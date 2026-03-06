import Dexie, { type Table } from 'dexie';

export type RunnerIdRules = {
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
};

export type SessionRow = {
  id: string;
  name?: string;
  remoteSessionId?: string;
  runConfigId?: string;
  templateKey: string;
  lapsRequired: number;
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
  enforcement?: string;
  createdAt: number;
  globalStartMs?: number;
  pairingToken?: string;
  scanGapMs?: number;
  localIdRulesOverride?: RunnerIdRules;
  localIdRulesOverrideUpdatedAt?: number;
};

export type EventRow = {
  id: string;
  sessionId: string;
  runnerId: string;
  stationId: string;
  type: string;
  capturedAtMs: number;
  refEventId?: string;
  syncedAtMs?: number;
  source?: 'local' | 'remote';
};

export class RunDb extends Dexie {
  sessions!: Table<SessionRow, string>;
  events!: Table<EventRow, string>;

  constructor() {
    super('napfa5-run');
    this.version(1).stores({
      sessions: 'id, createdAt',
      events:
        'id, sessionId, runnerId, stationId, capturedAtMs, [sessionId+runnerId], [sessionId+capturedAtMs]'
    });
    this.version(2).stores({
      sessions: 'id, createdAt',
      events:
        'id, sessionId, runnerId, stationId, capturedAtMs, syncedAtMs, [sessionId+runnerId], [sessionId+capturedAtMs], [sessionId+syncedAtMs]'
    });
    this.version(3).stores({
      sessions: 'id, createdAt, name, remoteSessionId, runConfigId',
      events:
        'id, sessionId, runnerId, stationId, capturedAtMs, syncedAtMs, [sessionId+runnerId], [sessionId+capturedAtMs], [sessionId+syncedAtMs]'
    });
    this.version(4).stores({
      sessions: 'id, createdAt, name, remoteSessionId, runConfigId',
      events:
        'id, sessionId, runnerId, stationId, capturedAtMs, syncedAtMs, [sessionId+runnerId], [sessionId+capturedAtMs], [sessionId+syncedAtMs]'
    });
    this.version(5).stores({
      sessions: 'id, createdAt, name, remoteSessionId, runConfigId',
      events:
        'id, sessionId, runnerId, stationId, capturedAtMs, syncedAtMs, [sessionId+runnerId], [sessionId+capturedAtMs], [sessionId+syncedAtMs]'
    });
    this.version(6).stores({
      sessions: 'id, createdAt, name, remoteSessionId, runConfigId',
      events:
        'id, sessionId, runnerId, stationId, capturedAtMs, syncedAtMs, [sessionId+runnerId], [sessionId+capturedAtMs], [sessionId+syncedAtMs]'
    });
  }
}

export const db = new RunDb();
