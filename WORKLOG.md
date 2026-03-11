# WORKLOG (Main App)

Last updated: 2026-03-11
Scope: Main app workings only (`src/...`), not run app (`apps/run/...`).

## Current branch state
- Current local branch: `wip/current-work`
- `main` and `origin/main` are aligned at: `6cbbaa6`
- `wip/current-work` and `origin/wip/current-work` are aligned at: `0f64946`
- Note: commit IDs differ between branches for equivalent cherry-picked changes.

## Main app changes completed in this chat
- SessionDetail and score workflows were iterated across multiple requests (group tab visuals, station/session warnings, score entry UX consistency, table mass edit flow and confirmation dialogs).
- Scanner/debug cycle:
  - Added temporary scanner diagnostics for iPad camera switching.
  - Then removed scanner debug panels and telemetry from main app pages.
- Camera behavior now updated for scanner modals in:
  - `src/pages/AddAttempt.jsx`
  - `src/pages/ScoreEntryGroup.jsx`
  - `src/pages/ViewScore.jsx`
- Camera logic now:
  - Defaults to back camera on mobile-like devices.
  - Remembers last used camera mode/device in local storage per page modal.
  - Keeps switch-camera logic and fallback scanning path.

## Key commits (main app relevant)
- `f40abd1` (main lineage): Remove scanner debug panels from score entry and view score.
- `0f64946` (`wip/current-work`): Default mobile scanner to back camera and remember last camera.
- `6cbbaa6` (`main`): Cherry-pick equivalent of `0f64946`.

## Branch note
- `178acdd` exists on `wip/current-work` only, but it is an older debug commit and is functionally superseded by later commits already in `main` and by debug removal.

## Pending checks / next steps
- Validate scanner on iPad Chrome for:
  - default opening camera (back on mobile),
  - switch camera behavior,
  - successful scan path in all three pages.
- If stable, keep this as baseline and avoid re-adding debug UI unless needed.

