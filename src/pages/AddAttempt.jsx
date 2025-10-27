// Inline minimal icons to avoid external deps
import { useMemo, useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import { AnimatePresence, motion } from 'framer-motion'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { useToast } from '../components/ToastProvider'

export default function AddAttempt({ user }) {
  const [sessionId, setSessionId] = useState('')
  const [sessions, setSessions] = useState([])
  const stations = useMemo(() => ([
    { key: 'situps', name: 'Sit-ups', Icon: Activity, description: 'Count repetitions | 1 attempt' },
    { key: 'broad_jump', name: 'Broad Jump', Icon: Ruler, description: 'Measure distance (cm) | 2 attempts, record best' },
    { key: 'sit_and_reach', name: 'Sit & Reach', Icon: Ruler, description: 'Measure distance (cm) | 2 attempts, record best' },
    { key: 'pullups', name: 'Pull-ups', Icon: Hand, description: 'Count repetitions | 1 attempt' },
    { key: 'shuttle_run', name: 'Shuttle Run', Icon: Timer, description: 'Record time (sec, 1dp) | 1 attempt' },
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
  const navigate = useNavigate()
  const active = useMemo(() => stations.find(s => s.key === activeStation), [stations, activeStation])
  const { showToast } = useToast()

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
        const { data: sess } = await supabase
          .from('sessions')
          .select('id, title, session_date')
          .eq('school_id', mem.school_id)
          .order('session_date', { ascending: true })
        setSessions(sess || [])
      } catch {}
    }
    load()
  }, [user?.id])

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!sessionId) { setError('Please select a session.'); return }
    if (!studentId.trim()) { setError('Please enter a Student ID.'); return }
    setLoading(true)
    try {
      // Look up student in this session's roster by student_identifier
      const { data, error: err } = await supabase
        .from('session_roster')
        .select('students!inner(id, student_identifier, name, gender, dob, enrollments!left(class, is_active))')
        .eq('session_id', sessionId)
        .eq('students.student_identifier', studentId.trim())
        .maybeSingle()
      if (err) throw err
      if (!data?.students?.id) {
        setError('Student not found in this session roster.')
        // Close student + attempt section if previously open
        setStudent(null)
        setLoading(false)
        return
      }
      // derive active class if present
      let className = ''
      const enr = data.students?.enrollments
      if (Array.isArray(enr)) {
        className = enr.find((e)=>e?.is_active)?.class || ''
      } else if (enr) {
        className = enr.class || ''
      }
      const id = (data.students.student_identifier || '').toUpperCase()
      // force exit/enter for animation even when already expanded
      setStudent(null)
      setStudent({ id, name: data.students.name, className, gender: data.students.gender, dob: data.students.dob })
      setRevealKey((k)=>k+1)
      setAttempt1('')
      setAttempt2('')
    } catch (e2) {
      setError(e2.message || 'Search failed.')
      // Close section on error as well
      setStudent(null)
    } finally {
      setLoading(false)
    }
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

  // Input helpers
  const onlyInt = (val) => (val || '').toString().replace(/[^0-9]/g, '')
  const oneDecimal = (val) => {
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
          .select('situps, pullups, broad_jump, sit_and_reach, shuttle_run')
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
    }
    const col = colMap[activeStation] || 'situps'
    let num = null
    if (activeStation === 'situps' || activeStation === 'pullups') {
      const n = parseInt(onlyInt(attempt1 || ''))
      if (!Number.isFinite(n)) return
      num = n
    } else if (activeStation === 'broad_jump' || activeStation === 'sit_and_reach') {
      const a = attempt1 ? parseInt(onlyInt(attempt1 || '')) : null
      const b = attempt2 ? parseInt(onlyInt(attempt2 || '')) : null
      if (a == null && b == null) return
      num = a == null ? b : (b == null ? a : Math.max(a, b))
    } else if (activeStation === 'shuttle_run') {
      const a = attempt1 ? Number(oneDecimal(attempt1)) : null
      const b = attempt2 ? Number(oneDecimal(attempt2)) : null
      if (a == null && b == null) return
      const best = (a == null) ? b : (b == null ? a : Math.min(a, b))
      num = Number.parseFloat(Number(best).toFixed(1))
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
      showToast('success', 'Score saved successfully')
      setAttempt1('')
      setAttempt2('')
      try {
        const sid = await getStudentRowId()
        const { data } = await supabase
          .from('scores')
          .select('situps, pullups, broad_jump, sit_and_reach, shuttle_run')
          .eq('session_id', sessionId)
          .eq('student_id', sid)
          .maybeSingle()
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
                    try { return `${se.title} | ${new Date(se.session_date).toLocaleDateString()}` } catch { return se.title }
                  })()}
                </span>
              </SelectTrigger>
              <SelectContent>
                {sessions?.length ? (
                  sessions.map((se) => (
                    <SelectItem key={se.id} value={se.id}>
                      {se.title} | {new Date(se.session_date).toLocaleDateString()}
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
          <div className="-mx-4 sm:mx-0 overflow-x-auto">
            <div className="px-4 sm:px-0 min-w-max">
              <TabsList className="bg-gray-100 rounded-lg p-1 flex gap-1">
                <TabsTrigger
                  value="situps"
                  className="rounded-md px-3 py-1.5 text-sm flex items-center gap-2
                             data-[state=active]:bg-white data-[state=active]:text-blue-700
                             data-[state=active]:shadow data-[state=active]:border data-[state=active]:border-gray-200
                             text-gray-700 hover:text-gray-900"
                  aria-label="Sit-ups"
                >
                  <Activity className="h-4 w-4" aria-hidden="true" />
                  <span className="font-medium whitespace-nowrap">Sit-ups</span>
                </TabsTrigger>

                <TabsTrigger
                  value="broad_jump"
                  className="rounded-md px-3 py-1.5 text-sm flex items-center gap-2
                             data-[state=active]:bg-white data-[state=active]:text-blue-700
                             data-[state=active]:shadow data-[state=active]:border data-[state=active]:border-gray-200
                             text-gray-700 hover:text-gray-900"
                  aria-label="Broad Jump"
                >
                  <Ruler className="h-4 w-4" aria-hidden="true" />
                  <span className="font-medium whitespace-nowrap">Broad Jump</span>
                </TabsTrigger>

                <TabsTrigger
                  value="sit_and_reach"
                  className="rounded-md px-3 py-1.5 text-sm flex items-center gap-2
                             data-[state=active]:bg-white data-[state=active]:text-blue-700
                             data-[state=active]:shadow data-[state=active]:border data-[state=active]:border-gray-200
                             text-gray-700 hover:text-gray-900"
                  aria-label="Sit & Reach"
                >
                  <Ruler className="h-4 w-4" aria-hidden="true" />
                  <span className="font-medium whitespace-nowrap">Sit & Reach</span>
                </TabsTrigger>

                <TabsTrigger
                  value="pullups"
                  className="rounded-md px-3 py-1.5 text-sm flex items-center gap-2
                             data-[state=active]:bg-white data-[state=active]:text-blue-700
                             data-[state=active]:shadow data-[state=active]:border data-[state=active]:border-gray-200
                             text-gray-700 hover:text-gray-900"
                  aria-label="Pull-ups"
                >
                  <Hand className="h-4 w-4" aria-hidden="true" />
                  <span className="font-medium whitespace-nowrap">Pull-ups</span>
                </TabsTrigger>

                <TabsTrigger
                  value="shuttle_run"
                  className="rounded-md px-3 py-1.5 text-sm flex items-center gap-2
                             data-[state=active]:bg-white data-[state=active]:text-blue-700
                             data-[state=active]:shadow data-[state=active]:border data-[state=active]:border-gray-200
                             text-gray-700 hover:text-gray-900"
                  aria-label="Shuttle Run"
                >
                  <Timer className="h-4 w-4" aria-hidden="true" />
                  <span className="font-medium whitespace-nowrap">Shuttle Run</span>
                </TabsTrigger>
              </TabsList>
            </div>
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
                    {loading ? 'Searchingâ€¦' : 'Search'}
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
                      </div>
                    </div>
                  )}

                  {/* Record Attempt */}
                  <div className="space-y-2">
                    {['situps','pullups'].includes(activeStation) && (
                      <>
                        <label htmlFor="attempt1" className="text-gray-700 text-sm">Repetitions</label>
                        <div className="text-xs text-gray-600">Unit: reps â€¢ Example: 25</div>
                        <Input id="attempt1" inputMode="numeric" value={attempt1} onChange={(e)=> setAttempt1(onlyInt(e.target.value))} placeholder="e.g., 25" className="w-full" />
                      </>
                    )}
                    {['broad_jump','sit_and_reach'].includes(activeStation) && (
                      <>
                        <label className="text-gray-700 text-sm">Scores (2 attempts, best kept)</label>
                        <div className="text-xs text-gray-600">Unit: cm â€¢ Example: 190</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Input inputMode="numeric" value={attempt1} onChange={(e)=> setAttempt1(onlyInt(e.target.value))} placeholder="Attempt 1" />
                          <Input inputMode="numeric" value={attempt2} onChange={(e)=> setAttempt2(onlyInt(e.target.value))} placeholder="Attempt 2" />
                        </div>
                      </>
                    )}
                    {activeStation === 'shuttle_run' && (
                      <>
                        <label className="text-gray-700 text-sm">Times (2 attempts, lower kept)</label>
                        <div className="text-xs text-gray-600">Unit: seconds (1 d.p.) â€¢ Example: 10.3</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Input inputMode="decimal" value={attempt1} onChange={(e)=> setAttempt1(oneDecimal(e.target.value))} placeholder="Attempt 1 (e.g., 10.3)" />
                          <Input inputMode="decimal" value={attempt2} onChange={(e)=> setAttempt2(oneDecimal(e.target.value))} placeholder="Attempt 2 (e.g., 10.2)" />
                        </div>
                      </>
                    )}
                    <Button className="w-full" onClick={() => { saveScore(); }}>
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
        <ScannerModal onClose={() => setScannerOpen(false)} onDetected={(code) => { setStudentId(code); setScannerOpen(false); }} />
      )}
      {rosterOpen && (
        <RosterModal
          loading={rosterLoading}
          roster={roster}
          query={rosterQuery}
          setQuery={setRosterQuery}
          onClose={() => setRosterOpen(false)}
          onSelect={(r) => { setStudentId(r.key); setRosterOpen(false); setTimeout(()=>onSubmit({ preventDefault: ()=>{} }), 0) }}
        />
      )}
      </div>
    </main>
  )
}

function ScannerModal({ onClose, onDetected }) {
  const videoRef = useRef(null)
  const [supported, setSupported] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    let stream
    const hasBarcode = 'BarcodeDetector' in window
    setSupported(hasBarcode)
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        if (hasBarcode) {
          const detector = new window.BarcodeDetector({ formats: ['qr_code','code_39','code_128'] })
          let cancelled = false
          const tick = async () => {
            if (cancelled) return
            try {
              const frame = await detector.detect(videoRef.current)
              if (frame && frame.length > 0) {
                const value = frame[0].rawValue || frame[0].rawValue
                if (value) { onDetected(value) }
                return
              }
            } catch {}
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
          return () => { cancelled = true }
        }
      } catch (e) {
        setErr(e.message || 'Camera unavailable.')
      }
    }
    const cleanup = start()
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop())
      if (typeof cleanup === 'function') cleanup()
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

