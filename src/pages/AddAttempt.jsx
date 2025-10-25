// Inline minimal icons to avoid external deps
import { useMemo, useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'

export default function AddAttempt({ user }) {
  const [sessionId, setSessionId] = useState('')
  const [sessions, setSessions] = useState([])
  const stations = useMemo(() => ([
    { key: 'situps', name: 'Sit-ups', Icon: Activity, description: 'Count repetitions – 1 attempt' },
    { key: 'broad_jump', name: 'Broad Jump', Icon: Ruler, description: 'Measure distance (cm) – 2 attempts, record best' },
    { key: 'sit_and_reach', name: 'Sit & Reach', Icon: Ruler, description: 'Measure distance (cm) – 2 attempts, record best' },
    { key: 'pullups', name: 'Pull-ups', Icon: Hand, description: 'Count repetitions – 1 attempt' },
    { key: 'shuttle_run', name: 'Shuttle Run', Icon: Timer, description: 'Record time (sec, 2dp) – 1 attempt' },
  ]), [])
  const [activeStation, setActiveStation] = useState('situps')
  const [studentId, setStudentId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const navigate = useNavigate()
  const active = useMemo(() => stations.find(s => s.key === activeStation), [stations, activeStation])

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
      const { data, error: err } = await supabase
        .from('session_roster')
        .select('students!inner(id, student_identifier, name)')
        .eq('session_id', sessionId)
        .eq('students.student_identifier', studentId.trim())
        .maybeSingle()
      if (err) throw err
      if (!data?.students?.id) {
        setError('Student not found in this session roster.');
        setLoading(false)
        return
      }
      // Navigate to the session Scores tab for quick entry
      navigate(`/sessions/${sessionId}#scores`)
    } catch (e2) {
      setError(e2.message || 'Search failed.')
    } finally {
      setLoading(false)
    }
  }

  const openScanner = () => setScannerOpen(true)

  return (
    <main className="w-full">
      <div className="max-w-5xl mx-auto pt-4 pb-8 space-y-6">
      {/* Header */}
      <header className="px-4 sm:px-6 pt-2 sm:pt-3 pb-3 sm:pb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
            <h1 className="text-2xl font-semibold mb-1">Score Entry</h1>
            <p className="text-muted-foreground mb-6">
                Select a station and record participant scores
            </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wide text-gray-500">Assessment Session</span>
          <div className="min-w-[260px]">
            <Select value={sessionId} onValueChange={setSessionId}>
              <SelectTrigger aria-label="Select assessment session">
                <span className="truncate text-left">
                  {(() => {
                    if (!sessionId) return 'Select session';
                    const se = sessions?.find(s => s.id === sessionId);
                    if (!se) return sessionId;
                    try { return `${se.title} — ${new Date(se.session_date).toLocaleDateString()}` } catch { return se.title }
                  })()}
                </span>
              </SelectTrigger>
              <SelectContent className="w-[260px]">
                {sessions?.length ? (
                  sessions.map((se) => (
                    <SelectItem key={se.id} value={se.id}>
                      {se.title} — {new Date(se.session_date).toLocaleDateString()}
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
      </header>

      {/* Tabs */}
      <section className="px-4 sm:px-6">
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
                    {loading ? 'Searching…' : 'Search'}
                  </button>
                </div>
                {error && <div className="text-sm text-red-600 mt-1">{error}</div>}
              </div>
            </form>
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

// Minimal inline icon set (stroke-based, currentColor)
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
