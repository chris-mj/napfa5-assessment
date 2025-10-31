// One-off generator to convert public/napfa_standards_full.csv to src/data/napfa_standards.json
// Usage: node scripts/generate-standards-json.js
const fs = require('fs');
const path = require('path');

function parseTimeToSeconds(t) {
  if (!t) return null;
  const s = String(t).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else { cur += ch; }
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') { inQuotes = true; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

(function main() {
  const repoRoot = process.cwd();
  const srcCsv = path.join(repoRoot, 'public', 'napfa_standards_full.csv');
  const outJson = path.join(repoRoot, 'src', 'data', 'napfa_standards.json');

  if (!fs.existsSync(srcCsv)) {
    console.error('CSV not found at', srcCsv);
    process.exit(1);
  }

  const raw = fs.readFileSync(srcCsv, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n').filter(Boolean);
  const header = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map(l => splitCsvLine(l));

  const h = Object.fromEntries(header.map((k, i) => [k, i]));

  const records = rows.map(cols => {
    const level = cols[h.level];
    const sex = cols[h.sex];
    const age_group = cols[h.age_group];
    const performance_band = cols[h.performance_band] || null;
    const performance_grade = cols[h.performance_grade] || null;
    const points = toNum(cols[h.points]);
    const situps_min = toNum(cols[h.situps_min]);
    const situps_max = toNum(cols[h.situps_max]);
    const sbj_min_cm = toNum(cols[h.sbj_min_cm]);
    const sbj_max_cm = toNum(cols[h.sbj_max_cm]);
    const sitreach_min_cm = toNum(cols[h.sitreach_min_cm]);
    const sitreach_max_cm = toNum(cols[h.sitreach_max_cm]);
    const pullups_min = toNum(cols[h.pullups_min]);
    const pullups_max = toNum(cols[h.pullups_max]);
    const shuttle_min_s = toNum(cols[h.shuttle_min_s]);
    const shuttle_max_s = toNum(cols[h.shuttle_max_s]);
    const run_km = toNum(cols[h.run_km]);
    const run_min = parseTimeToSeconds(cols[h.run_min]);
    const run_max = parseTimeToSeconds(cols[h.run_max]);

    return {
      level,
      sex,
      age_group,
      band: performance_band,
      grade: performance_grade,
      points,
      stations: {
        situps: { min: situps_min, max: situps_max },
        broad_jump_cm: { min: sbj_min_cm, max: sbj_max_cm },
        sit_and_reach_cm: { min: sitreach_min_cm, max: sitreach_max_cm },
        pullups: { min: pullups_min, max: pullups_max },
        shuttle_s: { min: shuttle_min_s, max: shuttle_max_s },
        run: { km: run_km, min_s: run_min, max_s: run_max },
      },
    };
  });

  const outDir = path.dirname(outJson);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(records, null, 2) + '\n', 'utf8');
  console.log('Wrote', outJson, 'with', records.length, 'rows');
})();

