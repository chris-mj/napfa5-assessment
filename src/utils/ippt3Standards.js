// IPPT-3 standards evaluator (sit-ups, push-ups, 2.4km run)
// Loads CSVs from public/ and provides points + award

let cache = {
  situp: null,
  pushup: null,
  run_km: null,
}

function parseCsv(text) {
  const rows = []
  const lines = text.trim().split(/\r?\n/)
  const headers = lines[0].split(',').map(s=>s.trim())
  for (let i=1;i<lines.length;i++) {
    const parts = lines[i].split(',')
    if (parts.length < headers.length) continue
    const obj = {}
    headers.forEach((h, idx) => obj[h] = parts[idx])
    // normalize numeric types
    if (obj.age_min != null) obj.age_min = Number(obj.age_min)
    if (obj.age_max != null) obj.age_max = Number(obj.age_max)
    if (obj.score != null) obj.score = Number(obj.score)
    if (obj.performance_reps != null) obj.performance_reps = Number(obj.performance_reps)
    rows.push(obj)
  }
  return rows
}

function timeToSeconds(mmss) {
  if (!mmss) return null
  const [m,s] = String(mmss).split(':').map(x => Number(x))
  if (!Number.isFinite(m) || !Number.isFinite(s)) return null
  return m*60 + s
}

async function ensureLoaded() {
  if (cache.situp && cache.pushup && cache.run_km) return cache
  const [a,b,c] = await Promise.all([
    fetch('/ippt3_standards_situp.csv').then(r=>r.text()),
    fetch('/ippt3_standards_pushup.csv').then(r=>r.text()),
    fetch('/ippt3_standards_2p4.csv').then(r=>r.text()),
  ])
  cache.situp = parseCsv(a)
  cache.pushup = parseCsv(b)
  // CSV headers use run_min/run_max (mm:ss)
  const runRows = parseCsv(c).map(r => ({
    ...r,
    min_s: timeToSeconds(r.run_min),
    max_s: timeToSeconds(r.run_max),
  }))
  cache.run_km = runRows
  return cache
}

function findBand(rows, gender, age) {
  const g = String(gender||'').toLowerCase()
  return rows.filter(r => String(r.gender||'').toLowerCase() === g && age >= r.age_min && age <= r.age_max)
}

function pointsForReps(rows, reps) {
  if (reps == null || !Number.isFinite(reps)) return 0
  // choose highest score where performance_reps <= reps
  let best = 0
  for (const r of rows) {
    if (reps >= r.performance_reps) best = Math.max(best, r.score)
  }
  return best
}

function pointsForRun(rows, seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return 0
  for (const r of rows) {
    if (seconds >= r.min_s && seconds <= r.max_s) return r.score
  }
  // faster than best range: take max score in cohort
  const max = rows.reduce((m,r)=> Math.max(m, r.score||0), 0)
  if (seconds < Math.min(...rows.map(r=>r.min_s))) return max
  return 0
}

export async function evaluateIppt3({ sex, age }, measures) {
  const { situp, pushup, run_km } = await ensureLoaded()
  const sitRows = findBand(situp, sex, age)
  const pushRows = findBand(pushup, sex, age)
  const runRows = findBand(run_km, sex, age)

  const sitPoints = pointsForReps(sitRows, Number(measures?.situps))
  const pushPoints = pointsForReps(pushRows, Number(measures?.pushups))
  const runPoints = pointsForRun(runRows, Number(measures?.run_seconds))

  const total = sitPoints + pushPoints + runPoints
  const award = awardForTotal(total, String(sex||''))
  return {
    totalPoints: total,
    award,
    stations: {
      situps: { points: sitPoints },
      pushups: { points: pushPoints },
      run: { points: runPoints },
    }
  }
}

export function awardForTotal(total, sex) {
  const s = String(sex||'').toLowerCase()
  if (total >= 85) return 'Gold'
  if (total >= 75) return 'Silver'
  if (s === 'male') return (total >= 51 ? 'Pass' : 'No Award')
  return (total >= 61 ? 'Pass' : 'No Award')
}

export async function cohortRowsIppt3({ sex, age }) {
  const { situp, pushup, run_km } = await ensureLoaded()
  return {
    situps: findBand(situp, sex, age),
    pushups: findBand(pushup, sex, age),
    run: findBand(run_km, sex, age),
  }
}
