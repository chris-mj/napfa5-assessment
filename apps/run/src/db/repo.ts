import Dexie from 'dexie';
import { db, type EventRow, type RunnerIdRules, type SessionRow } from './db';

export async function createSession(
  templateKey: string,
  lapsRequired: number,
  enforcement?: string,
  globalStartMs?: number,
  pairingToken?: string,
  scanGapMs?: number,
  name?: string,
  runnerIdFormat?: 'numeric' | 'classIndex' | 'structured4',
  runnerIdMin?: number,
  runnerIdMax?: number,
  classPrefixes?: string[],
  classIndexMin?: number,
  classIndexMax?: number,
  structuredLevelMin?: number,
  structuredLevelMax?: number,
  structuredClassMin?: number,
  structuredClassMax?: number,
  structuredIndexMin?: number,
  structuredIndexMax?: number
): Promise<string> {
  const id = crypto.randomUUID();
  const record: SessionRow = {
    id,
    name,
    templateKey,
    lapsRequired,
    runnerIdFormat,
    runnerIdMin,
    runnerIdMax,
    classPrefixes,
    classIndexMin,
    classIndexMax,
    structuredLevelMin,
    structuredLevelMax,
    structuredClassMin,
    structuredClassMax,
    structuredIndexMin,
    structuredIndexMax,
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
  runnerIdFormat?: 'numeric' | 'classIndex' | 'structured4';
  runnerIdMin?: number;
  runnerIdMax?: number;
  classPrefixes?: string[];
  classIndexMin?: number;
  classIndexMax?: number;
  structuredLevelMin?: number;
  structuredLevelMax?: number;
  structuredClassMin?: number;
  structuredClassMax?: number;
  structuredIndexMin?: number;
  structuredIndexMax?: number;
}): Promise<string> {
  const record: SessionRow = {
    id: input.runConfigId,
    runConfigId: input.runConfigId,
    remoteSessionId: input.remoteSessionId,
    name: input.name,
    templateKey: input.templateKey,
    lapsRequired: input.lapsRequired,
    runnerIdFormat: input.runnerIdFormat ?? 'numeric',
    runnerIdMin: input.runnerIdMin,
    runnerIdMax: input.runnerIdMax,
    classPrefixes: input.classPrefixes,
    classIndexMin: input.classIndexMin,
    classIndexMax: input.classIndexMax,
    structuredLevelMin: input.structuredLevelMin,
    structuredLevelMax: input.structuredLevelMax,
    structuredClassMin: input.structuredClassMin,
    structuredClassMax: input.structuredClassMax,
    structuredIndexMin: input.structuredIndexMin,
    structuredIndexMax: input.structuredIndexMax,
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
  // Unsynced rows may not be present in the [sessionId+syncedAtMs] index when syncedAtMs is undefined.
  // Query by sessionId first, then filter in-memory for null/undefined syncedAtMs.
  return db.events
    .where('sessionId')
    .equals(sessionId)
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

export async function updateSessionGlobalStart(sessionId: string, globalStartMs?: number): Promise<void> {
  await db.sessions.update(sessionId, { globalStartMs });
}

export async function updateSessionGlobalEnd(sessionId: string, globalEndMs?: number): Promise<void> {
  await db.sessions.update(sessionId, { globalEndMs });
}

export async function updateSessionGlobalPaused(sessionId: string, globalPaused?: boolean): Promise<void> {
  await db.sessions.update(sessionId, { globalPaused });
}

export async function updateSessionLocalIdRules(
  sessionId: string,
  rules: RunnerIdRules | null
): Promise<void> {
  await db.sessions.update(sessionId, {
    localIdRulesOverride: rules ?? undefined,
    localIdRulesOverrideUpdatedAt: rules ? Date.now() : undefined
  });
}

export async function updateSessionRemoteConfig(
  sessionId: string,
  patch: Partial<
    Pick<
      SessionRow,
      | 'name'
      | 'remoteSessionId'
      | 'runConfigId'
      | 'templateKey'
      | 'lapsRequired'
      | 'enforcement'
      | 'scanGapMs'
      | 'runnerIdFormat'
      | 'runnerIdMin'
      | 'runnerIdMax'
      | 'classPrefixes'
      | 'classIndexMin'
      | 'classIndexMax'
      | 'structuredLevelMin'
      | 'structuredLevelMax'
      | 'structuredClassMin'
      | 'structuredClassMax'
      | 'structuredIndexMin'
      | 'structuredIndexMax'
    >
  >
): Promise<void> {
  await db.sessions.update(sessionId, patch);
}

function escapeCsv(value: string | number | undefined): string {
  if (value == null) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatMmssFromSeconds(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function deriveRunSummaryRows(session: SessionRow | undefined, events: EventRow[]) {
  const template = String(session?.templateKey || 'A').toUpperCase();
  const lapsRequired = Math.max(1, Number(session?.lapsRequired || 1));
  const checkpoints = template === 'B' ? ['A'] : template === 'C' ? ['A', 'B'] : [];

  const sorted = [...events].sort((a, b) => a.capturedAtMs - b.capturedAtMs);
  const latestClear = sorted
    .filter((e) => e.type === 'CLEAR_ALL')
    .reduce((m, e) => Math.max(m, e.capturedAtMs || 0), 0);
  const scoped = latestClear ? sorted.filter((e) => (e.capturedAtMs || 0) >= latestClear) : sorted;
  const passEvents = scoped.filter((e) => e.type === 'PASS' && e.runnerId);

  const byRunner = new Map<string, EventRow[]>();
  for (const e of passEvents) {
    const key = String(e.runnerId || '').trim();
    if (!key) continue;
    if (!byRunner.has(key)) byRunner.set(key, []);
    byRunner.get(key)!.push(e);
  }

  const rows: Array<{
    tagId: string;
    checkpointFlag: string;
    totalMmss: string;
    intervalsText: string;
    intervalSteps: Array<{ station: string; mmss: string }>;
  }> = [];
  for (const [tagId, list] of byRunner.entries()) {
    const scans = [...list].sort((a, b) => a.capturedAtMs - b.capturedAtMs);
    let startedAt: number | null = null;
    let finishedAt: number | null = null;
    let lapCount = 0;
    const checkpointsSeen: Record<string, boolean> = {};
    const timeline: Array<{ station: string; t: number }> = [];

    for (const e of scans) {
      const station = String(e.stationId || '');
      const t = Number(e.capturedAtMs || 0);
      if (!t || finishedAt != null) continue;

      if (template === 'D' && station === 'START' && startedAt == null) {
        startedAt = t;
        timeline.push({ station, t });
        continue;
      }

      if (station === 'A' || station === 'B') {
        if (checkpoints.includes(station)) checkpointsSeen[station] = true;
        continue;
      }

      if (station === 'LAP_END') {
        if (startedAt == null) {
          startedAt = t;
          timeline.push({ station, t });
          continue;
        }
        timeline.push({ station, t });
        lapCount += 1;
        if (template !== 'E' && lapCount >= lapsRequired) {
          finishedAt = t;
        }
        continue;
      }

      if (station === 'FINISH' && template === 'E' && startedAt != null) {
        timeline.push({ station, t });
        if (lapCount >= lapsRequired) finishedAt = t;
      }
    }

    const totalSec = startedAt != null && finishedAt != null && finishedAt > startedAt
      ? Math.round((finishedAt - startedAt) / 1000)
      : undefined;
    const intervals: string[] = [];
    const intervalSteps: Array<{ station: string; mmss: string }> = [];
    for (let i = 1; i < timeline.length; i += 1) {
      const prev = timeline[i - 1];
      const curr = timeline[i];
      const sec = Math.max(0, Math.round((curr.t - prev.t) / 1000));
      const mmss = formatMmssFromSeconds(sec);
      intervals.push(`${prev.station}->${curr.station} ${mmss}`);
      intervalSteps.push({ station: curr.station, mmss });
    }

    rows.push({
      tagId,
      checkpointFlag: checkpoints.length
        ? (checkpoints.some((cp) => !checkpointsSeen[cp]) ? 'Missing checkpoint' : 'OK')
        : '',
      totalMmss: formatMmssFromSeconds(totalSec),
      intervalsText: intervals.join(' | '),
      intervalSteps
    });
  }

  rows.sort((a, b) => a.tagId.localeCompare(b.tagId, undefined, { numeric: true, sensitivity: 'base' }));
  return rows;
}

export async function exportCsv(sessionId: string): Promise<string> {
  const session = await db.sessions.get(sessionId);
  const events = await db.events
    .where('[sessionId+capturedAtMs]')
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .sortBy('capturedAtMs');

  const summaryRows = deriveRunSummaryRows(session, events);
  const maxSteps = summaryRows.reduce((m, r) => Math.max(m, r.intervalSteps.length), 0);
  const intervalHeaders: string[] = [];
  for (let i = 0; i < maxSteps; i += 1) {
    const station = summaryRows.find((r) => r.intervalSteps[i]?.station)?.intervalSteps[i]?.station;
    intervalHeaders.push(station || `Scan ${i + 2}`);
  }
  const metaRows = [
    ['Run Session Name', session?.name || ''],
    ['Run Config ID', session?.runConfigId || session?.id || sessionId],
    ['Setup Type', session?.templateKey || ''],
    ['Laps Required', session?.lapsRequired ?? ''],
    ['Checkpoint Enforcement', session?.enforcement || 'OFF'],
    ['Time Between Scans (s)', session?.scanGapMs ? Math.round(session.scanGapMs / 1000) : 10],
    ['Exported At', new Date().toISOString()],
    []
  ].map((row) => row.map((v) => escapeCsv(v as any)).join(','));

  const header = [
    'Tag ID',
    'Tag Mapping',
    'Student ID',
    'Student Name',
    'Class',
    'Checkpoint Flag',
    'Total Run Time',
    ...intervalHeaders
  ];
  const rows = summaryRows.map((row) =>
    [
      row.tagId,
      '',
      '',
      '',
      '',
      row.checkpointFlag,
      row.totalMmss,
      ...intervalHeaders.map((_, idx) => row.intervalSteps[idx]?.mmss || '')
    ].map(escapeCsv).join(',')
  );

  return [...metaRows, header.join(','), ...rows].join('\n');
}
