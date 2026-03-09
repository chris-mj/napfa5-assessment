import { getSession, listUnsyncedEvents, markEventsSynced, upsertRemoteEvents } from '../db/repo';
import type { EventRow } from '../db/db';
import { fetchRunEvents, ingestRunEvents } from './runApi';

type SyncResult = {
  synced: number;
  failed: number;
  attempted: number;
  pending: number;
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
    refEventId: event.refEventId ?? null,
    payload: event.payload ?? null
  };
}

export async function syncEvents(sessionId: string): Promise<SyncResult> {
  const session = await getSession(sessionId);
  if (!session?.pairingToken || !session?.remoteSessionId) {
    return { synced: 0, failed: 0, attempted: 0, pending: 0, error: 'Missing pairing token.' };
  }

  const events = await listUnsyncedEvents(sessionId);
  if (!events.length) return { synced: 0, failed: 0, attempted: 0, pending: 0 };
  const attempted = events.length;

  try {
    const result = await ingestRunEvents({
      pairingToken: session.pairingToken,
      sessionId: session.remoteSessionId,
      runConfigId: session.runConfigId ?? session.id,
      events: events.map(toPayload)
    });
    const acceptedIds = result.acceptedIds;
    const failedIds = result.failedIds;

    if (acceptedIds.length) {
      await markEventsSynced(acceptedIds, Date.now());
    }
    const pending = (await listUnsyncedEvents(sessionId)).length;

    return {
      synced: acceptedIds.length,
      failed: failedIds.length,
      attempted,
      pending,
      acceptedIds,
      failedIds,
      error: failedIds.length ? 'Some events failed to sync.' : undefined
    };
  } catch (err: any) {
    return {
      synced: 0,
      failed: attempted,
      attempted,
      pending: attempted,
      error: err?.message || 'Sync failed.'
    };
  }
}

type ResumeResult = {
  pushed: SyncResult;
  pulled: number;
  error?: string;
};

export async function reconcileSessionWithCloud(sessionId: string): Promise<ResumeResult> {
  const pushed = await syncEvents(sessionId);
  const session = await getSession(sessionId);
  if (!session?.pairingToken || !session?.remoteSessionId) {
    return { pushed, pulled: 0, error: pushed.error };
  }

  try {
    const pulled = await fetchRunEvents({
      pairingToken: session.pairingToken
    });
    const events = Array.isArray(pulled.events) ? pulled.events : [];
    if (events.length) {
      const mapped = events.map((event: any) => ({
        id: event.id,
        runnerId: event.runnerId || '',
        stationId: event.stationId || '',
        type: event.type || 'PASS',
        capturedAtMs: event.capturedAtMs || Date.now(),
        refEventId: event.refEventId || undefined,
        payload: event.payload || undefined,
        syncedAtMs: Date.now()
      }));
      await upsertRemoteEvents(sessionId, mapped);
    }

    return {
      pushed,
      pulled: events.length,
      error: pushed.error
    };
  } catch (err: any) {
    return {
      pushed,
      pulled: 0,
      error: err?.message || pushed.error || 'Failed to reconcile with cloud.'
    };
  }
}
