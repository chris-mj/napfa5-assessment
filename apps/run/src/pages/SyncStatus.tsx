import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSession, listRecentEvents, listUnsyncedEvents } from '../db/repo';
import type { SessionRow } from '../db/db';
import { syncEvents } from '../lib/sync';

export default function SyncStatus() {
  const [params] = useSearchParams();
  const sessionId = params.get('sessionId') ?? '';
  const [session, setSession] = useState<SessionRow | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then((value) => setSession(value ?? null));
    listRecentEvents(sessionId, 5000).then((events) => setEventCount(events.length));
    listUnsyncedEvents(sessionId).then((events) => setPendingCount(events.length));
    const stored = localStorage.getItem(`napfa5-run:lastSync:${sessionId}`);
    if (stored) setLastSyncAt(Number(stored));
  }, [sessionId]);

  async function handleSync() {
    if (!sessionId) return;
    const result = await syncEvents(sessionId);
    if (result.error) {
      setMessage(`Sync failed: ${result.error}`);
      return;
    }
    setMessage(`Synced ${result.synced} event(s).`);
    const now = Date.now();
    localStorage.setItem(`napfa5-run:lastSync:${sessionId}`, String(now));
    setLastSyncAt(now);
    const remaining = await listUnsyncedEvents(sessionId);
    setPendingCount(remaining.length);
  }

  function renderLastSync() {
    if (!lastSyncAt) return '-';
    return new Date(lastSyncAt).toLocaleString();
  }

  return (
    <main>
      <h1>Sync Status</h1>
      <p className="note">Session: {sessionId || 'Not set'}</p>

      <section className="card">
        <div className="grid">
          <div>
            <label>Pairing Token</label>
            <div>{session?.pairingToken ?? '-'}</div>
          </div>
          <div>
            <label>Local Events</label>
            <div>{eventCount}</div>
          </div>
          <div>
            <label>Pending Sync</label>
            <div>{pendingCount}</div>
          </div>
          <div>
            <label>Last Sync</label>
            <div>{renderLastSync()}</div>
          </div>
          <button onClick={handleSync}>Sync Now</button>
          {message && <div className="note">{message}</div>}
        </div>
      </section>
    </main>
  );
}
