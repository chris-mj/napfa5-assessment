import { describe, expect, it } from 'vitest';
import { getTemplateConfig, DEFAULT_GAP_FINISH_MS, DEFAULT_GAP_NORMAL_MS } from '../templates';
import { Flag } from '../types';

describe('getTemplateConfig', () => {
  it('applies default gaps for normal and finish stations', () => {
    const config = getTemplateConfig('A', 0);
    expect(config.minScanGapMsByStation.START).toBe(DEFAULT_GAP_NORMAL_MS);
    expect(config.minScanGapMsByStation.A).toBe(DEFAULT_GAP_NORMAL_MS);
    expect(config.minScanGapMsByStation.B).toBe(DEFAULT_GAP_NORMAL_MS);
    expect(config.minScanGapMsByStation.LAP_START).toBe(DEFAULT_GAP_NORMAL_MS);
    expect(config.minScanGapMsByStation.LAP_END).toBe(DEFAULT_GAP_NORMAL_MS);
    expect(config.minScanGapMsByStation.FINISH).toBe(DEFAULT_GAP_FINISH_MS);
  });

  it('sets Template A without enforcement flags', () => {
    const config = getTemplateConfig('A', 0);
    expect(config.flags).toEqual([]);
    expect(config.stationOrder).toEqual(['START', 'A', 'B', 'FINISH']);
  });

  it('sets Template D with lap start/end flags and soft enforcement', () => {
    const config = getTemplateConfig('D', 0);
    expect(config.flags).toEqual([Flag.SOFT_ENFORCEMENT, Flag.LAP_START_REQUIRED, Flag.LAP_END_REQUIRED]);
    expect(config.stationOrder).toEqual(['START', 'A', 'B', 'LAP_START', 'LAP_END', 'FINISH']);
  });

  it('sets Template E finish rule with min laps', () => {
    const config = getTemplateConfig('E', 4);
    expect(config.flags).toEqual([
      Flag.SOFT_ENFORCEMENT,
      Flag.LAP_START_REQUIRED,
      Flag.LAP_END_REQUIRED,
      Flag.FINISH_SCAN_WITH_MIN_LAPS
    ]);
    expect(config.minLapsRequired).toBe(4);
    expect(config.finishRule).toBe('FINISH_SCAN_WITH_MIN_LAPS');
  });
});
