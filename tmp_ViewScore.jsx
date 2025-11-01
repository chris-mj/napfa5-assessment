import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { normalizeStudentId } from '../utils/ids'
import { evaluateNapfa, normalizeSex, getAgeGroup, findRows } from '../utils/napfaStandards'

export default function ViewScore() {
  const [studentId, setStudentId] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState(null)
  const [attempts, setAttempts] = useState([]) // list of score rows with session + school
  const [selectedId, setSelectedId] = useState(null)

  const selected = useMemo(() => attempts.find(a => a.id === selectedId) || null, [attempts, selectedId])

  const handleSearch = async (idValue) => {
    setError('')
    const sid = normalizeStudentId(idValue || studentId)
    if (!sid) { setError('Enter a valid Student ID.'); return }
    setLoading(true)
    try {
      const { data: stu, error: e1 } = await supabase
        .from('students')
        .select('id, student_identifier, name, gender, dob')
        .eq('student_identifier', sid)
        .maybeSingle()
      if (e1) throw e1
      if (!stu?.id) { setError('Student not found or not visible.'); setProfile(null); setAttempts([]); setSelectedId(null); return }
      setProfile({ id: stu.id, sid: stu.student_identifier, name: stu.name, gender: stu.gender, dob: stu.dob })

      const { data: rows, error: e2 } = await supabase
        .from('scores')
        .select('id, test_date, situps, shuttle_run, sit_and_reach, pullups, run_2400, broad_jump, sessions!fk_scores_session(id, session_date, schools:school_id(type))')
        .eq('student_id', stu.id)
        .order('test_date', { ascending: false })
      if (e2) throw e2
      const list = (rows || []).map(r => ({
        id: r.id,
        test_date: r.test_date || r.sessions?.session_date || null,
        situps: r.situps,
        shuttle_run_s: r.shuttle_run,
        sit_and_reach_cm: r.sit_and_reach,
        pullups: r.pullups,
        run_2400_min: r.run_2400,
        broad_jump_cm: r.broad_jump,
        school_type: r.sessions?.schools?.type || null,
      }))
      setAttempts(list)
      setSelectedId(list[0]?.id || null)
    } catch (e) {
      setError(e.message || 'Lookup failed.')
      setProfile(null)
      setAttempts([])
      setSelectedId(null)
    } finally {
      setLoading(false)
    }
  }

  const details = useMemo(() => {
    if (!profile || !selected) return null
    const level = (selected.school_type === 'primary') ? 'Primary' : 'Secondary'
    const sex = normalizeSex(profile.gender)
    const testDate = selected.test_date ? new Date(selected.test_date) : new Date()
    const age = calcAgeAt(profile.dob, testDate)
    const runKm = age >= 14 ? 2.4 : (level === 'Primary' ? 1.6 : 2.4)
    const measures = {
      situps: toIntOrNull(selected.situps),
      broad_jump_cm: toIntOrNull(selected.broad_jump_cm),
      sit_and_reach_cm: toIntOrNull(selected.sit_and_reach_cm),
      pullups: toIntOrNull(selected.pullups),
      shuttle_s: toFloatOrNull(selected.shuttle_run_s),
      run_seconds: (runKm === 2.4 && isFinite(selected.run_2400_min)) ? Math.round(selected.run_2400_min * 60) : null,
    }
    const res = evaluateNapfa({ level, sex, age, run_km: runKm }, measures)
    const award = computeAward(res)
    const nextTargets = computeNextTargets({ level, sex, age, run_km: runKm }, res)
    return { level, sex, age, runKm, res, award, nextTargets }
  }, [profile, selected])

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-3">View Score</h1>
      <div className="bg-white/80 backdrop-blur rounded border shadow-sm p-3 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-sm mb-1 text-slate-700">Student ID</label>
            <div className="flex gap-2">
              <input value={studentId} onChange={(e)=>setStudentId(e.target.value)} placeholder="Type or scan Student ID" className="border rounded p-2 w-full"/>
              <button onClick={()=>setScannerOpen(true)} className="h-10 w-10 border rounded-full inline-flex items-center justify-center hover:bg-slate-50" aria-label="Open camera to scan student card" title="Scan">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2Z" /><circle cx="12" cy="13" r="4" /></svg>
              </button>
            </div>
            <div className="text-xs text-slate-500 mt-1">Scan QR or CODE128 on your card</div>
          </div>
          <button onClick={()=>handleSearch()} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700" disabled={loading}>{loading? 'Searching...' : 'Search'}</button>
        </div>
        {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
      </div>

      {profile && (
        <div className="space-y-3">
          <div className="bg-white rounded shadow p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <div className="text-sm text-gray-500">Name</div>
                <div className="text-lg font-semibold">{profile.name}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Student ID</div>
                <div className="font-mono text-lg">{normalizeStudentId(profile.sid)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">DOB</div>
                <div>{formatDate(profile.dob)}</div>
              </div>
            </div>
          </div>

          {attempts.length === 0 ? (
            <div className="bg-white rounded shadow p-3 text-sm text-gray-600">No recorded scores found.</div>
          ) : (
            <div className="bg-white rounded shadow p-3">
              <div className="flex items-center gap-2 mb-3">
                <label className="text-sm">Select Test</label>
                <select value={selectedId || ''} onChange={(e)=>setSelectedId(e.target.value)} className="border rounded p-1">
                  {attempts.map(a => (
                    <option key={a.id} value={a.id}>{formatDate(a.test_date) || '—'}</option>
                  ))}
                </select>
              </div>

              {details && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <Info label="Level" value={details.level} />
                    <Info label="Sex" value={details.sex || '—'} />
                    <Info label="Age at test" value={String(details.age)} />
                    <Info label="Run distance" value={`${details.runKm} km`} />
                  </div>

                  <div className="overflow-auto max-h-[55vh] border rounded">
                    <table className="min-w-full text-sm divide-y divide-slate-200">
                      <thead className="sticky top-0 z-10 bg-white">
                        <tr className="text-left text-slate-700">
                          <th className="px-3 py-2 border">Station</th>
                          <th className="px-3 py-2 border">Raw <span className="text-xs text-slate-500">(units)</span></th>
                          <th className="px-3 py-2 border">Grade</th>
                          <th className="px-3 py-2 border">Points</th>
                          <th className="px-3 py-2 border">Next Band Target</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {renderRow('Sit-ups', 'situps', selected.situps, details.res?.stations?.situps, details.nextTargets?.situps, 'reps')}
                        {renderRow('Standing Broad Jump', 'broad', selected.broad_jump_cm, details.res?.stations?.broad_jump_cm, details.nextTargets?.broad_jump_cm, 'cm')}
                        {renderRow('Sit & Reach', 'reach', selected.sit_and_reach_cm, details.res?.stations?.sit_and_reach_cm, details.nextTargets?.sit_and_reach_cm, 'cm')}
                        {renderRow('Pull-ups', 'pullups', selected.pullups, details.res?.stations?.pullups, details.nextTargets?.pullups, 'reps')}
                        {renderRow('Shuttle Run 4x10m', 'shuttle', selected.shuttle_run_s, details.res?.stations?.shuttle_s, details.nextTargets?.shuttle_s, 's', true)}
                        {renderRunRow(selected.run_2400_min, details)}
                        <tr className="font-semibold bg-slate-50">
                          <td className="px-3 py-2 border" colSpan={3}>Total Points</td>
                          <td className="px-3 py-2 border">{details.res?.totalPoints ?? 0}</td>
                          <td className="px-3 py-2 border"></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="p-3 rounded bg-gray-50">
                    <div className="font-medium">Award</div>
                    <div className="text-lg">{details.award.label}</div>
                    <div className="text-sm text-gray-600">{details.award.reason}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {scannerOpen && (
        <ScannerModal onClose={()=>setScannerOpen(false)} onDetected={(code)=>{ setStudentId(code); setScannerOpen(false); handleSearch(code); }} />
      )}
    </div>
  )
}

function Info({ label, value }) {
  return (
    <div>
      <div className="text-gray-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  )
}

function renderRow(label, key, raw, band, nextTarget, unit, isTime = false) {
  return (
    <tr className="odd:bg-white even:bg-slate-50">
      <td className="px-3 py-2 border">
        <div className="flex items-center gap-2">
          <StationIcon kind={key} />
          <span>{label}</span>
        </div>
      </td>
      <td className="px-3 py-2 border tabular-nums text-right">{formatRaw(raw, unit, isTime)}</td>
      <td className="px-3 py-2 border">{band?.grade ? <GradeBadge grade={band.grade} /> : '—'}</td>
      <td className="px-3 py-2 border text-right">{Number.isFinite(band?.points) ? <PointsBadge points={band.points} /> : 0}</td>
      <td className="px-3 py-2 border">{isTime ? (nextTarget?.target_mmss || '—') : (formatRaw(nextTarget?.target, unit, isTime) || '—')}</td>
    </tr>
  )
}

function renderRunRow(run2400Min, details) {
  const hasRun = (details?.runKm === 2.4 && isFinite(run2400Min)) || (details?.runKm === 1.6 && details?.res?.stations?.run)
  const raw = details?.runKm === 2.4 && isFinite(run2400Min) ? secondsToMmss(Math.round(run2400Min * 60)) : '—'
  const band = details?.res?.stations?.run
  const nextTarget = details?.nextTargets?.run
  return (
    <tr className="odd:bg-white even:bg-slate-50">
      <td className="px-3 py-2 border"><div className="flex items-center gap-2"><Timer className="w-4 h-4" /> <span>{`Run (${details?.runKm} km)`}</span></div></td>
      <td className="px-3 py-2 border tabular-nums text-right">{raw}</td>
      <td className="px-3 py-2 border">{band?.grade ? <GradeBadge grade={band.grade} /> : '—'}</td>
      <td className="px-3 py-2 border text-right">{Number.isFinite(band?.points) ? <PointsBadge points={band.points} /> : 0}</td>
      <td className="px-3 py-2 border">{nextTarget?.target_mmss || '—'}</td>
    </tr>
  )
}

function secondsToMmss(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—'
  const mm = Math.floor(sec / 60)
  const ss = Math.round(sec % 60)
  return `${mm}:${String(ss).padStart(2, '0')}`
}

function formatRaw(val, unit, isTime = false) {
  if (val == null || val === '' || (typeof val === 'number' && !Number.isFinite(val))) return '—'
  if (isTime) {
    // seconds with 1 decimal for shuttle
    const s = Number(val)
    return (Math.round(s * 10) / 10).toFixed(1)
  }
  return `${val}${unit ? ' ' + unit : ''}`
}

function toIntOrNull(v) { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null }
function toFloatOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null }

function calcAgeAt(dob, onDate) {
  if (!dob) return 0
  const birth = new Date(dob)
  const now = onDate ? new Date(onDate) : new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
  return age
}

function gradeToRank(g) {
  if (!g) return 0
  const t = String(g).toUpperCase()
  return t === 'A' ? 5 : t === 'B' ? 4 : t === 'C' ? 3 : t === 'D' ? 2 : t === 'E' ? 1 : 0
}

function computeAward(res) {
  const st = res?.stations || {}
  const grades = [st.situps?.grade, st.broad_jump_cm?.grade, st.sit_and_reach_cm?.grade, st.pullups?.grade, st.shuttle_s?.grade, st.run?.grade]
  if (grades.some(g => !g)) return { label: 'No Award', reason: 'Incomplete results across all stations.' }
  const total = res?.totalPoints || 0
  const minRank = Math.min(...grades.map(gradeToRank))
  if (total >= 21 && minRank >= gradeToRank('C')) return { label: 'Gold', reason: `Total ${total} points and at least grade C in all stations.` }
  if (total >= 15 && minRank >= gradeToRank('D')) return { label: 'Silver', reason: `Total ${total} points and at least grade D in all stations.` }
  if (total >= 6 && minRank >= gradeToRank('E')) return { label: 'Bronze', reason: `Total ${total} points and at least grade E in all stations.` }
  return { label: 'No Award', reason: `Total ${total} points or minimum grade conditions not met.` }
}

function computeNextTargets(ctx, res) {
  // For each station, find next higher points band and return the raw target required (no delta).
  const { level, sex, age, run_km } = ctx
  const sexNorm = normalizeSex(sex)
  const ageGroup = getAgeGroup(age)
  const rows = findRows(level, sexNorm, ageGroup)

  function nextFor(points, stationKey, isLowerBetter) {
    const candidates = rows
      .filter(r => (stationKey === 'run' ? ((r.stations.run.km ?? run_km) === run_km) : true))
      .filter(r => (r.points || 0) > (points || 0))
      .sort((a,b) => (a.points||0) - (b.points||0))
    if (candidates.length === 0) return null
    const r = candidates[0]
    if (stationKey === 'run') {
      // Lower is better; need <= band max if present, else <= band min
      const secs = (r.stations.run.max_s != null) ? r.stations.run.max_s : r.stations.run.min_s
      return { target_seconds: secs, target_mmss: secondsToMmss(secs), grade: r.grade, points: r.points }
    }
    if (stationKey === 'shuttle_s') {
      const secs = (r.stations.shuttle_s.max != null) ? r.stations.shuttle_s.max : r.stations.shuttle_s.min
      return { target: secs, grade: r.grade, points: r.points }
    }
    const band = r.stations[stationKey]
    if (!band) return null
    // Higher is better; need >= band.min
    return { target: band.min, grade: r.grade, points: r.points }
  }

  const st = res?.stations || {}
  return {
    situps: nextFor(st.situps?.points ?? 0, 'situps', false),
    broad_jump_cm: nextFor(st.broad_jump_cm?.points ?? 0, 'broad_jump_cm', false),
    sit_and_reach_cm: nextFor(st.sit_and_reach_cm?.points ?? 0, 'sit_and_reach_cm', false),
    pullups: nextFor(st.pullups?.points ?? 0, 'pullups', false),
    shuttle_s: nextFor(st.shuttle_s?.points ?? 0, 'shuttle_s', true),
    run: nextFor(st.run?.points ?? 0, 'run', true),
  }
}

function formatDate(d) {
  if (!d) return '-'
  try { const dt = new Date(d); return `${dt.getDate()}/${dt.getMonth()+1}/${dt.getFullYear()}` } catch { return String(d) }
}

// Visual helpers
function GradeBadge({ grade }) {
  if (!grade) return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs bg-slate-100 text-slate-700">—</span>
  const g = String(grade).toUpperCase()
  const map = {
    A: 'bg-green-100 text-green-800',
    B: 'bg-sky-100 text-sky-800',
    C: 'bg-amber-100 text-amber-800',
    D: 'bg-orange-100 text-orange-800',
    E: 'bg-rose-100 text-rose-800',
  }
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[g] || 'bg-slate-100 text-slate-700'}`}>{g}</span>
}

function PointsBadge({ points }) {
  const p = Number(points||0)
  return <span className="inline-flex items-center rounded px-2 py-0.5 text-xs bg-slate-100 text-slate-800 tabular-nums">{p}</span>
}

function AwardBanner({ award }) {
  const label = award?.label || 'No Award'
  const reason = award?.reason || ''
  const style = label === 'Gold' ? 'bg-yellow-100 text-yellow-900 border-yellow-200'
    : label === 'Silver' ? 'bg-zinc-100 text-zinc-800 border-zinc-200'
    : label === 'Bronze' ? 'bg-amber-100 text-amber-900 border-amber-200'
    : 'bg-slate-100 text-slate-800 border-slate-200'
  return (
    <div className={`p-3 rounded border ${style}`}>
      <div className="flex items-center gap-2">
        <Trophy className="w-4 h-4" />
        <div className="font-semibold">{label}</div>
      </div>
      {reason && <div className="text-sm text-slate-700 mt-1">{reason}</div>}
    </div>
  )
}

function StationIcon({ kind, className = 'w-4 h-4' }) {
  if (kind === 'situps') return <Activity className={className} />
  if (kind === 'broad' || kind === 'reach') return <Ruler className={className} />
  if (kind === 'pullups') return <Hand className={className} />
  if (kind === 'shuttle') return <Timer className={className} />
  return <Activity className={className} />
}

function IconBase({ children, className }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>{children}</svg>
  )
}
function Activity(props) { return (<IconBase {...props}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></IconBase>) }
function Ruler(props) { return (<IconBase {...props}><path d="M16 2l6 6-14 14-6-6Z" /><path d="M7 7l1.5 1.5M10 10l1.5 1.5M13 13l1.5 1.5" /></IconBase>) }
function Hand(props) { return (<IconBase {...props}><path d="M8 13V5a2 2 0 1 1 4 0v6" /><path d="M12 11V4a2 2 0 1 1 4 0v7" /><path d="M16 10V6a2 2 0 1 1 4 0v6c0 5-4 6-8 6-4 0-8-1-8-6v-3" /></IconBase>) }
function Timer(props) { return (<IconBase {...props}><circle cx="12" cy="13" r="9" /><path d="M12 7v6l4 2" /><path d="M10 2h4" /></IconBase>) }
function Trophy(props) { return (<IconBase {...props}><path d="M8 22h8" /><path d="M12 22v-4" /><path d="M7 10a5 5 0 0 1-5-5V3h5" /><path d="M17 10a5 5 0 0 0 5-5V3h-5" /><path d="M7 3h10v5a5 5 0 0 1-10 0V3Z" /></IconBase>) }

function ScannerModal({ onClose, onDetected }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const controlsRef = useRef(null)
  const [supported, setSupported] = useState(true)
  const [err, setErr] = useState('')
  useEffect(() => {
    let cleanupFn = null
    const hasBarcode = 'BarcodeDetector' in window
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        if (hasBarcode) {
          setSupported(true)
          const detector = new window.BarcodeDetector({ formats: ['qr_code','code_128','code_39'] })
          let cancelled = false
          const tick = async () => {
            if (cancelled) return
            try {
              const frame = await detector.detect(videoRef.current)
              if (frame && frame.length > 0) {
                const value = frame[0].rawValue
                if (value) { onDetected(value) }
                return
              }
            } catch {}
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
          cleanupFn = () => { cancelled = true }
        } else {
          try {
            const { BrowserMultiFormatReader } = await import('@zxing/browser')
            setSupported(true)
            const codeReader = new BrowserMultiFormatReader()
            const controls = await codeReader.decodeFromVideoDevice(null, videoRef.current, (result, _err, controls) => {
              if (result) {
                const v = result.getText()
                if (v) { controls.stop(); onDetected(v) }
              }
            })
            controlsRef.current = controls
            cleanupFn = () => { try { controls.stop(); codeReader.reset() } catch {} }
          } catch (e2) {
            setSupported(false)
          }
        }
      } catch (e) {
        setErr(e.message || 'Camera unavailable.')
      }
    }
    start()
    return () => {
      if (controlsRef.current) { try { controlsRef.current.stop() } catch {} controlsRef.current = null }
      if (streamRef.current) { try { streamRef.current.getTracks().forEach(t => t.stop()) } catch {} streamRef.current = null }
      if (videoRef.current) { try { videoRef.current.pause(); videoRef.current.srcObject = null } catch {} }
      if (typeof cleanupFn === 'function') cleanupFn()
    }
  }, [onDetected])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-sm font-medium">Scan Student Card</div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded" aria-label="Close scanner">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="p-3 space-y-2">
          {supported ? (
            <div className="aspect-video bg-black rounded overflow-hidden">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            </div>
          ) : (
            <div className="text-sm text-gray-600">This browser does not support in-page barcode scanning. Please type the ID or use a supported browser (Chrome/Edge).</div>
          )}
          {err && <div className="text-sm text-red-600">{err}</div>}
          <div className="text-xs text-gray-500">Tip: Point the camera at the QR/Barcode on the student card.</div>
        </div>
        <div className="px-3 py-2 border-t flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 border rounded hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  )
}


