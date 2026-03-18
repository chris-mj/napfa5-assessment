# WORKLOG (Main App)

Last updated: 2026-03-18
Scope: Main app workings only (`src/...`), not run app (`apps/run/...`).

## Current branch state
- Current local branch: `wip/current-work`
- `main` and `origin/main` are aligned at: `6cbbaa6`
- `wip/current-work` and `origin/wip/current-work` are aligned at: `0c9b405`
- Current `wip/current-work` HEAD (`0c9b405`) is a run-app/worklog sync commit; latest committed scanner-page change in `src/...` remains `0f64946`.
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
- Current uncommitted follow-up in working tree:
  - `AddAttempt`, `ScoreEntryGroup`, and `ViewScore` scanner modals now try saved/selected `deviceId` before loose `facingMode` requests, so iPad/Chrome-style switch-camera flows are more likely to reopen the intended camera instead of falling back to the same lens.
  - Added QR-login flow for low-privilege users:
    - `ModifyUser` now issues reusable QR-login credentials for `score_taker` and `viewer` memberships.
    - `score_taker` reusable QR login requires a 6-digit PIN; `viewer` does not.
    - `score_taker` PINs are now stored as salted `scrypt` hashes, with legacy SHA-256 verification kept only as a compatibility fallback for any earlier local test rows.
    - `Login` now scans reusable QR tokens, prompts for PIN only when required, and redeems them into a fresh sign-in link.
    - `api/generateQrLogin.js` now creates or rotates reusable QR-login credentials on the membership.
    - `api/redeemQrLogin.js` validates the reusable QR token and PIN, then mints a fresh sign-in link for that login attempt.
    - Admin actions now separate `Reset QR` from `Change PIN`: resetting rotates the reusable token, while changing the PIN keeps the current QR code valid.
    - `Login` QR scanner now follows the same camera preference behavior as the other scanner modals: mobile defaults to back camera, saved device/mode are reused, and reopen/restart is driven by camera-mode switches rather than `preferredDeviceId` updates.

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
- Confirm the new `deviceId`-first fallback resolves same-camera reopening when tapping `Switch Camera`.
- Smoke-test QR login end to end:
  - generate reusable QR from `Manage Users` for a `score_taker` account,
  - confirm first issue prompts for PIN,
  - scan it on `Login`, enter PIN, and confirm repeated scans still work,
  - generate reusable QR for a `viewer` account and confirm repeated scans work without PIN,
  - use `Reset QR` and confirm the old QR stops working,
  - use `Change PIN` for `score_taker` and confirm the old PIN stops working,
  - confirm `admin`/`superadmin`/other ineligible roles do not get the QR action.
- If available, rerun a full main-app build outside Codex timeout/sandbox limits; `npm run build` was attempted on 2026-03-18 but did not complete within the CLI time window here.
- If stable, keep this as baseline and avoid re-adding debug UI unless needed.
