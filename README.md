
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

## Deploy to Vercel
1. Push this repo to GitHub.
2. In Vercel: Import Project → select GitHub repo.
3. Set Environment Variables in Vercel project settings:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy — Vercel will build automatically on push.
