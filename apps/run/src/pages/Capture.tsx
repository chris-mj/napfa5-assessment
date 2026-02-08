import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { applyEvent, createInitialRunnerState, getTemplateConfig, type RunEvent, Flag } from '@napfa5/run-core';
import {
  addEvent,
  clearSessionEvents,
  exportCsv,
  getSession,
  listEventsForSession,
  upsertRemoteEvents,
  updateSessionGlobalStart
} from '../db/repo';
import type { EventRow, SessionRow } from '../db/db';
import { syncEvents } from '../lib/sync';

const GLOBAL_START_TEMPLATES = new Set(['A', 'B', 'C', 'D', 'E']);
const VALIDATE_ENDPOINT = import.meta.env.DEV
  ? 'http://localhost:3000/api/run/validateToken'
  : 'https://napfa5.sg/api/run/validateToken';
const EVENTS_ENDPOINT = import.meta.env.DEV
  ? 'http://localhost:3000/api/run/events'
  : 'https://napfa5.sg/api/run/events';
const SYNC_INTERVAL_MS = 5000;

type Enforcement = 'OFF' | 'SOFT' | 'STRICT';

type RunnerSummary = {
  runnerId: string;
  lapCount: number;
  finished: boolean;
  flags: Flag[];
  finishedAtMs?: number;
  lastSeenAtMs?: number;
};

function stationStorageKey(sessionId: string) {
  return `napfa5-run:station:${sessionId}`;
}

function stationLabel(templateKey: string | undefined, stationId: string) {
  if (stationId === 'LAP_END') {
    return 'Lap Start / End Scan';
  }
  if (templateKey === 'B' && stationId === 'A') return 'Checkpoint A Scan';
  if (templateKey === 'C' && stationId === 'A') return 'Checkpoint A Scan';
  if (templateKey === 'C' && stationId === 'B') return 'Checkpoint B Scan';
  return stationId;
}

function mapDbEventToRunEvent(event: EventRow): RunEvent {
  const type = event.type === 'PASS' ? 'SCAN' : event.type;
  return {
    id: event.id,
    capturedAtMs: event.capturedAtMs,
    type: type as RunEvent['type'],
    stationId: event.stationId as RunEvent['stationId'],
    targetId: event.refEventId
  };
}

function applyEnforcementFlags(
  config: ReturnType<typeof getTemplateConfig>,
  enforcement?: Enforcement
) {
  if (!enforcement) return config;
  const next = { ...config, flags: [...config.flags] };
  const softIndex = next.flags.indexOf(Flag.SOFT_ENFORCEMENT);
  const strictIndex = next.flags.indexOf(Flag.STRICT_ENFORCEMENT);

  if (enforcement === 'OFF') {
    if (softIndex >= 0) next.flags.splice(softIndex, 1);
    if (strictIndex >= 0) next.flags.splice(strictIndex, 1);
    return next;
  }

  if (enforcement === 'SOFT') {
    if (strictIndex >= 0) next.flags.splice(strictIndex, 1);
    if (softIndex < 0) next.flags.push(Flag.SOFT_ENFORCEMENT);
    return next;
  }

  if (softIndex >= 0) next.flags.splice(softIndex, 1);
  if (strictIndex < 0) next.flags.push(Flag.STRICT_ENFORCEMENT);
  return next;
}

