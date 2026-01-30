import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { evaluateNapfa, normalizeSex, secondsToMmss } from '../utils/napfaStandards'

export default function PftCalculator({ user }) {
  const [membership, setMembership] = useState(null)
  const [schoolType, setSchoolType] = useState(null) // 'primary' | 'secondary' | 'jc' etc (we'll map to Primary/Secondary)
  const [files, setFiles] = useState([])
  const [mode, setMode] = useState('auto') // 'auto' | '1.6' | '2.4'
  const [defaultDate, setDefaultDate] = useState(() => new Date().toISOString().slice(0,10)) // yyyy-mm-dd
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  // Source toggle and session state
  const [source, setSource] = useState('upload') // 'upload' | 'session'
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState('')
  const [sessionMeta, setSessionMeta] = useState(null)

  useEffect(() => {
    let ignore = false
    const load = async () => {
      try {
        if (!user?.id) return
        const { data: mems } = await supabase
          .from('memberships')
          .select('id, school_id, role')
          .eq('user_id', user.id)
        const m = (mems || [])[0] || null
        if (!m) { if (!ignore) { setMembership(null); setSchoolType(null) } ; return }
        if (!ignore) setMembership(m)
        if (m?.school_id) {
          const { data: sch } = await supabase
            .from('schools')
            .select('id, type')
            .eq('id', m.school_id)
            .maybeSingle()
          if (!ignore) setSchoolType(sch?.type || null)
          // Load sessions for this school (new)
          const { data: sess } = await supabase
            .from('sessions')
            .select('id, title, session_date, status')
            .eq('school_id', m.school_id)
            .order('session_date', { ascending: false })
          if (!ignore) setSessions(sess || [])
        }
      } catch {
        if (!ignore) { setMembership(null); setSchoolType(null) }
      }
    }
    load()
    return () => { ignore = true }
  }, [user?.id])

  const levelLabel = useMemo(() => {
    // Map DB type to standards level label
    const t = String(schoolType || '').toLowerCase()
    return t === 'primary' ? 'Primary' : 'Secondary'
  }, [schoolType])

  const onChooseFiles = (e) => {
    const list = Array.from(e.target.files || [])
    setFiles(list)
  }

  function appendLog(entry) { try { setLog(prev => [...prev, entry]) } catch {} }

  function parseDateDDMMYYYY(s) {
    if (!s) return null
    const m = String(s).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
    if (!m) return null
    let dd = parseInt(m[1], 10), mm = parseInt(m[2], 10), yy = m[3]
    if (String(yy).length === 2) yy = (parseInt(yy,10) > 50 ? '19' : '20') + yy
    const iso = `${yy.padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`
    const d = new Date(iso)
    return isNaN(d.getTime()) ? null : d
  }

  function parseDobToISO(s) {
    if (!s) return null
    const m = String(s).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/)
    if (!m) return null
    let dd = parseInt(m[1],10), mm = parseInt(m[2],10), yy = m[3]
    if (String(yy).length === 2) yy = (parseInt(yy,10) > 50 ? '19' : '20') + yy
    const iso = `${yy.padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`
    return isNaN(Date.parse(iso)) ? null : iso
  }

  // Accepts compact run timing formats from PFT: mmss or mss (and also m:ss)
  function parseRunToSeconds(val) {
    if (val == null) return null
    const s = String(val).trim()
    if (!s) return null
    // Pure digits: 3 or 4 length (mss or mmss)
    if (/^\d{3,4}$/.test(s)) {
      const mm = parseInt(s.slice(0, s.length - 2), 10)
      const ss = parseInt(s.slice(-2), 10)
      if (Number.isFinite(mm) && Number.isFinite(ss)) return (mm * 60) + ss
      return null
    }
    // With colon m:ss or mm:ss
    const m = s.match(/^(\d{1,2}):(\d{2})$/)
    if (m) {
      const mm = parseInt(m[1], 10)
      const ss = parseInt(m[2], 10)
      if (Number.isFinite(mm) && Number.isFinite(ss)) return (mm * 60) + ss
    }
    return null
  }

  function toIntOrNull(v) {
    if (v == null) return null
    const s = String(v).replace(/[^0-9\-]/g, '').trim()
    if (!s) return null
    const n = parseInt(s, 10)
    return Number.isFinite(n) ? n : null
  }

  function toFloatOrNull(v) {
    if (v == null) return null
    const s = String(v).replace(/[^0-9.\-]/g, '').trim()
    if (!s) return null
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  }

  function splitCsvLine(line) {
    const out = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQuotes) {
        if (ch === '"') {
          if (line[i+1] === '"') { cur += '"'; i++ } else { inQuotes = false }
        } else {
          cur += ch
        }
      } else {
        if (ch === ',') { out.push(cur.trim()); cur = '' }
        else if (ch === '"') { inQuotes = true }
        else { cur += ch }
      }
    }
    out.push(cur.trim())
    return out
  }

  function findHeaderIndex(lines) {
    for (let i = 0; i < Math.min(lines.length, 60); i++) {
      const cols = splitCsvLine(lines[i])
      const s = cols.map(c => String(c||'').toLowerCase()).join(' ')
      if (cols.length >= 8 && s.includes('name') && s.includes('id') && s.includes('gender')) return i
    }
    return 20 // default spec: header at row 21, data from 22
  }

  function calcAgeAt(dobISO, testDate) {
    if (!dobISO) return null
    try {
      const birth = new Date(dobISO)
      const now = testDate ? new Date(testDate) : new Date()
      let age = now.getFullYear() - birth.getFullYear()
      const m = now.getMonth() - birth.getMonth()
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
      return age
    } catch { return null }
  }

  function csvCell(v) {
    const s = v == null ? '' : String(v)
    return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g,'""')}"` : s
  }

  function fmtDdMmYyyy(d) {
    if (!d) return ''
    try {
      const dt = (d instanceof Date) ? d : new Date(d)
      const dd = String(dt.getDate()).padStart(2,'0')
      const mm = String(dt.getMonth()+1).padStart(2,'0')
      const yy = String(dt.getFullYear())
      return `${dd}/${mm}/${yy}`
    } catch { return '' }
  }

  function resolveRunKm(age, level, override) {
    if (override === '1.6') return 1.6
    if (override === '2.4') return 2.4
    // auto rule
    if (age != null && age >= 14) return 2.4
    return level === 'Primary' ? 1.6 : 2.4
  }

  async function buildRowsFromUpload() {
    const allRows = []
    for (const f of files) {
      const text = await f.text()
      const lines = String(text).replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n')
      const headerIdx = findHeaderIndex(lines)
      const start = headerIdx + 1
      let parsed = 0
      for (let i = start; i < lines.length; i++) {
        const raw = lines[i]
        if (!raw || !raw.trim()) continue
        const cols = splitCsvLine(raw)
        if (cols.every(c => !c || !String(c).trim())) continue
        parsed++
        const name = cols[1] ?? ''
        const id = cols[2] ?? ''
        const klass = cols[3] ?? ''
        const genderRaw = cols[4] ?? ''
        const dobRaw = cols[5] ?? ''
        const attendance = cols[6] ?? ''
        const situps = toIntOrNull(cols[7])
        const broadJumpCm = toFloatOrNull(cols[8])
        const sitAndReachCm = toFloatOrNull(cols[9])
        const pullups = toIntOrNull(cols[10])
        const shuttleSec = toFloatOrNull(cols[11])
        const runRaw = cols[12] ?? ''
        const testDateRaw = cols[13] ?? ''

        const dobISO = parseDobToISO(dobRaw)
        const testDate = parseDateDDMMYYYY(testDateRaw) || (defaultDate ? new Date(defaultDate) : null)
        const age = calcAgeAt(dobISO, testDate)
        const level = levelLabel
        const sex = normalizeSex(genderRaw)
        const runKm = resolveRunKm(age, level, mode)
        const runSec = runRaw ? parseRunToSeconds(runRaw) : null

        let res = null
        if (sex && age != null) {
          const measures = { situps, broad_jump_cm: broadJumpCm, sit_and_reach_cm: sitAndReachCm, pullups, shuttle_s: shuttleSec, run_seconds: runSec }
          res = evaluateNapfa({ level, sex, age, run_km: runKm }, measures)
        }
        const st = res?.stations || {}
        const total = res?.totalPoints || 0
        const grades = [st.situps?.grade, st.broad_jump_cm?.grade, st.sit_and_reach_cm?.grade, st.pullups?.grade, st.shuttle_s?.grade, st.run?.grade]
        const award = grades.every(g => !!g)
          ? (total >= 21 && minRank(grades) >= rank('C')) ? 'Gold'
            : (total >= 15 && minRank(grades) >= rank('D')) ? 'Silver'
            : (total >= 6 && minRank(grades) >= rank('E')) ? 'Bronze'
            : 'No Award'
          : 'No Award'
        allRows.push({ source: f.name, name, id, class: klass, gender: genderRaw, dob: dobRaw, attendance, testDate, runKm, situps, broadJumpCm, sitAndReachCm, pullups, shuttleSec, runRaw: runRaw && runSec != null ? secondsToMmss(runSec) : (runRaw || ''), st, total, award })
      }
      appendLog({ file: f.name, headerIdx, parsed })
    }
    return allRows
  }

  async function buildRowsFromSession() {
    const allRows = []
    const { data: se } = await supabase
      .from('sessions')
      .select('id,title,session_date')
      .eq('id', sessionId)
      .maybeSingle()
    setSessionMeta(se || null)
    const testDate = se?.session_date ? new Date(se.session_date) : (defaultDate ? new Date(defaultDate) : null)
    const { data: roster } = await supabase
      .from('session_roster')
      .select('students:students!inner(id,student_identifier,name,gender,dob,enrollments!left(class,is_active))')
      .eq('session_id', sessionId)
    const studentIds = (roster||[]).map(r => r.students?.id).filter(Boolean)
    let scoresMap = new Map()
    if (studentIds.length) {
      const { data: sc } = await supabase
        .from('scores')
        .select('student_id,situps,pullups,broad_jump,sit_and_reach,shuttle_run')
        .eq('session_id', sessionId)
      for (const row of (sc||[])) scoresMap.set(row.student_id, row)
    }
    for (const r of (roster||[])) {
      const s = r.students || {}
      let klass = ''
      const enr = s.enrollments
      if (Array.isArray(enr)) klass = enr.find(e=>e?.is_active)?.class || ''
      else if (enr) klass = enr.class || ''
      const id = s.student_identifier || ''
      const name = s.name || ''
      const genderRaw = s.gender || ''
      const dobRaw = s.dob ? fmtDdMmYyyy(s.dob) : ''
      const sc = scoresMap.get(s.id) || {}
      const situps = sc.situps ?? null
      const pullups = sc.pullups ?? null
      const broadJumpCm = sc.broad_jump ?? null
      const sitAndReachCm = sc.sit_and_reach ?? null
      const shuttleSec = sc.shuttle_run ?? null
      const dobISO = s.dob || null
      const age = calcAgeAt(dobISO, testDate)
      const level = levelLabel
      const sex = normalizeSex(genderRaw)
      const runKm = resolveRunKm(age, level, mode)
      const runSec = null
      let res = null
      if (sex && age != null) {
        const measures = { situps, broad_jump_cm: broadJumpCm, sit_and_reach_cm: sitAndReachCm, pullups, shuttle_s: shuttleSec, run_seconds: runSec }
        res = evaluateNapfa({ level, sex, age, run_km: runKm }, measures)
      }
      const st = res?.stations || {}
      const total = res?.totalPoints || 0
      const grades = [st.situps?.grade, st.broad_jump_cm?.grade, st.sit_and_reach_cm?.grade, st.pullups?.grade, st.shuttle_s?.grade, st.run?.grade]
      const award = grades.every(g => !!g)
        ? (total >= 21 && minRank(grades) >= rank('C')) ? 'Gold'
          : (total >= 15 && minRank(grades) >= rank('D')) ? 'Silver'
          : (total >= 6 && minRank(grades) >= rank('E')) ? 'Bronze'
          : 'No Award'
        : 'No Award'
      const hasAny = [situps,pullups,broadJumpCm,sitAndReachCm,shuttleSec,runSec].some(v => v != null)
      const attendance = hasAny ? 'P' : ''
      const runRaw = ''
      allRows.push({ source: se?.title ? `Session: ${se.title}` : 'Session', name, id, class: klass, gender: genderRaw, dob: dobRaw, attendance, testDate, runKm, situps, broadJumpCm, sitAndReachCm, pullups, shuttleSec, runRaw, st, total, award })
    }
    return allRows
  }
  // Build CSV rows into a CSV string
  function buildCalculatedCsv(rows) {
    const headers = [
      'Student ID','Name','Class','Gender','DOB','Attendance','PFT Test Date','Run Distance (km)',
      'Sit-ups','Broad Jump (cm)','Sit & Reach (cm)','Pull-ups','Shuttle (s)','Run (MM:SS)',
      'Sit-ups Grade','Sit-ups Points','Broad Jump Grade','Broad Jump Points','Sit & Reach Grade','Sit & Reach Points','Pull-ups Grade','Pull-ups Points','Shuttle Grade','Shuttle Points','Run Grade','Run Points','Total Points','Award','Source'
    ]
    const lines = [headers.map(csvCell).join(',')]
    for (const r of rows) {
      const st = r.st || {}
      lines.push([
        r.id,
        r.name,
        r.class,
        r.gender,
        r.dob,
        r.attendance,
        fmtDdMmYyyy(r.testDate),
        r.runKm,
        r.situps ?? '',
        r.broadJumpCm ?? '',
        r.sitAndReachCm ?? '',
        r.pullups ?? '',
        r.shuttleSec ?? '',
        r.runRaw ?? '',
        st.situps?.grade || '', st.situps?.points ?? '',
        st.broad_jump_cm?.grade || '', st.broad_jump_cm?.points ?? '',
        st.sit_and_reach_cm?.grade || '', st.sit_and_reach_cm?.points ?? '',
        st.pullups?.grade || '', st.pullups?.points ?? '',
        st.shuttle_s?.grade || '', st.shuttle_s?.points ?? '',
        st.run?.grade || '', st.run?.points ?? '',
        r.total ?? '', r.award || '',
        r.source || ''
      ].map(csvCell).join(','))
    }
    return lines.join('\n')
  }

  function downloadCsv(content, filename) {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function handleProcessPerClass() {
    if (source === 'upload' && !files.length) return
    if (source === 'session' && !sessionId) return
    setBusy(true)
    setLog([])
    try {
      const rows = source === 'upload' ? await buildRowsFromUpload() : await buildRowsFromSession()
      // Sort then group by class
      rows.sort((a,b) => (String(a.class||'').localeCompare(String(b.class||'')) || String(a.name||'').localeCompare(String(b.name||''))))
      const groups = new Map()
      for (const r of rows) {
        const key = String(r.class || 'Unassigned')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(r)
      }
      const ts = new Date()
      const baseName = (source === 'session' && sessionMeta)
        ? `PFT_Calculated_${sessionMeta.title || 'Session'}_${String(ts.getFullYear())}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}`
        : `PFT_Calculated_${String(ts.getFullYear())}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}`
      for (const [klass, arr] of groups.entries()) {
        const out = buildCalculatedCsv(arr)
        const safeClass = klass.replace(/[^A-Za-z0-9_-]+/g, '_')
        downloadCsv(out, `${baseName}_${safeClass}.csv`)
      }
    } catch (e) {
      appendLog({ error: e?.message || String(e) })
    } finally {
      setBusy(false)
    }
  }

  async function handleProcess() {
    if (source === 'upload' && !files.length) return
    if (source === 'session' && !sessionId) return
    setBusy(true)
    setLog([])
    try {
      const allRows = source === 'upload' ? await buildRowsFromUpload() : await buildRowsFromSession()

      // Sort: class asc, name asc
      allRows.sort((a,b) => (String(a.class||'').localeCompare(String(b.class||'')) || String(a.name||'').localeCompare(String(b.name||''))))

      const ts = new Date()
      const baseName = (source === 'session' && sessionMeta)
        ? `PFT_Calculated_${sessionMeta.title || 'Session'}_${String(ts.getFullYear())}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}`
        : `PFT_Calculated_${String(ts.getFullYear())}${String(ts.getMonth()+1).padStart(2,'0')}${String(ts.getDate()).padStart(2,'0')}`
      const out = buildCalculatedCsv(allRows)
      downloadCsv(out, `${baseName}.csv`)
    } catch (e) {
      appendLog({ error: e?.message || String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-3">NAPFA Award Score Calculator</h1>
        <p className="text-sm text-slate-600 mb-4">
            Upload PFT file with results, or select a session to calculate grades and award for all students.
        </p>
      <div className="bg-white rounded border shadow-sm p-4 space-y-4">
        <div className="text-sm font-semibold text-slate-700 mb-2">Test Configuration Options</div>
        {/* Source selector moved down to be with the upload/session section */}
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex-1 min-w-[260px] border rounded p-3 bg-slate-50">
            <div className="text-xs uppercase tracking-wide text-slate-500">School Type</div>
            <div className="mt-2">
              <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs ${levelLabel==='Primary' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'}`}>{levelLabel || '-'}</span>
            </div>
          </div>
          <div className="flex-1 min-w-[260px] border rounded p-3 bg-slate-50">
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Run Distance Rule</label>
            <div className="flex items-center gap-3 text-sm">
              <label className="inline-flex items-center gap-1"><input type="radio" name="km" value="auto" checked={mode==='auto'} onChange={(e)=>setMode(e.target.value)} /> Auto</label>
              <label className="inline-flex items-center gap-1"><input type="radio" name="km" value="1.6" checked={mode==='1.6'} onChange={(e)=>setMode(e.target.value)} /> 1.6 km</label>
              <label className="inline-flex items-center gap-1"><input type="radio" name="km" value="2.4" checked={mode==='2.4'} onChange={(e)=>setMode(e.target.value)} /> 2.4 km</label>
            </div>
            <div className="mt-2 text-xs">
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 mt-0.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v.01"/><path d="M11 12h1v4h1"/></svg>
                <div>
                  <div className="font-medium text-[12px]">Auto rule</div>
                  <ul className="text-[12px] text-slate-600 leading-relaxed list-disc pl-5 space-y-0.5">
                    <li>Age ≥ 14 → 2.4 km</li>
                    <li>Primary → 1.6 km</li>
                    <li>Secondary/JC → 2.4 km</li>
                  </ul>
                  <div>The used distance is written into the CSV.</div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-[260px] border rounded p-3 bg-slate-50">
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">Default Test Date</label>
            <input type="date" value={defaultDate} onChange={(e)=>setDefaultDate(e.target.value)} className="border rounded p-2 w-full" />
            <div className="text-xs text-slate-600 mt-2">Used only when a row has no PFT Test Date.</div>
          </div>
        </div>
        <div className="border-t border-slate-200" />
        <div className="text-sm font-semibold text-slate-700">Calculation Method</div>
        <div className="text-sm">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setSource('upload')}
              aria-pressed={source === 'upload'}
              className={`px-3 py-1.5 rounded-md transition-colors ${source==='upload' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-white'}`}
            >
              Upload CSV
            </button>
            <button
              type="button"
              onClick={() => setSource('session')}
              aria-pressed={source === 'session'}
              className={`px-3 py-1.5 rounded-md transition-colors ${source==='session' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-white'}`}
            >
              Select Session
            </button>
          </div>
        </div>
        {source === 'upload' ? (
          <>
            <div>
              <div className="text-sm font-semibold text-slate-700 mb-2">Upload</div>
              <label className="block text-sm text-slate-700 mb-1">PFT CSV file(s)</label>
              <input type="file" accept=".csv,text/csv" multiple onChange={onChooseFiles} />
              <div className="text-xs text-slate-600 mt-1">Use the PFT file from cockpit in the exact same format.</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleProcess} disabled={!files.length || busy || !levelLabel} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-60">{busy ? 'Processing…' : 'Download (All Students)'}</button>
              <button onClick={handleProcessPerClass} disabled={!files.length || busy || !levelLabel} className="px-4 py-2 bg-blue-600/90 hover:bg-blue-600 text-white rounded disabled:opacity-60">{busy ? 'Processing…' : 'Download (Per Class)'}</button>
              <span className="text-sm text-slate-600">{files.length ? `${files.length} file(s) selected` : 'No files selected'}</span>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="text-sm font-semibold text-slate-700 mb-2">Select Session</div>
              <select value={sessionId} onChange={(e)=>setSessionId(e.target.value)} className="border rounded p-2 min-w-[260px]">
                <option value="">Choose a session</option>
                {(sessions||[]).map(se => (
                  <option key={se.id} value={se.id}>{se.title} — {fmtDdMmYyyy(se.session_date)}</option>
                ))}
              </select>
              <div className="text-xs text-slate-600 mt-1">Calculates from the selected session’s roster and saved scores.</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleProcess} disabled={!sessionId || busy || !levelLabel} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-60">{busy ? 'Processing…' : 'Download (All Students)'}</button>
              <button onClick={handleProcessPerClass} disabled={!sessionId || busy || !levelLabel} className="px-4 py-2 bg-blue-600/90 hover:bg-blue-600 text-white rounded disabled:opacity-60">{busy ? 'Processing…' : 'Download (Per Class)'}</button>
            </div>
          </>
        )}
        {log.length > 0 && (
          <div className="text-xs text-slate-700 bg-slate-50 border rounded p-2 max-h-40 overflow-auto">
            {log.map((l, i) => (<div key={i}>{JSON.stringify(l)}</div>))}
          </div>
        )}
      </div>
    </div>
  )
}

function rank(g) {
  const t = String(g||'').toUpperCase()
  return t === 'A' ? 5 : t === 'B' ? 4 : t === 'C' ? 3 : t === 'D' ? 2 : t === 'E' ? 1 : 0
}
function minRank(grades) {
  const r = grades.map(rank)
  return r.length ? Math.min(...r) : 0
}
