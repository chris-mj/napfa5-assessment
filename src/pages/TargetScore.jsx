import { useMemo, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../components/ui/select'
import { evaluateNapfa, findRows, getAgeGroup, normalizeSex, secondsToMmss } from '../utils/napfaStandards'

function calcAgeAt(dobISO, when = new Date()) {
  if (!dobISO) return null
  try {
    const birth = new Date(dobISO)
    const d = when instanceof Date ? when : new Date(when)
    let age = d.getFullYear() - birth.getFullYear()
    const m = d.getMonth() - birth.getMonth()
    if (m < 0 || (m === 0 && d.getDate() < birth.getDate())) age--
    return age
  } catch { return null }
}

function onlyInt(val) { return (val || '').toString().replace(/[^0-9]/g, '') }
function oneDecimal(val) {
  const s = (val || '').toString().replace(/[^0-9.]/g, '')
  const parts = s.split('.')
  if (parts.length === 1) return parts[0]
  return parts[0] + '.' + parts[1].slice(0,1)
}

function gradeToRank(grade) {
  const map = { A: 5, B: 4, C: 3, D: 2, E: 1 }
  const g = String(grade || '').toUpperCase()
  return map[g] || 0
}

function computeAwardSummary(result, hasRun) {
  const st = result?.stations || {}
  const keys = ['situps','broad_jump_cm','sit_and_reach_cm','pullups','shuttle_s']
  const fiveCompleted = keys.every(k => st[k] && st[k].points != null)
  const sixCompleted = fiveCompleted && hasRun
  const total = Number(result?.totalPoints || 0)
  const ranks = keys.map(k => gradeToRank(st[k]?.grade)).filter(Boolean)
  if (hasRun && st.run && st.run.points != null) ranks.push(gradeToRank(st.run.grade))
  const minRank = ranks.length ? Math.min(...ranks) : 0

  const full = () => {
    if (total >= 21 && minRank >= gradeToRank('C')) return { label: 'Gold', reason: `Total ${total} points and at least grade C in all stations.` }
    if (total >= 15 && minRank >= gradeToRank('D')) return { label: 'Silver', reason: `Total ${total} points and at least grade D in all stations.` }
    if (total >= 6 && minRank >= gradeToRank('E')) return { label: 'Bronze', reason: `Total ${total} points and at least grade E in all stations.` }
    return { label: 'No Award', reason: `Total ${total} points or minimum grade conditions not met.` }
  }
  const prov = () => {
    if (!fiveCompleted || sixCompleted) return null
    const fiveTotal = (st.situps?.points||0)+(st.broad_jump_cm?.points||0)+(st.sit_and_reach_cm?.points||0)+(st.pullups?.points||0)+(st.shuttle_s?.points||0)
    const fiveMin = Math.min(gradeToRank(st.situps?.grade), gradeToRank(st.broad_jump_cm?.grade), gradeToRank(st.sit_and_reach_cm?.grade), gradeToRank(st.pullups?.grade), gradeToRank(st.shuttle_s?.grade))
    if (fiveTotal >= 21 && fiveMin >= gradeToRank('C')) return { label: 'Gold', reason: `Five-station subtotal ${fiveTotal} points and all >= C.`, provisional: true }
    if (fiveTotal >= 15 && fiveMin >= gradeToRank('D')) return { label: 'Silver', reason: `Five-station subtotal ${fiveTotal} points and all >= D.`, provisional: true }
    if (fiveTotal >= 6 && fiveMin >= gradeToRank('E')) return { label: 'Bronze', reason: `Five-station subtotal ${fiveTotal} points and all >= E.`, provisional: true }
    return { label: 'No Award', reason: `Five-station subtotal ${fiveTotal} points or minimum grade conditions not met.`, provisional: true }
  }
  return hasRun ? full() : (prov() || { label: 'No Award', reason: 'Enter five station results for provisional award.' })
}

function StationStandards({ rows, stationKey, lowerBetter }) {
  // Show a compact table of grade/points and threshold text for the given station
  const display = (r) => {
    if (stationKey === 'run') {
      const mmss = secondsToMmss(r.stations.run.max_s ?? r.stations.run.min_s)
      return mmss ? `<= ${mmss}` : '-'
    }
    if (stationKey === 'shuttle_s') {
      const v = (r.stations.shuttle_s.max ?? r.stations.shuttle_s.min)
      return Number.isFinite(v) ? `<= ${v}${lowerBetter ? ' s' : ''}` : '-'
    }
    const band = r.stations[stationKey]
    if (!band) return '-'
    const v = band.min
    return Number.isFinite(v) ? `>= ${v}` : '-'
  }
  const list = rows.slice().sort((a,b)=> (b.points||0)-(a.points||0))
  return (
    <table className="text-xs border rounded w-full">
      <thead>
        <tr className="bg-gray-100 text-left"><th className="px-2 py-1 border">Grade</th><th className="px-2 py-1 border">Points</th><th className="px-2 py-1 border">Target</th></tr>
      </thead>
      <tbody>
        {list.map((r,i)=>(
          <tr key={i}>
            <td className="px-2 py-1 border">{r.grade}</td>
            <td className="px-2 py-1 border">{r.points}</td>
            <td className="px-2 py-1 border">{display(r)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function TargetScore() {
  const [gender, setGender] = useState('')
  const [level, setLevel] = useState('')
  // DOB split inputs
  const [dobDD, setDobDD] = useState('')
  const [dobMM, setDobMM] = useState('')
  const [dobYYYY, setDobYYYY] = useState('')
  const days = useMemo(() => Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')), [])
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')), [])
  const years = useMemo(() => {
    const now = new Date().getFullYear()
    const top = now - 9
    const bottom = now - 25
    const arr = []
    for (let y = top; y >= bottom; y--) arr.push(String(y))
    return arr
  }, [])

  // Inputs
  const [situps, setSitups] = useState('')
  const [pullups, setPullups] = useState('')
  const [broad, setBroad] = useState('')
  const [reach, setReach] = useState('')
  const [shuttle, setShuttle] = useState('')
  const [run, setRun] = useState('') // MSS/MMSS digits e.g. 930 or 1330

  const today = new Date()
  const dobIso = useMemo(() => {
    if (dobDD.length !== 2 || dobMM.length !== 2 || dobYYYY.length !== 4) return ''
    return `${dobYYYY}-${dobMM}-${dobDD}`
  }, [dobDD, dobMM, dobYYYY])
  const age = useMemo(() => calcAgeAt(dobIso, today), [dobIso])
  const normSex = normalizeSex(gender)
  const runKm = useMemo(() => {
    if (age != null && age >= 14) return 2.4
    return level === 'Primary' ? 1.6 : (level === 'Secondary' ? 2.4 : null)
  }, [age, level])

  const measures = useMemo(() => {
    const m = {}
    if (situps !== '') m.situps = Number(onlyInt(situps))
    if (pullups !== '') m.pullups = Number(onlyInt(pullups))
    if (broad !== '') m.broad_jump_cm = Number(onlyInt(broad))
    if (reach !== '') m.sit_and_reach_cm = Number(onlyInt(reach))
    if (shuttle !== '') m.shuttle_s = Number.parseFloat(oneDecimal(shuttle))
    if (run !== '') {
      const raw = onlyInt(run)
      if (/^\d{3,4}$/.test(raw)) {
        const mm = raw.length === 3 ? parseInt(raw.slice(0,1), 10) : parseInt(raw.slice(0,2), 10)
        const ss = parseInt(raw.slice(-2), 10)
        if (Number.isFinite(mm) && Number.isFinite(ss) && ss < 60) m.run_seconds = mm*60 + ss
      }
    }
    return m
  }, [situps, pullups, broad, reach, shuttle, run])

  const result = useMemo(() => {
    if (!normSex || !level || age == null || runKm == null) return null
    return evaluateNapfa({ level, sex: normSex, age, run_km: runKm }, measures)
  }, [normSex, level, age, runKm, measures])

  const award = useMemo(() => {
    if (!result) return null
    const hasRun = !!measures.run_seconds
    return computeAwardSummary(result, hasRun)
  }, [result, measures.run_seconds])

  const rowsForCohort = useMemo(() => {
    if (!normSex || !level || age == null) return []
    return findRows(level, normSex, getAgeGroup(age))
  }, [normSex, level, age])

  return (
    <main className="w-full">
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <h1 className="text-2xl font-semibold">Target Score</h1>
        <p className="text-sm text-gray-600">Estimate your NAPFA points by entering your details and station results. Test date is assumed to be today.</p>

        <Card>
          <CardHeader><CardTitle>Your Details</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm">Gender</label>
                <div className="mt-1 relative inline-block">
                  <Select value={gender} onValueChange={setGender}>
                    <SelectTrigger aria-label="Gender" className={`min-w-[140px] ${!gender ? 'border-red-500 focus:ring-red-500' : ''}`}>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent className="w-[160px]">
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {!gender && (<div className="text-xs text-red-600 mt-1">Please select gender.</div>)}
              </div>
              <div>
                <label className="block text-sm">School Level</label>
                <div className="mt-1 relative inline-block">
                  <Select value={level} onValueChange={setLevel}>
                    <SelectTrigger aria-label="School Level" className={`min-w-[160px] ${!level ? 'border-red-500 focus:ring-red-500' : ''}`}>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent className="w-[180px] max-h-56 overflow-auto">
                      <SelectItem value="Primary">Primary</SelectItem>
                      <SelectItem value="Secondary">Secondary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {!level && (<div className="text-xs text-red-600 mt-1">Please select school level.</div>)}
              </div>
              <div>
                <label className="block text-sm">Date of Birth</label>
                <div className="mt-1 flex items-center gap-2">
                  <div className="relative inline-block">
                    <Select value={dobDD} onValueChange={(v)=>{ setDobDD(v); setTimeout(()=>{ try { document.getElementById('dob-month-trigger')?.focus() } catch {} },0) }}>
                      <SelectTrigger aria-label="Day" className={`min-w-[72px] justify-between ${(!dobDD && (dobMM || dobYYYY)) ? 'border-red-500' : ''}`}><SelectValue placeholder="DD" /></SelectTrigger>
                      <SelectContent className="w-[100px] max-h-56 overflow-auto">
                        {days.map(d => (<SelectItem key={d} value={d}>{d}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="relative inline-block">
                    <Select value={dobMM} onValueChange={(v)=>{ setDobMM(v); setTimeout(()=>{ try { document.getElementById('dob-year-trigger')?.focus() } catch {} },0) }}>
                      <SelectTrigger id="dob-month-trigger" aria-label="Month" className={`min-w-[84px] justify-between ${(!dobMM && (dobDD || dobYYYY)) ? 'border-red-500' : ''}`}><SelectValue placeholder="MM" /></SelectTrigger>
                      <SelectContent className="w-[110px] max-h-56 overflow-auto">
                        {months.map(m => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="relative inline-block">
                    <Select value={dobYYYY} onValueChange={setDobYYYY}>
                      <SelectTrigger id="dob-year-trigger" aria-label="Year" className={`min-w-[96px] justify-between ${(!dobYYYY && (dobDD || dobMM)) ? 'border-red-500' : ''}`}><SelectValue placeholder="YYYY" /></SelectTrigger>
                      <SelectContent className="w-[120px] max-h-56 overflow-auto">
                        {years.map(y => (<SelectItem key={y} value={y}>{y}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {((dobDD||dobMM||dobYYYY) && (!dobIso)) && (
                  <div className="text-xs text-red-600 mt-1">Please select a valid date.</div>
                )}
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-700">Run distance: <b>{runKm ? `${runKm} km` : '-'}</b> (auto based on age/level)</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Your Standards</CardTitle></CardHeader>
          <CardContent>
            {rowsForCohort.length === 0 ? (
              <div className="text-sm text-gray-600">No standards available for the current selection. Please check Gender, School Level, and Date of Birth.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="font-medium mb-1">Sit-ups</div>
                  <StationStandards rows={rowsForCohort} stationKey="situps" lowerBetter={false} />
                </div>
                <div>
                  <div className="font-medium mb-1">Pull-ups</div>
                  <StationStandards rows={rowsForCohort} stationKey="pullups" lowerBetter={false} />
                </div>
                <div>
                  <div className="font-medium mb-1">Standing Broad Jump</div>
                  <StationStandards rows={rowsForCohort} stationKey="broad_jump_cm" lowerBetter={false} />
                </div>
                <div>
                  <div className="font-medium mb-1">Sit & Reach</div>
                  <StationStandards rows={rowsForCohort} stationKey="sit_and_reach_cm" lowerBetter={false} />
                </div>
                <div>
                  <div className="font-medium mb-1">Shuttle Run 4x10m</div>
                  <StationStandards rows={rowsForCohort} stationKey="shuttle_s" lowerBetter={true} />
                </div>
                <div>
                  <div className="font-medium mb-1">Run ({runKm || '-'} km)</div>
                  <StationStandards rows={rowsForCohort} stationKey="run" lowerBetter={true} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Enter Your Results</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm">Sit-ups (reps)</label>
                <Input inputMode="numeric" value={situps} onChange={(e)=>setSitups(onlyInt(e.target.value))} placeholder="e.g., 30" />
                <ResultLine r={result?.stations?.situps} />
              </div>
              <div>
                <label className="text-sm">Pull-ups (reps)</label>
                <Input inputMode="numeric" value={pullups} onChange={(e)=>setPullups(onlyInt(e.target.value))} placeholder="e.g., 8" />
                <ResultLine r={result?.stations?.pullups} />
              </div>
              <div>
                <label className="text-sm">Standing Broad Jump (cm)</label>
                <Input inputMode="numeric" value={broad} onChange={(e)=>setBroad(onlyInt(e.target.value))} placeholder="e.g., 200" />
                <ResultLine r={result?.stations?.broad_jump_cm} />
              </div>
              <div>
                <label className="text-sm">Sit & Reach (cm)</label>
                <Input inputMode="numeric" value={reach} onChange={(e)=>setReach(onlyInt(e.target.value))} placeholder="e.g., 40" />
                <ResultLine r={result?.stations?.sit_and_reach_cm} />
              </div>
              <div>
                <label className="text-sm">Shuttle Run 4x10m (s, 1 d.p.)</label>
                <Input inputMode="decimal" value={shuttle} onChange={(e)=>setShuttle(oneDecimal(e.target.value))} placeholder="e.g., 10.3" />
                <ResultLine r={result?.stations?.shuttle_s} />
              </div>
              <div>
                <label className="text-sm">Run (MSS/MMSS digits)</label>
                <Input inputMode="numeric" value={run} onChange={(e)=>setRun(onlyInt(e.target.value))} placeholder="e.g., 1330 for 13:30" />
                <ResultLine r={result?.stations?.run} formatter={(v)=> (Number.isFinite(v)? secondsToMmss(v):'-')} />
              </div>
            </div>
            <div className="mt-3 p-3 rounded border bg-slate-50 text-slate-800">
              <div className="font-medium">Total Points: {Number(result?.totalPoints||0)}</div>
              {award && (
                <div className="mt-1 text-sm">
                  <div className="font-semibold">{award.label}{award.provisional ? ' (Provisional)' : ''}</div>
                  <div>{award.reason}</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

      </div>
    </main>
  )
}

function ResultLine({ r }) {
  if (!r) return <div className="text-xs text-gray-500">No result yet.</div>
  const pts = Number(r.points || 0)
  const grade = r.grade || '-'
  return (
    <div className="text-xs text-gray-700 mt-1">Grade: <b>{grade}</b> · Points: <b>{pts}</b></div>
  )
}
