# WORKLOGRUN.md

## Purpose
Handover log for the RUN app + SessionDetail RUN workflow work covered in this chat thread. This is intended for a fresh Codex session to continue quickly.

## Current Repo Pointer
- Repository: `D:\Java codes\napfa5-assessment`
- Active branch now: `wip/current-work`
- Current HEAD at time of writing: `0f64946` (`origin/wip/current-work`)

## Working Tree Snapshot (Uncommitted)
Modified:
- `api/run/ingestEvents.js`
- `apps/run/src/db/repo.ts`
- `apps/run/src/lib/runApi.ts`
- `apps/run/src/pages/Capture.tsx`
- `apps/run/src/pages/StationSelect.tsx`
- `apps/run/src/styles.css`
- `src/pages/SessionDetail.jsx`
- `src/pages/UserGuide.jsx`
- `supabase_schema.sql`

Untracked:
- `WORKLOG.md`
- `api/run/stationPresence.js`
- `tmp_fix_run_setup.ps1`
- `tmp_fix_run_setup2.ps1`

## High-Level Changes Done in This Chat (Consolidated)

### 1) RUN API routing/sync stability and CORS/dev-prod behavior
- Reworked RUN API usage to avoid brittle direct-origin assumptions.
- Reduced repeated failures from non-JSON HTML responses on `/api/run/events` by aligning endpoints and handling fallback/status paths.
- Continued handling for local dev (`localhost:5174`) and production (`vercel`) usage patterns.

### 2) Dependency/build compatibility
- Addressed Vite + `vite-plugin-pwa` incompatibilities in branch history (see commit pointers below), resolving Vercel install failures caused by peer conflicts.

### 3) Capture page redesign + operations UX
- Capture page significantly redesigned:
  - sticky top status strip
  - action card + recent scans/runner summary layout refinements
  - stronger status semantics (connected/stale/attention)
  - custom end confirmation dialog
  - simplified technical details display
- Run controls and warnings were iterated many times based on operational workflow.

### 4) Run state control flow (Start/Pause/End)
- Implemented stricter run-state gating:
  - Start enables recording
  - Pause required before End
  - Resume support after Pause
  - End confirmation dialog
- Synced state across stations via control events.

### 5) Multi-device same-station protection
- Server-side cross-device dedupe in `api/run/ingestEvents.js` for PASS scans using:
  - `run_config_id + station_id + runner_id`
  - dedupe window from `scan_gap_ms` (clamped)
- Duplicate scans are accepted (not failed) to prevent resend loops and operator confusion.

### 6) Station presence + scanner count warning
- Added station presence heartbeat endpoint: `api/run/stationPresence.js`.
- Capture now sends periodic presence heartbeat and displays active scanner count.
- Warning shown when `N >= 2`:
  - `>1 scanner on same station; dedupe active`

### 7) Time sync (clock consistency support)
- Added server-time check path and UI states for time sync quality.
- Tooltip/hint language updated for operators.
- "Stale" connection threshold changed to 60s (requested).

### 8) Run config + local override policy
- Shifted runner ID format and accepted tag ranges to be controlled in RUN app local overrides (not persisted back into main run config as source of truth).
- Added constraints to only allow config/id-rule changes at control-capable stations and when run data conditions allow.
- Ensured local override behavior does not get silently wiped by regular pull logic (iterative fixes).

### 9) Tag mapping + score import workflow in SessionDetail
- Built/iterated dialog-based workflow:
  - Tag Mapping dialog (manual + auto modes)
  - Lock mapping permanently
  - Import run timings dialog (preview + apply policy behavior)
- Labels and copy were revised repeatedly per user requests.

### 10) Data lifecycle warnings and deletion semantics
- Updated warning text for local reset vs cloud deletion.
- Added custom dialogs for destructive actions.
- Added/updated "delete cloud run data" behavior from SessionDetail Run Setup area.
- Included optional CLEAR_ALL propagation behavior discussion/implementation path for local stations.

### 11) User Guide StepWise2 updates
- Added StepWise2 card guidance and expanded details.
- Most recent update in this chat:
  - StepWise2 dialog now split into two tabs:
    - `Quick Start`
    - `Full System Specs`
  - Implemented in `src/pages/UserGuide.jsx`.

