# WORKLOG (Main App)

Last updated: 2026-04-29
Scope: Main app workings only (`src/...`), not run app (`apps/run/...`).

## Current branch state
- Current local branch: `wip/current-work`
- Current `wip/current-work` HEAD and remote are aligned at: `e106303`
- Latest commit: `e106303 Update analytics and responsive workflows`
- Working tree is clean for tracked files.
- Remaining local untracked artifacts, intentionally not committed:
  - `build-debug.log`
  - `scripts/perf-results/`

## Main app changes completed
- Analytics split:
  - added `src/pages/LiveCharts.jsx` for live analytics,
  - moved snapshot/history analytics to owner-only `src/pages/SnapshotAnalytics.jsx`,
  - kept `Charts` as the snapshot analytics entry point,
  - redirected legacy `SummaryData` to snapshot analytics,
  - added snapshot routes and navbar entries,
  - updated `supabase_schema.sql` with snapshot tables, batch tracking, snapshot RPCs, and delete-preserve RPC support.
- Live analytics:
  - school-scoped filters,
  - session/year/station/gender/age filters,
  - completed-only toggle,
  - split-by-gender and split-by-age views,
  - table mode,
  - box-and-whisker mode with station-specific scales,
  - `Create Summary Data` action.
- Snapshot analytics:
  - separates `live_snapshot` rows from `delete_preserve` rows,
  - exposes owner-only snapshot review separately from live charts.
- Student deletion flow:
  - preserves completed analytics before operational records are deleted.
- Navbar and navigation:
  - simplified desktop navbar,
  - moved `Challenge Hub` under `Assess`,
  - grouped Assess dropdown into `Plan`, `Assess`, and `Evaluate`,
  - made dropdown section headers visually distinct from clickable rows,
  - aligned mobile menu sequence with desktop,
  - added mobile collapse behavior,
  - kept iPad portrait on desktop-style navbar.
- Table polish:
  - added shared scroll/table styling with sticky headers, lighter row separators, zebra/hover states, tabular numbers, and larger table font sizes,
  - applied to data-heavy pages including session detail, roster/select flows, score views, analytics, admin/global/audit/student/user pages, gamification, run ops, and related summary tables.
- Score-entry ergonomics:
  - tightened `AddAttempt` for tablet use,
  - made the active scoring input more prominent,
  - added fixed bottom `Record Attempt` behavior on smaller screens,
  - compacted the points table and supporting panels,
  - removed station step count/title chrome,
  - kept the flow denser for iPad portrait.
- PFT import and award completeness:
  - overwrite import now transfers all PFT file station values, including blanks,
  - keep-better-score handling still replaces empty existing scores,
  - NAPFA completion is now based on whether each station has a recorded score, even if award/points are missing.
- Session grouping workflow:
  - renamed group card title to `Manage Groups`,
  - moved print/download actions into the manage card right side under auto-assign,
  - added upload note that group upload uses the same CSV format as download,
  - moved upload success/status messages beside the relevant action,
  - applied the same workflow layout pattern to the houses tab.
- Public home:
  - cleaned mojibake/encoding artifacts with ASCII-safe punctuation.

## Key commits
- `e106303`: Update analytics and responsive workflows.
- `76fc4f2`: Refine `AddAttempt` autofill and layout.
- `98b94ce`: Tighten score entry flows and harden PFT import.
- `269ed9a`: Move Challenge Hub leaderboards to top.
- `dba197c`: Add PFT import, award-calculator report/export, and guide updates.
- `f102953`: Make `ModifyUser` table responsive on narrow screens.

## Pending checks / next steps
- Validate live `Charts` page with real data:
  - table mode vs box-and-whisker mode,
  - session filter,
  - completed-only toggle,
  - split-by-gender / split-by-age combinations,
  - station-group scale/axis readability on tablet.
- Validate `Snapshot Analytics` against the new Supabase SQL objects.
- Confirm delete-preserve rows appear in snapshot analytics after deleting a student with completed records.
- User visual checks still recommended:
  - iPad portrait and landscape navbar behavior,
  - mobile collapsed navbar behavior,
  - `AddAttempt` one-page iPad scoring layout,
  - `SessionDetail` roster table readability,
  - `SessionDetail` groups/houses workflow layout,
  - `ViewScore` landscape card fit.
- Keep `scripts/perf-results/` and `build-debug.log` out of commits unless explicitly needed.
