import { getSession, listUnsyncedEvents, markEventsSynced } from '../db/repo';
import type { EventRow } from '../db/db';

const ENDPOINT = import.meta.env.DEV
  ? 'http://localhost:3000/api/run/ingestEvents'
  : 'https://napfa5.sg/api/run/ingestEvents';

type SyncResult = {
  synced: number;
  failed: number;
  error?: string;
  acceptedIds?: string[];
  failedIds?: string[];
};

function toPayload(event: EventRow) {
  return {
    id: event.id,
    runnerId: event.runnerId,
    stationId: event.stationId,
    type: event.type,
    capturedAtMs: event.capturedAtMs,
    refEventId: event.refEventId ?? null
  };
}

export async function syncEvents(sessionId: string): Promise<SyncResult> {
  const session = await getSession(sessionId);
  if (!session?.pairingToken || !session?.remoteSessionId) {
    return { synced: 0, failed: 0, error: 'Missing pairing token.' };
  }

  const events = await listUnsyncedEvents(sessionId);
  if (!events.length) return { synced: 0, failed: 0 };

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.pairingToken}`
    },
    body: JSON.stringify({
      sessionId: session.remoteSessionId,
      runConfigId: session.runConfigId ?? session.id,
      events: events.map(toPayload)
    })
  });

  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    return {
      synced: 0,
      failed: events.length,
      error: body?.error ?? `Sync failed (${response.status}).`
    };
  }

  const acceptedIds: string[] = Array.isArray(body?.acceptedIds) ? body.acceptedIds : [];
  const failedIds: string[] = Array.isArray(body?.failedIds) ? body.failedIds : [];

  if (!acceptedIds.length && !failedIds.length) {
    // If API doesn't return per-item status, assume all accepted.
    const syncedAtMs = Date.now();
    await markEventsSynced(events.map((event) => event.id), syncedAtMs);
    return { synced: events.length, failed: 0, acceptedIds: events.map((event) => event.id) };
  }

  if (acceptedIds.length) {
    await markEventsSynced(acceptedIds, Date.now());
  }

  return {
    synced: acceptedIds.length,
    failed: failedIds.length,
    acceptedIds,
    failedIds,
    error: failedIds.length ? 'Some events failed to sync.' : undefined
  };
}