## Key Files to Review First (Fresh Codex)
- Capture/runtime behavior:
  - `apps/run/src/pages/Capture.tsx`
  - `apps/run/src/lib/runApi.ts`
  - `apps/run/src/db/repo.ts`
  - `api/run/ingestEvents.js`
  - `api/run/stationPresence.js`
- Main app integration:
  - `src/pages/SessionDetail.jsx`
  - `src/pages/UserGuide.jsx`
- Schema:
  - `supabase_schema.sql`

## Branch / Commit Pointers (Recent, useful)
- `0f64946` Default mobile scanner to back camera and remember last camera
- `9a435ea` Run app sync/status UX updates and SessionDetail enforcement notes
- `144cf0e` Merge main into wip/current-work
- `f4422e7` Refine run/session data lifecycle UX and deletion flows
- `e426fe4` Improve run station sync overrides and capture controls
- `4675cba` run capture: refine status bar, controls, and end confirmation UX
- `5f6ada0` Add run ops dashboard and robust run config controls
- `849f798` Fix unsynced event query and push status indicator
- `2d04dac` Force run token validation through API backend
- `c6d32a2` Update vite-plugin-pwa dependency locks for Vite 6 compatibility
- `1912045` Stabilize run app API flow and fix dev/prod routing
- `a5c629a` Restore Score Entry (Group) route and Assess navbar links

## Supabase / SQL Notes
- This chat introduced/used changes around:
  - `run_station_presence`
  - run tag mapping / lock / apply metadata fields
  - run distance and run-config metadata
  - event types including `RUNCFG_SET` / `RUNIDCFG_SET` support behavior
- Ensure `supabase_schema.sql` reflects final intended schema and does not contain accidental duplicate blocks unless intentionally idempotent.
- User specifically requested fixed/permanent schema to live in `supabase_schema.sql`.

## Operational Behavior Confirmed
- Cross-device dedupe works for same station within dedupe window.
- Presence heartbeat:
  - pulse interval from client: ~10s
  - active device window: ~30s
- Connection stale threshold set to 60s in UI logic.

## Known Risk/Attention Points
1. Large uncommitted working tree: verify no accidental regressions before next commit.
2. Untracked temp scripts should probably be excluded from commits unless intentionally needed:
   - `tmp_fix_run_setup.ps1`
   - `tmp_fix_run_setup2.ps1`
3. Ensure `node_modules` is not accidentally staged/committed.
4. Re-run end-to-end for local + vercel API routing to ensure no fallback to HTML responses for JSON endpoints.
5. Validate run-state race behavior (start signal bouncing) under slow sync.

## Suggested Next Checks (Smoke Checklist)
1. Pair token on fresh browser profile; choose station; verify first entry works for LAP_START/END path.
2. Capture scans on 2 devices at same station within scan-gap window; confirm only one effective pass (dedupe).
3. Confirm scanner warning appears when active scanners >= 2.
4. Verify Start/Pause/End state propagation across stations.
5. Verify reset local data messaging and behavior (local-only).
6. Verify delete cloud run data action in SessionDetail and warning dialog text.
7. Tag Mapping dialog:
   - auto modes
   - manual override
   - lock mapping
8. Import timings preview/apply in SessionDetail and validate target score column updates.
9. Export CSV formats from RUN app and main app match expected structure.
10. Open User Guide -> StepWise2 -> verify `Quick Start` and `Full System Specs` tabs render correctly.

## Where to Continue Next
- If focusing on operator UX: continue in `apps/run/src/pages/Capture.tsx`.
- If focusing on data integrity/import: continue in `src/pages/SessionDetail.jsx` + API handlers.
- If focusing on deployment reliability: validate Vercel build + endpoint behavior with current lockfile and schema.

## Known Good Test Scenario (Script + Click Path)
Goal: Validate end-to-end run capture with token link, sync, dedupe, and import workflow.

Preconditions:
- Main app and RUN app are reachable.
- At least one session exists in main app.
- Supabase schema updates already applied.
- Two devices/browsers available for multi-scanner test.

Script:
1. Main app: `Sessions -> open target session -> Run Setup`.
2. Create a new Run Session Config:
   - Config Name: `KG-Run-ClassA`
   - Setup Type: `B` (Lap Start/End + Checkpoint A)
   - Laps Required: `4`
   - Checkpoint Enforcement: `SOFT`
   - Time Between Scans: `10000 ms`
