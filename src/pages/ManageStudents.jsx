import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { parseNapfaCsv } from '../utils/napfaCsv'
import { useToast } from '../components/ToastProvider'

export default function ManageStudents({ user }) {
  const [membership, setMembership] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [query, setQuery] = useState('')
  const [filterClass, setFilterClass] = useState('')
  const [filterYear, setFilterYear] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
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
    const base = includeInactive ? rows : rows.filter(r => r.is_active)
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
    return yearFiltered
  }, [rows, query, includeInactive, filterClass, filterYear])

  const distinctClasses = useMemo(() => {
    const set = new Set((rows || []).map(r => (r.class || '').trim()).filter(Boolean))
    return Array.from(set).sort()
  }, [rows])

  const distinctYears = useMemo(() => {
    const set = new Set((rows || []).map(r => r.academic_year).filter(Boolean))
    return Array.from(set).sort((a,b)=>b-a)
  }, [rows])

  const paged = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const cur = Math.min(page, totalPages)
    const start = (cur - 1) * pageSize
    return { cur, totalPages, items: filtered.slice(start, start + pageSize) }
  }, [filtered, page])

  const handleForm = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

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

  const addOrEnroll = async (e) => {
    e.preventDefault()
    if (!membership?.school_id) return
    setSubmitting(true)
    setError('')
    try {
      // 1) Upsert student by student_identifier (update profile fields if provided)
      const payloadStudent = {
        student_identifier: (form.student_identifier || '').trim().toUpperCase(),
        name: form.name?.trim(),
        gender: form.gender?.trim() || null,
        dob: form.dob || null,
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
      const ids = Array.from(new Set(rows.map(r => (r.id || '').toUpperCase()).filter(Boolean)))
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
        if (sameYear) return { id: r.id, name: r.name, action: `update class ${sameYear.class||'-'} → ${tgt.class||'-'}`, detail: `${tgt.year}` }
        return { id: r.id, name: r.name, action: 'new enrollment', detail: `${tgt.class || '-'} / ${tgt.year}` }
      })
      setImportDiffs(diffs)
    } catch (e) {
      setImportPreview({ rows: [], errors: [{ message: e.message }], summary: { parsed: 0 } })
      setImportDiffs([])
    } finally { setImportParsing(false) }
  }
  const runImport = async () => {
    if (!importPreview?.rows?.length || !membership?.school_id) return
    setImportParsing(true)
    let created = 0, updated = 0, exists = 0, failed = 0
    const details = []
    for (const r of importPreview.rows) {
      try {
        const targetClass = r.class || null
        const targetYear = r.academic_year || Number(importYear)
        const targetSchool = membership.school_id
        // Upsert student
        const payloadStudent = { student_identifier: r.id.toUpperCase(), name: r.name, gender: r.gender, dob: r.dob }
        const { data: st, error: sErr } = await supabase.from('students').upsert(payloadStudent, { onConflict: 'student_identifier' }).select('id').maybeSingle()
        if (sErr || !st?.id) throw sErr || new Error('no student id')

        // Fetch enrollments for this student
        const { data: enrolls } = await supabase
          .from('enrollments')
          .select('id, school_id, class, academic_year, is_active')
          .eq('student_id', st.id)

        const matchActive = (enrolls || []).find(e => e.school_id === targetSchool && (e.class || null) === targetClass && e.academic_year === targetYear && e.is_active)
        if (matchActive) { exists++; details.push({ id: r.id, name: r.name, result: 'already exists', detail: `${targetClass || '-'} / ${targetYear}` }); continue }

        // Try to reuse same school+year row if present (even if inactive or different class)
        const sameYearRow = (enrolls || []).find(e => e.school_id === targetSchool && e.academic_year === targetYear)
        if (sameYearRow) {
          // Deactivate other active enrollments first
          await supabase.from('enrollments').update({ is_active: false }).eq('student_id', st.id).eq('is_active', true).neq('id', sameYearRow.id)
          // Update this row to target class and activate
          const { error: uErr } = await supabase.from('enrollments').update({ class: targetClass, is_active: true }).eq('id', sameYearRow.id)
          if (uErr) throw uErr
          updated++
          details.push({ id: r.id, name: r.name, result: `updated`, detail: `class ${sameYearRow.class||'-'} → ${targetClass||'-'} @ ${targetYear}` })
        } else {
          // Deactivate any active enrollments; then insert new
          await supabase.from('enrollments').update({ is_active: false }).eq('student_id', st.id).eq('is_active', true)
          const { error: iErr } = await supabase.from('enrollments').insert({ student_id: st.id, school_id: targetSchool, class: targetClass, academic_year: targetYear, is_active: true })
          if (iErr) throw iErr
          created++
          details.push({ id: r.id, name: r.name, result: 'created', detail: `${targetClass || '-'} / ${targetYear}` })
        }
      } catch { failed++; details.push({ id: r.id, name: r.name, result: 'failed', detail: '-' }) }
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
  }
  return (
    <main className="w-full">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Manage Students</h1>
          <p className="text-sm text-gray-600">Enroll students in your school, manage active enrollments, and keep profiles up to date. Adding a student will automatically deactivate any existing active enrollment elsewhere.</p>
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
              <input name="dob" type="date" value={form.dob} onChange={handleForm} className="w-full p-2 border rounded mt-1" />
            </label>
            <label className="text-sm">
              Class
              <input name="class" value={form.class} onChange={handleForm} className="w-full p-2 border rounded mt-1" placeholder="e.g., Sec 2E1" />
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
          <div className="text-xs text-gray-600 mt-2">Note: If the student already exists, their profile is updated and any previous active enrollment is automatically set inactive. A new active enrollment is created in this school.</div>
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
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeInactive} onChange={(e)=>{ setIncludeInactive(e.target.checked); setPage(1) }} /> Include inactive
            </label>
            <div className="ml-auto flex items-center gap-2">
              <a href="/pft_template.csv" download className="px-3 py-2 border rounded hover:bg-gray-50">Download PFT template</a>
              <button onClick={()=> setImportOpen(true)} className="px-3 py-2 border rounded hover:bg-gray-50">Import PFT</button>
            </div>
          </div>

          <div className="overflow-x-auto border rounded">
            <table className="min-w-[1050px] w-full">
              <thead>
                <tr className="bg-gray-100 text-left">
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
                  <tr><td colSpan="7" className="px-3 py-3 text-sm">Loading...</td></tr>
                ) : paged.items.length ? (
                  paged.items.map((r) => (
                    <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                      <td className="border px-3 py-2">{r.students?.student_identifier}</td>
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
                      <td className="border px-3 py-2">{r.is_active ? 'Active' : 'Inactive'}</td>
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
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan="7" className="px-3 py-6 text-center text-sm text-gray-600">No students found.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm mt-2">
            <div>Showing {(paged.cur-1)*pageSize + (filtered.length?1:0)}-{Math.min(paged.cur*pageSize, filtered.length)} of {filtered.length}</div>
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
              <div className="font-medium">Enrollment History {historyFor ? `- ${historyFor.name} (${historyFor.student_identifier})` : ''}</div>
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
                <button className="px-3 py-2 border rounded hover:bg-gray-50" onClick={parseImport} disabled={importParsing}>Parse</button>
                {importPreview && (
                  <>
                    <div className="text-sm text-gray-700">Parsed: {importPreview.summary?.parsed || 0} rows • Errors: {importPreview.errors?.length || 0}</div>
                    <button className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-60" onClick={runImport} disabled={importParsing || !(importPreview.rows?.length)}>Import</button>
                  </>
                )}
              </div>
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
                      Planned: Created {created}, Updated {updated}, Already exists {exists}. Parse errors: {parseErrs}.
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
                  {importPreview.errors.slice(0,50).map((e, i)=> (<div key={i}>• {e.message || JSON.stringify(e)}</div>))}
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
