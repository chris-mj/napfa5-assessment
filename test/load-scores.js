 import http from 'k6/http';
     import { check, sleep } from 'k6';
     import { randomSeed } from 'k6';
     randomSeed(12345);

  const SUPABASE_URL = 'https://bhavglmnglzelaatofrl.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoYXZnbG1uZ2x6ZWxhYXRvZnJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA4NjMwMTUsImV4cCI6MjA3NjQzOTAxNX0.uM8gh2RimSa6WHXWfUkwOuoag2bgyNtvnWQgemFQWV8';
  const TEST_EMAIL = 'tsa@moe.edu.sg';
  const TEST_PASSWORD = 'test1234';

// OPTIONAL overrides (otherwise autodiscovered in setup)
  const OVERRIDE_SCHOOL_ID = __ENV.SCHOOL_ID || '';
  const OVERRIDE_SESSION_ID = __ENV.SESSION_ID || '';
  const OVERRIDE_STUDENT_ID = __ENV.STUDENT_ID || '';

  // Tuning knobs (optional)
  const CHUNK = Number(__ENV.CHUNK || 20);              // rows per upsert batch
  const PAGE_SIZE = Number(__ENV.PAGE_SIZE || 100);     // rows per read page

  export const options = {
  scenarios: {
  write_scores: {
  executor: 'ramping-vus',
  exec: 'upsertScores',
  stages: [
  { duration: '20s', target: 5 },
  { duration: '1m', target: 10 },
  { duration: '20s', target: 0 },
  ],
  },
  read_scores: {
  executor: 'ramping-vus',
  exec: 'viewScores',
  startTime: '10s',
  stages: [
  { duration: '20s', target: 5 },
  { duration: '1m', target: 10 },
  { duration: '20s', target: 0 },
  ],
  },
  },
  thresholds: {
  http_req_duration: ['p(95)<400'],
  http_req_failed: ['rate<0.01'],
  },
  };

  function rest(path, params = '') {
  return ${SUPABASE_URL}/rest/v1/${path}${params};
  }

  function login() {
  const res = http.post(
  ${SUPABASE_URL}/auth/v1/token?grant_type=password,
  JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
  { headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY } }
  );
  check(res, { 'login 200': (r) => r.status === 200 });
  return res.json()?.access_token;
  }

  export function setup() {
  // sanity
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD) {
  throw new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY, TEST_EMAIL, TEST_PASSWORD as env vars');
  }
  const token = login();
  const baseHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: Bearer ${token},
  'Content-Type': 'application/json',
  };

  // Discover school/session/students if not provided
  let schoolId = OVERRIDE_SCHOOL_ID;
  if (!schoolId) {
  const m = http.get(
  rest('memberships', ?select=school_id,role&limit=1),
  { headers: baseHeaders }
  );
  check(m, { 'memberships 200': (r) => r.status === 200 });
  const arr = m.json();
  if (Array.isArray(arr) && arr.length) schoolId = arr[0].school_id;
  }

  let sessionId = OVERRIDE_SESSION_ID;
  if (!sessionId && schoolId) {
  // Prefer an ACTIVE session to satisfy RLS on insert/update
  const s = http.get(
  rest('sessions', ?select=id,title,status,session_date&school_id=eq.${schoolId}&order=session_date.desc&limit=5),
  { headers: baseHeaders }
  );
  check(s, { 'sessions 200': (r) => r.status === 200 });
  const rows = s.json() || [];
  const active = rows.find((x) => String(x.status || '').toLowerCase() === 'active');
  sessionId = active ? active.id : (rows[0]?.id || '');
  }

  // Build a pool of students from the session roster (fallback: generic students)
  let studentIds = [];
  if (sessionId) {
  const r = http.get(
  rest('session_roster', ?select=student_id&session_id=eq.${sessionId}&limit=2000),
  { headers: baseHeaders }
  );
  if (r.status === 200 && Array.isArray(r.json())) {
  studentIds = r.json().map((x) => x.student_id);
  }
  }
  if (!studentIds.length) {
  const st = http.get(
  rest('students', ?select=id&limit=500),
  { headers: baseHeaders }
  );
  if (st.status === 200 && Array.isArray(st.json())) {
  studentIds = st.json().map((x) => x.id);
  }
  }

  return { token, schoolId, sessionId, studentIds };
  }

  function rndInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function rndDec(min, max, dp = 1) {
  const n = Math.random() * (max - min) + min;
  return Number(n.toFixed(dp));
  }

  export function upsertScores(data) {
  const { token, sessionId, studentIds } = data;
  const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: Bearer ${token},
  'Content-Type': 'application/json',
  // upsert and minimal response
  Prefer: 'return=minimal, resolution=merge-duplicates',
  };

  if (!sessionId || studentIds.length === 0) {
  // nothing to do; avoid failing the run
  sleep(1);
  return;
  }

  // Build a chunk of random rows
  const rows = [];
  for (let i = 0; i < CHUNK; i++) {
  const sid = studentIds[rndInt(0, studentIds.length - 1)];
  rows.push({
  session_id: sessionId,
  student_id: sid,
  situps: rndInt(0, 50),
  broad_jump: rndInt(120, 250),
  sit_and_reach: rndInt(10, 60),
  pullups: rndInt(0, 40),
  shuttle_run: rndDec(9.0, 16.0, 1),
  });
  }

  const res = http.post(rest('scores'), JSON.stringify(rows), { headers });
  check(res, {
  'upsert 201/204': (r) => r.status === 201 || r.status === 204,
  });
  // small pause to be nice to DB
  sleep(0.5);
  }

  export function viewScores(data) {
  const { token, sessionId } = data;
  const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: Bearer ${token},
  };

  if (!sessionId) {
  sleep(1);
  return;
  }

  const page = rndInt(0, 20);
  const offset = page * PAGE_SIZE;
  const q = ?select=student_id,situps,broad_jump,sit_and_reach,pullups,shuttle_run&session_id=eq.${sessionId}&order=student_id.asc&limit=${PAGE_SIZE}&offset=${offset};
  const res = http.get(rest('scores', q), { headers });

  check(res, { 'view 200': (r) => r.status === 200 });
  sleep(0.5);
  }