3. Generate token.
4. Device A (RUN app):
   - Open RUN app home.
   - Select setup type matching run config flow.
   - Enter/scan token.
   - Choose `LAP_END` station.
   - If resume prompt appears, select `Load local and cloud data` for continuity, else continue.
5. Device B (RUN app):
   - Repeat step 4 and also choose `LAP_END`.
6. Device A capture page:
   - Confirm status strip shows scanner count.
   - Confirm warning appears at `N >= 2`:
     - `>1 scanner on same station; dedupe active`
7. Start run controls:
   - Click `Start`.
   - Verify state changes and remains stable (no permanent bounce-back).
8. Multi-device dedupe check:
   - On both devices, scan same tag ID within 3-5 seconds.
   - Expected: only one effective pass in cloud for that dedupe window (same run config + station + tag).
9. Pause/Resume/End controls:
   - Click `Pause` on control station.
   - Verify `Start (Resume)` is enabled.
   - Click `Start (Resume)`.
   - Click `Pause` again, then `End`, confirm custom dialog.
10. Main app data flow:
   - Return to `Session Detail -> Run Setup`.
   - Open Tag Mapping dialog.
   - Apply AutoTag or manual mapping.
   - Save mapping.
   - Lock tag mapping.
   - Open Import Run Timings dialog.
   - Preview and apply to scores.
11. Verify scores:
   - Open session scores view/roster and confirm run timings populated.
12. Cleanup behavior check:
   - RUN app capture `Reset Session Data` and confirm warning states local-only behavior.
   - Validate cloud data still present unless deleted from main app.

Known-good pass criteria:
- Pairing/token link succeeds.
- Capture accepts scans only in correct run state.
- Multi-device same-station dedupe prevents duplicate PASS effect.
- Scanner warning appears when more than one scanner active.
- Tag mapping and import to scores complete without errors.

## Test Cases and Scenarios (Latest Functions)

### A. Multi-device dedupe (server-side)
TC-A1: Same tag, same station, two devices, within scan gap
- Steps:
  1. Set scan gap to 15s.
  2. Device A and B scan `1101` at `LAP_END` within 5s.
- Expected:
  - One effective pass counted for that window.
  - No hard failure shown to operators.

TC-A2: Same tag, same station, outside scan gap
- Steps:
  1. Scan `1101` on A.
  2. Wait >15s.
  3. Scan `1101` on B.
- Expected:
  - Second scan is accepted as new pass.

TC-A3: Same tag, different stations
- Steps:
  1. Scan `1101` at `START`.
  2. Scan `1101` at `LAP_END` within 5s.
- Expected:
  - Both station-specific events can be accepted (dedupe key includes station).

### B. Station presence and scanner warning
TC-B1: Warning threshold
- Steps:
  1. One device active at station.
  2. Observe `Scanners: 1`.
  3. Bring second device active at same station.
- Expected:
  - `Scanners: 2`.
  - Warning line visible: `>1 scanner on same station; dedupe active`.

TC-B2: Presence timeout decay
- Steps:
  1. Keep 2 devices active.
  2. Close one device tab and wait >30s.
- Expected:
  - Scanner count drops by one.
  - Warning disappears when back to `<2`.

### C. Run control state logic (Start/Pause/End)
TC-C1: Start gating
- Steps:
  1. Before start, attempt scan.
  2. Click Start.
  3. Scan again.
- Expected:
  - Pre-start behavior follows designed gating.
  - Post-start scans accepted.

TC-C2: Pause and resume
- Steps:
  1. Click Pause.
  2. Verify `Start (Resume)` enabled.
  3. Click `Start (Resume)`.
- Expected:
  - Run returns to running state.

TC-C3: End protection
- Steps:
  1. Try End while not paused.
  2. Pause then click End.
  3. Use custom confirmation dialog.
- Expected:
  - End is blocked until paused.
  - Confirmation required.

### D. Sync and status indicators
TC-D1: Stale threshold
- Steps:
  1. Let station idle with no sync activity.
  2. Wait >60s.
- Expected:
  - Connection state becomes `Stale`.

TC-D2: Needs attention
- Steps:
  1. Break token validity or API availability.
