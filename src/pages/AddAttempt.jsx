// Inline minimal icons to avoid external deps
import { useMemo, useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { SCORE_SELECT_FIELDS, fetchScoreRow, fmtRun } from '../lib/scores'
import { evaluateNapfa } from '../utils/napfaStandards'
import { normalizeStudentId } from '../utils/ids'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { AnimatePresence, motion } from 'framer-motion'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { useToast } from '../components/ToastProvider'
import { SitupsIcon, BroadJumpIcon, ReachIcon, PullupsIcon, ShuttleIcon } from '../components/icons/StationIcons'

export default function AddAttempt({ user }) {
  const fmtDdMmYyyy = (iso) => {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      const dd = String(d.getDate()).padStart(2,'0')
      const mm = String(d.getMonth()+1).padStart(2,'0')
      const yyyy = d.getFullYear()
      return `${dd}/${mm}/${yyyy}`
    } catch { return '' }
  }
  const [sessionId, setSessionId] = useState('')
  const [sessions, setSessions] = useState([])
  const [schoolType, setSchoolType] = useState(null)
  const stations = useMemo(() => ([
    { key: 'situps', name: 'Sit-ups', Icon: SitupsIcon, description: 'Count repetitions | 1 attempt' },
    { key: 'broad_jump', name: 'Broad Jump', Icon: BroadJumpIcon, description: 'Measure distance (cm) | 2 attempts, record best' },
    { key: 'sit_and_reach', name: 'Sit & Reach', Icon: ReachIcon, description: 'Measure distance (cm) | 2 attempts, record best' },
    { key: 'pullups', name: 'Pull-ups', Icon: PullupsIcon, description: 'Count repetitions | 1 attempt' },
    { key: 'shuttle_run', name: 'Shuttle Run', Icon: ShuttleIcon, description: 'Record time (sec, 1dp) | 1 attempt' },
    { key: 'run', name: '1.6/2.4km Run', Icon: Timer, description: 'Record time (MSS/MMSS digits) | 1 attempt' },
  ]), [])
  const [activeStation, setActiveStation] = useState('situps')
  const [studentId, setStudentId] = useState('')
  const [student, setStudent] = useState(null)
  const [attempt1, setAttempt1] = useState('')
  const [attempt2, setAttempt2] = useState('')
  const [existing, setExisting] = useState(null)
  const [revealKey, setRevealKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [roster, setRoster] = useState([])
  const [rosterLoading, setRosterLoading] = useState(false)
  const [rosterQuery, setRosterQuery] = useState('')
  const firstAttemptRef = useRef(null)
  // Horizontal scroll + edge fade for stations bar
  const tabsScrollRef = useRef(null)
  const [tabsFadeLeft, setTabsFadeLeft] = useState(false)
  const [tabsFadeRight, setTabsFadeRight] = useState(false)
  const navigate = useNavigate()
  const active = useMemo(() => stations.find(s => s.key === activeStation), [stations, activeStation])
  const { showToast } = useToast()

  // Track scroll to show edge fade hints
  useEffect(() => {
    const el = tabsScrollRef.current
    if (!el) return
    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el
      setTabsFadeLeft(scrollLeft > 0)
      setTabsFadeRight(scrollLeft + clientWidth < scrollWidth - 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  // Live validation for current station + inputs
  const validation = useMemo(() => {
    const inRange = (v, min, max) => v >= min && v <= max
    const make = (valid, message) => ({ valid, message })
    if (!student || !sessionId) return make(false, 'Select a session and student.')
    if (activeStation === 'situps' || activeStation === 'pullups') {
      if (attempt1 === '') return make(false, 'Enter a value 0–60.')
      const n = parseInt((attempt1 || '').toString(), 10)
      if (!Number.isFinite(n)) return make(false, 'Invalid number.')
      return inRange(n, 0, 60) ? make(true, 'OK') : make(false, 'Value must be 0–60.')
    }
    if (activeStation === 'broad_jump' || activeStation === 'sit_and_reach') {
      const max = activeStation === 'broad_jump' ? 300 : 80
      if (attempt1 === '' && attempt2 === '') return make(false, `Enter at least one attempt (0–${max} cm).`)
      const a = attempt1 === '' ? null : parseInt(attempt1, 10)
      const b = attempt2 === '' ? null : parseInt(attempt2, 10)
      if ((a !== null && !Number.isFinite(a)) || (b !== null && !Number.isFinite(b))) return make(false, 'Invalid number in attempts.')
      if ((a !== null && !inRange(a, 0, max)) || (b !== null && !inRange(b, 0, max))) return make(false, `Attempts must be 0–${max} cm.`)
      return make(true, 'Best of two is saved.')
    }
    if (activeStation === 'shuttle_run') {
      if (attempt1 === '' && attempt2 === '') return make(false, 'Enter at least one time (0.0–20.0s).')
      const a = attempt1 === '' ? null : Number.parseFloat(Number(oneDecimal(attempt1)).toFixed(1))
      const b = attempt2 === '' ? null : Number.parseFloat(Number(oneDecimal(attempt2)).toFixed(1))
      if ((a !== null && !Number.isFinite(a)) || (b !== null && !Number.isFinite(b))) return make(false, 'Invalid time format.')
      if ((a !== null && !inRange(a, 0.0, 20.0)) || (b !== null && !inRange(b, 0.0, 20.0))) return make(false, 'Times must be 0.0–20.0 seconds (1 d.p.).')
      return make(true, 'Lower of two is saved.')
    }
    if (activeStation === 'run') {
      if (attempt1 === '') return make(false, 'Enter a time in MSS/MMSS (digits only).')
      const raw = onlyInt(attempt1)
      if (!/^\d{3,4}$/.test(raw)) return make(false, 'Use 3 or 4 digits without colon (e.g., 930 or 1330).')
      const mm = raw.length === 3 ? parseInt(raw.slice(0,1), 10) : parseInt(raw.slice(0,2), 10)
      const ss = parseInt(raw.slice(-2), 10)
      if (!Number.isFinite(mm) || !Number.isFinite(ss) || ss >= 60) return make(false, 'Seconds must be 00-59.')
      return make(true, 'OK')
    }
    return make(false, 'Select a station.')
  }, [activeStation, attempt1, attempt2, student, sessionId])

  // Load sessions belonging to the same school as the user
  useEffect(() => {
    const load = async () => {
      try {
        if (!user?.id) return
        const { data: mem, error: mErr } = await supabase
          .from('memberships')
          .select('school_id')
          .eq('user_id', user.id)
          .maybeSingle()
        if (mErr || !mem?.school_id) return
        // Load school type for standards evaluation (Primary/Secondary)
        try {
          const { data: sch } = await supabase
            .from('schools')
            .select('type')
            .eq('id', mem.school_id)
            .maybeSingle()
          setSchoolType(sch?.type || null)
        } catch {}
        const { data: sess } = await supabase
          .from('sessions')
          .select('id, title, session_date, status')
          .eq('school_id', mem.school_id)
          .eq('status', 'active')
          .order('session_date', { ascending: true })
        setSessions(sess || [])
      } catch {}
    }
    load()
  }, [user?.id])

  // Auto-select session if there is exactly one active session
  useEffect(() => {
    if (!sessionId && Array.isArray(sessions) && sessions.length === 1) {
      setSessionId(sessions[0].id)
    }
  }, [sessions, sessionId])

  const doSearch = async (idValue) => {
    setError('')
    if (!sessionId) { setError('Please select a session.'); return }
    const sid = normalizeStudentId(idValue || '')
    if (!sid) { setError('Please enter a Student ID.'); return }
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from('session_roster')
        .select('students!inner(id, student_identifier, name, gender, dob, enrollments!left(class, is_active))')
        .eq('session_id', sessionId)
        .eq('students.student_identifier', sid)
        .maybeSingle()
      if (err) throw err
      if (!data?.students?.id) {
        setError('Student not found in this session roster.')
        setStudent(null)
        return
      }
      let className = ''
      const enr = data.students?.enrollments
      if (Array.isArray(enr)) {
        className = enr.find((e)=>e?.is_active)?.class || ''
      } else if (enr) {
        className = enr.class || ''
      }
      const id = (data.students.student_identifier || '').toUpperCase()
      setStudent(null)
      setStudent({ id, name: data.students.name, className, gender: data.students.gender, dob: data.students.dob })
      setRevealKey((k)=>k+1)
      setAttempt1('')
      setAttempt2('')
    } catch (e2) {
      setError(e2.message || 'Search failed.')
      setStudent(null)
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    await doSearch(studentId)
    setTimeout(() => { try { firstAttemptRef.current?.focus() } catch {} }, 0)
  }

  const openScanner = () => setScannerOpen(true)
  const openRoster = () => setRosterOpen(true)

  // Load roster when session changes
  useEffect(() => {
    let ignore = false
    async function loadRoster() {
      setRoster([])
      if (!sessionId) return
      setRosterLoading(true)
      try {
        const { data, error } = await supabase
          .from('session_roster')
          .select('students:students!inner(id, student_identifier, name, gender, enrollments!left(class, is_active))')
          .eq('session_id', sessionId)
        if (!ignore) {
          if (error) {
            setRoster([])
          } else {
            const rows = (data||[]).map(r => {
              const s = r.students || {}
              let className = ''
              const enr = s.enrollments
              if (Array.isArray(enr)) className = enr.find(e=>e?.is_active)?.class || ''
              else if (enr) className = enr.class || ''
              return { key: s.student_identifier, name: s.name, className }
            })
            rows.sort((a,b)=> (a.name||'').localeCompare(b.name||''))
            setRoster(rows)
          }
        }
      } finally {
        if (!ignore) setRosterLoading(false)
      }
    }
    loadRoster()
    return () => { ignore = true }
  }, [sessionId])

  // Input helpers (hoisted declarations to avoid TDZ issues)
  function onlyInt(val) { return (val || '').toString().replace(/[^0-9]/g, '') }
  function oneDecimal(val) {
    const s = (val || '').toString().replace(/[^0-9.]/g, '')
    const parts = s.split('.')
    if (parts.length === 1) return parts[0]
    return parts[0] + '.' + parts[1].slice(0,1)
  }

  // Load existing saved scores for this student in this session
  useEffect(() => {
    const loadExisting = async () => {
      try {
        setExisting(null)
        if (!student || !sessionId) return
        const sid = await getStudentRowId()
        const { data } = await supabase
          .from('scores')
          .select(SCORE_SELECT_FIELDS)
          .eq('session_id', sessionId)
          .eq('student_id', sid)
          .maybeSingle()
        setExisting(data || null)
      } catch {}
    }
    loadExisting()
  }, [student?.id, sessionId])

  // Save score to scores table (one row per session+student)
  async function saveScore() {
    if (!student || !sessionId) return
    const colMap = {
      situps: 'situps',
      pullups: 'pullups',
      broad_jump: 'broad_jump',
      sit_and_reach: 'sit_and_reach',
      shuttle_run: 'shuttle_run',
      run: 'run_2400',
    }
    const col = colMap[activeStation] || 'situps'
    let num = null
    // Validation helpers
    const inRange = (v, min, max) => v >= min && v <= max
    const err = (msg) => { showToast('error', msg); throw new Error(msg) }

    if (activeStation === 'situps' || activeStation === 'pullups') {
      const n = parseInt(onlyInt(attempt1 || ''))
      if (!Number.isFinite(n)) return
      const max = 60
      if (!inRange(n, 0, max)) err(`${active.name} must be between 0 and ${max}.`)
      num = n
    } else if (activeStation === 'broad_jump' || activeStation === 'sit_and_reach') {
      const a = attempt1 ? parseInt(onlyInt(attempt1 || '')) : null
      const b = attempt2 ? parseInt(onlyInt(attempt2 || '')) : null
      if (a == null && b == null) return
      const max = activeStation === 'broad_jump' ? 300 : 80
      if (a != null && !inRange(a, 0, max)) err(`${active.name} attempts must be between 0 and ${max} cm.`)
      if (b != null && !inRange(b, 0, max)) err(`${active.name} attempts must be between 0 and ${max} cm.`)
      num = a == null ? b : (b == null ? a : Math.max(a, b))
    } else if (activeStation === 'shuttle_run') {
      const a = attempt1 ? Number(oneDecimal(attempt1)) : null
      const b = attempt2 ? Number(oneDecimal(attempt2)) : null
      if (a == null && b == null) return
      const best = (a == null) ? b : (b == null ? a : Math.min(a, b))
      const bestRounded = Number.parseFloat(Number(best).toFixed(1))
      if ((a != null && !inRange(a, 0.0, 20.0)) || (b != null && !inRange(b, 0.0, 20.0)) || !inRange(bestRounded, 0.0, 20.0)) {
        err('Shuttle Run time must be between 0.0 and 20.0 seconds (1 d.p.).')
      }
      num = bestRounded
    } else if (activeStation === 'run') {
      const raw = onlyInt(attempt1 || '')
      if (!/^\d{3,4}$/.test(raw)) return
      const mm = raw.length === 3 ? parseInt(raw.slice(0,1), 10) : parseInt(raw.slice(0,2), 10)
      const ss = parseInt(raw.slice(-2), 10)
      if (!Number.isFinite(mm) || !Number.isFinite(ss) || ss >= 60) err('Time must be MSS/MMSS with seconds 00-59.')
      const minutes = mm + (ss / 60)
      num = Number.parseFloat(minutes.toFixed(2))
    }
    if (num == null || !Number.isFinite(num)) return
    try {
      // Check if a score row exists
      const { data: existing } = await supabase
        .from('scores')
        .select('id')
        .eq('session_id', sessionId)
        .eq('student_id', (await getStudentRowId()) )
        .maybeSingle()
      if (existing?.id) {
        await supabase
          .from('scores')
          .update({ [col]: num })
          .eq('id', existing.id)
      } else {
        await supabase
          .from('scores')
          .insert({ session_id: sessionId, student_id: await getStudentRowId(), [col]: num })
      }
      // Compute points attained for the saved station
      try {
        const sessionMeta = Array.isArray(sessions) ? sessions.find(s => s.id === sessionId) : null
        const testDate = sessionMeta?.session_date ? new Date(sessionMeta.session_date) : new Date()
        // Determine standards level label from school type
        const levelLabel = String(schoolType || '').toLowerCase() === 'primary' ? 'Primary' : 'Secondary'
        const sex = student?.gender
        const age = calcAgeAt(student?.dob, testDate)
        const runKm = (() => {
          if (age == null) return null
          return age >= 14 ? 2.4 : (levelLabel === 'Primary' ? 1.6 : 2.4)
        })()
        const measures = {}
        if (activeStation === 'situps') measures.situps = num
        else if (activeStation === 'pullups') measures.pullups = num
        else if (activeStation === 'broad_jump') measures.broad_jump_cm = num
        else if (activeStation === 'sit_and_reach') measures.sit_and_reach_cm = num
        else if (activeStation === 'shuttle_run') measures.shuttle_s = num
        else if (activeStation === 'run') measures.run_seconds = Math.round(num * 60)
        const res = evaluateNapfa({ level: levelLabel, sex, age, run_km: runKm }, measures)
        const stationKey = (
          activeStation === 'broad_jump' ? 'broad_jump_cm'
          : activeStation === 'sit_and_reach' ? 'sit_and_reach_cm'
          : activeStation === 'shuttle_run' ? 'shuttle_s'
          : activeStation === 'run' ? 'run'
          : activeStation // situps / pullups
        )
        const pts = res?.stations?.[stationKey]?.points
        // Display value formatting per station
        const valueLabel = (() => {
          if (activeStation === 'shuttle_run') return `${num.toFixed(1)}s`
          if (activeStation === 'run') return fmtRun(num) || `${Math.round(num*60)}s`
          return String(num)
        })()
        const base = `${active.name}: ${valueLabel}`
        if (Number.isFinite(pts)) {
          showToast('success', `${base} — ${pts} pts saved`)
        } else {
          showToast('success', `${base} - saved`)
        }
      } catch {
        // If standards don't match or any error occurs, just state the saved value
        const valueLabel = (() => {
          if (activeStation === 'shuttle_run') return `${num.toFixed(1)}s`
          if (activeStation === 'run') return fmtRun(num) || `${Math.round(num*60)}s`
          return String(num)
        })()
        showToast('success', `${active.name}: ${valueLabel} - saved`)
      }
      setAttempt1('')
      setAttempt2('')
      try {
        const sid = await getStudentRowId()
        const data = await fetchScoreRow(supabase, sessionId, sid)
        setExisting(data || null)
      } catch {}
    } catch (e) {
      showToast('error', e.message || 'Failed to save score')
    }
  }

  // Helper to retrieve the student's UUID by their identifier within this session
  async function getStudentRowId() {
    // We already queried the student; try to re-fetch the UUID for reliability
    const { data, error } = await supabase
      .from('students')
      .select('id')
      .eq('student_identifier', student.id)
      .maybeSingle()
    if (error || !data?.id) throw new Error('Student record missing')
    return data.id
  }

  return (
    <main className="w-full">
      <div className="max-w-5xl mx-auto pt-4 pb-8 space-y-6">
      {/* Header */}
        <header className="px-4 sm:px-6 pt-2 sm:pt-3 pb-3 sm:pb-2">
        <div className="space-y-1">
            <h1 className="text-2xl font-semibold mb-1">Score Entry</h1>
            <p className="text-muted-foreground mb-6">
                Select a station and record participant scores
            </p>
        </div>
      </header>

      {/* Tabs */}
      <section className="px-4 sm:px-6">
        {/* Session selector above tabs (overlay dropdown to avoid layout shift) */}
        <div className="px-1 pb-2">
          <div className="relative inline-block min-w-[260px]">
            <Select value={sessionId} onValueChange={setSessionId}>
              <SelectTrigger aria-label="Select assessment session">
                <span className="truncate text-left">
                  {(() => {
                    if (!sessionId) return 'Select session';
                    const se = sessions?.find(s => s.id === sessionId);
                    if (!se) return sessionId;
                    try { return `${se.title} | ${fmtDdMmYyyy(se.session_date)}` } catch { return se.title }
                  })()}
                </span>
              </SelectTrigger>
              <SelectContent>
                {sessions?.length ? (
                  sessions.map((se) => (
                    <SelectItem key={se.id} value={se.id}>
                      {se.title} | {fmtDdMmYyyy(se.session_date)}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="" disabled>
                    No sessions available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Tabs value={activeStation} onValueChange={setActiveStation}>
          <div ref={tabsScrollRef} className="sticky top-0 z-30 -mx-4 sm:mx-0 backdrop-blur bg-white/85 supports-[backdrop-filter]:bg-white/70 border-b border-slate-200 overflow-x-auto overscroll-x-contain snap-x snap-proximity relative">
            <div className="px-4 sm:px-0 min-w-max">
              <TabsList className="bg-gray-100 rounded-lg p-1 flex flex-nowrap gap-1 whitespace-nowrap">
                <TabsTrigger
                  value="situps"
                  className="relative rounded-full px-3 py-1.5 text-sm flex items-center gap-2
                             bg-white text-slate-700 hover:bg-slate-50 ring-1 ring-slate-200
                             border-b-4 border-transparent transition-colors
                             data-[state=active]:bg-blue-600 data-[state=active]:text-white
                             data-[state=active]:border-blue-600 data-[state=active]:ring-blue-600/20 data-[state=active]:shadow-sm"
                  aria-label="Sit-ups"
                  data-snap
                  style={{ scrollSnapAlign: 'start' }}
                >
                  <SitupsIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="font-medium whitespace-nowrap">Sit-ups</span>
                </TabsTrigger>

                <TabsTrigger
                  value="broad_jump"
                  className="relative rounded-full px-3 py-1.5 text-sm flex items-center gap-2
                             bg-white text-slate-700 hover:bg-slate-50 ring-1 ring-slate-200
                             border-b-4 border-transparent transition-colors
                             data-[state=active]:bg-blue-600 data-[state=active]:text-white
                             data-[state=active]:border-blue-600 data-[state=active]:ring-blue-600/20 data-[state=active]:shadow-sm"
                  aria-label="Broad Jump"
                  style={{ scrollSnapAlign: 'start' }}
                >
                  <BroadJumpIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="font-medium whitespace-nowrap">Broad Jump</span>
                </TabsTrigger>

                <TabsTrigger
                  value="sit_and_reach"
                  className="relative rounded-full px-3 py-1.5 text-sm flex items-center gap-2
                             bg-white text-slate-700 hover:bg-slate-50 ring-1 ring-slate-200
                             border-b-4 border-transparent transition-colors
                             data-[state=active]:bg-blue-600 data-[state=active]:text-white
                             data-[state=active]:border-blue-600 data-[state=active]:ring-blue-600/20 data-[state=active]:shadow-sm"
                  aria-label="Sit & Reach"
                  style={{ scrollSnapAlign: 'start' }}
                >
                  <ReachIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="font-medium whitespace-nowrap">Sit & Reach</span>
                </TabsTrigger>

                <TabsTrigger
                  value="pullups"
                  className="relative rounded-full px-3 py-1.5 text-sm flex items-center gap-2
                             bg-white text-slate-700 hover:bg-slate-50 ring-1 ring-slate-200
                             border-b-4 border-transparent transition-colors
                             data-[state=active]:bg-blue-600 data-[state=active]:text-white
                             data-[state=active]:border-blue-600 data-[state=active]:ring-blue-600/20 data-[state=active]:shadow-sm"
                  aria-label="Pull-ups"
                  style={{ scrollSnapAlign: 'start' }}
                >
                  <PullupsIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="font-medium whitespace-nowrap">Pull-ups</span>
                </TabsTrigger>

                <TabsTrigger
                  value="shuttle_run"
                  className="relative rounded-full px-3 py-1.5 text-sm flex items-center gap-2
                             bg-white text-slate-700 hover:bg-slate-50 ring-1 ring-slate-200
                             border-b-4 border-transparent transition-colors
                             data-[state=active]:bg-blue-600 data-[state=active]:text-white
                             data-[state=active]:border-blue-600 data-[state=active]:ring-blue-600/20 data-[state=active]:shadow-sm"
                  aria-label="Shuttle Run"
                  style={{ scrollSnapAlign: 'start' }}
                >
                  <ShuttleIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="font-medium whitespace-nowrap">Shuttle Run</span>
                </TabsTrigger>
                <TabsTrigger
                  value="run"
                  className="relative rounded-full px-3 py-1.5 text-sm flex items-center gap-2
                             bg-white text-slate-700 hover:bg-slate-50 ring-1 ring-slate-200
                             border-b-4 border-transparent transition-colors
                             data-[state=active]:bg-blue-600 data-[state=active]:text-white
                             data-[state=active]:border-blue-600 data-[state=active]:ring-blue-600/20 data-[state=active]:shadow-sm"
                  aria-label="1.6/2.4km Run"
                  style={{ scrollSnapAlign: 'start' }}
                >
                  <Timer className="h-4 w-4" aria-hidden="true" />
                  <span className="font-medium whitespace-nowrap">Run 1.6/2.4km</span>
                </TabsTrigger>
              </TabsList>
            </div>
            {/* Edge fade hints */}
            <div className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white/90 to-transparent transition-opacity ${tabsFadeLeft ? 'opacity-100' : 'opacity-0'}`} />
            <div className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white/90 to-transparent transition-opacity ${tabsFadeRight ? 'opacity-100' : 'opacity-0'}`} />
          </div>
        </Tabs>

        {/* Active Station Card */}
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>
              {active && <active.Icon className="h-5 w-5 text-blue-700" aria-hidden="true" />}
              <span className="font-bold">{active?.name || 'Station'}</span>
            </CardTitle>
            <CardDescription>{active?.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="grid gap-3">
              <div className="grid gap-1.5">
                <label htmlFor="studentId" className="text-gray-700 text-sm">Student ID</label>
                <div className="flex gap-2">
                  <input
                    id="studentId"
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    placeholder="Type or scan student ID"
                    aria-label="Type or scan student ID"
                    className="bg-white border rounded-md px-3 py-2 w-full"
                  />
                  <button
                    type="button"
                    onClick={openScanner}
                    className="border rounded-md px-3 py-2 hover:bg-gray-50"
                    aria-label="Open camera to scan student card"
                    title="Open camera to scan student card"
                  >
                    <Camera className="h-4 w-4" />
                  </button>
                  <button
                    type="submit"
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-md px-3 py-2 flex items-center disabled:opacity-60"
                    disabled={loading}
                    aria-label="Search student by ID"
                  >
                    <ArrowRight className="h-4 w-4 mr-1.5" />
                    {loading ? 'Searching…' : 'Search'}
                  </button>
                  <button
                    type="button"
                    onClick={()=>{ if(sessionId){ setRosterOpen(true) } }}
                    disabled={!sessionId}
                    className="border rounded-md px-3 py-2 hover:bg-gray-50 disabled:opacity-60"
                    aria-label="Select student from list"
                    title={sessionId ? 'Select student from list' : 'Select a session first'}
                  >
                    Student list
                  </button>
                </div>
                {error && <div className="text-sm text-red-600 mt-1">{error}</div>}
              </div>
            </form>
            {/* Expand student info and attempt form after a match */}
            <AnimatePresence initial={false}>
              {student && (
                <motion.div
                  key={`student-${revealKey}`}
                  initial={{ opacity: 0, height: 0, y: -12, scaleY: 0.98, originY: 0 }}
                  animate={{ opacity: 1, height: 'auto', y: 0, scaleY: 1 }}
                  exit={{ opacity: 0, height: 0, y: -12, scaleY: 0.98 }}
                  transition={{ duration: 0.24, ease: 'easeOut' }}
                  className="mt-4 space-y-6 overflow-hidden"
                >
                  {/* Student Info */}
                  <div className="bg-muted/50 border rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 w-12 h-12 rounded-full bg-white border flex items-center justify-center">
                        <UserCircle className="h-7 w-7 text-gray-600" aria-hidden="true" />
                      </div>
                      <div className="flex-1">
                        <div className="text-gray-900 text-base font-semibold">
                          {student.name} <span className="text-gray-600 font-normal">/ {student.id}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-700">
                          <div>
                            <span className="text-gray-500">Class:</span> <span className="font-medium">{student.className}</span>
                          </div>
                          <div>
                            <span className="text-gray-500">Gender:</span> <span className="font-medium">{student.gender || '-'}</span>
                          </div>
                          <div className="sm:col-span-2">
                            <span className="text-gray-500">DOB:</span> <span className="font-medium">{formatDob(student.dob)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Previous saved scores */}
                  {existing && (
                    <div className="space-y-1 text-sm bg-gray-50 border border-gray-200 rounded p-2">
                      <div className="font-medium">Previous saved scores</div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-xs">
                        <div>Sit-ups: <span className="font-semibold">{existing.situps ?? '-'}</span></div>
                        <div>Pull-ups: <span className="font-semibold">{existing.pullups ?? '-'}</span></div>
                        <div>Broad Jump (cm): <span className="font-semibold">{existing.broad_jump ?? '-'}</span></div>
                        <div>Sit & Reach (cm): <span className="font-semibold">{existing.sit_and_reach ?? '-'}</span></div>
                        <div>Shuttle Run (s): <span className="font-semibold">{existing.shuttle_run ?? '-'}</span></div>
                        <div>Run (mm:ss): <span className="font-semibold">{fmtRun(existing.run_2400) ?? '-'}</span></div>
                      </div>
                    </div>
                  )}

                  {/* Record Attempt */}
                  <div className="space-y-2">
                    {['situps','pullups'].includes(activeStation) && (
                      <>
                        <label htmlFor="attempt1" className="text-gray-700 text-sm">Repetitions</label>
                        <div className="text-xs text-gray-600">Unit: reps | Example: 25</div>
                        <Input ref={firstAttemptRef} id="attempt1" inputMode="numeric" value={attempt1} onChange={(e)=> setAttempt1(onlyInt(e.target.value))} placeholder="e.g., 25" className="w-full" />
                        <div role="status" aria-live="polite" className={(validation.valid ? "text-gray-500" : "text-red-600") + " text-xs mt-1"}>{validation.message}</div>
                      </>
                    )}
                    {['broad_jump','sit_and_reach'].includes(activeStation) && (
                      <>
                        <label className="text-gray-700 text-sm">Scores (2 attempts, best kept)</label>
                        <div className="text-xs text-gray-600">Unit: cm | Example: {activeStation === 'sit_and_reach' ? '34' : '190'}</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Input ref={firstAttemptRef} inputMode="numeric" value={attempt1} onChange={(e)=> setAttempt1(onlyInt(e.target.value))} placeholder="Attempt 1" />
                          <Input inputMode="numeric" value={attempt2} onChange={(e)=> setAttempt2(onlyInt(e.target.value))} placeholder="Attempt 2" />
                        </div>
                        <div role="status" aria-live="polite" className={(validation.valid ? "text-gray-500" : "text-red-600") + " text-xs mt-1"}>{validation.message}</div>
                      </>
                    )}
                    {activeStation === 'shuttle_run' && (
                      <>
                        <label className="text-gray-700 text-sm">Times (2 attempts, lower kept)</label>
                        <div className="text-xs text-gray-600">Unit: seconds (1 d.p.) | Example: 10.3</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Input ref={firstAttemptRef} inputMode="decimal" value={attempt1} onChange={(e)=> setAttempt1(oneDecimal(e.target.value))} placeholder="Attempt 1 (e.g., 10.3)" />
                          <Input inputMode="decimal" value={attempt2} onChange={(e)=> setAttempt2(oneDecimal(e.target.value))} placeholder="Attempt 2 (e.g., 10.2)" />
                        </div>
                        <div role="status" aria-live="polite" className={(validation.valid ? "text-gray-500" : "text-red-600") + " text-xs mt-1"}>{validation.message}</div>
                      </>
                    )}
                    {activeStation === 'run' && (
                      <>
                        <label className="text-gray-700 text-sm">Time</label>
                        <div className="text-xs text-gray-600">Format: MSS/MMSS (digits only) | Example: 930 or 1330</div>
                        <div className="grid grid-cols-1 gap-2">
                          <Input ref={firstAttemptRef} inputMode="numeric" value={attempt1} onChange={(e)=> setAttempt1(onlyInt(e.target.value))} placeholder="e.g., 1330 for 13:30" />
                        </div>
                        <div role="status" aria-live="polite" className={(validation.valid ? "text-gray-500" : "text-red-600") + " text-xs mt-1"}>{validation.message}</div>
                      </>
                    )}
                    <Button className="w-full" disabled={!validation.valid} onClick={() => { if (validation.valid) saveScore(); }}>
                      Save Score
                    </Button>
                    <div className="text-xs text-gray-500">Note: This will replace any saved values.</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
          <CardFooter className="text-xs text-gray-500 flex items-center justify-between">
            <div>
              Station: <span className="font-medium">{active?.name}</span>
            </div>
            <div className="text-gray-400" aria-hidden="true" />
          </CardFooter>
        </Card>
      </section>
      {scannerOpen && (
        <ScannerModal
          onClose={() => setScannerOpen(false)}
          onDetected={async (code) => {
            setStudentId(code)
            setScannerOpen(false)
            await doSearch(code)
            setTimeout(() => { try { firstAttemptRef.current?.focus() } catch {} }, 0)
          }}
        />
      )}
      {rosterOpen && (
        <RosterModal
          loading={rosterLoading}
          roster={roster}
          query={rosterQuery}
          setQuery={setRosterQuery}
          onClose={() => setRosterOpen(false)}
          onSelect={async (r) => {
            const id = r?.key || ''
            setStudentId(id)
            setRosterOpen(false)
            try {
              await doSearch(id)
              setTimeout(() => { try { firstAttemptRef.current?.focus() } catch {} }, 0)
            } catch {}
          }}
        />
      )}
      </div>
    </main>
  )
}

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
          // Fallback: ZXing
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
      // Stop ZXing controls if active
      if (controlsRef.current) { try { controlsRef.current.stop() } catch {} controlsRef.current = null }
      // Stop camera tracks
      if (streamRef.current) {
        try { streamRef.current.getTracks().forEach(t => t.stop()) } catch {}
        streamRef.current = null
      }
      // Clear video element
      if (videoRef.current) {
        try { videoRef.current.pause(); videoRef.current.srcObject = null } catch {}
      }
      if (typeof cleanupFn === 'function') cleanupFn()
    }
  }, [onDetected])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-sm font-medium">Scan Student Card</div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded" aria-label="Close scanner"><X className="h-4 w-4" /></button>
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

function RosterModal({ loading, roster, query, setQuery, onClose, onSelect }) {
  const filtered = useMemo(() => {
    const q = (query||'').trim().toLowerCase()
    if (!q) return roster
    return roster.filter(r => (r.name||'').toLowerCase().includes(q) || (r.key||'').toLowerCase().includes(q) || (r.className||'').toLowerCase().includes(q))
  }, [roster, query])

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl overflow-hidden" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-sm font-medium">Select Student</div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-3 space-y-3">
          <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search by name, ID, class" className="border rounded p-2 w-full" />
          <div className="max-h-80 overflow-auto border rounded">
            {loading ? (
              <div className="p-3 text-sm text-gray-600">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-3 text-sm text-gray-600">No students in this session.</div>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="px-3 py-2 border">ID</th>
                    <th className="px-3 py-2 border">Name</th>
                    <th className="px-3 py-2 border">Class</th>
                    <th className="px-3 py-2 border w-28">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => (
                    <tr key={r.key} className="hover:bg-gray-50">
                      <td className="px-3 py-2 border font-mono">{r.key}</td>
                      <td className="px-3 py-2 border">{r.name}</td>
                      <td className="px-3 py-2 border">{r.className || '-'}</td>
                      <td className="px-3 py-2 border">
                        <button className="px-2 py-1 border rounded" onClick={()=>onSelect(r)}>Select</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="px-3 py-2 border-t flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 border rounded hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  )
}

  // Minimal inline icon set (stroke-based, currentColor)
  function calcAgeAt(dobISO, when) {
    if (!dobISO) return null
    const birth = new Date(dobISO)
    const d = when instanceof Date ? when : new Date(when)
    let age = d.getFullYear() - birth.getFullYear()
    const m = d.getMonth() - birth.getMonth()
    if (m < 0 || (m === 0 && d.getDate() < birth.getDate())) age--
    return age
  }
function formatDob(dob) {
  if (!dob) return '-'
  try {
    const dt = new Date(dob)
    const day = dt.getDate()
    const mon = dt.getMonth() + 1
    const yr = dt.getFullYear()
    return `${day}/${mon}/${yr}`
  } catch { return dob }
}

// fmtRun is imported from ../lib/scores

function IconBase({ children, className, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  )
}

function Activity(props) {
  return (
    <IconBase {...props}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </IconBase>
  )
}
function Ruler(props) {
  return (
    <IconBase {...props}>
      <path d="M16 2l6 6-14 14-6-6Z" />
      <path d="M7 7l1.5 1.5M10 10l1.5 1.5M13 13l1.5 1.5" />
    </IconBase>
  )
}
function Hand(props) {
  return (
    <IconBase {...props}>
      <path d="M8 13V5a2 2 0 1 1 4 0v6" />
      <path d="M12 11V4a2 2 0 1 1 4 0v7" />
      <path d="M16 10V6a2 2 0 1 1 4 0v6c0 5-4 6-8 6-4 0-8-1-8-6v-3" />
    </IconBase>
  )
}
function Timer(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="13" r="9" />
      <path d="M12 7v6l4 2" />
      <path d="M10 2h4" />
    </IconBase>
  )
}
function Camera(props) {
  return (
    <IconBase {...props}>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2Z" />
      <circle cx="12" cy="13" r="4" />
    </IconBase>
  )
}
function ArrowRight(props) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14" />
      <path d="M13 5l7 7-7 7" />
    </IconBase>
  )
}
function X(props) {
  return (
    <IconBase {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </IconBase>
  )
}

function UserCircle(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M7.5 17a4.5 4.5 0 0 1 9 0" />
      <circle cx="12" cy="10" r="3" />
    </IconBase>
  )
}


