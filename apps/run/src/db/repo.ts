import Dexie from 'dexie';
import { db, type EventRow, type SessionRow } from './db';

export async function createSession(
  templateKey: string,
  lapsRequired: number,
  enforcement?: string,
  globalStartMs?: number,
  pairingToken?: string,
  scanGapMs?: number,
  name?: string,
  runnerIdFormat?: 'numeric' | 'classIndex'
): Promise<string> {
  const id = crypto.randomUUID();
  const record: SessionRow = {
    id,
    name,
    templateKey,
    lapsRequired,
    runnerIdFormat,
    enforcement,
    createdAt: Date.now(),
    globalStartMs,
    pairingToken,
    scanGapMs
  };

  await db.sessions.add(record);
  return id;
}

export async function upsertTokenSession(input: {
  runConfigId: string;
  remoteSessionId: string;
  templateKey: string;
  lapsRequired: number;
  enforcement?: string;
  scanGapMs?: number;
  pairingToken: string;
  name?: string;
  runnerIdFormat?: 'numeric' | 'classIndex';
}): Promise<string> {
  const record: SessionRow = {
    id: input.runConfigId,
    runConfigId: input.runConfigId,
    remoteSessionId: input.remoteSessionId,
    name: input.name,
    templateKey: input.templateKey,
    lapsRequired: input.lapsRequired,
    runnerIdFormat: input.runnerIdFormat ?? 'numeric',
    enforcement: input.enforcement,
    createdAt: Date.now(),
    pairingToken: input.pairingToken,
    scanGapMs: input.scanGapMs
  };
  await db.sessions.put(record);
  return record.id;
}

export async function addEvent(event: Omit<EventRow, 'id'> & { id?: string }): Promise<EventRow> {
  const saved: EventRow = {
    ...event,
    id: event.id ?? crypto.randomUUID(),
    source: event.source ?? 'local'
  };

  await db.events.add(saved);
  return saved;
}

export async function listRecentEvents(sessionId: string, limit: number): Promise<EventRow[]> {
  const rows = await db.events
    .where('[sessionId+capturedAtMs]')
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .reverse()
    .limit(limit)
    .toArray();

  return rows;
}

export async function listEventsForRunner(sessionId: string, runnerId: string): Promise<EventRow[]> {
  return db.events.where('[sessionId+runnerId]').equals([sessionId, runnerId]).toArray();
}

export async function listEventsForSession(sessionId: string): Promise<EventRow[]> {
  return db.events
    .where('[sessionId+capturedAtMs]')
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .toArray();
}

export async function clearSessionEvents(sessionId: string): Promise<void> {
  await db.events.where('sessionId').equals(sessionId).delete();
}

export async function upsertRemoteEvents(
  sessionId: string,
  events: Array<Omit<EventRow, 'sessionId'> & { syncedAtMs?: number }>
): Promise<void> {
  if (!events.length) return;
  await db.transaction('rw', db.events, async () => {
    for (const event of events) {
      const existing = await db.events.get(event.id);
      await db.events.put({
        ...(existing ?? {}),
        ...event,
        sessionId,
        syncedAtMs: event.syncedAtMs ?? existing?.syncedAtMs,
        source: event.source ?? existing?.source ?? 'remote'
      });
    }
  });
}

export async function listUnsyncedEvents(sessionId: string): Promise<EventRow[]> {
  return db.events
    .where('[sessionId+syncedAtMs]')
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .filter((event) => event.syncedAtMs == null)
    .toArray();
}

export async function markEventsSynced(eventIds: string[], syncedAtMs: number): Promise<void> {
  if (!eventIds.length) return;
  await db.transaction('rw', db.events, async () => {
    for (const id of eventIds) {
      const existing = await db.events.get(id);
      if (existing) {
        await db.events.put({ ...existing, syncedAtMs });
      }
    }
  });
}

export async function getSession(sessionId: string): Promise<SessionRow | undefined> {
  return db.sessions.get(sessionId);
}

export async function listSessions(): Promise<SessionRow[]> {
  return db.sessions.orderBy('createdAt').reverse().toArray();
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.events, async () => {
    await db.sessions.delete(sessionId);
    await db.events.where('sessionId').equals(sessionId).delete();
  });
}

export async function updateSessionGlobalStart(sessionId: string, globalStartMs: number): Promise<void> {
  await db.sessions.update(sessionId, { globalStartMs });
}

function escapeCsv(value: string | number | undefined): string {
  if (value == null) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function exportCsv(sessionId: string): Promise<string> {
  const events = await db.events
    .where('[sessionId+capturedAtMs]')
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .sortBy('capturedAtMs');

  const header = ['id', 'sessionId', 'runnerId', 'stationId', 'type', 'capturedAtMs', 'refEventId'];
  const rows = events.map((event) =>
    [
      event.id,
      event.sessionId,
      event.runnerId,
      event.stationId,
      event.type,
      event.capturedAtMs,
      event.refEventId ?? ''
    ]
      .map(escapeCsv)
      .join(',')
  );

  return [header.join(','), ...rows].join('\n');
}
