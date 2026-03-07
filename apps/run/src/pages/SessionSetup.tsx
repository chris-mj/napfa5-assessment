import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addEvent,
  clearSessionEvents,
  createSession,
  deleteSession,
  listEventsForSession,
  listSessions,
  updateSessionGlobalEnd,
  updateSessionGlobalPaused,
  updateSessionGlobalStart,
  upsertTokenSession
} from '../db/repo';
import { fetchRunEvents, postValidateToken } from '../lib/runApi';
import { reconcileSessionWithCloud, syncEvents } from '../lib/sync';

const TEMPLATE_OPTIONS = ['A', 'B', 'C', 'D', 'E'] as const;

type Enforcement = 'OFF' | 'SOFT' | 'STRICT';

type TemplateKey = (typeof TEMPLATE_OPTIONS)[number];

type TokenResponse = {
  runConfigId: string;
  sessionId: string;
  templateKey: TemplateKey;
  lapsRequired: number;
  enforcement?: Enforcement;
  scanGapMs?: number;
  name?: string;
};

function defaultEnforcement(templateKey: TemplateKey): Enforcement {
  if (templateKey === 'B' || templateKey === 'C') return 'SOFT';
  return 'OFF';
}

function parseTokenValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'napfa5-run:') {
      return url.searchParams.get('token') || '';
    }
  } catch {}
  return trimmed;
}

function parseOptionalInt(value: string): number | undefined {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : undefined;
}

