import http from 'k6/http';
import { check, sleep } from 'k6';

// Required environment variables
const SUPABASE_URL = __ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = __ENV.SUPABASE_ANON_KEY;
const TEST_EMAIL = __ENV.TEST_EMAIL;
const TEST_PASSWORD = __ENV.TEST_PASSWORD;

// Optional overrides
const OVERRIDE_SCHOOL_ID = __ENV.SCHOOL_ID || 'cea8ab24-182f-4018-a966-3ac6fb33bd79';
const OVERRIDE_SESSION_ID = __ENV.SESSION_ID || 'ee786b56-20fc-4b16-8b99-640c4b51a29e';

// Tunables
const PAGE_SIZE = Number(__ENV.PAGE_SIZE || 100);
const CHUNK = Number(__ENV.CHUNK || 20);

export let options = {
  scenarios: {
    write_scores: { executor: 'constant-vus', exec: 'upsertScores', vus: 5, duration: '1m' },
    read_scores:  { executor: 'constant-vus', exec: 'viewScores',  vus: 5, duration: '1m', startTime: '10s' },
  },
  thresholds: {
    http_req_duration: ['p(95)<400'],
    http_req_failed:   ['rate<0.01'],
  },
};

function rest(path, params) {
  return `${SUPABASE_URL}/rest/v1/${path}${params || ''}`;
}

function login() {
  const url = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
  const res = http.post(url, JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }), {
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
  });
  check(res, { 'login 200': (r) => r.status === 200 });
  return res.json() && res.json().access_token;
}

export function setup() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD) {
    throw new Error('Missing env vars: SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD');
  }
  const token = login();
  const baseHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Discover context
  let schoolId = OVERRIDE_SCHOOL_ID;
  if (!schoolId) {
    const m = http.get(rest('memberships', '?select=school_id,role&limit=1'), { headers: baseHeaders });
    check(m, { 'memberships 200': (r) => r.status === 200 });
    const arr = m.json();
    if (Array.isArray(arr) && arr.length) schoolId = arr[0].school_id;
  }

  let sessionId = OVERRIDE_SESSION_ID;
  if (!sessionId && schoolId) {
    const s = http.get(rest('sessions', `?select=id,title,status,session_date&school_id=eq.${schoolId}&order=session_date.desc&limit=5`), { headers: baseHeaders });
    check(s, { 'sessions 200': (r) => r.status === 200 });
    const rows = s.json() || [];
    const active = rows.find((x) => String(x.status || '').toLowerCase() === 'active');
    sessionId = active ? active.id : (rows[0] && rows[0].id) || '';
  }

  let studentIds = [];
  if (sessionId) {
    const r = http.get(rest('session_roster', `?select=student_id&session_id=eq.${sessionId}&limit=2000`), { headers: baseHeaders });
    if (r.status === 200 && Array.isArray(r.json())) {
      studentIds = r.json().map((x) => x.student_id);
    }
  }
  if (!studentIds.length) {
    const st = http.get(rest('students', '?select=id&limit=200'), { headers: baseHeaders });
    if (st.status === 200 && Array.isArray(st.json())) {
      studentIds = st.json().map((x) => x.id);
    }
  }

  return { token, sessionId, studentIds };
}

function rndInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function rndDec(a, b) { return Number((Math.random() * (b - a) + a).toFixed(1)); }

export function upsertScores(data) {
  const { token, sessionId, studentIds } = data;
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal, resolution=merge-duplicates',
  };
  if (!sessionId || studentIds.length === 0) { sleep(1); return; }

  // Build a chunk with UNIQUE (session_id, student_id) pairs to avoid
  // "ON CONFLICT DO UPDATE command cannot affect row a second time".
  const rows = [];
  const picked = new Set();
  const target = Math.min(CHUNK, studentIds.length);
  while (picked.size < target) {
    const sid = studentIds[rndInt(0, studentIds.length - 1)];
    if (picked.has(sid)) continue;
    picked.add(sid);
    rows.push({
      session_id: sessionId,
      student_id: sid,
      situps: rndInt(0, 50),
      broad_jump: rndInt(120, 250),
      sit_and_reach: rndInt(10, 60),
      pullups: rndInt(0, 40),
      shuttle_run: rndDec(9.0, 16.0),
    });
  }
  const res = http.post(
    rest('scores', '?on_conflict=session_id,student_id'),
    JSON.stringify(rows),
    { headers }
  );
  check(res, { 'upsert 201/204': (r) => r.status === 201 || r.status === 204 });
  // Small jitter to reduce lock contention / timeouts under high concurrency
  sleep(0.2 + Math.random() * 0.5);
}

export function viewScores(data) {
  const { token, sessionId } = data;
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
  if (!sessionId) { sleep(1); return; }

  const page = rndInt(0, 10);
  const offset = page * PAGE_SIZE;
  const q = `?select=student_id,situps,broad_jump,sit_and_reach,pullups,shuttle_run&session_id=eq.${sessionId}&order=student_id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
  const res = http.get(rest('scores', q), { headers });
  check(res, { 'view 200': (r) => r.status === 200 });
  sleep(0.5);
}
