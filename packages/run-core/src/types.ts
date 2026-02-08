export type TemplateKey = 'A' | 'B' | 'C' | 'D' | 'E';

export type StationId = 'START' | 'A' | 'B' | 'LAP_START' | 'LAP_END' | 'FINISH';

export type EventType = 'SCAN' | 'START_SET' | 'UNDO' | 'CLEAR' | 'CLEAR_ALL';

export type RunEvent = {
  id: string;
  capturedAtMs: number;
  type: EventType;
  stationId?: StationId;
  targetId?: string;
};

export type StartRule = 'RUNNER_START' | 'GLOBAL_START';

export type FinishRule = 'AT_LAPS' | 'FINISH_SCAN_WITH_MIN_LAPS';

export enum Flag {
  FINISH_SCAN_WITH_MIN_LAPS = 'FINISH_SCAN_WITH_MIN_LAPS',
  LAP_START_REQUIRED = 'LAP_START_REQUIRED',
  LAP_END_REQUIRED = 'LAP_END_REQUIRED',
  SOFT_ENFORCEMENT = 'SOFT_ENFORCEMENT',
  STRICT_ENFORCEMENT = 'STRICT_ENFORCEMENT',
  MISSING_CHECKPOINT = 'MISSING_CHECKPOINT',
  MISSING_CHECKPOINT_STRICT = 'MISSING_CHECKPOINT_STRICT',
  EARLY_FINISH = 'EARLY_FINISH'
}

export type RunTemplateConfig = {
  templateKey: TemplateKey;
  stationOrder: StationId[];
  minScanGapMsByStation: Partial<Record<StationId, number>>;
  flags: Flag[];
  minLapsRequired?: number;
  lapsRequired?: number;
  startRule?: StartRule;
  finishRule?: FinishRule;
  globalStartMs?: number;
};

export type RunnerDerivedState = {
  startedAtMs?: number;
  finishedAtMs?: number;
  lapCount: number;
  flags: Flag[];
  lastSeenMsAtStation: Partial<Record<StationId, number>>;
  checkpointsSeen: Partial<Record<StationId, boolean>>;
};
