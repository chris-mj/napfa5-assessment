import { getSession, listUnsyncedEvents, markEventsSynced } from '../db/repo';
import type { EventRow } from '../db/db';
import { ingestRunEvents } from './runApi';

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

    return {
      synced: acceptedIds.length,
      failed: failedIds.length,
      acceptedIds,
      failedIds,
      error: failedIds.length ? 'Some events failed to sync.' : undefined
    };
  } catch (err: any) {
    return {
      synced: 0,
      failed: events.length,
      error: err?.message || 'Sync failed.'
    };
  }
}
