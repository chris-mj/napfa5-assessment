import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { applyEvent, createInitialRunnerState, getTemplateConfig, type RunEvent, Flag } from '@napfa5/run-core';
import { getSession, listEventsForSession } from '../db/repo';
import type { EventRow, SessionRow } from '../db/db';

const REFRESH_MS = 1000;
const TOP_FINISHERS = 10;
const REMOTE_POLL_MS = 5000;
const EVENTS_ENDPOINT = import.meta.env.DEV
  ? 'http://localhost:3000/api/run/events'
  : 'https://napfa5.sg/api/run/events';

type RunnerSummary = {
  runnerId: string;
  lapCount: number;
  finishedAtMs?: number;
  flags: Flag[];
  lastSeenAtMs?: number;
};

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

function filterUndoneEvents(events: EventRow[]) {
  const undone = new Set(
    events
      .filter((event) => event.type === 'UNDO' && event.refEventId)
      .map((event) => event.refEventId as string)
  );
  return events.filter((event) => !undone.has(event.id) && event.type !== 'UNDO');
}

function formatDuration(start?: number, end?: number) {
  if (!start || !end) return '-';
  const totalMs = Math.max(0, end - start);
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const ms = Math.floor((totalMs % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
}

export default function DisplayPage() {
  const [params] = useSearchParams();
  const sessionId = params.get('sessionId') ?? '';
  const [session, setSession] = useState<SessionRow | null>(null);
  const [summaries, setSummaries] = useState<RunnerSummary[]>([]);
  const [globalStartMs, setGlobalStartMs] = useState<number | null>(null);
  const [remoteEvents, setRemoteEvents] = useState<EventRow[]>([]);
  const [remoteError, setRemoteError] = useState('');
  const remoteSinceRef = useRef<number>(0);
  const remoteMapRef = useRef<Map<string, EventRow>>(new Map());

  const templateConfig = useMemo(() => {
    if (!session) return null;
    return getTemplateConfig(session.templateKey as any, session.lapsRequired);
  }, [session]);

  useEffect(() => {
    document.body.style.background = '#020617';
    return () => {
      document.body.style.background = '';
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then((value) => setSession(value ?? null));
  }, [sessionId]);

  useEffect(() => {
    if (!session?.pairingToken || !session?.remoteSessionId) return;
    let active = true;
    const poll = async () => {
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
        for (const event of events) {
          remoteMapRef.current.set(event.id, {
            id: event.id,
            sessionId,
            runnerId: event.runnerId || '',
            stationId: event.stationId || '',
            type: event.type || 'PASS',
            capturedAtMs: event.capturedAtMs || Date.now(),
            refEventId: event.refEventId || undefined
          });
          if (event.capturedAtMs && event.capturedAtMs > remoteSinceRef.current) {
            remoteSinceRef.current = event.capturedAtMs;
          }
        }
        if (active) {
          setRemoteEvents(Array.from(remoteMapRef.current.values()));
          setRemoteError('');
        }
      } catch (err: any) {
        if (!active) return;
        setRemoteError(err.message || 'Failed to fetch events.');
      }
    };
    poll();
    const timer = setInterval(poll, REMOTE_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session?.pairingToken, session?.remoteSessionId, sessionId]);

  useEffect(() => {
    if (!sessionId || !templateConfig) return;

    let active = true;

    const refresh = async () => {
      const events =
        session?.pairingToken && session?.remoteSessionId
          ? remoteEvents
          : await listEventsForSession(sessionId);
      const filteredEvents = filterUndoneEvents(events);
      const byRunner = new Map<string, EventRow[]>();
      const clearAllEvents = filteredEvents
        .filter((event) => event.type === 'CLEAR_ALL')
        .sort((a, b) => a.capturedAtMs - b.capturedAtMs);
      let derivedStart: number | null = null;
      for (const event of filteredEvents) {
        if (event.type === 'START_SET' && event.stationId === 'START') {
          if (derivedStart == null || event.capturedAtMs < derivedStart) {
            derivedStart = event.capturedAtMs;
          }
        }
        if (!event.runnerId) continue;
        const key = event.runnerId;
        if (!byRunner.has(key)) byRunner.set(key, []);
        byRunner.get(key)!.push(event);
      }

      const next: RunnerSummary[] = [];
      for (const [key, items] of byRunner.entries()) {
        const combined = [...clearAllEvents, ...items].sort((a, b) => a.capturedAtMs - b.capturedAtMs);
        let state = createInitialRunnerState();
        for (const entry of combined) {
          state = applyEvent(state, mapDbEventToRunEvent(entry), templateConfig);
        }
        next.push({
          runnerId: key,
          lapCount: state.lapCount,
          finishedAtMs: state.finishedAtMs,
          flags: state.flags,
          lastSeenAtMs: combined.length ? combined[combined.length - 1].capturedAtMs : undefined
        });
      }

      if (active) {
        setSummaries(next);
        setGlobalStartMs(derivedStart);
      }
    };

    refresh();
    const timer = setInterval(refresh, REFRESH_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [sessionId, templateConfig, remoteEvents, session?.pairingToken, session?.remoteSessionId]);

  const finished = useMemo(() => {
    return [...summaries]
      .filter((runner) => runner.finishedAtMs)
      .sort((a, b) => (a.finishedAtMs ?? 0) - (b.finishedAtMs ?? 0))
      .slice(0, TOP_FINISHERS);
  }, [summaries]);

  const inProgress = useMemo(() => {
    return [...summaries]
      .filter((runner) => !runner.finishedAtMs)
      .sort((a, b) => b.lapCount - a.lapCount);
  }, [summaries]);

  if (!sessionId) {
    return (
      <main>
        <h1>Display</h1>
        <p className="note">Missing session ID.</p>
      </main>
    );
  }

  return (
    <main className="display">
      <div className="page-actions">
        <Link className="btn-link" to={`/capture?sessionId=${encodeURIComponent(sessionId)}`}>
          Back to Capture
        </Link>
        <Link className="btn-link" to="/">
          Back to Setup
        </Link>
      </div>
      <div className="display-header">
        <div>
          <h1>Session Display</h1>
          <div className="note">Session: {sessionId}</div>
          {remoteError && <div className="note">Live pull issue: {remoteError}</div>}
        </div>
        <div className="display-meta">Template {session?.templateKey ?? '-'} | Laps {session?.lapsRequired ?? '-'}</div>
      </div>

      <section className="display-grid">
        <div className="display-card">
          <h2>Top Finishers</h2>
          <table className="display-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Runner</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {finished.map((runner, index) => (
                <tr key={runner.runnerId}>
                  <td>{index + 1}</td>
                  <td>{runner.runnerId}</td>
                  <td>{formatDuration(session?.globalStartMs ?? globalStartMs ?? undefined, runner.finishedAtMs)}</td>
                </tr>
              ))}
              {finished.length === 0 && (
                <tr>
                  <td colSpan={3}>No finishers yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="display-card">
          <h2>In Progress</h2>
          <table className="display-table">
            <thead>
              <tr>
                <th>Runner</th>
                <th>Laps</th>
              </tr>
            </thead>
            <tbody>
              {inProgress.map((runner) => (
                <tr key={runner.runnerId}>
                  <td>{runner.runnerId}</td>
                  <td>{runner.lapCount}/{session?.lapsRequired ?? '-'}</td>
                </tr>
              ))}
              {inProgress.length === 0 && (
                <tr>
                  <td colSpan={2}>No runners yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
