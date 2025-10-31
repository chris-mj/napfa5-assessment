function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        out.push(cur.trim());
        cur = '';
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur.trim());
  return out;
}

function normalizeGender(val) {
  if (!val) return null;
  const v = String(val).trim().toLowerCase();
  if (["m", "male", "boy"].includes(v)) return "M";
  if (["f", "female", "girl"].includes(v)) return "F";
  return null;
}

function parseDob(d) {
  if (!d) return null;
  const s = String(d).trim();
  const parts = s.split(/[\/\-\.]/).filter(Boolean);
  if (parts.length < 3) return null;
  let [dd, mm, yyyy] = parts;
  if (yyyy && yyyy.length === 2) yyyy = (Number(yyyy) > 50 ? '19' : '20') + yyyy;
  const day = String(parseInt(dd, 10)).padStart(2, '0');
  const mon = String(parseInt(mm, 10)).padStart(2, '0');
  const yr = String(parseInt(yyyy, 10)).padStart(4, '0');
  const iso = `${yr}-${mon}-${day}`;
  if (isNaN(Date.parse(iso))) return null;
  return iso;
}

function parseFloatOrNull(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9\.-]/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(v) {
  if (v == null) return null;
  const s = String(v).replace(/[^0-9\-]/g, '').trim();
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function parseMmssToSeconds(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  if (/^[0-9]{3,4}$/.test(s)) {
    const mm = parseInt(s.slice(0, s.length - 2), 10);
    const ss = parseInt(s.slice(-2), 10);
    if (Number.isFinite(mm) && Number.isFinite(ss)) return mm * 60 + ss;
    return null;
  }
  const m = s.match(/^(\d{1,2})[:\- ]?(\d{2})$/);
  if (m) {
    const mm = parseInt(m[1], 10);
    const ss = parseInt(m[2], 10);
    if (Number.isFinite(mm) && Number.isFinite(ss)) return mm * 60 + ss;
  }
  return null;
}

export function parseNapfaCsv(csvText, options = {}) {
  const { academicYear, schoolId } = options;
  const lines = String(csvText).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const errors = [];
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const lineJoin = cols.join(' ').toLowerCase();
    if (cols.length >= 8 && lineJoin.includes('name') && lineJoin.includes('id') && lineJoin.includes('gender')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) headerIdx = 20; // default per spec

  const dataStart = headerIdx + 1;
  const rows = [];
  for (let i = dataStart; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    const cols = splitCsvLine(raw);
    if (cols.every(c => !c || !String(c).trim())) continue;
    const excelRow = i + 1; // 1-based display

    const serial = cols[0] ?? '';
    const name = cols[1] ?? '';
    const id = normalizeStudentId(cols[2] ?? '');
    const klass = cols[3] ?? '';
    const gender = normalizeGender(cols[4] ?? '');
    const dob = parseDob(cols[5] ?? '');
    // cols[6] attendance ignored
    const situps = parseIntOrNull(cols[7]);
    const broadJumpCm = parseFloatOrNull(cols[8]);
    const sitAndReachCm = parseFloatOrNull(cols[9]);
    const pullups = parseIntOrNull(cols[10]);
    const shuttleRunSec = parseFloatOrNull(cols[11]);
    // cols[12] 1.6/2.4 Km Run MMSS (ignored per spec)
    // cols[13] PFT Test Date (ignored)

    if (!id || !String(id).trim()) {
      errors.push({ row: excelRow, message: 'Missing ID (unique identifier).' });
      continue;
    }

    rows.push({
      excelRow,
      serial,
      name: name?.trim() || null,
      id,
      class: klass?.trim() || null,
      gender,
      dob,
      situps,
      broad_jump_cm: broadJumpCm,
      sit_and_reach_cm: sitAndReachCm,
      pullups,
      shuttle_run_sec: shuttleRunSec,
      school_id: schoolId || null,
      academic_year: academicYear || null,
    });
  }

  const studentsUpserts = rows.map(r => ({
    student_identifier: r.id,
    name: r.name,
    gender: r.gender,
    dob: r.dob,
  }));

  const enrollmentsUpserts = rows.map(r => ({
    student_identifier: r.id,
    school_id: r.school_id,
    class: r.class,
    academic_year: r.academic_year,
    is_active: true,
  }));

  const scores = rows.map(r => ({
    student_identifier: r.id,
    situps: r.situps,
    broad_jump: r.broad_jump_cm,
    sit_and_reach: r.sit_and_reach_cm,
    pullups: r.pullups,
    shuttle_run: r.shuttle_run_sec,
  }));

  const summary = {
    totalLines: lines.length,
    headerIndex: headerIdx,
    parsed: rows.length,
    errors: errors.length,
  };

  return { rows, studentsUpserts, enrollmentsUpserts, scores, errors, summary };
}

export default parseNapfaCsv;
import { normalizeStudentId } from './ids'
