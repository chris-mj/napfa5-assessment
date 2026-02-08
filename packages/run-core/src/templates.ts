import type { RunTemplateConfig, StationId, TemplateKey } from './types';
import { Flag } from './types';

export const DEFAULT_GAP_NORMAL_MS = 10000;
export const DEFAULT_GAP_FINISH_MS = 5000;

const NORMAL_STATIONS: StationId[] = ['START', 'A', 'B', 'LAP_START', 'LAP_END'];

function buildGapMap(): RunTemplateConfig['minScanGapMsByStation'] {
  const gaps: Partial<Record<StationId, number>> = {
    FINISH: DEFAULT_GAP_FINISH_MS
  };

  for (const station of NORMAL_STATIONS) {
    gaps[station] = DEFAULT_GAP_NORMAL_MS;
  }

  return gaps;
}

function baseConfig(templateKey: TemplateKey, stationOrder: StationId[]): RunTemplateConfig {
  return {
    templateKey,
    stationOrder,
    minScanGapMsByStation: buildGapMap(),
    flags: [],
    startRule: 'RUNNER_START'
  };
}

export function getTemplateConfig(templateKey: TemplateKey, lapsRequired: number): RunTemplateConfig {
  switch (templateKey) {
    case 'A': {
      return baseConfig('A', ['LAP_END']);
    }
    case 'B': {
      return {
        ...baseConfig('B', ['A', 'LAP_END']),
        flags: [Flag.SOFT_ENFORCEMENT]
      };
    }
    case 'C': {
      return {
        ...baseConfig('C', ['A', 'B', 'LAP_END']),
        flags: [Flag.SOFT_ENFORCEMENT]
      };
    }
    case 'D': {
      return {
        ...baseConfig('D', ['START', 'LAP_END']),
        flags: [Flag.SOFT_ENFORCEMENT]
      };
    }
    case 'E': {
      return {
        ...baseConfig('E', ['LAP_END', 'FINISH']),
        flags: [
          Flag.SOFT_ENFORCEMENT,
          Flag.FINISH_SCAN_WITH_MIN_LAPS
        ],
        minLapsRequired: lapsRequired,
        finishRule: 'FINISH_SCAN_WITH_MIN_LAPS'
      };
    }
    default: {
      return baseConfig('A', ['LAP_END']);
    }
  }
}
