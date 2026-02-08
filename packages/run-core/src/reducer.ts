import type { RunEvent, RunTemplateConfig, RunnerDerivedState, StationId } from './types';
import { Flag } from './types';

const NON_CHECKPOINTS: StationId[] = ['START', 'LAP_START', 'LAP_END', 'FINISH'];

function isCheckpointStation(stationId: StationId, config: RunTemplateConfig): boolean {
  if (NON_CHECKPOINTS.includes(stationId)) return false;
  return config.stationOrder.includes(stationId);
}

function hasSoftEnforcement(config: RunTemplateConfig): boolean {
  return config.flags.includes(Flag.SOFT_ENFORCEMENT);
}

function hasStrictEnforcement(config: RunTemplateConfig): boolean {
  return config.flags.includes(Flag.STRICT_ENFORCEMENT);
}

function addFlag(state: RunnerDerivedState, flag: Flag): RunnerDerivedState {
  if (state.flags.includes(flag)) return state;
  return { ...state, flags: [...state.flags, flag] };
}

function resetCheckpoints(state: RunnerDerivedState, config: RunTemplateConfig): RunnerDerivedState {
  const next: RunnerDerivedState = { ...state, checkpointsSeen: { ...state.checkpointsSeen } };
  for (const stationId of config.stationOrder) {
    if (isCheckpointStation(stationId, config)) {
      next.checkpointsSeen[stationId] = false;
    }
  }
  return next;
}

function markCheckpoint(state: RunnerDerivedState, stationId: StationId): RunnerDerivedState {
  return {
    ...state,
    checkpointsSeen: {
      ...state.checkpointsSeen,
      [stationId]: true
    }
  };
}

function missingCheckpoints(state: RunnerDerivedState, config: RunTemplateConfig): boolean {
  const checkpoints = config.stationOrder.filter((stationId) => isCheckpointStation(stationId, config));
  if (!checkpoints.length) return false;
  return checkpoints.some((stationId) => !state.checkpointsSeen[stationId]);
}

export function createInitialRunnerState(): RunnerDerivedState {
  return {
    startedAtMs: undefined,
    finishedAtMs: undefined,
    lapCount: 0,
    flags: [],
    lastSeenMsAtStation: {},
    checkpointsSeen: {}
  };
}

export function applyEvent(
  state: RunnerDerivedState,
  event: RunEvent,
  config: RunTemplateConfig
): RunnerDerivedState {
  const stationId = event.stationId;
  const capturedAtMs = event.capturedAtMs;

  if (event.type === 'UNDO') {
    return state;
  }

  if (event.type === 'CLEAR' || event.type === 'CLEAR_ALL') {
    const reset = createInitialRunnerState();
    if (config.startRule === 'GLOBAL_START' && config.globalStartMs != null) {
      return { ...reset, startedAtMs: config.globalStartMs };
    }
    return reset;
  }

  let nextState: RunnerDerivedState = { ...state };
  let startedNow = false;

  if (config.startRule === 'GLOBAL_START') {
    // v0: GLOBAL_START uses config.globalStartMs; no per-event START_SET handling.
    if (nextState.startedAtMs == null && config.globalStartMs != null) {
      nextState.startedAtMs = config.globalStartMs;
    }
  }

  if (!stationId) return nextState;

  const lastSeen = nextState.lastSeenMsAtStation[stationId];
  const gapMs = config.minScanGapMsByStation[stationId] ?? 0;
  if (lastSeen != null && capturedAtMs - lastSeen < gapMs) {
    return nextState;
  }

  nextState = {
    ...nextState,
    lastSeenMsAtStation: {
      ...nextState.lastSeenMsAtStation,
      [stationId]: capturedAtMs
    }
  };

  const usesLapStart = config.stationOrder.includes('LAP_START');
  if (config.startRule !== 'GLOBAL_START' && nextState.startedAtMs == null) {
    // RUNNER_START: start on LAP_START if present; otherwise start on LAP_END for single-scan setups.
    if (stationId === 'LAP_START' || (!usesLapStart && stationId === 'LAP_END')) {
      nextState.startedAtMs = capturedAtMs;
      startedNow = true;
    }
  }

  if (event.type !== 'SCAN' && event.type !== 'START_SET') {
    return nextState;
  }

  if (event.type === 'START_SET' && stationId === 'START') {
    nextState.startedAtMs = capturedAtMs;
    return nextState;
  }

  if (isCheckpointStation(stationId, config)) {
    nextState = markCheckpoint(nextState, stationId);
    return nextState;
  }

  if (stationId === 'LAP_END') {
    if (!usesLapStart && startedNow) {
      // First scan starts the run; do not count a lap yet.
      return resetCheckpoints(nextState, config);
    }
    const missing = missingCheckpoints(nextState, config);
    if (missing) {
      if (hasStrictEnforcement(config)) {
        return addFlag(nextState, Flag.MISSING_CHECKPOINT_STRICT);
      }
      if (hasSoftEnforcement(config)) {
        nextState = addFlag(nextState, Flag.MISSING_CHECKPOINT);
      }
    }

    nextState = {
      ...nextState,
      lapCount: nextState.lapCount + 1
    };

    if (config.finishRule === 'AT_LAPS' && config.lapsRequired != null) {
      if (nextState.lapCount >= config.lapsRequired) {
        nextState.finishedAtMs = capturedAtMs;
      }
    }

    return resetCheckpoints(nextState, config);
  }

  if (stationId === 'FINISH') {
    if (config.finishRule === 'FINISH_SCAN_WITH_MIN_LAPS') {
      const required = config.minLapsRequired ?? 0;
      if (nextState.lapCount < required) {
        return addFlag(nextState, Flag.EARLY_FINISH);
      }
    }

    return {
      ...nextState,
      finishedAtMs: capturedAtMs
    };
  }

  return nextState;
}