- Expected:
  - Connection shows `Needs attention`.
  - Tooltip advises not for official use until resolved.

### E. Time sync status
TC-E1: Time sync success
- Steps:
  1. Ensure API `/api/run/time` reachable.
  2. Trigger time sync check.
- Expected:
  - Status shows synced/ok.
  - Tooltip shows ping/offset info.

TC-E2: Time sync failure
- Steps:
  1. Block `/api/run/time` endpoint.
  2. Trigger check.
- Expected:
  - Status shows error with actionable tooltip.

### F. Tag mapping + import workflow
TC-F1: AutoTag and save
- Steps:
  1. Open Tag Mapping dialog for config.
  2. Use AutoTag mode.
  3. Save.
- Expected:
  - Mappings persist and re-open correctly.

TC-F2: Lock mapping
- Steps:
  1. Click `Lock Tag Mapping Permanently`.
  2. Re-open dialog and attempt edits.
- Expected:
  - Edits blocked after lock.

TC-F3: Import timings
- Steps:
  1. Open Import Run Timings.
  2. Preview.
  3. Apply.
- Expected:
  - Target session score field updated for mapped students.

### G. User Guide StepWise2 tabs
TC-G1: Tab render and content split
- Steps:
  1. Open `User Guide & FAQ`.
  2. Open `StepWise2 -> How to`.
  3. Switch between `Quick Start` and `Full System Specs`.
- Expected:
  - Correct tab content shown.
  - Modal is wider and scrollable for StepWise2 only.

### H. Reset/Delete messaging correctness
TC-H1: RUN app reset warning
- Steps:
  1. Click `Reset Session Data` on capture.
- Expected:
  - Warning states local-only clear and cloud data unaffected.

TC-H2: Main app cloud delete warning
- Steps:
  1. In SessionDetail Run Setup, trigger cloud run data deletion.
- Expected:
  - Warning clearly explains cloud deletion impact and download advice where implemented.

## Compact Tester Checklist (Pass/Fail)
Use: `[ ]` = not done, `[PASS]` = passed, `[FAIL]` = failed.

Environment:
- [ ] Open main app and RUN app
- [ ] Prepare 2 devices/browsers for same-station test
- [ ] Ensure test session + run config token is available

Token + Station:
- [ ] Enter token in RUN app -> link succeeds
- [ ] Select station -> capture page opens on first try

Run Controls:
- [ ] Start changes run state to running
- [ ] Pause enables Start (Resume)
- [ ] End only enabled after Pause
- [ ] End uses custom confirmation dialog

Sync + Status:
- [ ] Last received/last sent update during active sync
- [ ] Pending upload increases/decreases correctly
- [ ] Idle >60s shows `Stale`
- [ ] Broken token/API shows `Needs attention`

Time Sync:
- [ ] Time sync check can complete and show synced/ok
- [ ] Time sync error state appears when endpoint unavailable
- [ ] Tooltip explains status clearly

Multi-scanner Presence + Dedupe:
- [ ] One device active shows `Scanners: 1`
- [ ] Two devices active same station shows `Scanners: 2`
- [ ] Warning appears: `>1 scanner on same station; dedupe active`
- [ ] Close one device >30s -> scanner count drops
- [ ] Same tag scanned on 2 devices within scan-gap -> one effective pass
- [ ] Same tag scanned outside scan-gap -> second pass accepted

Tag Mapping:
- [ ] Open Tag Mapping dialog for run config
- [ ] AutoTag works and values populate
- [ ] Manual override can be edited before lock
- [ ] Save mappings persists on reopen
- [ ] Lock Tag Mapping permanently blocks further edits

Import Timings:
- [ ] Import Run Timings dialog opens
- [ ] Preview generates rows
- [ ] Apply updates run score field for mapped students

Reset/Delete Messaging:
- [ ] RUN app reset warning states local-only clear
- [ ] Main app cloud delete warning states cloud impact clearly

User Guide:
- [ ] User Guide -> StepWise2 -> How to opens
- [ ] `Quick Start` tab content visible
- [ ] `Full System Specs` tab content visible
- [ ] StepWise2 modal is wider + scrollable

Final Sign-off:
- [ ] No blocking console errors during core flow
- [ ] Data visible in DB for run events as expected
- [ ] Import results visible in session scores as expected

