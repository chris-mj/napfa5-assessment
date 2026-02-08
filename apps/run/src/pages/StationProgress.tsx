import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getSession, listEventsForSession } from '../db/repo';
import type { EventRow, SessionRow } from '../db/db';

const REFRESH_MS = 1000;

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

function formatDurationMs(ms?: number) {
  if (!ms || ms < 0) return '-';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function filterUndoneEvents(events: EventRow[]) {
  const undone = new Set(
    events
      .filter((event) => event.type === 'UNDO' && event.refEventId)
      .map((event) => event.refEventId as string)
  );
  return events.filter((event) => !undone.has(event.id) && event.type !== 'UNDO');
}

export default function StationProgressPage() {
  const [params] = useSearchParams();
  const sessionId = params.get('sessionId') ?? '';
  const [session, setSession] = useState<SessionRow | null>(null);
  const [stationId, setStationId] = useState('');
  const [localEvents, setLocalEvents] = useState<EventRow[]>([]);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const stored = localStorage.getItem(stationStorageKey(sessionId)) ?? '';
    const fromQuery = params.get('stationId') ?? '';
    setStationId(fromQuery || stored);
  }, [sessionId, params]);

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then((value) => setSession(value ?? null));
  }, [sessionId]);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    const events = await listEventsForSession(sessionId);
    const filtered = filterUndoneEvents(
      events.filter((event) => event.source !== 'remote' && event.stationId === stationId)
    );
    const clearAllEvents = events
      .filter((event) => event.type === 'CLEAR_ALL')
      .sort((a, b) => a.capturedAtMs - b.capturedAtMs);
    const lastClearAt = clearAllEvents.length
      ? clearAllEvents[clearAllEvents.length - 1].capturedAtMs
      : 0;
    const scoped = lastClearAt ? filtered.filter((event) => event.capturedAtMs >= lastClearAt) : filtered;
    setLocalEvents(scoped);
  }, [sessionId, stationId]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!active) return;
      await refresh();
    };
    run();
    const timer = setInterval(run, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    channelRef.current = new BroadcastChannel('napfa5-run');
    const channel = channelRef.current;
    channel.onmessage = (event) => {
      if (event?.data?.type === 'events-updated' && event.data.sessionId === sessionId) {
        refresh();
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [sessionId, refresh]);

  const isCheckpoint = stationId === 'A' || stationId === 'B' || stationId === 'START' || stationId === 'FINISH';

  const recentScans = useMemo(() => {
    return [...localEvents]
      .filter((event) => event.type === 'PASS')
      .sort((a, b) => b.capturedAtMs - a.capturedAtMs)
      .slice(0, 30);
  }, [localEvents]);

  const lapRows = useMemo(() => {
    const events = localEvents.filter((event) => event.type === 'PASS');
    const byRunner = new Map<string, EventRow[]>();
    for (const event of events) {
      if (!event.runnerId) continue;
      if (!byRunner.has(event.runnerId)) byRunner.set(event.runnerId, []);
      byRunner.get(event.runnerId)!.push(event);
    }

    const rows = [];
    for (const [runnerId, items] of byRunner.entries()) {
      const sorted = items.sort((a, b) => a.capturedAtMs - b.capturedAtMs);
      const last = sorted[sorted.length - 1];
      const prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
      const totalScans = sorted.length;
      const lapCount = Math.max(0, totalScans - 1);
      const lapsLeft = Math.max((session?.lapsRequired ?? 0) - lapCount, 0);
      const lapTimeMs = prev ? last.capturedAtMs - prev.capturedAtMs : undefined;
      const startMs = session?.globalStartMs ?? sorted[0]?.capturedAtMs;
      const totalTimeMs = startMs ? last.capturedAtMs - startMs : undefined;
      rows.push({
        runnerId,
        lapCount,
        lapsLeft,
        lapTimeMs,
        totalTimeMs,
        lastSeen: last.capturedAtMs
      });
    }

    return rows.sort((a, b) => b.lastSeen - a.lastSeen);
  }, [localEvents, session?.lapsRequired, session?.globalStartMs]);

  if (!sessionId || !stationId) {
    return (
      <main className="progress-view">
        <h1>Station Progress</h1>
        <p className="note">Missing session or station. Open from the Capture page.</p>
        <Link className="btn-link" to="/">
          Back to Setup
        </Link>
      </main>
    );
  }

  return (
    <main className="progress-view">
      <div className="page-actions">
        <Link className="btn-link" to={`/capture?sessionId=${encodeURIComponent(sessionId)}`}>
          Back to Capture
        </Link>
      </div>
      <div className="progress-header">
        <div>
          <h1>Station Progress</h1>
          <div className="note">This device only</div>
        </div>
        <div className="progress-meta">{stationLabel(session?.templateKey, stationId)}</div>
      </div>

      {isCheckpoint ? (
        <section className="progress-card">
          <h2>Checkpoint Scans</h2>
          <table className="progress-table">
            <thead>
              <tr>
                <th>Runner ID</th>
              </tr>
            </thead>
            <tbody>
              {recentScans.map((event) => (
                <tr key={event.id}>
                  <td>{event.runnerId}</td>
                </tr>
              ))}
              {recentScans.length === 0 && (
                <tr>
                  <td>No scans yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="progress-card">
          <h2>Lap Scans</h2>
          <table className="progress-table">
            <thead>
              <tr>
                <th>Runner ID</th>
                <th>Laps Left</th>
                <th>Lap Time</th>
                <th>Total Time</th>
              </tr>
            </thead>
            <tbody>
              {lapRows.map((row) => {
                const lapsRequired = session?.lapsRequired ?? 0;
                const completed = row.lapCount >= lapsRequired;
                const lastLap = !completed && row.lapCount === Math.max(lapsRequired - 1, 0);
                const rowClass = completed ? 'row-success' : lastLap ? 'row-warning' : '';
                return (
                <tr key={row.runnerId} className={rowClass}>
                  <td>{row.runnerId}</td>
                  <td>{row.lapsLeft}</td>
                  <td>{formatDurationMs(row.lapTimeMs)}</td>
                  <td>{formatDurationMs(row.totalTimeMs)}</td>
                </tr>
              );
              })}
              {lapRows.length === 0 && (
                <tr>
                  <td colSpan={4}>No scans yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
