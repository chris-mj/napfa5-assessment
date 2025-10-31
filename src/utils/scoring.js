
// Simplified scoring helpers (replace with official tables for production)

export function scoreRun2400(gender, age, minutes) {
  // minutes = run time in minutes (e.g., 10.5)
  // Simplified: lower time = higher points
  const base = gender === 'M' ? 1000 : 900
  const pts = Math.max(0, Math.round(base - (minutes - 8) * 20))
  return pts
}

export function computeTotalScore(student, raw) {
  const run = scoreRun2400(student.gender, calcAge(student.dob), raw.run_2400 || 0)
  const situps = (raw.situps || 0) * 5
  const shuttle = Math.max(0, Math.round(200 - (raw.shuttle_run || 0) * 10))
  const sitreach = Math.max(0, Math.round((raw.sit_and_reach || 0) * 10))
  const pullups = (raw.pullups || 0) * 10
  const broad = Math.max(0, Math.round((raw.broad_jump || 0) * 10))
  return run + situps + shuttle + sitreach + pullups + broad
}

export function calcAge(dob) {
  if(!dob) return 0
  const birth = new Date(dob)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const m = now.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
  return age
}

// Standards-based scoring helper (JSON-backed)
export { evaluateNapfa } from './napfaStandards'