export default function SessionSetup() {
  const navigate = useNavigate();
  const [templateKey, setTemplateKey] = useState<TemplateKey>('A');
  const [sessionName, setSessionName] = useState('');
  const [lapsRequired, setLapsRequired] = useState(3);
  const [enforcement, setEnforcement] = useState<Enforcement>(() => defaultEnforcement('A'));
  const [scanGapMs, setScanGapMs] = useState(10000);
  const [runnerIdFormat, setRunnerIdFormat] = useState<'numeric' | 'classIndex' | 'structured4'>('numeric');
  const [runnerIdMin, setRunnerIdMin] = useState('');
  const [runnerIdMax, setRunnerIdMax] = useState('');
  const [classPrefixes, setClassPrefixes] = useState('');
  const [classIndexMin, setClassIndexMin] = useState('');
  const [classIndexMax, setClassIndexMax] = useState('');
  const [structuredLevelMin, setStructuredLevelMin] = useState('');
  const [structuredLevelMax, setStructuredLevelMax] = useState('');
  const [structuredClassMin, setStructuredClassMin] = useState('');
  const [structuredClassMax, setStructuredClassMax] = useState('');
  const [structuredIndexMin, setStructuredIndexMin] = useState('');
  const [structuredIndexMax, setStructuredIndexMax] = useState('');
  const runnerFormatNote =
    runnerIdFormat === 'classIndex'
      ? 'Accepted format: letter + digits (A04, b10).'
      : runnerIdFormat === 'structured4'
        ? 'Accepted format: 4 digits (LCII), e.g., 1101.'
        : 'Accepted format: digits only.';
  const [sessions, setSessions] = useState<
    { id: string; createdAt: number; templateKey: string; name?: string }[]
  >([]);

  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [tokenLoading, setTokenLoading] = useState(false);
  const [resumeBusyId, setResumeBusyId] = useState('');
  const [resumeError, setResumeError] = useState('');
  const [showTokenDecisionModal, setShowTokenDecisionModal] = useState(false);
  const [pendingTokenSessionId, setPendingTokenSessionId] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionNote, setDecisionNote] = useState('');
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState('');
  const [pendingDeleteSessionName, setPendingDeleteSessionName] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const enforcementOptions = useMemo<Enforcement[]>(() => ['OFF', 'SOFT', 'STRICT'], []);

  const refreshSessions = () => {
    listSessions().then((rows) =>
      setSessions(
        rows
          .map((row) => ({
            id: row.id,
            createdAt: row.createdAt,
            templateKey: row.templateKey,
            name: row.name
          }))
          .slice(0, 5)
      )
    );
  };

  useEffect(() => {
    refreshSessions();
  }, []);

  function handleTemplateChange(value: TemplateKey) {
    setTemplateKey(value);
    setEnforcement(defaultEnforcement(value));
  }

  async function handleCreateSession() {
    if (templateKey !== 'A') return;
    if (!Number.isFinite(lapsRequired) || lapsRequired < 1) return;
    const parsedRunnerMin = parseOptionalInt(runnerIdMin);
    const parsedRunnerMax = parseOptionalInt(runnerIdMax);
    const parsedClassMin = parseOptionalInt(classIndexMin);
    const parsedClassMax = parseOptionalInt(classIndexMax);
    const parsedLevelMin = parseOptionalInt(structuredLevelMin);
    const parsedLevelMax = parseOptionalInt(structuredLevelMax);
    const parsedStructClassMin = parseOptionalInt(structuredClassMin);
    const parsedStructClassMax = parseOptionalInt(structuredClassMax);
    const parsedStructIndexMin = parseOptionalInt(structuredIndexMin);
    const parsedStructIndexMax = parseOptionalInt(structuredIndexMax);
    const parsedPrefixes = String(classPrefixes || '')
      .split(',')
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);

    const sessionId = await createSession(
      templateKey,
      lapsRequired,
      enforcement,
      undefined,
      undefined,
      scanGapMs,
      sessionName.trim() || undefined,
      runnerIdFormat,
      parsedRunnerMin,
      parsedRunnerMax,
      parsedPrefixes,
      parsedClassMin,
      parsedClassMax,
      parsedLevelMin,
      parsedLevelMax,
      parsedStructClassMin,
      parsedStructClassMax,
      parsedStructIndexMin,
      parsedStructIndexMax
    );
    navigate(`/station?sessionId=${encodeURIComponent(sessionId)}`);
  }

  const lapsValid = Number.isFinite(lapsRequired) && lapsRequired >= 1;
  const parsedRunnerMin = parseOptionalInt(runnerIdMin);
  const parsedRunnerMax = parseOptionalInt(runnerIdMax);
  const parsedClassMin = parseOptionalInt(classIndexMin);
  const parsedClassMax = parseOptionalInt(classIndexMax);
  const parsedLevelMin = parseOptionalInt(structuredLevelMin);
  const parsedLevelMax = parseOptionalInt(structuredLevelMax);
  const parsedStructClassMin = parseOptionalInt(structuredClassMin);
  const parsedStructClassMax = parseOptionalInt(structuredClassMax);
  const parsedStructIndexMin = parseOptionalInt(structuredIndexMin);
  const parsedStructIndexMax = parseOptionalInt(structuredIndexMax);

  const runnerRulesError = useMemo(() => {
    if (runnerIdFormat === 'numeric') {
      if (parsedRunnerMin != null && parsedRunnerMax != null && parsedRunnerMin > parsedRunnerMax) {
        return 'Numeric ID range is invalid: Min cannot be greater than Max.';
      }
      return '';
    }
    if (runnerIdFormat === 'classIndex') {
      if (parsedClassMin != null && parsedClassMax != null && parsedClassMin > parsedClassMax) {
        return 'Class index range is invalid: Min cannot be greater than Max.';
      }
      return '';
    }
    if (parsedLevelMin != null && parsedLevelMax != null && parsedLevelMin > parsedLevelMax) {
      return 'Structured Level range is invalid: Min cannot be greater than Max.';
    }
    if (parsedStructClassMin != null && parsedStructClassMax != null && parsedStructClassMin > parsedStructClassMax) {
      return 'Structured Class range is invalid: Min cannot be greater than Max.';
    }
    if (parsedStructIndexMin != null && parsedStructIndexMax != null && parsedStructIndexMin > parsedStructIndexMax) {
      return 'Structured Index range is invalid: Min cannot be greater than Max.';
    }
    return '';
  }, [
    runnerIdFormat,
    parsedRunnerMin,
    parsedRunnerMax,
    parsedClassMin,
    parsedClassMax,
    parsedLevelMin,
    parsedLevelMax,
    parsedStructClassMin,
    parsedStructClassMax,
    parsedStructIndexMin,
    parsedStructIndexMax
  ]);

  const canCreate = templateKey === 'A' && lapsValid && !runnerRulesError;

  const handleTokenValidate = async () => {
    const tokenValue = parseTokenValue(tokenInput);
    if (!tokenValue) {
      setTokenError('Enter or scan a pairing token.');
      return;
    }
    setTokenLoading(true);
    setTokenError('');
    try {
      const { response, body } = await postValidateToken(tokenValue);
      if (!response.ok) {
        throw new Error(body?.error || 'Token validation failed.');
      }
      const data = body as TokenResponse;
      const localId = await upsertTokenSession({
        runConfigId: data.runConfigId,
        remoteSessionId: data.sessionId,
        templateKey: data.templateKey,
        lapsRequired: data.lapsRequired,
        enforcement: data.enforcement,
        scanGapMs: data.scanGapMs,
        pairingToken: tokenValue,
        name: data.name
      });
      setShowTokenModal(false);
      setTokenInput('');
      const existingEvents = await listEventsForSession(localId);
      const hasLocalData = existingEvents.length > 0;
      let hasCloudData = false;
      try {
        const pulled = await fetchRunEvents({ pairingToken: tokenValue });
        hasCloudData = Array.isArray(pulled.events) && pulled.events.length > 0;
      } catch {
        // If cloud pull fails here, continue with local decision only.
      }
      if (hasLocalData || hasCloudData) {
        setPendingTokenSessionId(localId);
        if (hasLocalData && hasCloudData) {
          setDecisionNote('Existing local and cloud data found for this run session config.');
        } else if (hasCloudData) {
          setDecisionNote('Cloud data found for this run session config.');
        } else {
          setDecisionNote('Existing local data found for this run session config.');
        }
        setShowTokenDecisionModal(true);
      } else {
        navigate(`/station?sessionId=${encodeURIComponent(localId)}`);
      }
      refreshSessions();
    } catch (err: any) {
      setTokenError(err.message || 'Token validation failed.');
    } finally {
      setTokenLoading(false);
    }
  };

  const handleResumeSession = async (sessionId: string) => {
    setResumeBusyId(sessionId);
    setResumeError('');
    try {
      const result = await reconcileSessionWithCloud(sessionId);
      if (result.error) {
        setResumeError(`Resume synced with warnings: ${result.error}`);
      }
    } catch (err: any) {
      setResumeError(err?.message || 'Resume sync failed; continuing with local data.');
    } finally {
      setResumeBusyId('');
      navigate(`/station?sessionId=${encodeURIComponent(sessionId)}`);
    }
  };

  const handleRequestDeleteSession = (sessionId: string, sessionName?: string) => {
    setPendingDeleteSessionId(sessionId);
    setPendingDeleteSessionName(sessionName || sessionId);
    setShowDeleteConfirmModal(true);
  };

  const handleConfirmDeleteSession = async () => {
    if (!pendingDeleteSessionId) return;
    setDeleteBusy(true);
    try {
      await deleteSession(pendingDeleteSessionId);
      setShowDeleteConfirmModal(false);
      setPendingDeleteSessionId('');
      setPendingDeleteSessionName('');
      refreshSessions();
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleTokenDecisionLoadAndMerge = async () => {
    if (!pendingTokenSessionId) return;
    setDecisionBusy(true);
    setTokenError('');
    try {
      const result = await reconcileSessionWithCloud(pendingTokenSessionId);
      if (result.error) {
        setTokenError(`Resume synced with warnings: ${result.error}`);
      }
      setShowTokenDecisionModal(false);
      navigate(`/station?sessionId=${encodeURIComponent(pendingTokenSessionId)}`);
    } catch (err: any) {
      setTokenError(err?.message || 'Failed to load and merge session.');
    } finally {
      setDecisionBusy(false);
    }
  };

  const handleTokenDecisionResetAll = async () => {
    if (!pendingTokenSessionId) return;
    setDecisionBusy(true);
    setTokenError('');
    try {
      const nowMs = Date.now();
      await clearSessionEvents(pendingTokenSessionId);
      await updateSessionGlobalStart(pendingTokenSessionId, undefined);
      await updateSessionGlobalPaused(pendingTokenSessionId, false);
      await updateSessionGlobalEnd(pendingTokenSessionId, undefined);
      await addEvent({
        sessionId: pendingTokenSessionId,
        runnerId: 'GLOBAL',
        stationId: 'LAP_END',
        type: 'CLEAR_ALL',
        capturedAtMs: nowMs
      });
      await syncEvents(pendingTokenSessionId);
      await reconcileSessionWithCloud(pendingTokenSessionId);
      setShowTokenDecisionModal(false);
      navigate(`/station?sessionId=${encodeURIComponent(pendingTokenSessionId)}`);
    } catch (err: any) {
      setTokenError(err?.message || 'Failed to reset run data.');
    } finally {
      setDecisionBusy(false);
    }
  };

  return (
    <main>
      <h1>Run Session Setup</h1>
      <p className="note">Create a run session for this capture device.</p>

      <section className="card">
        <div className="grid">
          <div>
            <label>Setup Type</label>
            <div className="template-grid">
              {TEMPLATE_OPTIONS.map((option) => {
                const disabled = option !== 'A';
                return (
                  <button
                    key={option}
                    type="button"
                    className={`template-card ${templateKey === option ? 'selected' : ''} ${
                      disabled ? 'disabled' : ''
                    }`}
                    onClick={() => !disabled && handleTemplateChange(option)}
                    disabled={disabled}
                  >
                    <div className="template-icon">
                      <img src={`/setup${option}.svg`} alt={`Setup ${option}`} />
                    </div>
                    <div className="template-letter">Setup {option}</div>
                    <div className="template-desc">
                      {option === 'A' && 'Single scan (lap start/end)'}
                      {option === 'B' && 'Lap scan + Checkpoint A'}
                      {option === 'C' && 'Lap scan + Checkpoints A & B'}
                      {option === 'D' && 'Start + Lap scan'}
                      {option === 'E' && 'Lap scan + Finish'}
                    </div>
                    {disabled && <div className="template-note">Token required</div>}
                  </button>
                );
              })}
            </div>
            <div className="note">Setup A can start immediately. Setups B-E need a Napfa5 token.</div>
            <button type="button" className="btn-lg" onClick={() => setShowTokenModal(true)}>
              Enter/Scan Napfa5 Token
            </button>
          </div>

          <div className="inline-row">
            <div>
              <label htmlFor="sessionName">Session Name (optional)</label>
              <input
                id="sessionName"
                value={sessionName}
                onChange={(event) => setSessionName(event.target.value)}
                placeholder="e.g., P5 Morning Run"
                className="input-lg"
              />
            </div>
            <div>
              <label htmlFor="lapsRequired">Laps Required</label>
              <input
                id="lapsRequired"
                type="number"
                min={1}
                value={lapsRequired}
                onChange={(event) => setLapsRequired(Number(event.target.value))}
                className="input-lg"
              />
              {!lapsValid && <div className="error">Laps required must be at least 1.</div>}
            </div>
            <div>
              <label htmlFor="enforcement" className="label-row">
                <span>Enforce checkpoint scan (Setup B and C)</span>
              </label>
              <select
                id="enforcement"
                value={enforcement}
                onChange={(event) => setEnforcement(event.target.value as Enforcement)}
                className="input-lg"
                disabled
              >
                {enforcementOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <div className="note">
                OFF: ignore missing checkpoints. SOFT: allow but flag. STRICT: block lap if checkpoints missing.
              </div>
            </div>
          </div>
            <div>
              <label htmlFor="scanGap">Time Between Scans</label>
              <select
                id="scanGap"
                value={scanGapMs}
                onChange={(event) => setScanGapMs(Number(event.target.value))}
                className="input-lg"
              >
                {[5, 10, 15, 20, 25, 30].map((seconds) => (
                  <option key={seconds} value={seconds * 1000}>
                    {seconds} seconds
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="runnerFormat">Runner ID Format</label>
              <select
                id="runnerFormat"
                value={runnerIdFormat}
                onChange={(event) => setRunnerIdFormat(event.target.value as 'numeric' | 'classIndex' | 'structured4')}
                className="input-lg"
              >
                <option value="numeric">Numbers only (e.g., 1023)</option>
                <option value="classIndex">Class + index (e.g., A04, B10)</option>
                <option value="structured4">4-digit code (LCII, e.g., 1101)</option>
              </select>
              <div className="note">{runnerFormatNote}</div>
            </div>
            {runnerIdFormat === 'numeric' && (
              <div className="inline-row">
                <div>
                  <label htmlFor="runnerIdMin">Numeric Min (optional)</label>
                  <input
                    id="runnerIdMin"
                    type="number"
                    min={0}
                    value={runnerIdMin}
                    onChange={(event) => setRunnerIdMin(event.target.value)}
                    className="input-lg"
                    placeholder="e.g., 1"
                  />
                </div>
                <div>
                  <label htmlFor="runnerIdMax">Numeric Max (optional)</label>
                  <input
                    id="runnerIdMax"
                    type="number"
                    min={0}
                    value={runnerIdMax}
                    onChange={(event) => setRunnerIdMax(event.target.value)}
                    className="input-lg"
                    placeholder="e.g., 120"
                  />
                </div>
              </div>
            )}
            {runnerIdFormat === 'classIndex' && (
              <div className="grid">
                <div>
                  <label htmlFor="classPrefixes">Class Prefixes (optional)</label>
                  <input
                    id="classPrefixes"
                    value={classPrefixes}
                    onChange={(event) => setClassPrefixes(event.target.value)}
                    className="input-lg"
                    placeholder="e.g., A,B,C"
                  />
                  <div className="note">Leave blank to allow any A-Z prefix.</div>
                </div>
                <div className="inline-row">
                  <div>
                    <label htmlFor="classIndexMin">Index Min (optional)</label>
                    <input
                      id="classIndexMin"
                      type="number"
                      min={0}
                      value={classIndexMin}
                      onChange={(event) => setClassIndexMin(event.target.value)}
                      className="input-lg"
                      placeholder="e.g., 1"
                    />
                  </div>
                  <div>
                    <label htmlFor="classIndexMax">Index Max (optional)</label>
                    <input
                      id="classIndexMax"
                      type="number"
                      min={0}
                      value={classIndexMax}
                      onChange={(event) => setClassIndexMax(event.target.value)}
                      className="input-lg"
                      placeholder="e.g., 40"
                    />
                  </div>
                </div>
              </div>
            )}
            {runnerIdFormat === 'structured4' && (
              <div className="grid">
                <div className="inline-row">
                  <div>
                    <label htmlFor="structuredLevelMin">Level Min (L)</label>
                    <input
                      id="structuredLevelMin"
                      type="number"
                      min={0}
                      max={9}
                      value={structuredLevelMin}
                      onChange={(event) => setStructuredLevelMin(event.target.value)}
                      className="input-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="structuredLevelMax">Level Max (L)</label>
                    <input
                      id="structuredLevelMax"
                      type="number"
                      min={0}
                      max={9}
                      value={structuredLevelMax}
                      onChange={(event) => setStructuredLevelMax(event.target.value)}
                      className="input-lg"
                    />
                  </div>
                </div>
                <div className="inline-row">
                  <div>
                    <label htmlFor="structuredClassMin">Class Min (C)</label>
                    <input
                      id="structuredClassMin"
                      type="number"
                      min={0}
                      max={9}
                      value={structuredClassMin}
                      onChange={(event) => setStructuredClassMin(event.target.value)}
                      className="input-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="structuredClassMax">Class Max (C)</label>
                    <input
                      id="structuredClassMax"
                      type="number"
                      min={0}
                      max={9}
                      value={structuredClassMax}
                      onChange={(event) => setStructuredClassMax(event.target.value)}
                      className="input-lg"
                    />
                  </div>
                </div>
                <div className="inline-row">
                  <div>
                    <label htmlFor="structuredIndexMin">Index Min (II)</label>
                    <input
                      id="structuredIndexMin"
                      type="number"
                      min={0}
                      max={99}
                      value={structuredIndexMin}
                      onChange={(event) => setStructuredIndexMin(event.target.value)}
                      className="input-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="structuredIndexMax">Index Max (II)</label>
                    <input
                      id="structuredIndexMax"
                      type="number"
                      min={0}
                      max={99}
                      value={structuredIndexMax}
                      onChange={(event) => setStructuredIndexMax(event.target.value)}
                      className="input-lg"
                    />
                  </div>
                </div>
                <div className="note">Example 1101 means Level 1, Class 1, Index 01.</div>
              </div>
            )}
            {!!runnerRulesError && <div className="error">{runnerRulesError}</div>}

          <button onClick={handleCreateSession} disabled={!canCreate} className="btn-lg">
            Create Session (Setup A)
          </button>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="grid">
          <h2>Recent Sessions</h2>
          {sessions.length === 0 && <div className="note">No sessions yet.</div>}
          {!!resumeError && <div className="error">{resumeError}</div>}
          {sessions.map((session) => (
            <div key={session.id} className="session-row">
              <div>
                <div className="session-id">{session.name ? session.name : session.id}</div>
                <div className="note">Template {session.templateKey}</div>
              </div>
              <div className="session-actions">
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => handleResumeSession(session.id)}
                  disabled={resumeBusyId === session.id}
                >
                  {resumeBusyId === session.id ? 'Resuming...' : 'Resume'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => handleRequestDeleteSession(session.id, session.name)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {showTokenModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <div className="text-base font-semibold">Enter Napfa5 Token</div>
              <button type="button" className="btn-link" onClick={() => setShowTokenModal(false)}>
                Close
              </button>
            </div>
            <div className="grid">
              <div>
                <label htmlFor="tokenInput">Pairing Token</label>
                <input
                  id="tokenInput"
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                  className="input-lg"
                  placeholder="Scan QR/barcode or paste token"
                />
              </div>
              {tokenError && <div className="error">{tokenError}</div>}
              <button
                type="button"
                className="btn-lg"
                onClick={handleTokenValidate}
                disabled={tokenLoading}
              >
                {tokenLoading ? 'Validating...' : 'Validate Token'}
              </button>
              <div className="note">
                Tokens come from Napfa5 Session Detail -&gt; Run Setup.
              </div>
            </div>
          </div>
        </div>
      )}
      {showTokenDecisionModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <div className="text-base font-semibold">Existing Run Data Found</div>
              <button type="button" className="btn-link" onClick={() => setShowTokenDecisionModal(false)} disabled={decisionBusy}>
                Close
              </button>
            </div>
            <div className="grid">
              <div className="note">
                {decisionNote || 'Existing data was found for this run session config. Choose how to continue.'}
              </div>
              <button
                type="button"
                className="btn-lg"
                onClick={handleTokenDecisionLoadAndMerge}
                disabled={decisionBusy}
              >
                {decisionBusy ? 'Processing...' : 'Load local and cloud data'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={handleTokenDecisionResetAll}
                disabled={decisionBusy}
              >
                {decisionBusy ? 'Processing...' : 'Reset all'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showDeleteConfirmModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <div className="text-base font-semibold">Delete Local Session</div>
              <button
                type="button"
                className="btn-link"
                onClick={() => setShowDeleteConfirmModal(false)}
                disabled={deleteBusy}
              >
                Close
              </button>
            </div>
            <div className="grid">
              <div className="note">
                Session: {pendingDeleteSessionName}
              </div>
              <div className="note">
                Delete this local session and local events on this device only? Cloud data and other device data are not deleted.
                To delete cloud data, use the main Napfa-5 app Run Session Setup configuration.
                To delete run session data on other devices, delete it locally on each device.
              </div>
              <div className="reset-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowDeleteConfirmModal(false)}
                  disabled={deleteBusy}
                >
                  Cancel
                </button>
                <button type="button" onClick={handleConfirmDeleteSession} disabled={deleteBusy}>
                  {deleteBusy ? 'Deleting...' : 'Delete Local Session'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