function sortSummaries(items: RunnerSummary[]) {
  return [...items].sort((a, b) => {
    return a.runnerId.localeCompare(b.runnerId, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export default function CaptureScreen() {
  const [params] = useSearchParams();
  const sessionId = params.get('sessionId') ?? '';
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [runnerId, setRunnerId] = useState('');
  const [recentEvents, setRecentEvents] = useState<EventRow[]>([]);
  const [runnerSummaries, setRunnerSummaries] = useState<RunnerSummary[]>([]);
  const [toast, setToast] = useState('');
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [tokenError, setTokenError] = useState('');
  const [lastPullAtMs, setLastPullAtMs] = useState<number | null>(null);
  const [lastPushAtMs, setLastPushAtMs] = useState<number | null>(null);
  const [projectorOpen, setProjectorOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(true);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastClearAllRef = useRef<number>(0);
  const remoteSinceRef = useRef<number>(0);
  const syncInFlightRef = useRef(false);
  const projectorRef = useRef<Window | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const filterUndoneEvents = (events: EventRow[]) => {
    const undone = new Set(
      events
        .filter((event) => event.type === 'UNDO' && event.refEventId)
        .map((event) => event.refEventId as string)
    );
    return events.filter((event) => !undone.has(event.id) && event.type !== 'UNDO');
  };

  const stationId = useMemo(() => {
    if (!sessionId) return '';
    return localStorage.getItem(stationStorageKey(sessionId)) ?? '';
  }, [sessionId]);

  const templateConfig = useMemo(() => {
    if (!session) return null;
    const config = getTemplateConfig(session.templateKey as any, session.lapsRequired);
    const withEnforcement = applyEnforcementFlags(config, session.enforcement as Enforcement | undefined);
    if (session.scanGapMs) {
      const gapByStation = { ...withEnforcement.minScanGapMsByStation };
      Object.keys(gapByStation).forEach((key) => {
        if (key !== 'FINISH') gapByStation[key as any] = session.scanGapMs;
      });
      return { ...withEnforcement, minScanGapMsByStation: gapByStation };
    }
    return withEnforcement;
  }, [session]);

  const runnerFormat = session?.runnerIdFormat ?? 'numeric';
  const normalizeRunnerId = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (runnerFormat === 'numeric') {
      if (!/^\d+$/.test(trimmed)) return '';
      const normalized = trimmed.replace(/^0+/, '');
      return normalized === '' ? '0' : normalized;
    }
    if (/^[a-zA-Z][0-9]+$/.test(trimmed)) {
      const letter = trimmed[0].toUpperCase();
      const digits = trimmed.slice(1);
      return `${letter}${digits}`;
    }
    return '';
  };

  const showGlobalStart = session && GLOBAL_START_TEMPLATES.has(session.templateKey);
  const hasStartStation = session && ['D'].includes(session.templateKey);


  const buildSummaries = (events: EventRow[]) => {
    if (!templateConfig) return [];
    const clearAllEvents = events
      .filter((event) => event.type === 'CLEAR_ALL')
      .sort((a, b) => a.capturedAtMs - b.capturedAtMs);
    if (clearAllEvents.length) {
      const latest = clearAllEvents[clearAllEvents.length - 1].capturedAtMs;
      if (latest > lastClearAllRef.current) {
        lastClearAllRef.current = latest;
      }
    }

    const byRunner = new Map<string, EventRow[]>();
    for (const event of filterUndoneEvents(events)) {
      if (!event.runnerId) continue;
      if (!byRunner.has(event.runnerId)) byRunner.set(event.runnerId, []);
      byRunner.get(event.runnerId)!.push(event);
    }

    const summaries: RunnerSummary[] = [];
    for (const [key, items] of byRunner.entries()) {
      const combined = [...clearAllEvents, ...items].sort((a, b) => a.capturedAtMs - b.capturedAtMs);
      let state = createInitialRunnerState();
      for (const entry of combined) {
        state = applyEvent(state, mapDbEventToRunEvent(entry), templateConfig);
      }
      const lastSeenAtMs = combined.length ? combined[combined.length - 1].capturedAtMs : undefined;
      summaries.push({
        runnerId: key,
        lapCount: state.lapCount,
        finished: Boolean(state.finishedAtMs),
        flags: state.flags,
        finishedAtMs: state.finishedAtMs,
        lastSeenAtMs
      });
    }

    return sortSummaries(summaries);
  };

  const buildLocalRecent = (events: EventRow[]) => {
    if (!stationId) return [];
    return filterUndoneEvents(
      [...events].filter((event) => event.stationId === stationId && event.source !== 'remote')
    )
      .sort((a, b) => b.capturedAtMs - a.capturedAtMs)
      .slice(0, 20);
  };

  const hydrateFromEvents = (events: EventRow[]) => {
    setRecentEvents(buildLocalRecent(events));
    setRunnerSummaries(buildSummaries(events));
  };

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then((value) => setSession(value));
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !session?.pairingToken || !session?.remoteSessionId) return;
    let active = true;
    const verify = async () => {
      const existing = await listEventsForSession(sessionId);
      if (!active || existing.length > 0) return;
      setTokenStatus('checking');
      setTokenError('');
      try {
        const response = await fetch(VALIDATE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: session.pairingToken })
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || 'Token validation failed.');
        }
        if (active) setTokenStatus('valid');
      } catch (err: any) {
        if (!active) return;
        setTokenStatus('invalid');
        setTokenError(err.message || 'Token validation failed.');
      }
    };
    verify();
    return () => {
      active = false;
    };
  }, [sessionId, session?.pairingToken, session?.remoteSessionId]);

  useEffect(() => {
    if (!sessionId || !session?.pairingToken || !session?.remoteSessionId) return;
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const url = new URL(EVENTS_ENDPOINT);
        if (remoteSinceRef.current) {
          url.searchParams.set('since', String(remoteSinceRef.current));
        }
        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${session.pairingToken}` }
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error || 'Failed to fetch events.');
        }
        const events = Array.isArray(body?.events) ? body.events : [];
        if (events.length) {
          let latestClearAll = 0;
          for (const event of events) {
            if (event.type === 'CLEAR_ALL' && event.capturedAtMs) {
              latestClearAll = Math.max(latestClearAll, event.capturedAtMs);
            }
            if (event.capturedAtMs && event.capturedAtMs > remoteSinceRef.current) {
              remoteSinceRef.current = event.capturedAtMs;
            }
          }

          if (latestClearAll > lastClearAllRef.current) {
            lastClearAllRef.current = latestClearAll;
            await clearSessionEvents(sessionId);
          }

          const relevant = latestClearAll
            ? events.filter((event) => (event.capturedAtMs || 0) >= latestClearAll)
            : events;

          const mapped = relevant.map((event: any) => ({
            id: event.id,
            runnerId: event.runnerId || '',
            stationId: event.stationId || '',
            type: event.type || 'PASS',
            capturedAtMs: event.capturedAtMs || Date.now(),
            refEventId: event.refEventId || undefined,
            syncedAtMs: Date.now()
          }));

          await upsertRemoteEvents(sessionId, mapped);
          await refreshEvents();
        }
        if (active) setLastPullAtMs(Date.now());
      } catch {
        // Silent: capture screen should continue offline.
      }
    };
    poll();
    const timer = setInterval(poll, SYNC_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [sessionId, session?.pairingToken, session?.remoteSessionId]);

  useEffect(() => {
    if (!sessionId || !session?.pairingToken || !session?.remoteSessionId) return;
    let active = true;
    const tick = async () => {
      if (!active || syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      try {
        const result = await syncEvents(sessionId);
        if (!result.error && result.synced >= 0) {
          setLastPushAtMs(Date.now());
        }
      } finally {
        syncInFlightRef.current = false;
      }
    };
    tick();
    const timer = setInterval(tick, SYNC_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [sessionId, session?.pairingToken, session?.remoteSessionId]);

  useEffect(() => {
    if (sessionId && !stationId) {
      navigate(`/station?sessionId=${encodeURIComponent(sessionId)}`);
    }
  }, [sessionId, stationId, navigate]);

  useEffect(() => {
    if (!sessionId) return;
    listEventsForSession(sessionId).then((events) => {
      hydrateFromEvents(events);
    });
  }, [sessionId, templateConfig, stationId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    channelRef.current = new BroadcastChannel('napfa5-run');
    return () => {
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!projectorOpen) return;
    const timer = window.setInterval(() => {
      if (projectorRef.current && projectorRef.current.closed) {
        projectorRef.current = null;
        setProjectorOpen(false);
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [projectorOpen]);

  function handleProjectorToggle() {
    if (!sessionId) return;
    if (projectorRef.current && !projectorRef.current.closed) {
      projectorRef.current.close();
      projectorRef.current = null;
      setProjectorOpen(false);
      return;
    }
    const url = `/station-progress?sessionId=${encodeURIComponent(sessionId)}&stationId=${encodeURIComponent(
      stationId || ''
    )}`;
    const screenLeft = window.screenX ?? window.screenLeft ?? 0;
    const screenTop = window.screenY ?? window.screenTop ?? 0;
    const availWidth = window.screen.availWidth || window.innerWidth;
    const availHeight = window.screen.availHeight || window.innerHeight;
    const width = Math.floor(availWidth * 0.66);
    const height = Math.floor(availHeight);
    const left = Math.floor(screenLeft + (availWidth - width));
    const top = Math.floor(screenTop);
    const features = `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
    projectorRef.current = window.open(url, 'napfa5-run-progress', features);
    setProjectorOpen(true);
  }

  async function refreshEvents() {
    if (!sessionId) return;
    const all = await listEventsForSession(sessionId);
    hydrateFromEvents(all);
    channelRef.current?.postMessage({ type: 'events-updated', sessionId });
  }

  async function handleClearRunnerById(targetId: string) {
    if (!targetId || !sessionId || !stationId) return;
    await addEvent({
      sessionId,
      runnerId: targetId,
      stationId,
      type: 'CLEAR',
      capturedAtMs: Date.now()
    });
    await refreshEvents();
  }

  async function handleUndoRunnerById(targetId: string) {
    if (!targetId || !sessionId || !stationId) return;
    const all = await listEventsForSession(sessionId);
    const localEvents = all.filter(
      (event) =>
        event.source !== 'remote' &&
        event.stationId === stationId &&
        event.runnerId === targetId &&
        event.type === 'PASS'
    );
    const usable = filterUndoneEvents(localEvents);
    const last = usable.sort((a, b) => b.capturedAtMs - a.capturedAtMs)[0];
    if (!last) {
      setToast(`No local scans to undo: ${targetId}`);
      setTimeout(() => setToast(''), 1500);
      return;
    }
    await addEvent({
      sessionId,
      runnerId: targetId,
      stationId: last.stationId,
      type: 'UNDO',
      capturedAtMs: Date.now(),
      refEventId: last.id
    });
    setToast(`Undo: ${targetId}`);
    setTimeout(() => setToast(''), 1500);
    await refreshEvents();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionId || !stationId || !runnerId) return;
    if (!templateConfig) return;
    if (tokenStatus === 'invalid') return;
    const trimmed = runnerId.trim();
    if (trimmed.startsWith('-c')) {
      const target = trimmed.slice(2).trim();
      const normalizedTarget = normalizeRunnerId(target);
      setRunnerId('');
      setOverridePending(false);
      inputRef.current?.focus();
      if (!normalizedTarget) {
        const msg =
          runnerFormat === 'classIndex'
            ? 'Invalid ID. Use A04, B10 format.'
            : 'Invalid ID. Numbers only.';
        setToast(msg);
        setTimeout(() => setToast(''), 1500);
        return;
      }
      await handleClearRunnerById(normalizedTarget);
      setToast(`Cleared: ${normalizedTarget}`);
      setTimeout(() => setToast(''), 1500);
      return;
    }
    if (trimmed.startsWith('--')) {
      const target = trimmed.slice(2).trim();
      const normalizedTarget = normalizeRunnerId(target);
      setRunnerId('');
      setOverridePending(false);
      inputRef.current?.focus();
      if (!normalizedTarget) {
        const msg =
          runnerFormat === 'classIndex'
            ? 'Invalid ID. Use A04, B10 format.'
            : 'Invalid ID. Numbers only.';
        setToast(msg);
        setTimeout(() => setToast(''), 1500);
        return;
      }
      await handleUndoRunnerById(normalizedTarget);
      return;
    }
    const normalizedId = normalizeRunnerId(trimmed);
    if (!normalizedId) {
      setRunnerId('');
      setOverridePending(false);
      inputRef.current?.focus();
      const msg =
        runnerFormat === 'classIndex'
          ? 'Invalid ID. Use A04, B10 format.'
          : 'Invalid ID. Numbers only.';
      setToast(msg);
      setTimeout(() => setToast(''), 1500);
      return;
    }
    const force = overridePending || (event as unknown as React.KeyboardEvent).shiftKey === true;

    const sessionEvents = await listEventsForSession(sessionId);
    const clearAllEvents = sessionEvents.filter((event) => event.type === 'CLEAR_ALL');
    const runnerEvents = sessionEvents.filter(
      (event) => event.runnerId === normalizedId || event.runnerId === trimmed
    );
    const combined = filterUndoneEvents([...clearAllEvents, ...runnerEvents]).sort(
      (a, b) => a.capturedAtMs - b.capturedAtMs
    );
    let runnerState = createInitialRunnerState();
    for (const entry of combined) {
      runnerState = applyEvent(runnerState, mapDbEventToRunEvent(entry), templateConfig);
    }

    const nowMs = Date.now();
    const lastSeen = runnerState.lastSeenMsAtStation[stationId as any];
    const gapMs = templateConfig.minScanGapMsByStation[stationId as any] ?? 0;
    if (!force && lastSeen != null && nowMs - lastSeen < gapMs) {
      setRunnerId('');
      setOverridePending(false);
      inputRef.current?.focus();
      return;
    }
    if (
      stationId === 'LAP_END' &&
      session?.lapsRequired != null &&
      runnerState.lapCount >= session.lapsRequired
    ) {
      setRunnerId('');
      setOverridePending(false);
      inputRef.current?.focus();
      setToast(`Already finished: ${normalizedId}`);
      setTimeout(() => setToast(''), 1500);
      return;
    }

    await addEvent({
      sessionId,
      runnerId: normalizedId,
      stationId,
      type: 'PASS',
      capturedAtMs: nowMs
    });

    setRunnerId('');
    setOverridePending(false);
    inputRef.current?.focus();
    setToast(`Recorded: ${runnerId}`);
    setTimeout(() => setToast(''), 1500);
    await refreshEvents();
  }

  const holdTimerRef = useRef<number | null>(null);
  const [overridePending, setOverridePending] = useState(false);
  function handleHoldStart() {
    holdTimerRef.current = window.setTimeout(() => {
      setOverridePending(true);
      setToast('Override armed.');
      setTimeout(() => setToast(''), 1200);
    }, 500);
  }

  function handleHoldEnd() {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  async function handleResetSession() {
    if (!sessionId) return;
    await clearSessionEvents(sessionId);
    const nowMs = Date.now();
    lastClearAllRef.current = nowMs;
    await addEvent({
      sessionId,
      runnerId: 'GLOBAL',
      stationId: stationId || 'LAP_END',
      type: 'CLEAR_ALL',
      capturedAtMs: nowMs
    });
    setToast('Session reset recorded.');
    setTimeout(() => setToast(''), 1500);
    await refreshEvents();
    await syncEvents(sessionId);
  }

  async function handleExport() {
    if (!sessionId) return;
    const csv = await exportCsv(sessionId);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `session-${sessionId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleGlobalStart() {
    if (!sessionId) return;
    const startMs = Date.now();
    await addEvent({
      sessionId,
      runnerId: 'GLOBAL',
      stationId: 'START',
      type: 'START_SET',
      capturedAtMs: startMs
    });
    await updateSessionGlobalStart(sessionId, startMs);
    setSession((prev) => (prev ? { ...prev, globalStartMs: startMs } : prev));
    await refreshEvents();
  }

  if (!sessionId) {
    return (
      <main>
        <h1>Capture</h1>
        <p className="note">Missing session ID. Start from Session Setup.</p>
      </main>
    );
  }

  return (
    <main className="capture-main">
      {sessionId && (
        <div className="page-actions">
          <Link className="btn-link" to={`/station?sessionId=${encodeURIComponent(sessionId)}`}>
            Back to Station
          </Link>
          <Link className="btn-link" to="/">
            Back to Setup
          </Link>
        </div>
      )}

      <div className="capture-layout">
        <section className="capture-left card">
          {!inputFocused && (
            <div
              className="focus-overlay"
              onClick={() => {
                inputRef.current?.focus();
                setInputFocused(true);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  inputRef.current?.focus();
                  setInputFocused(true);
                }
              }}
            >
              Put cursor in scan box
            </div>
          )}
          <div className="station-title">
            {stationId
              ? `STATION SCANNING: ${stationLabel(session?.templateKey, stationId)}`
              : 'STATION SCANNING: -'}
          </div>
          <p className="note">
            Session: {sessionId} | Station: {stationId ? stationLabel(session?.templateKey, stationId) : 'Not set'}{' '}
            <Link to={`/station?sessionId=${encodeURIComponent(sessionId)}`}>Switch station</Link>
          </p>

          <form onSubmit={handleSubmit} className="capture-form">
            <div>
              <label htmlFor="runner">Runner ID</label>
              <input
                id="runner"
                ref={inputRef}
                value={runnerId}
                onChange={(event) => setRunnerId(event.target.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.shiftKey) {
                    setOverridePending(true);
                  }
                }}
                placeholder="Scan or type runner ID"
                style={{ fontSize: '24px', height: '56px' }}
              />
            </div>
            <button
              type="submit"
              className="btn-lg"
              disabled={tokenStatus === 'invalid' || tokenStatus === 'checking'}
              onMouseDown={handleHoldStart}
              onMouseUp={handleHoldEnd}
              onMouseLeave={handleHoldEnd}
              onTouchStart={handleHoldStart}
              onTouchEnd={handleHoldEnd}
            >
              Record
            </button>
            {showGlobalStart && stationId === 'START' && (
              <button type="button" className="secondary" onClick={handleGlobalStart}>
                Start
              </button>
            )}
          </form>

          {toast && <div className="toast">{toast}</div>}
          {hasStartStation && (
            <div className="note">
              Start: {session?.globalStartMs ? new Date(session.globalStartMs).toLocaleTimeString() : 'Not set'}
            </div>
          )}
          {tokenStatus === 'checking' && <div className="note">Validating pairing token...</div>}
          {tokenStatus === 'invalid' && <div className="error">Token invalid: {tokenError}</div>}
          {(lastPullAtMs || lastPushAtMs || (!session?.pairingToken || !session?.remoteSessionId)) && (
            <div className="note">
              Sync:{' '}
              {!session?.pairingToken || !session?.remoteSessionId
                ? 'offline'
                : (() => {
                    const now = Date.now();
                    const pullText = lastPullAtMs ? new Date(lastPullAtMs).toLocaleTimeString() : 'never';
                    const pushText = lastPushAtMs ? new Date(lastPushAtMs).toLocaleTimeString() : 'never';
                    const stalePull = lastPullAtMs ? now - lastPullAtMs > 15000 : true;
                    const stalePush = lastPushAtMs ? now - lastPushAtMs > 15000 : true;
                    const stale = stalePull || stalePush;
                    return `pull ${pullText} | push ${pushText}${stale ? ' (stale)' : ''}`;
                  })()}
            </div>
          )}
          <div className="capture-inline-note">
            <div className="tag">
              ID format: {runnerFormat === 'classIndex' ? 'A04, B10' : 'Numbers only'}
            </div>
          </div>
          <div className="capture-inline-note">
            <div className="tag">-cID clears runner</div>
            <div className="tag">--ID undo last local scan</div>
          </div>

          <div className="capture-section-title">Recent Scans (this device)</div>
          <div className="capture-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Runner</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.capturedAtMs).toLocaleTimeString()}</td>
                    <td>{event.runnerId}</td>
                    <td>{event.type}</td>
                  </tr>
                ))}
                {recentEvents.length === 0 && (
                  <tr>
                    <td colSpan={3}>No scans yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="capture-right card">
          <div className="capture-section-title">Runner Summary</div>
          <div className="capture-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Runner</th>
                  <th>Laps</th>
                  <th>Finished</th>
                  <th>Flags</th>
                  <th>Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {runnerSummaries.map((runner) => {
                  const lapsRequired = session?.lapsRequired;
                  const completedByLaps =
                    lapsRequired != null && runner.lapCount >= lapsRequired;
                  const lastLap =
                    lapsRequired != null &&
                    !completedByLaps &&
                    runner.lapCount === lapsRequired - 1;
                  const rowClass = completedByLaps || runner.finished ? 'row-success' : lastLap ? 'row-warning' : '';
                  return (
                    <tr key={runner.runnerId} className={rowClass}>
                      <td>{runner.runnerId}</td>
                      <td>
                        {runner.lapCount}/{session?.lapsRequired ?? '-'}
                      </td>
                      <td>{completedByLaps || runner.finished ? 'Yes' : 'No'}</td>
                      <td>{runner.flags.join(', ') || '-'}</td>
                      <td>{runner.lastSeenAtMs ? new Date(runner.lastSeenAtMs).toLocaleTimeString() : '-'}</td>
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="capture-footer card">
        <div className="capture-footer-actions">
          <button type="button" className="secondary" onClick={() => setShowResetConfirm(true)}>
            Reset Session Data
          </button>
          <button type="button" className="secondary" onClick={handleExport}>
            Export CSV
          </button>
          <button
            type="button"
            className="secondary"
            onClick={handleProjectorToggle}
            disabled={!stationId}
          >
            {projectorOpen ? 'Close Projector View' : 'Projector View'}
          </button>
        </div>
        <div className="note">Warning: reset clears local history and broadcasts a reset to all stations.</div>
      </div>
      {showResetConfirm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <div className="text-base font-semibold">Reset Session Data</div>
              <button type="button" className="btn-link" onClick={() => setShowResetConfirm(false)}>
                Close
              </button>
            </div>
            <div className="grid">
              <div className="note" style={{ fontSize: '14px' }}>
                This clears all scans on this device and resets the session for all stations.
              </div>
              <div className="reset-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowResetConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setShowResetConfirm(false);
                    await handleResetSession();
                  }}
                >
                  Reset Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
