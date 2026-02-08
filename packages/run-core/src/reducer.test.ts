import { describe, expect, it } from 'vitest';
import { getTemplateConfig } from './templates';
import { applyEvent, createInitialRunnerState } from './reducer';
import type { RunEvent } from './types';
import { Flag } from './types';

const makeEvent = (overrides: Partial<RunEvent>): RunEvent => ({
  id: overrides.id ?? crypto.randomUUID(),
  capturedAtMs: overrides.capturedAtMs ?? 0,
  type: overrides.type ?? 'SCAN',
  stationId: overrides.stationId
});

const applyEvents = (events: RunEvent[], config: ReturnType<typeof getTemplateConfig>) => {
  return events.reduce((state, event) => applyEvent(state, event, config), createInitialRunnerState());
};

describe('reducer', () => {
  it('Template A finishes at lapsRequired on LAP_END', () => {
    const config = {
      ...getTemplateConfig('A', 3),
      finishRule: 'AT_LAPS',
      lapsRequired: 3
    };

    const events = [
      makeEvent({ id: 'lap1', capturedAtMs: 0, stationId: 'LAP_END' }),
      makeEvent({ id: 'lap2', capturedAtMs: 11000, stationId: 'LAP_END' }),
      makeEvent({ id: 'lap3', capturedAtMs: 22000, stationId: 'LAP_END' })
    ];

    const state = applyEvents(events, config);
    expect(state.lapCount).toBe(3);
    expect(state.finishedAtMs).toBe(22000);
  });

  it('debounces duplicate LAP_END scans for the same station', () => {
    const config = getTemplateConfig('A', 1);

    const events = [
      makeEvent({ id: 'lap1', capturedAtMs: 0, stationId: 'LAP_END' }),
      makeEvent({ id: 'lap2', capturedAtMs: 2000, stationId: 'LAP_END' })
    ];

    const state = applyEvents(events, config);
    expect(state.lapCount).toBe(1);
  });

  it('Template C soft enforcement increments lap and flags missing checkpoints', () => {
    const config = getTemplateConfig('C', 1);

    const events = [makeEvent({ id: 'lap1', capturedAtMs: 0, stationId: 'LAP_END' })];

    const state = applyEvents(events, config);
    expect(state.lapCount).toBe(1);
    expect(state.flags).toContain(Flag.MISSING_CHECKPOINT);
  });

  it('Template E requires min laps before finish scan', () => {
    const config = getTemplateConfig('E', 2);

    const events = [
      makeEvent({ id: 'finish-early', capturedAtMs: 0, stationId: 'FINISH' }),
      makeEvent({ id: 'lap1', capturedAtMs: 11000, stationId: 'LAP_END' }),
      makeEvent({ id: 'lap2', capturedAtMs: 22000, stationId: 'LAP_END' }),
      makeEvent({ id: 'finish-ok', capturedAtMs: 33000, stationId: 'FINISH' })
    ];

    const state = applyEvents(events, config);
    expect(state.finishedAtMs).toBe(33000);
    expect(state.flags).toContain(Flag.EARLY_FINISH);
  });
});
