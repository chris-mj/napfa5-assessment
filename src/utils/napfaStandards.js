import standards from '../data/napfa_standards.json'

export function parseMmssToSeconds(val) {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function secondsToMmss(sec) {
  if (sec == null || !Number.isFinite(sec)) return null;
  const mm = Math.floor(sec / 60);
  const ss = Math.round(sec % 60);
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export function normalizeSex(s) {
  if (!s) return null;
  const v = String(s).toLowerCase();
  if (['m', 'male', 'boy'].includes(v)) return 'Male';
  if (['f', 'female', 'girl'].includes(v)) return 'Female';
  return null;
}

export function getAgeGroup(age) {
  if (age == null || !Number.isFinite(age)) return null;
  const a = Math.floor(age);
  if (a >= 20 && a <= 24) return '20-24';
  return String(a);
}

export function findRows(level, sex, ageGroup) {
  return standards.filter(r =>
    (!level || r.level === level) &&
    (!sex || r.sex === sex) &&
    (!ageGroup || r.age_group === ageGroup)
  );
}

function inRangeHigherBetter(value, min, max) {
  if (value == null) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

function inRangeLowerBetter(value, min, max) {
  if (value == null) return false;
  if (min == null && max == null) return false;
  if (max == null) return value <= min; // Outstanding case: <= threshold
  if (min == null) return value <= max; // Fallback
  return value >= min && value <= max; // Defined band
}

export function evaluateNapfa({ level, sex, age, run_km }, measures) {
  const normSex = normalizeSex(sex);
  const ageGroup = getAgeGroup(age);
  const rows = findRows(level, normSex, ageGroup);
  const result = { stations: {}, totalPoints: 0 };

  function selectRowFor(stationKey, value, isLowerBetter, extra = {}) {
    for (const r of rows) {
      // For run, match distance if provided in either context or table
      if (stationKey === 'run') {
        const km = extra.run_km ?? run_km;
        const rowKm = r.stations.run.km;
        if (rowKm != null && km != null && rowKm !== km) continue;
        const ok = inRangeLowerBetter(value, r.stations.run.min_s, r.stations.run.max_s);
        if (ok) return r;
      } else if (stationKey === 'shuttle_s') {
        const ok = inRangeLowerBetter(value, r.stations.shuttle_s.min, r.stations.shuttle_s.max);
        if (ok) return r;
      } else {
        const band = r.stations[stationKey];
        if (!band) continue;
        const ok = isLowerBetter
          ? inRangeLowerBetter(value, band.min, band.max)
          : inRangeHigherBetter(value, band.min, band.max);
        if (ok) return r;
      }
    }
    return null;
  }

  const stations = [
    { key: 'situps', label: 'Sit-ups', value: measures?.situps, lower: false },
    { key: 'broad_jump_cm', label: 'Standing Broad Jump (cm)', value: measures?.broad_jump_cm, lower: false },
    { key: 'sit_and_reach_cm', label: 'Sit & Reach (cm)', value: measures?.sit_and_reach_cm, lower: false },
    { key: 'pullups', label: 'Pull-ups', value: measures?.pullups, lower: false },
    { key: 'shuttle_s', label: 'Shuttle Run 4x10m (s)', value: measures?.shuttle_s, lower: true },
  ];

  for (const st of stations) {
    if (st.value == null) continue;
    const row = selectRowFor(st.key, st.value, st.lower);
    if (row) {
      result.stations[st.key] = { grade: row.grade, points: row.points, band: row.band };
      result.totalPoints += row.points || 0;
    } else {
      result.stations[st.key] = { grade: null, points: 0, band: null };
    }
  }

  // Run (1.6km or 2.4km)
  let runSec = measures?.run_seconds;
  if (runSec == null && measures?.run_mmss) runSec = parseMmssToSeconds(measures.run_mmss);
  if (runSec != null) {
    const row = selectRowFor('run', runSec, true, { run_km });
    if (row) {
      result.stations.run = { grade: row.grade, points: row.points, band: row.band, km: row.stations.run.km ?? run_km };
      result.totalPoints += row.points || 0;
    } else {
      result.stations.run = { grade: null, points: 0, band: null, km: run_km ?? null };
    }
  }

  result.meta = { level, sex: normSex, ageGroup };
  return result;
}

