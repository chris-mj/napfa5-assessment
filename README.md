
# NAPFA5 Assessment — React + Supabase (Vite)

Ready-to-deploy web app for tracking NAPFA test scores in Singapore schools.

## Quick start (local)

1. Copy `.env.example` to `.env` and fill in your Supabase project values.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run dev server:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:5173`.

## Database
Run the SQL in `supabase_schema.sql` in your Supabase project's SQL editor to create `students` and `scores` tables.

## DB performance measurement
Use the benchmark script to measure hot Supabase paths before and after DB changes.

Required environment variables:
- `PERF_SUPABASE_URL`
- `PERF_SUPABASE_ANON_KEY`
- `PERF_ACCESS_TOKEN`
- `PERF_SESSION_ID`
- `PERF_WRITE_STUDENT_ID`
- `PERF_GROUP_STUDENT_IDS` as comma-separated student UUIDs
- `PERF_VIEW_SCORE_IDENTIFIERS` as comma-separated student identifiers

Optional environment variables:
- `PERF_ENABLE_WRITES=true` to benchmark real writes
- `PERF_CONCURRENCY=1`
- `PERF_ADD_ATTEMPT_WRITES=20`
- `PERF_GROUP_SAVE_ROUNDS=10`
- `PERF_CHALLENGE_REFRESHES=10`
- `PERF_VIEW_SCORE_COUNT=3`

Run:
```bash
npm run perf:db
```

The script writes a JSON report into `scripts/perf-results/` so you can compare before/after runs.

PowerShell single-command example:
```powershell
npm run perf:db -- --supabase-url "https://YOUR_PROJECT.supabase.co" --supabase-anon-key "YOUR_ANON_KEY" --access-token "YOUR_ACCESS_TOKEN" --session-id "YOUR_SESSION_UUID" --write-student-id "YOUR_STUDENT_UUID" --group-student-ids "uuid1,uuid2,uuid3" --view-score-identifiers "S001,S002,S003" --enable-writes true --concurrency 1 --add-attempt-writes 20 --group-save-rounds 10 --challenge-refreshes 10 --view-score-count 3
```

## Deploy to Vercel
1. Push this repo to GitHub.
2. In Vercel: Import Project → select GitHub repo.
3. Set Environment Variables in Vercel project settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy — Vercel will build automatically on push.
