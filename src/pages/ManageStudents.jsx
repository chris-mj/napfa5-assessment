import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { parseNapfaCsv } from '../utils/napfaCsv'
import { useToast } from '../components/ToastProvider'
import { normalizeStudentId } from '../utils/ids'

export default function ManageStudents({ user }) {
  const [membership, setMembership] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [query, setQuery] = useState('')
  const [filterClass, setFilterClass] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [showInactiveOnly, setShowInactiveOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [form, setForm] = useState({
    student_identifier: '',
    name: '',
    gender: '',
    dob: '',
    class: '',
    academic_year: new Date().getFullYear(),
  })
  const [submitting, setSubmitting] = useState(false)
  const [historyFor, setHistoryFor] = useState(null)
  const [history, setHistory] = useState([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editRowId, setEditRowId] = useState(null)
  const [editClass, setEditClass] = useState('')
  const [editYear, setEditYear] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importYear, setImportYear] = useState(new Date().getFullYear())
  const [importText, setImportText] = useState('')
  const [importParsing, setImportParsing] = useState(false)
  const [importPreview, setImportPreview] = useState(null)
  const [importDiffs, setImportDiffs] = useState([])
  const [importResult, setImportResult] = useState(null)
  const [importSummaryUrl, setImportSummaryUrl] = useState('')
  const [importProgress, setImportProgress] = useState(0)
  const { showToast } = useToast()

  useEffect(() => {
    if (!user?.id) return
    const loadMembership = async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('school_id, role')
        .eq('user_id', user.id)
        .maybeSingle()
      if (error) setError(error.message)
      setMembership(data || null)
    }
    loadMembership()
  }, [user?.id])

  // Responsive page size: 100 on tablet/desktop, 40 on mobile
  useEffect(() => {
    const calc = () => setPageSize(window.innerWidth < 768 ? 40 : 100)
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  useEffect(() => {
    const load = async () => {
      if (!membership?.school_id) return
      setLoading(true)
      setError('')
      const { data, error } = await supabase
        .from('enrollments')
        .select('id, class, academic_year, is_active, created_at, students(id, student_identifier, name, gender, dob)')
        .eq('school_id', membership.school_id)
        .order('class', { ascending: true })
        .order('academic_year', { ascending: false })
      if (error) setError(error.message)
      setRows(data || [])
      setLoading(false)
    }
    load()
  }, [membership?.school_id])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = showInactiveOnly ? rows.filter(r => !r.is_active) : rows.filter(r => r.is_active)
    const qFiltered = q ? base.filter(r => {
      const s = r.students || {}
      return (
        (s.student_identifier || '').toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q) ||
        (r.class || '').toLowerCase().includes(q)
      )
    }) : base
    const classFiltered = filterClass ? qFiltered.filter(r => (r.class || '').toLowerCase() === filterClass.toLowerCase()) : qFiltered
    const yearFiltered = filterYear ? classFiltered.filter(r => String(r.academic_year || '') === String(filterYear)) : classFiltered
    const sorted = [...yearFiltered].sort((a,b)=>{ const y=(b.academic_year||0)-(a.academic_year||0); if(y) return y; const c=String(a.class||'').localeCompare(String(b.class||''), undefined, { numeric:true, sensitivity:'base' }); if(c) return c; return String(a.students?.name||'').localeCompare(String(b.students?.name||''), undefined, { sensitivity:'base' }); })
    return sorted
  }, [rows, query, showInactiveOnly, filterClass, filterYear])

  const distinctClasses = useMemo(() => {
    const set = new Set((rows || []).map(r => (r.class || '').trim()).filter(Boolean))
    return Array.from(set).sort()
  }, [rows])

  const distinctYears = useMemo(() => {
    const set = new Set((rows || []).map(r => r.academic_year).filter(Boolean))
    return Array.from(set).sort((a,b)=>b-a)
  }, [rows])

  const [selectedEnrollments, setSelectedEnrollments] = useState(new Set())
  const headerSelectRef = useRef(null)
  // Per-row actions expander (kebab menu)
  const [openActions, setOpenActions] = useState(new Set())
  const toggleActionsFor = (rowId) => {
    setOpenActions(prev => {
      const next = new Set()
      if (!prev.has(rowId)) next.add(rowId) // only one open at a time
      return next
    })
  }
  // Close popovers on outside click or Escape
  useEffect(() => {
    const onDocDown = (e) => {
      try {
        const t = e.target
        const inside = t && typeof t.closest === 'function' && t.closest('[data-actions-rowid]')
        if (!inside) setOpenActions(new Set())
      } catch { setOpenActions(new Set()) }
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpenActions(new Set()) }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const paged = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const cur = Math.min(page, totalPages)
    const start = (cur - 1) * pageSize
    return { cur, totalPages, items: filtered.slice(start, start + pageSize) }
  }, [filtered, page])

  const allOnPageSelected = useMemo(() => (
    (paged.items || []).length > 0 && (paged.items || []).every(r => selectedEnrollments.has(r.id))
  ), [paged.items, selectedEnrollments])
  const someOnPageSelected = useMemo(() => (
    (paged.items || []).some(r => selectedEnrollments.has(r.id)) && !allOnPageSelected
  ), [paged.items, selectedEnrollments, allOnPageSelected])

  useEffect(() => {
    if (headerSelectRef.current) headerSelectRef.current.indeterminate = someOnPageSelected
  }, [someOnPageSelected])

  const toggleRowSelect = (id, checked) => {
    setSelectedEnrollments(prev => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }
  const toggleSelectAllOnPage = (checked) => {
    setSelectedEnrollments(prev => {
      const next = new Set(prev)
      for (const r of (paged.items || [])) {
        if (checked) next.add(r.id); else next.delete(r.id)
      }
      return next
    })
  }

  const bulkDeactivate = async () => {
    const ids = Array.from(selectedEnrollments)
    if (!ids.length) return
    try {
      const { error: uErr } = await supabase
        .from('enrollments')
        .update({ is_active: false })
        .in('id', ids)
        .eq('is_active', true)
      if (uErr) throw uErr
      const { data: latest } = await supabase
        .from('enrollments')
        .select('id, class, academic_year, is_active, created_at, students(id, student_identifier, name, gender, dob)')
        .eq('school_id', membership.school_id)
        .order('class', { ascending: true })
        .order('academic_year', { ascending: false })
      setRows(latest || [])
      setSelectedEnrollments(new Set())
      try { showToast('success', `Deactivated ${ids.length} enrollment(s).`) } catch {}
    } catch (e) {
      try { showToast('error', e?.message || 'Bulk deactivation failed.') } catch {}
    }
  }

  // Indicator: has enrollment(s) in other schools (any status)
  const [otherSchoolMap, setOtherSchoolMap] = useState(new Map())
  useEffect(() => {
    const load = async () => {
      const curSchool = membership?.school_id
      if (!curSchool) return
      const missing = (paged.items || [])
        .map(r => r?.students?.id)
        .filter(Boolean)
        .filter(id => !otherSchoolMap.has(id))
      if (!missing.length) return
      const next = new Map(otherSchoolMap)
      for (const sid of missing) {
        try {
          const { count } = await supabase
            .from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('student_id', sid)
            .neq('school_id', curSchool)
          next.set(sid, (count || 0) > 0)
        } catch {}
      }
      setOtherSchoolMap(next)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged.items, membership?.school_id])

  // Delete helpers (RPC-backed)
  const reloadEnrollments = async () => {
    const { data: latest } = await supabase
      .from('enrollments')
      .select('id, class, academic_year, is_active, created_at, students(id, student_identifier, name, gender, dob)')
      .eq('school_id', membership.school_id)
      .order('class', { ascending: true })
      .order('academic_year', { ascending: false })
    setRows(latest || [])
  }
  const removeFromSchool = async (row) => {
    try {
      if (!row?.students?.id || !membership?.school_id) return
      const idDisp = normalizeStudentId(row.students.student_identifier)
      const ok = window.confirm(`Remove ${row.students.name} (${idDisp}) from this school? This deletes this school's enrollments, roster, and scores for this student.`)
      if (!ok) return
      const { error } = await supabase.rpc('delete_student_in_school', { p_student: row.students.id, p_school: membership.school_id })
      if (error) throw error
      try { showToast('success', 'Removed from school.') } catch {}
      await reloadEnrollments()
    } catch (e) {
      try { showToast('error', e?.message || 'Remove failed.') } catch {}
    }
  }
  const deleteGlobally = async (row) => {
    try {
      if (!row?.students?.id) return
      const idDisp = normalizeStudentId(row.students.student_identifier)
      const ok = window.confirm(`DELETE ${row.students.name} (${idDisp}) globally? This deletes all enrollments, roster, scores and the student identity. This cannot be undone.`)
      if (!ok) return
      const { error } = await supabase.rpc('delete_student_global', { p_student: row.students.id })
      if (error) throw error
      try { showToast('success', 'Deleted globally.') } catch {}
      await reloadEnrollments()
    } catch (e) {
      try { showToast('error', e?.message || 'Global delete failed.') } catch {}
    }
  }


  const bulkActivate = async () => {
    const ids = Array.from(selectedEnrollments)
    if (!ids.length) return
    try {
      const { error: uErr } = await supabase
        .from("enrollments")
        .update({ is_active: true })
        .in("id", ids)
        .eq("is_active", false)
      if (uErr) throw uErr
      const { data: latest } = await supabase
        .from("enrollments")
        .select("id, class, academic_year, is_active, created_at, students(id, student_identifier, name, gender, dob)")
        .eq("school_id", membership.school_id)
        .order("class", { ascending: true })
        .order("academic_year", { ascending: false })
      setRows(latest || [])
      setSelectedEnrollments(new Set())
      try { showToast("success", `Activated ${ids.length} enrollment(s).`) } catch {}
    } catch (e) {
      try { showToast("error", e?.message || "Bulk activation failed.") } catch {}
    }
  }

  const handleForm = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const parseDdMmYyyyToIso = (val) => {
    if (!val) return null
    const s = String(val).trim()
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
    if (!m) return null
    const dd = String(parseInt(m[1], 10)).padStart(2, '0')
    const mm = String(parseInt(m[2], 10)).padStart(2, '0')
    const yyyy = m[3]
    const iso = `${yyyy}-${mm}-${dd}`
    if (isNaN(Date.parse(iso))) return null
    return iso
  }

  const formatDob = (d) => {
    if (!d) return '-'
    try {
      const dt = new Date(d)
      const dd = String(dt.getDate()).padStart(2,'0')
      const mm = String(dt.getMonth()+1).padStart(2,'0')
      const yyyy = dt.getFullYear()
      return `${dd}/${mm}/${yyyy}`
    } catch { return '-' }
  }

  // Purge flow removed

  const addOrEnroll = async (e) => {
    e.preventDefault()
    if (!membership?.school_id) return
    setSubmitting(true)
    setError('')
    try {
      // 1) Upsert student by student_identifier (update profile fields if provided)
      const dobIso = form.dob ? parseDdMmYyyyToIso(form.dob) : null
      if (form.dob && !dobIso) {
        throw new Error('DOB must be in DD/MM/YYYY format')
      }
      const payloadStudent = {
        student_identifier: normalizeStudentId(form.student_identifier),
        name: form.name?.trim(),
        gender: form.gender?.trim() || null,
        dob: dobIso,
      }
      const { data: student, error: sErr } = await supabase
        .from('students')
        .upsert(payloadStudent, { onConflict: 'student_identifier' })
        .select('id')
        .maybeSingle()
      if (sErr) throw sErr
      if (!student?.id) throw new Error('Failed to upsert student')

      // 2) Automatically deactivate any existing active enrollments for this student (across schools)
      await supabase
        .from('enrollments')
        .update({ is_active: false })
        .eq('student_id', student.id)
        .eq('is_active', true)

      // 3) Insert a new active enrollment in the current school
      const enrollmentPayload = {
        student_id: student.id,
        school_id: membership.school_id,
        class: form.class?.trim() || null,
        academic_year: form.academic_year ? Number(form.academic_year) : new Date().getFullYear(),
        is_active: true,
      }
      const { error: eErr } = await supabase
        .from('enrollments')
        .insert(enrollmentPayload)
      if (eErr) throw eErr

      // Clear and reload
      setForm({ student_identifier: '', name: '', gender: '', dob: '', class: '', academic_year: new Date().getFullYear() })
      // refresh list
      const { data: latest } = await supabase
        .from('enrollments')
        .select('id, class, academic_year, is_active, created_at, students(id, student_identifier, name, gender, dob)')
        .eq('school_id', membership.school_id)
        .eq('is_active', true)
        .order('class', { ascending: true })
      setRows(latest || [])
    } catch (e1) {
      setError(e1.message || 'Failed to enroll student')
    } finally {
      setSubmitting(false)
    }
  }

  // History + edit helpers
  const openHistory = async (studentId) => {
    setHistoryOpen(true)
    setHistory([])
    try {
      const { data } = await supabase
        .from('enrollments')
        .select('id, class, academic_year, is_active, created_at, school_id')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
      setHistory(data || [])
    } catch {}
  }
  const startEdit = (row) => { setEditRowId(row.id); setEditClass(row.class || ''); setEditYear(row.academic_year || new Date().getFullYear()) }
  const cancelEdit = () => { setEditRowId(null) }
  const saveEdit = async () => {
    if (!editRowId) return
    try {
      await supabase.from('enrollments').update({ class: editClass || null, academic_year: Number(editYear)||null }).eq('id', editRowId)
      const { data: latest } = await supabase
        .from('enrollments')
        .select('id, class, academic_year, is_active, created_at, students(id, student_identifier, name, gender, dob)')
        .eq('school_id', membership.school_id)
        .order('class', { ascending: true })
        .order('academic_year', { ascending: false })
      setRows(latest || [])
      setEditRowId(null)
    } catch (e) { setError(e.message || 'Failed to update enrollment') }
  }
  const toggleActive = async (row, nextActive) => {
    try {
      if (nextActive) {
        await supabase.from('enrollments').update({ is_active: false }).eq('student_id', row.students.id).eq('is_active', true)
      }
      await supabase.from('enrollments').update({ is_active: !!nextActive }).eq('id', row.id)
      const { data: latest } = await supabase
        .from('enrollments')
        .select('id, class, academic_year, is_active, created_at, students(id, student_identifier, name, gender, dob)')
        .eq('school_id', membership.school_id)
        .order('class', { ascending: true })
        .order('academic_year', { ascending: false })
      setRows(latest || [])
    } catch (e) { setError(e.message || 'Failed to change status') }
  }

  // Import helpers
  const onImportFile = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImportText(reader.result)
    reader.readAsText(file)
  }
  const parseImport = async () => {
    setImportParsing(true)
    try {
      const { rows, errors, summary } = parseNapfaCsv(importText || '', { academicYear: Number(importYear)||new Date().getFullYear(), schoolId: membership?.school_id })
      setImportPreview({ rows, errors, summary })
      setImportResult(null)
      if (importSummaryUrl) { try { URL.revokeObjectURL(importSummaryUrl) } catch {} setImportSummaryUrl('') }
      // Build diffs by comparing with current enrollments
      const ids = Array.from(new Set(rows.map(r => normalizeStudentId(r.id || "")).filter(Boolean)))
      
      if (!ids.length) { setImportDiffs([]); return }
      const { data: foundStudents } = await supabase.from('students').select('id, student_identifier').in('student_identifier', ids)
      const idMap = new Map((foundStudents||[]).map(s => [s.student_identifier.toUpperCase(), s.id]))
      const studentIds = Array.from(idMap.values())
      let enrolls = []
      if (studentIds.length) {
        const { data: ens } = await supabase.from('enrollments').select('id, student_id, school_id, class, academic_year, is_active').in('student_id', studentIds)
        enrolls = ens || []
      }
      const diffs = rows.map(r => {
        const sid = idMap.get((r.id||'').toUpperCase())
        const tgt = { school_id: membership?.school_id, class: r.class || null, year: r.academic_year || Number(importYear) }
        if (!sid) return { id: r.id, name: r.name, action: 'create student + enroll', detail: `${tgt.class || '-'} / ${tgt.year}` }
        const eAll = enrolls.filter(e => e.student_id === sid)
        const matchActive = eAll.find(e => e.school_id === tgt.school_id && (e.class||null) === tgt.class && e.academic_year === tgt.year && e.is_active)
        if (matchActive) return { id: r.id, name: r.name, action: 'no change', detail: `${tgt.class || '-'} / ${tgt.year}` }
        const sameYear = eAll.find(e => e.school_id === tgt.school_id && e.academic_year === tgt.year)
        if (sameYear) return { id: r.id, name: r.name, action: `update class ${sameYear.class||'-'} {'\u2192'} ${tgt.class||'-'}`, detail: `${tgt.year}` }
        return { id: r.id, name: r.name, action: 'new enrollment', detail: `${tgt.class || '-'} / ${tgt.year}` }
      })
      setImportDiffs(diffs)
    } catch (e) {
      setImportPreview({ rows: [], errors: [{ message: e.message }], summary: { parsed: 0 } })
      setImportDiffs([])
    } finally { setImportParsing(false) }
  }
  const runImport = async () => {
    
    if (!importPreview?.rows?.length || !membership?.school_id) { try { showToast('error', `Import cannot start. Rows: ${importPreview?.rows?.length||0}, School: ${membership?.school_id||'-'}`) } catch {} ; return }
    setImportParsing(true)
    setImportProgress(0)
    try { showToast('info', `Starting import of ${importPreview?.rows?.length||0} rows…`) } catch {}
    
    let created = 0, updated = 0, exists = 0, failed = 0
    const details = []
    const total = importPreview.rows.length
    for (let idx = 0; idx < importPreview.rows.length; idx++) {
      const r = importPreview.rows[idx]
      try {
        const targetClass = r.class || null
        const targetYear = r.academic_year || Number(importYear)
        const targetSchool = membership.school_id
        // Upsert student
        const payloadStudent = { student_identifier: normalizeStudentId(r.id), name: r.name, gender: r.gender, dob: r.dob }
        const { data: st, error: sErr } = await supabase.from('students').upsert(payloadStudent, { onConflict: 'student_identifier' }).select('id').maybeSingle()
        if (sErr || !st?.id) { throw sErr || new Error('no student id') }

        // Fetch enrollments for this student
        const { data: enrolls, error: eFetchErr } = await supabase
          .from('enrollments')
          .select('id, school_id, class, academic_year, is_active')
          .eq('student_id', st.id)
        if (eFetchErr) { throw eFetchErr }

        const matchActive = (enrolls || []).find(e => e.school_id === targetSchool && (e.class || null) === targetClass && e.academic_year === targetYear && e.is_active)
        if (matchActive) { exists++; details.push({ id: r.id, name: r.name, result: 'already exists', detail: `${targetClass || '-'} / ${targetYear}` }); continue }

        // Try to reuse same school+year row if present (even if inactive or different class)
        const sameYearRow = (enrolls || []).find(e => e.school_id === targetSchool && e.academic_year === targetYear)
        if (sameYearRow) {
          // Deactivate other active enrollments first (skip if none active)
          const hasOtherActive = (enrolls || []).some(e => e.is_active && e.id !== sameYearRow.id)
          if (hasOtherActive) {
            const { error: deactErr } = await supabase
              .from('enrollments')
              .update({ is_active: false })
              .eq('student_id', st.id)
              .eq('is_active', true)
              .neq('id', sameYearRow.id)
            if (deactErr) { }
          }
          // Update this row to target class and activate
          const { error: uErr } = await supabase.from('enrollments').update({ class: targetClass, is_active: true }).eq('id', sameYearRow.id)
          if (uErr) { throw uErr }
          updated++
          details.push({ id: r.id, name: r.name, result: `updated`, detail: `class ${sameYearRow.class||'-'} {'\u2192'} ${targetClass||'-'} @ ${targetYear}` })
        } else {
          // Deactivate any active enrollments; then insert new (skip if none active)
            const hasActive = (enrolls || []).some(e => e.is_active)
            if (hasActive) {
              const { error: deact2Err } = await supabase
                .from('enrollments')
                .update({ is_active: false })
                .eq('student_id', st.id)
                .eq('is_active', true)
              if (deact2Err) { }
            }
            const { error: iErr } = await supabase.from('enrollments').insert({ student_id: st.id, school_id: targetSchool, class: targetClass, academic_year: targetYear, is_active: true })
            if (iErr) { throw iErr }
          created++
          details.push({ id: r.id, name: r.name, result: 'created', detail: `${targetClass || '-'} / ${targetYear}` })
        }
      } catch (e) { failed++; details.push({ id: r.id, name: r.name, result: 'failed', detail: e?.message || '-' }) }
      // progress update
      try { setImportProgress((idx + 1) / total) } catch {}
    }
    // refresh list
    const { data: latest } = await supabase
      .from('enrollments')
      .select('id, class, academic_year, is_active, created_at, students(id, student_identifier, name, gender, dob)')
      .eq('school_id', membership.school_id)
      .order('class', { ascending: true })
      .order('academic_year', { ascending: false })
    setRows(latest || [])
    // Build summary CSV
    const header = 'Student ID,Name,Result,Detail\n'
    const body = details.map(d => [d.id, d.name || '', d.result, d.detail || ''].map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n')
    const csv = header + body
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    setImportSummaryUrl(url)
    setImportResult({ created, updated, exists, failed, total: importPreview.rows.length })
    setImportParsing(false)
    showToast('success', `Import done. Created: ${created}, Updated: ${updated}, Already exists: ${exists}, Failed: ${failed}`)
    try {
      const validUuid = (v) => typeof v === 'string' && /[0-9a-fA-F-]{36}/.test(v)
      const sch = validUuid(membership?.school_id) ? membership.school_id : null
      await supabase.rpc('audit_log_event', {
        p_entity_type: 'import_students',
        p_action: 'complete',
        p_entity_id: null,
        p_school_id: sch,
        p_session_id: null,
        p_details: { created, updated, exists, failed, total: importPreview.rows.length }
      })
    } catch {}
  }
  return (
    <main className="w-full">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Manage Students</h1>
          <p className="text-sm text-gray-600">
              This manages all the students in your school.
              <br />A student enrollment is a student who is enrolled in a school: assigned with an academic year and a class.
              <br />Adding a student (with the same cockpit ID) will automatically deactivate any existing active enrollment, even from another school.</p>
        </header>

        {/* Add / Enroll */}
        <section className="border rounded-lg p-4 bg-white shadow-sm">
          <h2 className="font-medium mb-3">Add Student / Enroll in School</h2>
          <form onSubmit={addOrEnroll} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm">
              Student ID
              <input name="student_identifier" value={form.student_identifier} onChange={handleForm} className="w-full p-2 border rounded mt-1" placeholder="e.g., S12345" required />
            </label>
            <label className="text-sm">
              Name
              <input name="name" value={form.name} onChange={handleForm} className="w-full p-2 border rounded mt-1" placeholder="Full name" required />
            </label>
            <label className="text-sm">
              Gender
              <select name="gender" value={form.gender} onChange={handleForm} className="w-full p-2 border rounded mt-1">
                <option value="">-</option>
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </label>
            <label className="text-sm">
              DOB
              <input name="dob" type="text" inputMode="numeric" placeholder="DD/MM/YYYY" value={form.dob} onChange={handleForm} className="w-full p-2 border rounded mt-1" />
            </label>
            <label className="text-sm">
              Class
              <input name="class" value={form.class} onChange={handleForm} className="w-full p-2 border rounded mt-1" placeholder="e.g., 2E1" />
            </label>
            <label className="text-sm">
              Academic Year
              <input name="academic_year" value={form.academic_year} onChange={handleForm} className="w-full p-2 border rounded mt-1" type="number" step="1" />
            </label>
            <div className="md:col-span-3 flex gap-2">
              <button type="submit" disabled={submitting || !membership?.school_id} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-60">
                {submitting ? 'Saving...' : 'Save Enrollment'}
              </button>
              {error && <div className="text-sm text-red-600 self-center">{error}</div>}
            </div>
          </form>
          <div className="text-xs text-gray-600 mt-2">Note: If the student already exists, their profile is updated and any previous active enrollment is automatically set inactive.</div>
          {/* ID format helper */}
          <div className="mt-3 text-sm text-gray-700 border border-blue-200 bg-blue-50 rounded p-3">
            <div className="font-medium text-blue-900 mb-1">Tip: If you want to use your own Student ID format</div>
            <ul className="list-disc pl-5 space-y-1 text-blue-900">
                <li>
                    Do use the same cockpit student ID from the PFT file.
                </li>
                <li>
                If really necessary, you can use your own Student IDs. Use your school acronym, year, class and index. Example: <span className="font-mono">ABSS25_2A-1</span>
              </li>
              <li>
                Allowed characters: A-Z, 0-9, underscore <span className="font-mono">_</span> and hyphen <span className="font-mono">-</span>. Avoid spaces.
              </li>
              <li>
                IDs are stored uppercased. Numeric-only IDs are left-padded to 14 digits; alphanumeric IDs (like the example above) are not padded.
              </li>
            </ul>
          </div>
        </section>

        {/* Search, Filters & Import */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input value={query} onChange={(e)=>{ setQuery(e.target.value); setPage(1) }} placeholder="Search by ID, name or class" className="w-full md:max-w-sm p-2 border rounded" />
            <select value={filterClass} onChange={(e)=>{ setFilterClass(e.target.value); setPage(1) }} className="p-2 border rounded">
              <option value="">All classes</option>
              {distinctClasses.map(c => (<option key={c} value={c}>{c}</option>))}
            </select>
            <select value={filterYear} onChange={(e)=>{ setFilterYear(e.target.value); setPage(1) }} className="p-2 border rounded">
              <option value="">All years</option>
              {distinctYears.map(y => (<option key={y} value={y}>{y}</option>))}
            </select>
            <div className="inline-flex items-center rounded border overflow-hidden">
  <button
    type="button"
    aria-pressed={!showInactiveOnly}
    onClick={() => { if (showInactiveOnly) { setShowInactiveOnly(false); setPage(1) } }}
    className={(!showInactiveOnly)
      ? "px-3 py-2 bg-green-600 text-white"
      : "px-3 py-2 bg-white text-gray-700 hover:bg-gray-50"}
  >
    Active
  </button>
  <button
    type="button"
    aria-pressed={showInactiveOnly}
    onClick={() => { if (!showInactiveOnly) { setShowInactiveOnly(true); setPage(1) } }}
    className={(showInactiveOnly)
      ? "px-3 py-2 bg-gray-600 text-white"
      : "px-3 py-2 bg-white text-gray-700 hover:bg-gray-50"}
  >
    Inactive
  </button>
</div>
            <div className="ml-auto flex items-center gap-2">
                <button onClick={bulkActivate} disabled={selectedEnrollments.size===0} className="px-3 py-2 border rounded bg-white hover:bg-gray-50 disabled:opacity-60">Activate Selected</button>
                <button onClick={bulkDeactivate} disabled={selectedEnrollments.size===0} className="px-3 py-2 border rounded bg-white hover:bg-gray-50 disabled:opacity-60">Deactivate Selected</button>
                <a href="/pft_template.csv" download className="px-3 py-2 border rounded hover:bg-gray-50">Download PFT template</a>
                <button onClick={()=> setImportOpen(true)} className="px-3 py-2 border rounded hover:bg-gray-50">Import PFT</button>
                {/* Purge School Data button removed */}
              </div>
              {/* Danger zone note removed */}
          </div>

            <div className="overflow-x-auto border rounded">
            <table className="min-w-[1050px] w-full">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="border px-2 py-2 w-10"><input ref={headerSelectRef} type="checkbox" checked={allOnPageSelected} onChange={(e)=>toggleSelectAllOnPage(e.target.checked)} /></th>
                  <th className="border px-3 py-2">Student ID</th>
                  <th className="border px-3 py-2">Name</th>
                  <th className="border px-3 py-2">Gender</th>
                  <th className="border px-3 py-2">DOB</th>
                  <th className="border px-3 py-2">Class</th>
                  <th className="border px-3 py-2">Academic Year</th>
                  <th className="border px-3 py-2">Status</th>
                  <th className="border px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="9" className="px-3 py-3 text-sm">Loading...</td></tr>
                ) : (
                  <>
                    {paged.items.length ? (
                      <>
                        <tr>
                          <td colSpan="9" className="px-3 py-1 text-xs text-gray-600">Selected: {selectedEnrollments.size}</td>
                        </tr>
                        {paged.items.map((r) => (
                      <tr key={r.id} className={"odd:bg-white even:bg-gray-50 border-l-4 " + (r.is_active ? "opacity-100 border-l-green-500" : "opacity-60 border-l-gray-400") }>
                        <td className="border px-2 py-2 w-10"><input type="checkbox" checked={selectedEnrollments.has(r.id)} onChange={(e)=>toggleRowSelect(r.id, e.target.checked)} /></td>
                        <td className="border px-3 py-2">{normalizeStudentId(r.students?.student_identifier)}</td>
                        <td className="border px-3 py-2">
                          <button className="underline decoration-dotted underline-offset-2" onClick={()=>{ setHistoryFor(r.students); openHistory(r.students.id) }}>{r.students?.name}</button>
                        </td>
                      <td className="border px-3 py-2">{r.students?.gender || '-'}</td>
                      <td className="border px-3 py-2">{formatDob(r.students?.dob)}</td>
                      <td className="border px-3 py-2">
                        {editRowId === r.id ? (
                          <input className="p-1 border rounded w-32" value={editClass} onChange={(e)=>setEditClass(e.target.value)} />
                        ) : (r.class || '-')}
                      </td>
                      <td className="border px-3 py-2">
                        {editRowId === r.id ? (
                          <input className="p-1 border rounded w-24" type="number" step="1" value={editYear} onChange={(e)=>setEditYear(e.target.value)} />
                        ) : (r.academic_year || '-')}
                      </td>
                      <td className="border px-3 py-2">{r.is_active ? (<span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-green-50 text-green-700 border border-green-200">Active</span>) : (<span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700 border border-gray-300"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="opacity-80"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg> Inactive</span>)}</td>
                      <td className="border px-3 py-2">
                        {editRowId === r.id ? (
                          <div className="flex gap-2">
                            <button onClick={saveEdit} className="px-2 py-1 text-sm border rounded hover:bg-gray-50">Save</button>
                            <button onClick={cancelEdit} className="px-2 py-1 text-sm border rounded hover:bg-gray-50">Cancel</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button onClick={()=>startEdit(r)} className="px-2 py-1 text-sm border rounded hover:bg-gray-50">Edit</button>
                            {r.is_active ? (
                              <button onClick={()=>toggleActive(r, false)} className="px-2 py-1 text-sm border rounded hover:bg-gray-50">Deactivate</button>
                            ) : (
                              <button onClick={()=>toggleActive(r, true)} className="px-2 py-1 text-sm border rounded hover:bg-gray-50">Reactivate</button>
                            )}
                            {otherSchoolMap.get(r?.students?.id) && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-amber-50 text-amber-800 border border-amber-200" title="Has enrollment in other school(s)">Other school</span>
                            )}
                            {/* Kebab (vertical triple-dot) opens a small popover menu */}
                            <div className="relative" data-actions-rowid={r.id}>
                              <button
                                onClick={() => toggleActionsFor(r.id)}
                                className="px-2 py-1 border rounded hover:bg-gray-50"
                                aria-expanded={openActions.has(r.id)}
                                title={openActions.has(r.id) ? 'Hide actions' : 'More actions'}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                  <circle cx="12" cy="5" r="2"></circle>
                                  <circle cx="12" cy="12" r="2"></circle>
                                  <circle cx="12" cy="19" r="2"></circle>
                                </svg>
                              </button>
                              {openActions.has(r.id) && (
                                <div className="absolute right-0 top-full mt-1 w-56 bg-white border rounded shadow-lg z-20">
                                  <button
                                    onClick={() => { toggleActionsFor(r.id); removeFromSchool(r) }}
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 text-red-700"
                                  >
                                    Remove from school
                                  </button>
                                  {String(membership?.role).toLowerCase() === 'superadmin' && (
                                    <button
                                      onClick={() => { toggleActionsFor(r.id); deleteGlobally(r) }}
                                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 text-red-800"
                                    >
                                      Delete globally
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                      </>
                    ) : (
                  <tr><td colSpan="9" className="px-3 py-6 text-center text-sm text-gray-600">No students found.</td></tr>
                )}
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm mt-2">
            <div className="flex items-center gap-4">
              <div>Showing {(paged.cur-1)*pageSize + (filtered.length?1:0)}-{Math.min(paged.cur*pageSize, filtered.length)} of {filtered.length}</div>
              <div className="text-xs text-gray-600">Selected: {selectedEnrollments.size}</div>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={paged.cur<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Prev</button>
              <div>Page {paged.cur} / {paged.totalPages}</div>
              <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={paged.cur>=paged.totalPages} onClick={()=>setPage(p=>Math.min(paged.totalPages,p+1))}>Next</button>
            </div>
          </div>
        </section>
      </div>

      {/* History Modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={()=>setHistoryOpen(false)}>
          <div className="bg-white rounded shadow-xl w-full max-w-2xl" onClick={(e)=>e.stopPropagation()}>
            <div className="px-4 py-2 border-b flex items-center justify-between">
              <div className="font-medium">Enrollment History {historyFor ? `- ${historyFor.name} (${normalizeStudentId(historyFor.student_identifier)})` : ''}</div>
              <button className="px-2 py-1 border rounded" onClick={()=>setHistoryOpen(false)}>Close</button>
            </div>
            <div className="p-4">
              {history.length ? (
                <table className="w-full">
                  <thead>
                    <tr className="text-left bg-gray-100">
                      <th className="px-2 py-1 border">Class</th>
                      <th className="px-2 py-1 border">Year</th>
                      <th className="px-2 py-1 border">Status</th>
                      <th className="px-2 py-1 border">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(h => (
                      <tr key={h.id}>
                        <td className="px-2 py-1 border">{h.class || '-'}</td>
                        <td className="px-2 py-1 border">{h.academic_year || '-'}</td>
                        <td className="px-2 py-1 border">{h.is_active ? 'Active' : 'Inactive'}</td>
                        <td className="px-2 py-1 border">{h.created_at ? new Date(h.created_at).toLocaleString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-sm text-gray-600">No history available.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {importOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={()=>setImportOpen(false)}>
          <div className="bg-white rounded shadow-xl w-full max-w-3xl" onClick={(e)=>e.stopPropagation()}>
            <div className="px-4 py-2 border-b flex items-center justify-between">
              <div className="font-medium">Import Students (CSV)</div>
              <button className="px-2 py-1 border rounded" onClick={()=>setImportOpen(false)}>Close</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm">Academic Year
                  <input className="ml-2 p-1 border rounded w-28" type="number" step="1" value={importYear} onChange={(e)=>setImportYear(e.target.value)} />
                </label>
                <input type="file" accept=".csv,text/csv" onChange={(e)=>onImportFile(e.target.files?.[0])} />
              </div>
              <textarea className="w-full h-48 p-2 border rounded font-mono text-xs" placeholder="Paste CSV here..." value={importText} onChange={(e)=>setImportText(e.target.value)} />
              <div className="flex items-center gap-2">
                <button className="px-3 py-2 border rounded hover:bg-gray-50" onClick={() => { parseImport() }} disabled={importParsing}>Parse</button>
                {importPreview && (
                  <>
                    <div className="text-sm text-gray-700">Parsed: {importPreview.summary?.parsed || 0} rows • Errors: {importPreview.errors?.length || 0}</div>
                    <button className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-60" onClick={() => { try { showToast("info", "Import clicked") } catch {}; runImport() }} disabled={importParsing || !(importPreview.rows?.length)}>Import</button>
                  </>
                )}
              </div>
				{importParsing && importPreview?.rows?.length ? (
				  <div className="w-full">
					<div className="w-full border rounded bg-gray-100 h-3 overflow-hidden" aria-label="Import progress">
					  <div className="h-3 bg-blue-500 transition-all" style={{ width: `${Math.round(importProgress*100)}%` }} />
					</div>
					<div className="text-xs text-gray-600 mt-1">Importing {Math.round(importProgress*100)}% ({Math.round(importProgress*importPreview.rows.length)}/{importPreview.rows.length})</div>
				  </div>
				) : null}
              {importPreview && (
                <>
                {/* Summary banner */}
                {(() => {
                  const planned = importDiffs || [];
                  const created = planned.filter(d => d.action === 'new enrollment' || d.action === 'create student + enroll').length;
                  const updated = planned.filter(d => String(d.action||'').startsWith('update class')).length;
                  const exists = planned.filter(d => d.action === 'no change').length;
                  const parseErrs = importPreview?.errors?.length || 0;
                  return (
                    <div className="border border-blue-200 bg-blue-50 text-blue-900 rounded p-2 text-sm mb-2">
                      Planned: To create {created}, To update {updated}, Already exists {exists}. Parse errors: {parseErrs}.
                    </div>
                  );
                })()}

                <div className="max-h-48 overflow-auto border rounded p-2 bg-gray-50 text-xs">
                  <div className="font-medium mb-1">Planned changes (first 30):</div>
                  {(importDiffs || []).slice(0,30).map((d,i)=> (
                    <div key={i} className="py-0.5">{d.id} - {d.name || '-'}: {d.action} ({d.detail})</div>
                  ))}
                </div>
                {importResult && (
                  <div className="border border-green-200 bg-green-50 text-green-900 rounded p-2 text-sm">
                    Import result: Created {importResult.created}, Updated {importResult.updated}, Already exists {importResult.exists}, Failed {importResult.failed} of {importResult.total} rows.
                    {importSummaryUrl && (
                      <a className="ml-3 underline" href={importSummaryUrl} download={`import_summary_${Date.now()}.csv`}>Download detailed summary</a>
                    )}
                  </div>
                )}
                </>
              )}
              {importPreview?.errors?.length ? (
                <div className="max-h-40 overflow-auto border rounded p-2 bg-red-50 text-sm">
                  {importPreview.errors.slice(0,50).map((e, i)=> (<div key={i}>{'\u2022'} {e.message || JSON.stringify(e)}</div>))}
                  {importPreview.errors.length > 50 && <div>...and more</div>}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}



















