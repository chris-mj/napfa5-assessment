# WORKLOG (Main App)

Last updated: 2026-04-20
Scope: Main app workings only (`src/...`), not run app (`apps/run/...`).

## Current branch state
- Current local branch: `wip/current-work`
- Current `wip/current-work` HEAD and remote are aligned at: `76fc4f2`
- Local `main` is at: `14c6a58`
- `origin/main` is at: `cba4585`
- Working tree is not clean:
  - modified: `WORKLOG.md`
  - modified: `src/App.jsx`
  - modified: `src/components/Navbar.jsx`
  - modified: `src/pages/Charts.jsx`
  - modified: `src/pages/SessionDetail.jsx`
  - modified: `src/pages/SummaryData.jsx`
  - modified: `supabase_schema.sql`
  - untracked: `src/pages/LiveCharts.jsx`
  - untracked: `src/pages/SnapshotAnalytics.jsx`
  - untracked artifact: `build-debug.log`
  - untracked artifact folder: `scripts/perf-results/`

## Main app changes completed in this chat
- Committed and pushed up to current `wip/current-work` head:
  - `f102953`: made `ModifyUser` table/pagination more usable on narrow screens.
  - `dba197c`: added PFT import, award-calculator report/export changes, and related guide/what's-new updates.
  - `269ed9a`: moved Challenge Hub class/house leaderboards to the top.
  - `98b94ce`: tightened score-entry unsaved-change guards and hardened PFT import/preview behavior.
  - `76fc4f2`: refined `AddAttempt` saved-score autofill and iPad-friendly layout.
- `src/pages/AddAttempt.jsx`
  - auto-fills the active station input from previously saved scores,
  - resets/prefills correctly when switching station or student,
  - added in-app unsaved-change confirmation dialogs instead of just banner warnings,
  - compacted the layout for tablet use,
  - moved `Points Table` / `Previous saved scores` / `Student Info` into a denser responsive arrangement,
  - made `Record Attempt` span full width,
  - removed card subtitles and kept `Student list` on one line.
- `src/pages/ScoreEntryGroup.jsx`
  - added unsaved-change confirmation dialog before switching group/session/station/scan flows.
- `src/pages/ViewScore.jsx`
  - compacted the page for desktop and landscape tablets,
  - moved award content into a right-side compact panel on larger screens,
  - defaulted grade ladder to off,
  - added a darker current/next award separator.
- `src/pages/SessionDetail.jsx`
  - progress bar status is now derived from roster + loaded score map instead of a separate count query,
  - added and later removed temporary debug output for in-progress students,
  - added PFT import UI improvements including clearer preview language, explicit refresh-preview support, and import-rule layout changes,
  - updated profile-card A4 export variant with larger QR code for the 4-cards-per-page write-score format.
- Live analytics and snapshot analytics work is in the current working tree and not yet committed:
  - `src/pages/LiveCharts.jsx`:
    - new live analytics page,
    - school-scoped filters only,
    - year/session/station/gender/age filters,
    - min/max age range filters,
    - split-by-gender / split-by-age controls,
    - completed-only vs include-incomplete control,
    - table view plus box-and-whisker visual mode,
    - station-grouped box plots with per-station axis scale and inline labels,
    - `Create Summary Data` action and latest generated timestamp.
  - `src/pages/Charts.jsx` / `src/pages/SnapshotAnalytics.jsx` / `src/pages/SummaryData.jsx` / `src/components/Navbar.jsx` / `src/App.jsx`:
    - split live `Charts` from owner-only `Snapshot Analytics`,
    - added `Snapshot Analytics` under Insights,
    - redirected legacy `SummaryData` entry to the snapshot page,
    - snapshot view surfaces `delete_preserve` data separately from `live_snapshot`.
  - `supabase_schema.sql`:
    - added analytics snapshot tables and batch table,
    - added snapshot RPCs for session summary, session station, and school-year station data,
    - added delete-preserve RPCs and hooked student delete flows to preserve completed-only analytics before deletion.

## Key commits (main app relevant)
- `f102953`: Make `ModifyUser` table responsive on narrow screens.
- `dba197c`: Add PFT import, award-calculator report/export, and guide updates.
- `269ed9a`: Move Challenge Hub leaderboards to top.
- `98b94ce`: Tighten score entry flows and harden PFT import.
- `76fc4f2`: Refine `AddAttempt` autofill and layout.
- `cba4585`: Matching `main` branch commit for the `AddAttempt` refinements.

## Branch note
- Local `main` is ahead of `origin/main`; current local `main` SHA is `14c6a58` while `origin/main` is `cba4585`.
- `wip/current-work` is cleanly pushed through `76fc4f2`; current live/snapshot analytics work is still only in the working tree.

## Pending checks / next steps
- Validation completed in this chat:
  - production build passed locally on 2026-04-20 via `npm run build`,
  - route split is wired as intended:
    - `/charts` -> live analytics page,
    - `/snapshot-analytics` -> owner-only snapshot analytics page,
    - `/summary-data` -> redirect to snapshot analytics.
- Commit and push the current analytics-page work if accepted:
  - `src/pages/LiveCharts.jsx`
  - `src/pages/Charts.jsx`
  - `src/pages/SnapshotAnalytics.jsx`
  - `src/pages/SummaryData.jsx`
  - `src/components/Navbar.jsx`
  - `src/App.jsx`
  - `supabase_schema.sql`
- Validate live `Charts` page with real data:
  - table mode vs box-and-whisker mode,
  - session filter,
  - completed-only toggle,
  - split-by-gender / split-by-age combinations,
  - station-group scale/axis readability on tablet.
- Validate `Snapshot Analytics` against the new Supabase SQL objects already applied in the database.
- Confirm delete-preserve rows appear in snapshot analytics after deleting a student with completed records.
- Recheck whether the current `src/pages/SessionDetail.jsx` modification should ship with this analytics batch or stay separate; its present diff is the A4 score-sheet QR/layout refinement, not snapshot analytics.
- Keep `scripts/perf-results/` and `build-debug.log` out of commits unless explicitly needed.
