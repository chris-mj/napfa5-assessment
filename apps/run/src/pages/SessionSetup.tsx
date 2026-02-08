import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createSession, deleteSession, listSessions, upsertTokenSession } from '../db/repo';

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

const VALIDATE_ENDPOINT = import.meta.env.DEV
  ? 'http://localhost:3000/api/run/validateToken'
  : 'https://napfa5.sg/api/run/validateToken';

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

export default function SessionSetup() {
  const navigate = useNavigate();
  const [templateKey, setTemplateKey] = useState<TemplateKey>('A');
  const [sessionName, setSessionName] = useState('');
  const [lapsRequired, setLapsRequired] = useState(3);
  const [enforcement, setEnforcement] = useState<Enforcement>(() => defaultEnforcement('A'));
  const [scanGapMs, setScanGapMs] = useState(10000);
  const [runnerIdFormat, setRunnerIdFormat] = useState<'numeric' | 'classIndex'>('numeric');
  const runnerFormatNote =
    runnerIdFormat === 'classIndex'
      ? 'Accepted format: letter + digits (A04, b10).'
      : 'Accepted format: digits only.';
  const [sessions, setSessions] = useState<
    { id: string; createdAt: number; templateKey: string; name?: string }[]
  >([]);

  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState('');
  const [tokenLoading, setTokenLoading] = useState(false);

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
    const sessionId = await createSession(
      templateKey,
      lapsRequired,
      enforcement,
      undefined,
      undefined,
      scanGapMs,
      sessionName.trim() || undefined,
      runnerIdFormat
    );
    navigate(`/station?sessionId=${encodeURIComponent(sessionId)}`);
  }

  const lapsValid = Number.isFinite(lapsRequired) && lapsRequired >= 1;
  const canCreate = templateKey === 'A' && lapsValid;

  const handleTokenValidate = async () => {
    const tokenValue = parseTokenValue(tokenInput);
    if (!tokenValue) {
      setTokenError('Enter or scan a pairing token.');
      return;
    }
    setTokenLoading(true);
    setTokenError('');
    try {
      const response = await fetch(VALIDATE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenValue })
      });
      const body = await response.json().catch(() => null);
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
      navigate(`/station?sessionId=${encodeURIComponent(localId)}`);
      refreshSessions();
    } catch (err: any) {
      setTokenError(err.message || 'Token validation failed.');
    } finally {
      setTokenLoading(false);
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
                onChange={(event) => setRunnerIdFormat(event.target.value as 'numeric' | 'classIndex')}
                className="input-lg"
              >
                <option value="numeric">Numbers only (e.g., 1023)</option>
                <option value="classIndex">Class + index (e.g., A04, B10)</option>
              </select>
              <div className="note">{runnerFormatNote}</div>
            </div>

          <button onClick={handleCreateSession} disabled={!canCreate} className="btn-lg">
            Create Session (Setup A)
          </button>
        </div>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="grid">
          <h2>Recent Sessions</h2>
          {sessions.length === 0 && <div className="note">No sessions yet.</div>}
          {sessions.map((session) => (
            <div key={session.id} className="session-row">
              <div>
                <div className="session-id">{session.name ? session.name : session.id}</div>
                <div className="note">Template {session.templateKey}</div>
              </div>
              <div className="session-actions">
                <Link
                  className="btn-link"
                  to={`/station?sessionId=${encodeURIComponent(session.id)}`}
                >
                  Resume
                </Link>
                <button
                  type="button"
                  className="secondary"
                  onClick={async () => {
                    const ok = window.confirm('Delete this session and all its events?');
                    if (!ok) return;
                    await deleteSession(session.id);
                    refreshSessions();
                  }}
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
    </main>
  );
}
