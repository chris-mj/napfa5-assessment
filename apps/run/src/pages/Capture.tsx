import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { applyEvent, createInitialRunnerState, getTemplateConfig, type RunEvent, Flag } from '@napfa5/run-core';
import {
  addEvent,
  clearSessionEvents,
  exportCsv,
  getSession,
  listEventsForSession,
  upsertRemoteEvents,
  updateSessionGlobalEnd,
  updateSessionGlobalPaused,
  updateSessionLocalIdRules,
  updateSessionGlobalStart
} from '../db/repo';
import type { EventRow, RunnerIdRules, SessionRow } from '../db/db';
import { syncEvents } from '../lib/sync';
import { postValidateToken } from '../lib/runApi';
import { fetchRunEvents } from '../lib/runApi';
import { runApiUrl } from '../lib/runApi';
import { fetchRunHealth } from '../lib/runApi';

const GLOBAL_START_TEMPLATES = new Set(['A', 'B', 'C', 'D', 'E']);
const SYNC_INTERVAL_MS = 5000;
const STATIONS_BY_TEMPLATE: Record<string, string[]> = {
  A: ['LAP_END'],
  B: ['LAP_END', 'A'],
  C: ['LAP_END', 'A', 'B'],
  D: ['START', 'LAP_END'],
  E: ['LAP_END', 'FINISH']
};

type Enforcement = 'OFF' | 'SOFT' | 'STRICT';

type RunnerSummary = {
  runnerId: string;
  lapCount: number;
  finished: boolean;
  flags: Flag[];
  finishedAtMs?: number;
  lastSeenAtMs?: number;
};

type SyncLogItem = {
  atMs: number;
  attempted: number;
  synced: number;
  failed: number;
  pending: number;
  error?: string;
};

type OverrideForm = {
  runnerIdFormat: 'numeric' | 'classIndex' | 'structured4';
  runnerIdMin: string;
  runnerIdMax: string;
  classPrefixes: string;
  classIndexMin: string;
  classIndexMax: string;
  structuredLevelMin: string;
  structuredLevelMax: string;
  structuredClassMin: string;
  structuredClassMax: string;
  structuredIndexMin: string;
  structuredIndexMax: string;
};

function stationStorageKey(sessionId: string) {
  return `napfa5-run:station:${sessionId}`;
}

function stationLabel(templateKey: string | undefined, stationId: string) {
  if (stationId === 'LAP_END') {
    return 'Lap Start / End Scan';
  }
  if (templateKey === 'B' && stationId === 'A') return 'Checkpoint A Scan';
  if (templateKey === 'C' && stationId === 'A') return 'Checkpoint A Scan';
  if (templateKey === 'C' && stationId === 'B') return 'Checkpoint B Scan';
  return stationId;
}

function mapDbEventToRunEvent(event: EventRow): RunEvent {
  const type = event.type === 'PASS' ? 'SCAN' : event.type;
  return {
    id: event.id,
    capturedAtMs: event.capturedAtMs,
    type: type as RunEvent['type'],
    stationId: event.stationId as RunEvent['stationId'],
    targetId: event.refEventId
  };
}

function applyEnforcementFlags(
  config: ReturnType<typeof getTemplateConfig>,
  enforcement?: Enforcement
) {
  if (!enforcement) return config;
  const next = { ...config, flags: [...config.flags] };
  const softIndex = next.flags.indexOf(Flag.SOFT_ENFORCEMENT);
  const strictIndex = next.flags.indexOf(Flag.STRICT_ENFORCEMENT);

  if (enforcement === 'OFF') {
    if (softIndex >= 0) next.flags.splice(softIndex, 1);
    if (strictIndex >= 0) next.flags.splice(strictIndex, 1);
    return next;
  }

  if (enforcement === 'SOFT') {
    if (strictIndex >= 0) next.flags.splice(strictIndex, 1);
    if (softIndex < 0) next.flags.push(Flag.SOFT_ENFORCEMENT);
    return next;
  }

  if (softIndex >= 0) next.flags.splice(softIndex, 1);
  if (strictIndex < 0) next.flags.push(Flag.STRICT_ENFORCEMENT);
  return next;
}

function sortSummaries(items: RunnerSummary[]) {
  return [...items].sort((a, b) => {
    return a.runnerId.localeCompare(b.runnerId, undefined, { numeric: true, sensitivity: 'base' });
  });
}

function normalizeRunnerIdWithRules(value: string, session: SessionRow | null) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return { normalized: '', error: '' };

  const format = session?.runnerIdFormat || 'numeric';
  if (format === 'numeric') {
    if (!/^\d+$/.test(trimmed)) return { normalized: '', error: 'Invalid ID. Numbers only.' };
    const numeric = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(numeric)) return { normalized: '', error: 'Invalid ID.' };
    const min = Number.isFinite(session?.runnerIdMin as number) ? Number(session?.runnerIdMin) : null;
    const max = Number.isFinite(session?.runnerIdMax as number) ? Number(session?.runnerIdMax) : null;
    if (min != null && numeric < min) return { normalized: '', error: `ID must be at least ${min}.` };
    if (max != null && numeric > max) return { normalized: '', error: `ID must be ${max} or below.` };
    return { normalized: String(numeric), error: '' };
  }

  if (format === 'classIndex') {
    const m = trimmed.match(/^([a-zA-Z])(\d{1,3})$/);
    if (!m) return { normalized: '', error: 'Invalid ID. Use class format like A01.' };
    const prefix = m[1].toUpperCase();
    const index = Number.parseInt(m[2], 10);
    if (!Number.isFinite(index)) return { normalized: '', error: 'Invalid class index.' };
    const allowedPrefixes = Array.isArray(session?.classPrefixes) && session?.classPrefixes.length
      ? session.classPrefixes.map((p) => String(p || '').trim().toUpperCase()).filter(Boolean)
      : null;
    if (allowedPrefixes && !allowedPrefixes.includes(prefix)) {
      return { normalized: '', error: `Class must be one of: ${allowedPrefixes.join(', ')}.` };
    }
    const min = Number.isFinite(session?.classIndexMin as number) ? Number(session?.classIndexMin) : null;
    const max = Number.isFinite(session?.classIndexMax as number) ? Number(session?.classIndexMax) : null;
    if (min != null && index < min) return { normalized: '', error: `Index must be at least ${String(min).padStart(2, '0')}.` };
    if (max != null && index > max) return { normalized: '', error: `Index must be ${String(max).padStart(2, '0')} or below.` };
    const width = Math.max(2, String(max ?? index).length);
    return { normalized: `${prefix}${String(index).padStart(width, '0')}`, error: '' };
  }

  if (format === 'structured4') {
    if (!/^\d{4}$/.test(trimmed)) return { normalized: '', error: 'Invalid ID. Use 4 digits (LCII), e.g. 1101.' };
    const level = Number.parseInt(trimmed.slice(0, 1), 10);
    const cls = Number.parseInt(trimmed.slice(1, 2), 10);
    const index = Number.parseInt(trimmed.slice(2, 4), 10);
    const levelMin = Number.isFinite(session?.structuredLevelMin as number) ? Number(session?.structuredLevelMin) : 0;
    const levelMax = Number.isFinite(session?.structuredLevelMax as number) ? Number(session?.structuredLevelMax) : 9;
    const classMin = Number.isFinite(session?.structuredClassMin as number) ? Number(session?.structuredClassMin) : 0;
    const classMax = Number.isFinite(session?.structuredClassMax as number) ? Number(session?.structuredClassMax) : 9;
    const indexMin = Number.isFinite(session?.structuredIndexMin as number) ? Number(session?.structuredIndexMin) : 1;
    const indexMax = Number.isFinite(session?.structuredIndexMax as number) ? Number(session?.structuredIndexMax) : 99;
    if (level < levelMin || level > levelMax) return { normalized: '', error: `Level must be ${levelMin}-${levelMax}.` };
    if (cls < classMin || cls > classMax) return { normalized: '', error: `Class must be ${classMin}-${classMax}.` };
    if (index < indexMin || index > indexMax) return { normalized: '', error: `Index must be ${String(indexMin).padStart(2, '0')}-${String(indexMax).padStart(2, '0')}.` };
    return { normalized: `${level}${cls}${String(index).padStart(2, '0')}`, error: '' };
  }

  return { normalized: '', error: 'Unsupported runner ID format.' };
}

function resolveRunnerRuleSession(session: SessionRow | null): SessionRow | null {
  if (!session?.localIdRulesOverride) return session;
  return {
    ...session,
    runnerIdFormat: session.localIdRulesOverride.runnerIdFormat || session.runnerIdFormat,
    runnerIdMin: session.localIdRulesOverride.runnerIdMin,
    runnerIdMax: session.localIdRulesOverride.runnerIdMax,
    classPrefixes: session.localIdRulesOverride.classPrefixes,
    classIndexMin: session.localIdRulesOverride.classIndexMin,
    classIndexMax: session.localIdRulesOverride.classIndexMax,
    structuredLevelMin: session.localIdRulesOverride.structuredLevelMin,
    structuredLevelMax: session.localIdRulesOverride.structuredLevelMax,
    structuredClassMin: session.localIdRulesOverride.structuredClassMin,
    structuredClassMax: session.localIdRulesOverride.structuredClassMax,
    structuredIndexMin: session.localIdRulesOverride.structuredIndexMin,
    structuredIndexMax: session.localIdRulesOverride.structuredIndexMax
  };
}

function toOverrideForm(session: SessionRow | null): OverrideForm {
  const base = resolveRunnerRuleSession(session);
  return {
    runnerIdFormat: (base?.runnerIdFormat || 'numeric') as OverrideForm['runnerIdFormat'],
    runnerIdMin: base?.runnerIdMin == null ? '' : String(base.runnerIdMin),
    runnerIdMax: base?.runnerIdMax == null ? '' : String(base.runnerIdMax),
    classPrefixes: Array.isArray(base?.classPrefixes) ? base.classPrefixes.join(',') : '',
    classIndexMin: base?.classIndexMin == null ? '' : String(base.classIndexMin),
    classIndexMax: base?.classIndexMax == null ? '' : String(base.classIndexMax),
    structuredLevelMin: base?.structuredLevelMin == null ? '' : String(base.structuredLevelMin),
    structuredLevelMax: base?.structuredLevelMax == null ? '' : String(base.structuredLevelMax),
    structuredClassMin: base?.structuredClassMin == null ? '' : String(base.structuredClassMin),
    structuredClassMax: base?.structuredClassMax == null ? '' : String(base.structuredClassMax),
    structuredIndexMin: base?.structuredIndexMin == null ? '' : String(base.structuredIndexMin),
    structuredIndexMax: base?.structuredIndexMax == null ? '' : String(base.structuredIndexMax)
  };
}

function parseOptInt(value: string) {
  const v = String(value || '').trim();
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function formToOverrideRules(form: OverrideForm): RunnerIdRules {
  const format = form.runnerIdFormat;
  if (format === 'numeric') {
    return {
      runnerIdFormat: 'numeric',
      runnerIdMin: parseOptInt(form.runnerIdMin),
      runnerIdMax: parseOptInt(form.runnerIdMax)
    };
  }
  if (format === 'classIndex') {
    return {
      runnerIdFormat: 'classIndex',
      classPrefixes: String(form.classPrefixes || '')
        .split(',')
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
      classIndexMin: parseOptInt(form.classIndexMin),
      classIndexMax: parseOptInt(form.classIndexMax)
    };
  }
  return {
    runnerIdFormat: 'structured4',
    structuredLevelMin: parseOptInt(form.structuredLevelMin),
    structuredLevelMax: parseOptInt(form.structuredLevelMax),
    structuredClassMin: parseOptInt(form.structuredClassMin),
    structuredClassMax: parseOptInt(form.structuredClassMax),
    structuredIndexMin: parseOptInt(form.structuredIndexMin),
    structuredIndexMax: parseOptInt(form.structuredIndexMax)
  };
}

function displayEventType(type: string) {
  if (type === 'PASS') return '';
  if (type === 'START_SET') return 'START';
  if (type === 'RESUME_SET') return 'RESUME';
  if (type === 'PAUSE_SET') return 'PAUSE';
  if (type === 'END_SET') return 'END';
  if (type === 'CLEAR_ALL') return 'RESET';
  return type;
}

export default function CaptureScreen() {
  const [params] = useSearchParams();
  const sessionId = params.get('sessionId') ?? '';
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionRow | null>(null);
  const [runnerId, setRunnerId] = useState('');
  const [recentEvents, setRecentEvents] = useState<EventRow[]>([]);
  const [recentTypeById, setRecentTypeById] = useState<Record<string, string>>({});
  const [runnerSummaries, setRunnerSummaries] = useState<RunnerSummary[]>([]);
  const [toast, setToast] = useState('');
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [tokenError, setTokenError] = useState('');
  const [lastPullAtMs, setLastPullAtMs] = useState<number | null>(null);
  const [lastPushAtMs, setLastPushAtMs] = useState<number | null>(null);
  const [lastPullError, setLastPullError] = useState('');
  const [lastPushError, setLastPushError] = useState('');
  const [syncPending, setSyncPending] = useState(0);
  const [lastSyncStats, setLastSyncStats] = useState<{ attempted: number; synced: number; failed: number } | null>(null);
  const [syncLog, setSyncLog] = useState<SyncLogItem[]>([]);
  const [healthStatus, setHealthStatus] = useState<'idle' | 'checking' | 'ok' | 'warn' | 'error'>('idle');
  const [healthError, setHealthError] = useState('');
  const [healthCheckedAtMs, setHealthCheckedAtMs] = useState<number | null>(null);
  const [healthSummary, setHealthSummary] = useState('');
  const [showTechDetails, setShowTechDetails] = useState(false);
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(() => toOverrideForm(null));
  const [clockMs, setClockMs] = useState(Date.now());
  const [projectorOpen, setProjectorOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(true);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastClearAllRef = useRef<number>(0);
  const remoteSinceRef = useRef<number>(0);
  const syncInFlightRef = useRef(false);
  const projectorRef = useRef<Window | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const filterUndoneEvents = (events: EventRow[]) => {
    const undone = new Set(
      events
        .filter((event) => event.type === 'UNDO' && event.refEventId)
        .map((event) => event.refEventId as string)
    );
    return events.filter((event) => !undone.has(event.id) && event.type !== 'UNDO');
  };

  const stationId = useMemo(() => {
    if (!sessionId) return '';
    return localStorage.getItem(stationStorageKey(sessionId)) ?? '';
  }, [sessionId]);

  const templateConfig = useMemo(() => {
    if (!session) return null;
    const config = getTemplateConfig(session.templateKey as any, session.lapsRequired);
    const withEnforcement = applyEnforcementFlags(config, session.enforcement as Enforcement | undefined);
    if (session.scanGapMs) {
      const gapByStation = { ...withEnforcement.minScanGapMsByStation };
      Object.keys(gapByStation).forEach((key) => {
        if (key !== 'FINISH') gapByStation[key as any] = session.scanGapMs;
      });
      return { ...withEnforcement, minScanGapMsByStation: gapByStation };
    }
    return withEnforcement;
  }, [session]);

  const effectiveRuleSession = useMemo(() => resolveRunnerRuleSession(session), [session]);

  const runnerFormat = effectiveRuleSession?.runnerIdFormat ?? 'numeric';
  const runnerFormatNote = useMemo(() => {
    if (runnerFormat === 'numeric') {
      const min = effectiveRuleSession?.runnerIdMin;
      const max = effectiveRuleSession?.runnerIdMax;
      if (Number.isFinite(min as number) || Number.isFinite(max as number)) {
        return `Numbers only (${min ?? '-'}-${max ?? '-'})`;
      }
      return 'Numbers only';
    }
    if (runnerFormat === 'classIndex') {
      const prefixes = Array.isArray(effectiveRuleSession?.classPrefixes) && effectiveRuleSession.classPrefixes.length
        ? effectiveRuleSession.classPrefixes.join('/')
        : 'A-Z';
      const min = effectiveRuleSession?.classIndexMin;
      const max = effectiveRuleSession?.classIndexMax;
      return `Class + index (${prefixes}${Number.isFinite(min as number) || Number.isFinite(max as number) ? ` ${String(min ?? 1).padStart(2, '0')}-${String(max ?? 99).padStart(2, '0')}` : ''})`;
    }
    return `4-digit LCII (L ${effectiveRuleSession?.structuredLevelMin ?? 0}-${effectiveRuleSession?.structuredLevelMax ?? 9}, C ${effectiveRuleSession?.structuredClassMin ?? 0}-${effectiveRuleSession?.structuredClassMax ?? 9}, II ${String(effectiveRuleSession?.structuredIndexMin ?? 1).padStart(2, '0')}-${String(effectiveRuleSession?.structuredIndexMax ?? 99).padStart(2, '0')})`;
  }, [
    runnerFormat,
    effectiveRuleSession?.runnerIdMin,
    effectiveRuleSession?.runnerIdMax,
    effectiveRuleSession?.classPrefixes,
    effectiveRuleSession?.classIndexMin,
    effectiveRuleSession?.classIndexMax,
    effectiveRuleSession?.structuredLevelMin,
    effectiveRuleSession?.structuredLevelMax,
    effectiveRuleSession?.structuredClassMin,
    effectiveRuleSession?.structuredClassMax,
    effectiveRuleSession?.structuredIndexMin,
    effectiveRuleSession?.structuredIndexMax
  ]);

  const normalizedTemplateKey = String(session?.templateKey || '').toUpperCase();
  const templateStations = STATIONS_BY_TEMPLATE[normalizedTemplateKey] || ['LAP_END'];
  const showGlobalStart = Boolean(session) && GLOBAL_START_TEMPLATES.has(normalizedTemplateKey);
  const startStationId = templateStations.includes('START') ? 'START' : 'LAP_END';
  const hasStartStation = Boolean(showGlobalStart);
  const isControlStation = stationId === 'START' || stationId === 'LAP_END' || stationId === 'FINISH';
  const runStarted = Boolean(session?.globalStartMs);
  const runPaused = Boolean(session?.globalPaused);
  const runEnded = Boolean(session?.globalEndMs);
  const syncIsStale = session?.pairingToken && session?.remoteSessionId
    ? (!lastPullAtMs || !lastPushAtMs || Date.now() - lastPullAtMs > 15000 || Date.now() - lastPushAtMs > 15000)
    : false;
  const hasSyncIssue = Boolean(lastPullError || lastPushError || tokenStatus === 'invalid' || healthStatus === 'error');
  const connectionLabel = !session?.pairingToken || !session?.remoteSessionId
    ? 'Offline (not linked)'
    : hasSyncIssue
      ? 'Needs attention'
      : syncIsStale
        ? 'Delayed'
        : 'Connected';
  const connectionTone = hasSyncIssue
    ? 'danger'
    : (!session?.pairingToken || !session?.remoteSessionId || syncIsStale)
      ? 'warn'
      : 'ok';


  const buildSummaries = (events: EventRow[]) => {
    if (!templateConfig) return [];
    const clearAllEvents = events
      .filter((event) => event.type === 'CLEAR_ALL')
      .sort((a, b) => a.capturedAtMs - b.capturedAtMs);
    if (clearAllEvents.length) {
      const latest = clearAllEvents[clearAllEvents.length - 1].capturedAtMs;
      if (latest > lastClearAllRef.current) {
        lastClearAllRef.current = latest;
      }
    }

    const byRunner = new Map<string, EventRow[]>();
    for (const event of filterUndoneEvents(events)) {
      if (!['PASS', 'UNDO', 'CLEAR'].includes(event.type)) continue;
      if (!event.runnerId) continue;
      if (!byRunner.has(event.runnerId)) byRunner.set(event.runnerId, []);
      byRunner.get(event.runnerId)!.push(event);
    }

    const summaries: RunnerSummary[] = [];
    for (const [key, items] of byRunner.entries()) {
      const combined = [...clearAllEvents, ...items].sort((a, b) => a.capturedAtMs - b.capturedAtMs);
      let state = createInitialRunnerState();
      for (const entry of combined) {
        state = applyEvent(state, mapDbEventToRunEvent(entry), templateConfig);
      }
      const lastSeenAtMs = combined.length ? combined[combined.length - 1].capturedAtMs : undefined;
      summaries.push({
        runnerId: key,
        lapCount: state.lapCount,
        finished: Boolean(state.finishedAtMs),
        flags: state.flags,
        finishedAtMs: state.finishedAtMs,
        lastSeenAtMs
      });
    }

    return sortSummaries(summaries);
  };

  const buildLocalRecent = (events: EventRow[]) => {
    if (!stationId) return [];
    return filterUndoneEvents(
      [...events].filter((event) => event.stationId === stationId && event.source !== 'remote')
    )
      .sort((a, b) => b.capturedAtMs - a.capturedAtMs)
      .slice(0, 20);
  };

  const buildRecentTypeMap = (events: EventRow[]) => {
    const map: Record<string, string> = {};
    // First PASS at start-station for a runner (after CLEAR_ALL) is treated as START in UI.
    const chronological = filterUndoneEvents(
      [...events].filter((event) => event.source !== 'remote')
    ).sort((a, b) => a.capturedAtMs - b.capturedAtMs);
    const startedRunners = new Set<string>();
    for (const event of chronological) {
      if (event.type === 'CLEAR_ALL') {
        startedRunners.clear();
        map[event.id] = 'RESET';
        continue;
      }
      if (event.type === 'START_SET') {
        map[event.id] = 'START';
        continue;
      }
      if (event.type === 'PASS' && event.stationId === startStationId) {
        const rid = String(event.runnerId || '');
        if (rid && !startedRunners.has(rid)) {
          startedRunners.add(rid);
          map[event.id] = 'START';
        }
      }
    }
    return map;
  };

  const hydrateFromEvents = (events: EventRow[]) => {
    setRecentEvents(buildLocalRecent(events));
    setRecentTypeById(buildRecentTypeMap(events));
    setRunnerSummaries(buildSummaries(events));
  };

  useEffect(() => {
    if (!sessionId) return;
    getSession(sessionId).then((value) => setSession(value));
  }, [sessionId]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setOverrideForm(toOverrideForm(session));
  }, [session]);

  useEffect(() => {
    if (!sessionId || !session?.pairingToken || !session?.remoteSessionId) return;
    let active = true;
    const verify = async () => {
      const existing = await listEventsForSession(sessionId);
      if (!active || existing.length > 0) return;
      setTokenStatus('checking');
      setTokenError('');
      try {
        const { response, body } = await postValidateToken(session.pairingToken);
        if (!response.ok) {
          throw new Error(body?.error || 'Token validation failed.');
        }
        if (active) setTokenStatus('valid');
      } catch (err: any) {
        if (!active) return;
        setTokenStatus('invalid');
        setTokenError(err.message || 'Token validation failed.');
      }
    };
    verify();
    return () => {
      active = false;
    };
  }, [sessionId, session?.pairingToken, session?.remoteSessionId]);

  useEffect(() => {
    if (!session?.pairingToken) return;
    let active = true;
    const check = async () => {
      if (!active) return;
      setHealthStatus('checking');
      try {
        const result = await fetchRunHealth({
          pairingToken: session.pairingToken,
          sessionId: session.remoteSessionId,
          runConfigId: session.runConfigId ?? session.id
        });
        if (!active) return;
        const warn = !result.matchesSession || !result.matchesRunConfig;
        setHealthStatus(warn ? 'warn' : 'ok');
        setHealthError('');
        setHealthCheckedAtMs(Date.now());
        setHealthSummary(
          `${result.name || 'run-config'} (${result.runConfigId.slice(0, 8)})` +
          `${warn ? ' - linked ID mismatch' : ''}`
        );
      } catch (err: any) {
        if (!active) return;
        setHealthStatus('error');
        setHealthError(err?.message || 'Heartbeat failed.');
        setHealthCheckedAtMs(Date.now());
        setHealthSummary('');
      }
    };
    check();
    const timer = setInterval(check, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session?.pairingToken, session?.remoteSessionId, session?.runConfigId, session?.id]);

  useEffect(() => {
    if (!sessionId || !session?.pairingToken || !session?.remoteSessionId) return;
    let active = true;
    const poll = async () => {
      if (!active) return;
      try {
        const pulled = await fetchRunEvents({
          pairingToken: session.pairingToken,
          sinceMs: remoteSinceRef.current || undefined
        });
        const events = pulled.events || [];
        if (events.length) {
          let latestStartSet = 0;
          let latestResumeSet = 0;
          let latestPauseSet = 0;
          let latestEndSet = 0;
          let latestClearAll = 0;
          for (const event of events) {
            if (event.type === 'START_SET' && event.capturedAtMs) {
              latestStartSet = Math.max(latestStartSet, event.capturedAtMs);
            }
            if (event.type === 'RESUME_SET' && event.capturedAtMs) {
              latestResumeSet = Math.max(latestResumeSet, event.capturedAtMs);
            }
            if (event.type === 'PAUSE_SET' && event.capturedAtMs) {
              latestPauseSet = Math.max(latestPauseSet, event.capturedAtMs);
            }
            if (event.type === 'END_SET' && event.capturedAtMs) {
              latestEndSet = Math.max(latestEndSet, event.capturedAtMs);
            }
            if (event.type === 'CLEAR_ALL' && event.capturedAtMs) {
              latestClearAll = Math.max(latestClearAll, event.capturedAtMs);
            }
            if (event.capturedAtMs && event.capturedAtMs > remoteSinceRef.current) {
              remoteSinceRef.current = event.capturedAtMs;
            }
          }

          const latestStartOrResume = Math.max(latestStartSet, latestResumeSet);
          const latestControl = Math.max(latestStartSet, latestResumeSet, latestPauseSet, latestEndSet, latestClearAll);

          if (latestControl === latestClearAll && latestClearAll > 0) {
            await clearSessionEvents(sessionId);
            await updateSessionGlobalStart(sessionId, undefined);
            await updateSessionGlobalPaused(sessionId, false);
            await updateSessionGlobalEnd(sessionId, undefined);
            if (active) {
              setSession((prev) => (prev ? { ...prev, globalStartMs: undefined, globalPaused: false, globalEndMs: undefined } : prev));
            }
          } else if (latestControl > 0) {
            const paused = latestPauseSet > latestStartOrResume && latestPauseSet > latestEndSet;
            const ended = latestEndSet > latestStartOrResume && latestEndSet >= latestPauseSet;
            if (latestStartOrResume > 0) {
              await updateSessionGlobalStart(sessionId, latestStartOrResume);
            }
            await updateSessionGlobalPaused(sessionId, paused);
            await updateSessionGlobalEnd(sessionId, ended ? latestEndSet : undefined);
            if (active) {
              setSession((prev) => (prev ? {
                ...prev,
                globalStartMs: latestStartOrResume || prev.globalStartMs,
                globalPaused: paused,
                globalEndMs: ended ? latestEndSet : undefined
              } : prev));
            }
          }

          const relevant = latestClearAll
            ? events.filter((event) => (event.capturedAtMs || 0) >= latestClearAll)
            : events;

          const mapped = relevant.map((event: any) => ({
            id: event.id,
            runnerId: event.runnerId || '',
            stationId: event.stationId || '',
            type: event.type || 'PASS',
            capturedAtMs: event.capturedAtMs || Date.now(),
            refEventId: event.refEventId || undefined,
            syncedAtMs: Date.now()
          }));

          await upsertRemoteEvents(sessionId, mapped);
          await refreshEvents();
        }
        if (active) setLastPullAtMs(Date.now());
        if (active) setLastPullError('');
      } catch (err: any) {
        if (active) setLastPullError(err?.message || 'Failed to pull remote events.');
      }
    };
    poll();
    const timer = setInterval(poll, SYNC_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [sessionId, session?.pairingToken, session?.remoteSessionId]);

  useEffect(() => {
    if (!sessionId || !session?.pairingToken || !session?.remoteSessionId) return;
    let active = true;
    const tick = async () => {
      if (!active || syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      try {
        const result = await syncEvents(sessionId);
        setSyncPending(result.pending);
        setLastSyncStats({ attempted: result.attempted, synced: result.synced, failed: result.failed });
        setSyncLog((prev) => [
          {
            atMs: Date.now(),
            attempted: result.attempted,
            synced: result.synced,
            failed: result.failed,
            pending: result.pending,
            error: result.error
          },
          ...prev
        ].slice(0, 5));
        if (!result.error && result.synced > 0) {
          setLastPushAtMs(Date.now());
          setLastPushError('');
        } else if (result.error) {
          setLastPushError(result.error);
        }
      } finally {
        syncInFlightRef.current = false;
      }
    };
    tick();
    const timer = setInterval(tick, SYNC_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [sessionId, session?.pairingToken, session?.remoteSessionId]);

  useEffect(() => {
    if (sessionId && !stationId) {
      navigate(`/station?sessionId=${encodeURIComponent(sessionId)}`);
    }
  }, [sessionId, stationId, navigate]);

  useEffect(() => {
    if (!sessionId) return;
    listEventsForSession(sessionId).then((events) => {
      hydrateFromEvents(events);
    });
  }, [sessionId, templateConfig, stationId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    channelRef.current = new BroadcastChannel('napfa5-run');
    return () => {
      channelRef.current?.close();
      channelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!projectorOpen) return;
    const timer = window.setInterval(() => {
      if (projectorRef.current && projectorRef.current.closed) {
        projectorRef.current = null;
        setProjectorOpen(false);
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [projectorOpen]);

  function handleProjectorToggle() {
    if (!sessionId) return;
    if (projectorRef.current && !projectorRef.current.closed) {
      projectorRef.current.close();
      projectorRef.current = null;
      setProjectorOpen(false);
      return;
    }
    const url = `/station-progress?sessionId=${encodeURIComponent(sessionId)}&stationId=${encodeURIComponent(
      stationId || ''
    )}`;
    const screenLeft = window.screenX ?? window.screenLeft ?? 0;
    const screenTop = window.screenY ?? window.screenTop ?? 0;
    const availWidth = window.screen.availWidth || window.innerWidth;
    const availHeight = window.screen.availHeight || window.innerHeight;
    const width = Math.floor(availWidth * 0.66);
    const height = Math.floor(availHeight);
    const left = Math.floor(screenLeft + (availWidth - width));
    const top = Math.floor(screenTop);
    const features = `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
    projectorRef.current = window.open(url, 'napfa5-run-progress', features);
    setProjectorOpen(true);
  }

  async function refreshEvents() {
    if (!sessionId) return;
    const all = await listEventsForSession(sessionId);
    hydrateFromEvents(all);
    channelRef.current?.postMessage({ type: 'events-updated', sessionId });
  }

  async function handleClearRunnerById(targetId: string) {
    if (!targetId || !sessionId || !stationId) return;
    await addEvent({
      sessionId,
      runnerId: targetId,
      stationId,
      type: 'CLEAR',
      capturedAtMs: Date.now()
    });
    await refreshEvents();
  }

  async function handleUndoRunnerById(targetId: string) {
    if (!targetId || !sessionId || !stationId) return;
    const all = await listEventsForSession(sessionId);
    const localEvents = all.filter(
      (event) =>
        event.source !== 'remote' &&
        event.stationId === stationId &&
        event.runnerId === targetId &&
        event.type === 'PASS'
    );
    const usable = filterUndoneEvents(localEvents);
    const last = usable.sort((a, b) => b.capturedAtMs - a.capturedAtMs)[0];
    if (!last) {
      setToast(`No local scans to undo: ${targetId}`);
      setTimeout(() => setToast(''), 1500);
      return;
    }
    await addEvent({
      sessionId,
      runnerId: targetId,
      stationId: last.stationId,
      type: 'UNDO',
      capturedAtMs: Date.now(),
      refEventId: last.id
    });
    setToast(`Undo: ${targetId}`);
    setTimeout(() => setToast(''), 1500);
    await refreshEvents();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionId || !stationId || !runnerId) return;
    if (!templateConfig) return;
    if (tokenStatus === 'invalid') return;
    const trimmed = runnerId.trim();
    if (trimmed.startsWith('-c')) {
      const target = trimmed.slice(2).trim();
      const normalizedTarget = normalizeRunnerIdWithRules(target, effectiveRuleSession).normalized;
      setRunnerId('');
      setOverridePending(false);
      inputRef.current?.focus();
      if (!normalizedTarget) {
        const validation = normalizeRunnerIdWithRules(target, effectiveRuleSession);
        setToast(validation.error || 'Invalid ID.');
        setTimeout(() => setToast(''), 1500);
        return;
      }
      await handleClearRunnerById(normalizedTarget);
      setToast(`Cleared: ${normalizedTarget}`);
      setTimeout(() => setToast(''), 1500);
      return;
    }
    if (trimmed.startsWith('--')) {
      const target = trimmed.slice(2).trim();
      const normalizedTarget = normalizeRunnerIdWithRules(target, effectiveRuleSession).normalized;
      setRunnerId('');
      setOverridePending(false);
      inputRef.current?.focus();
      if (!normalizedTarget) {
        const validation = normalizeRunnerIdWithRules(target, effectiveRuleSession);
        setToast(validation.error || 'Invalid ID.');
        setTimeout(() => setToast(''), 1500);
        return;
      }
      await handleUndoRunnerById(normalizedTarget);
      return;
    }
    if (!runStarted) {
      setRunnerId('');
      setOverridePending(false);
      inputRef.current?.focus();
      setToast('Run has not started. Press Start first.');
      setTimeout(() => setToast(''), 1500);
      return;
    }
    if (runPaused) {
      setRunnerId('');
      setOverridePending(false);
      inputRef.current?.focus();
      setToast('Run is paused. Resume/Start to continue scanning.');
      setTimeout(() => setToast(''), 1500);
      return;
    }
    if (runEnded) {
      setRunnerId('');
      setOverridePending(false);
      inputRef.current?.focus();
      setToast('Run has ended. No more scans accepted.');
      setTimeout(() => setToast(''), 1500);
      return;
    }
    const idValidation = normalizeRunnerIdWithRules(trimmed, effectiveRuleSession);
    const normalizedId = idValidation.normalized;
    if (!normalizedId) {
      setRunnerId('');
      setOverridePending(false);
      inputRef.current?.focus();
      setToast(idValidation.error || 'Invalid ID.');
      setTimeout(() => setToast(''), 1500);
      return;
    }
    const force = overridePending || (event as unknown as React.KeyboardEvent).shiftKey === true;

    const sessionEvents = await listEventsForSession(sessionId);
    const clearAllEvents = sessionEvents.filter((event) => event.type === 'CLEAR_ALL');
    const runnerEvents = sessionEvents.filter(
      (event) => event.runnerId === normalizedId || event.runnerId === trimmed
    );
    const combined = filterUndoneEvents([...clearAllEvents, ...runnerEvents]).sort(
      (a, b) => a.capturedAtMs - b.capturedAtMs
    );
    let runnerState = createInitialRunnerState();
    for (const entry of combined) {
      runnerState = applyEvent(runnerState, mapDbEventToRunEvent(entry), templateConfig);
    }

    const nowMs = Date.now();
    const lastSeen = runnerState.lastSeenMsAtStation[stationId as any];
    const gapMs = templateConfig.minScanGapMsByStation[stationId as any] ?? 0;
    if (!force && lastSeen != null && nowMs - lastSeen < gapMs) {
      setRunnerId('');
      setOverridePending(false);
      inputRef.current?.focus();
      return;
    }
    if (
      stationId === 'LAP_END' &&
      session?.lapsRequired != null &&
      runnerState.lapCount >= session.lapsRequired
    ) {
      setRunnerId('');
      setOverridePending(false);
      inputRef.current?.focus();
      setToast(`Already finished: ${normalizedId}`);
      setTimeout(() => setToast(''), 1500);
      return;
    }

    await addEvent({
      sessionId,
      runnerId: normalizedId,
      stationId,
      type: 'PASS',
      capturedAtMs: nowMs
    });

    setRunnerId('');
    setOverridePending(false);
    inputRef.current?.focus();
    setToast(`Recorded: ${runnerId}`);
    setTimeout(() => setToast(''), 1500);
    await refreshEvents();
  }

  const holdTimerRef = useRef<number | null>(null);
  const [overridePending, setOverridePending] = useState(false);
  function handleHoldStart() {
    holdTimerRef.current = window.setTimeout(() => {
      setOverridePending(true);
      setToast('Override armed.');
      setTimeout(() => setToast(''), 1200);
    }, 500);
  }

  function handleHoldEnd() {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  async function handleResetSession() {
    if (!sessionId) return;
    await clearSessionEvents(sessionId);
    await updateSessionGlobalStart(sessionId, undefined);
    await updateSessionGlobalPaused(sessionId, false);
    await updateSessionGlobalEnd(sessionId, undefined);
    setSession((prev) => (prev ? { ...prev, globalStartMs: undefined, globalPaused: false, globalEndMs: undefined } : prev));
    const nowMs = Date.now();
    lastClearAllRef.current = nowMs;
    await addEvent({
      sessionId,
      runnerId: 'GLOBAL',
      stationId: stationId || 'LAP_END',
      type: 'CLEAR_ALL',
      capturedAtMs: nowMs
    });
    setToast('Session reset recorded.');
    setTimeout(() => setToast(''), 1500);
    await refreshEvents();
    await syncEvents(sessionId);
  }

  async function handleExport() {
    if (!sessionId) return;
    const csv = await exportCsv(sessionId);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `session-${sessionId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleSaveLocalOverride() {
    if (!sessionId) return;
    const rules = formToOverrideRules(overrideForm);
    await updateSessionLocalIdRules(sessionId, rules);
    const updated = await getSession(sessionId);
    setSession(updated || null);
    setShowOverrideModal(false);
    setToast('Local run config override saved.');
    setTimeout(() => setToast(''), 1400);
  }

  async function handleClearLocalOverride() {
    if (!sessionId) return;
    await updateSessionLocalIdRules(sessionId, null);
    const updated = await getSession(sessionId);
    setSession(updated || null);
    setShowOverrideModal(false);
    setToast('Local override cleared. Using original run config.');
    setTimeout(() => setToast(''), 1600);
  }

  async function handleGlobalStart() {
    if (!sessionId) return;
    const startMs = Date.now();
    const eventType = runStarted ? 'RESUME_SET' : 'START_SET';
    await addEvent({
      sessionId,
      runnerId: 'GLOBAL',
      stationId: stationId || startStationId,
      type: eventType,
      capturedAtMs: startMs
    });
    await updateSessionGlobalStart(sessionId, startMs);
    await updateSessionGlobalPaused(sessionId, false);
    await updateSessionGlobalEnd(sessionId, undefined);
    setSession((prev) => (prev ? { ...prev, globalStartMs: startMs, globalPaused: false, globalEndMs: undefined } : prev));
    await refreshEvents();
  }

  async function handleGlobalPause() {
    if (!sessionId || !runStarted || runEnded) return;
    const pauseMs = Date.now();
    await addEvent({
      sessionId,
      runnerId: 'GLOBAL',
      stationId: stationId || startStationId,
      type: 'PAUSE_SET',
      capturedAtMs: pauseMs
    });
    await updateSessionGlobalPaused(sessionId, true);
    setSession((prev) => (prev ? { ...prev, globalPaused: true } : prev));
    await refreshEvents();
  }

  async function handleGlobalEnd() {
    if (!sessionId || !runStarted || !runPaused) return;
    const endMs = Date.now();
    await addEvent({
      sessionId,
      runnerId: 'GLOBAL',
      stationId: stationId || startStationId,
      type: 'END_SET',
      capturedAtMs: endMs
    });
    await updateSessionGlobalPaused(sessionId, false);
    await updateSessionGlobalEnd(sessionId, endMs);
    setSession((prev) => (prev ? { ...prev, globalPaused: false, globalEndMs: endMs } : prev));
    await refreshEvents();
  }

  if (!sessionId) {
    return (
      <main>
        <h1>Capture</h1>
        <p className="note">Missing session ID. Start from Session Setup.</p>
      </main>
    );
  }

  return (
    <main className="capture-main">
      {sessionId && (
        <div className="page-actions">
          <Link className="btn-link" to={`/station?sessionId=${encodeURIComponent(sessionId)}`}>
            Back to Station
          </Link>
          <Link className="btn-link" to="/">
            Back to Setup
          </Link>
        </div>
      )}

      <div className="capture-redesign">
        <section className="capture-status-strip card">
          <div className="capture-status-top">
            <div className="capture-status-station">
              {stationId ? stationLabel(session?.templateKey, stationId) : 'Station not set'}
            </div>
            <div className="capture-status-right">
              <div className={`capture-status-badge ${connectionTone}`}>{connectionLabel}</div>
              <div className="capture-status-clock">{new Date(clockMs).toLocaleTimeString()}</div>
            </div>
          </div>
          <div className="capture-status-controls-meta">
            <div className="capture-status-controls">
              {showGlobalStart && stationId === startStationId && (
                <>
                  <button type="button" className="capture-control-btn start" onClick={handleGlobalStart}>
                    {runStarted && runPaused ? 'Start (Resume)' : 'Start'}
                  </button>
                  {runStarted && !runEnded && (
                    <>
                    <button type="button" className="capture-control-btn pause" onClick={handleGlobalPause} disabled={runPaused}>
                      Pause
                    </button>
                    <button
                      type="button"
                      className="capture-control-btn end"
                      onClick={() => setShowEndConfirm(true)}
                      disabled={!runPaused}
                    >
                      End
                    </button>
                  </>
                )}
                </>
              )}
            </div>
            <div className="capture-status-meta">
              <div>Last received: {lastPullAtMs ? new Date(lastPullAtMs).toLocaleTimeString() : 'never'}</div>
              <div>Last sent: {lastPushAtMs ? new Date(lastPushAtMs).toLocaleTimeString() : 'never'}</div>
              <div>Pending upload: {syncPending}</div>
            </div>
          </div>
        </section>

        <div className="capture-workspace">
          <div className="capture-main-col">
            <section className="capture-primary card">
          <div className="station-title">Record Runner</div>
          <form onSubmit={handleSubmit} className="capture-form">
            <div className="capture-input-wrap">
              <label htmlFor="runner">Runner ID</label>
              <input
                id="runner"
                ref={inputRef}
                value={runnerId}
                onChange={(event) => setRunnerId(event.target.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.shiftKey) {
                    setOverridePending(true);
                  }
                }}
                placeholder="Scan or type runner ID"
                style={{ fontSize: '24px', height: '56px' }}
              />
              <div
                className={`focus-overlay ${!inputFocused ? 'is-visible' : ''}`}
                onClick={() => {
                  if (inputFocused) return;
                  inputRef.current?.focus();
                  setInputFocused(true);
                }}
                role="button"
                tabIndex={!inputFocused ? 0 : -1}
                aria-hidden={inputFocused}
                onKeyDown={(event) => {
                  if (inputFocused) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    inputRef.current?.focus();
                    setInputFocused(true);
                  }
                }}
              >
                Put cursor in scan box
              </div>
            </div>
            <button
              type="submit"
              className="btn-lg"
              disabled={tokenStatus === 'invalid' || tokenStatus === 'checking' || !runStarted || runPaused || runEnded}
              onMouseDown={handleHoldStart}
              onMouseUp={handleHoldEnd}
              onMouseLeave={handleHoldEnd}
              onTouchStart={handleHoldStart}
              onTouchEnd={handleHoldEnd}
            >
              Record
            </button>
          </form>

          {toast && <div className="toast">{toast}</div>}
          {tokenStatus === 'checking' && <div className="note">Validating pairing token...</div>}
          {tokenStatus === 'invalid' && <div className="error">Token invalid: {tokenError}</div>}
          {!runStarted && (
            <div className="note">Waiting for Start signal before accepting scans.</div>
          )}
          {runStarted && runPaused && !runEnded && (
            <div className="note">Run is paused. Scanning is temporarily locked.</div>
          )}
          {runEnded && (
            <div className="note">Run ended. Recording is locked.</div>
          )}
          {hasStartStation && (
            <div className="note">
              Start: {session?.globalStartMs ? new Date(session.globalStartMs).toLocaleTimeString() : 'Not set'}
            </div>
          )}
          {hasSyncIssue && (
            <div className="error">
              Sync needs attention.
            </div>
          )}
          <div className="capture-inline-note">
            <div className="tag">
              ID format: {runnerFormatNote}
            </div>
            <div className="tag">-cID clears runner</div>
            <div className="tag">--ID undo last local scan</div>
          </div>
            </section>

            <div className="card capture-recent-sticky">
              <div className="capture-section-title">Runner Summary</div>
              <div className="note">
                {(() => {
                  const total = runnerSummaries.length;
                  const lapsRequired = session?.lapsRequired;
                  const completed = runnerSummaries.filter((runner) =>
                    lapsRequired != null ? runner.lapCount >= lapsRequired : runner.finished
                  ).length;
                  const running = Math.max(0, total - completed);
                  return `Running: ${running} | Completed: ${completed} | Total: ${total}`;
                })()}
              </div>
              <div className="capture-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Runner</th>
                      <th>Laps</th>
                      <th>Finished</th>
                      <th>Flags</th>
                      <th>Last Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runnerSummaries.map((runner) => {
                      const lapsRequired = session?.lapsRequired;
                      const completedByLaps =
                        lapsRequired != null && runner.lapCount >= lapsRequired;
                      const lastLap =
                        lapsRequired != null &&
                        !completedByLaps &&
                        runner.lapCount === lapsRequired - 1;
                      const rowClass = completedByLaps || runner.finished ? 'row-success' : lastLap ? 'row-warning' : '';
                      return (
                        <tr key={runner.runnerId} className={rowClass}>
                          <td>{runner.runnerId}</td>
                          <td>
                            {runner.lapCount}/{session?.lapsRequired ?? '-'}
                          </td>
                          <td>{completedByLaps || runner.finished ? 'Yes' : 'No'}</td>
                          <td>{runner.flags.join(', ') || '-'}</td>
                          <td>{runner.lastSeenAtMs ? new Date(runner.lastSeenAtMs).toLocaleTimeString() : '-'}</td>
                      </tr>
                    );
                    })}
                    {runnerSummaries.length === 0 && (
                      <tr>
                        <td colSpan={5}>No runners yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <section className="card capture-summary">
              <div className="capture-section-title">Recent Scans (this station)</div>
              <div className="capture-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Runner</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentEvents.map((event) => (
                      <tr key={event.id}>
                        <td>{new Date(event.capturedAtMs).toLocaleTimeString()}</td>
                        <td>{event.runnerId}</td>
                        <td>{recentTypeById[event.id] || displayEventType(event.type)}</td>
                      </tr>
                    ))}
                    {recentEvents.length === 0 && (
                      <tr>
                        <td colSpan={3}>No scans yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
          </section>
        </div>

        <section className="capture-ops card">
          <div className="capture-section-title">Run Controls</div>
          <div className="capture-footer-actions">
            {isControlStation && (
              <>
                <button type="button" className="secondary" onClick={() => setShowOverrideModal(true)}>
                  Change runner ID format
                </button>
                <button type="button" className="secondary" onClick={() => setShowResetConfirm(true)}>
                  Reset Session Data
                </button>
                <button type="button" className="secondary" onClick={handleExport}>
                  Export CSV
                </button>
              </>
            )}
            <button
              type="button"
              className="secondary"
              onClick={handleProjectorToggle}
              disabled={!stationId}
            >
              {projectorOpen ? 'Close Projector View' : 'Projector View'}
            </button>
          </div>
          <div className="note">
            ID format, reset session data, export csv apply only to START, Lap Start / End, or FINISH station.
          </div>
        </section>
        <section className="capture-diagnostics card">
          <button
            type="button"
            className="secondary"
            onClick={() => setShowTechDetails((value) => !value)}
          >
            {showTechDetails ? 'Hide technical details' : 'Show technical details'}
          </button>
          {showTechDetails && (
            <>
              {!!lastPullError && <div className="error">Pull error: {lastPullError}</div>}
              {!!lastPushError && <div className="error">Push error: {lastPushError}</div>}
              <div className="note">
                Heartbeat:{' '}
                {healthStatus === 'checking' ? 'checking'
                  : healthStatus === 'ok' ? 'ok'
                  : healthStatus === 'warn' ? 'warn'
                  : healthStatus === 'error' ? 'error'
                  : 'idle'} (token/config link check)
                {healthCheckedAtMs ? ` @ ${new Date(healthCheckedAtMs).toLocaleTimeString()}` : ''}
              </div>
              {!!healthSummary && <div className="note">Health: {healthSummary}</div>}
              {!!healthError && <div className="error">Health error: {healthError}</div>}
              <div className="note">
                Sync stats: attempted {lastSyncStats?.attempted ?? 0} | accepted {lastSyncStats?.synced ?? 0} | failed {lastSyncStats?.failed ?? 0} | pending {syncPending}
              </div>
              {session?.localIdRulesOverride && (
                <div className="note">
                  Local override active
                  {session?.localIdRulesOverrideUpdatedAt
                    ? ` (updated ${new Date(session.localIdRulesOverrideUpdatedAt).toLocaleTimeString()})`
                    : ''}
                </div>
              )}
              <div className="note">API: {runApiUrl('/api/run/events')}</div>
              <div className="capture-table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Sync Time</th>
                      <th>Attempted</th>
                      <th>Accepted</th>
                      <th>Failed</th>
                      <th>Pending</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncLog.map((item, idx) => (
                      <tr key={`${item.atMs}-${idx}`}>
                        <td>{new Date(item.atMs).toLocaleTimeString()}</td>
                        <td>{item.attempted}</td>
                        <td>{item.synced}</td>
                        <td>{item.failed}</td>
                        <td>{item.pending}</td>
                        <td>{item.error ? item.error : 'ok'}</td>
                      </tr>
                    ))}
                    {syncLog.length === 0 && (
                      <tr>
                        <td colSpan={6}>No sync attempts yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
      {showOverrideModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ width: 'min(560px, 100%)' }}>
            <div className="modal-header">
              <div className="text-base font-semibold">Change runner ID format</div>
              <button type="button" className="btn-link" onClick={() => setShowOverrideModal(false)}>
                Close
              </button>
            </div>
            <div className="grid">
              <div className="note">This will not change the original run config.</div>
              <div>
                <label htmlFor="overrideFormat">Runner ID Format</label>
                <select
                  id="overrideFormat"
                  value={overrideForm.runnerIdFormat}
                  onChange={(event) => setOverrideForm((prev) => ({ ...prev, runnerIdFormat: event.target.value as OverrideForm['runnerIdFormat'] }))}
                  className="input-lg"
                >
                  <option value="numeric">Numeric</option>
                  <option value="classIndex">Class + Index (A01)</option>
                  <option value="structured4">4-digit LCII (1101)</option>
                </select>
              </div>
              {overrideForm.runnerIdFormat === 'numeric' && (
                <div className="inline-row">
                  <div>
                    <label htmlFor="overrideMin">Min ID</label>
                    <input id="overrideMin" value={overrideForm.runnerIdMin} onChange={(event) => setOverrideForm((prev) => ({ ...prev, runnerIdMin: event.target.value }))} className="input-lg" />
                  </div>
                  <div>
                    <label htmlFor="overrideMax">Max ID</label>
                    <input id="overrideMax" value={overrideForm.runnerIdMax} onChange={(event) => setOverrideForm((prev) => ({ ...prev, runnerIdMax: event.target.value }))} className="input-lg" />
                  </div>
                </div>
              )}
              {overrideForm.runnerIdFormat === 'classIndex' && (
                <div className="grid">
                  <div>
                    <label htmlFor="overridePrefixes">Class Prefixes (comma-separated)</label>
                    <input id="overridePrefixes" value={overrideForm.classPrefixes} onChange={(event) => setOverrideForm((prev) => ({ ...prev, classPrefixes: event.target.value }))} className="input-lg" placeholder="A,B,C" />
                  </div>
                  <div className="inline-row">
                    <div>
                      <label htmlFor="overrideClassMin">Min Index</label>
                      <input id="overrideClassMin" value={overrideForm.classIndexMin} onChange={(event) => setOverrideForm((prev) => ({ ...prev, classIndexMin: event.target.value }))} className="input-lg" />
                    </div>
                    <div>
                      <label htmlFor="overrideClassMax">Max Index</label>
                      <input id="overrideClassMax" value={overrideForm.classIndexMax} onChange={(event) => setOverrideForm((prev) => ({ ...prev, classIndexMax: event.target.value }))} className="input-lg" />
                    </div>
                  </div>
                </div>
              )}
              {overrideForm.runnerIdFormat === 'structured4' && (
                <div className="grid">
                  <div className="inline-row">
                    <div>
                      <label htmlFor="overrideLvlMin">Level Min (L)</label>
                      <input id="overrideLvlMin" value={overrideForm.structuredLevelMin} onChange={(event) => setOverrideForm((prev) => ({ ...prev, structuredLevelMin: event.target.value }))} className="input-lg" />
                    </div>
                    <div>
                      <label htmlFor="overrideLvlMax">Level Max (L)</label>
                      <input id="overrideLvlMax" value={overrideForm.structuredLevelMax} onChange={(event) => setOverrideForm((prev) => ({ ...prev, structuredLevelMax: event.target.value }))} className="input-lg" />
                    </div>
                  </div>
                  <div className="inline-row">
                    <div>
                      <label htmlFor="overrideClsMin">Class Min (C)</label>
                      <input id="overrideClsMin" value={overrideForm.structuredClassMin} onChange={(event) => setOverrideForm((prev) => ({ ...prev, structuredClassMin: event.target.value }))} className="input-lg" />
                    </div>
                    <div>
                      <label htmlFor="overrideClsMax">Class Max (C)</label>
                      <input id="overrideClsMax" value={overrideForm.structuredClassMax} onChange={(event) => setOverrideForm((prev) => ({ ...prev, structuredClassMax: event.target.value }))} className="input-lg" />
                    </div>
                  </div>
                  <div className="inline-row">
                    <div>
                      <label htmlFor="overrideIdxMin">Index Min (II)</label>
                      <input id="overrideIdxMin" value={overrideForm.structuredIndexMin} onChange={(event) => setOverrideForm((prev) => ({ ...prev, structuredIndexMin: event.target.value }))} className="input-lg" />
                    </div>
                    <div>
                      <label htmlFor="overrideIdxMax">Index Max (II)</label>
                      <input id="overrideIdxMax" value={overrideForm.structuredIndexMax} onChange={(event) => setOverrideForm((prev) => ({ ...prev, structuredIndexMax: event.target.value }))} className="input-lg" />
                    </div>
                  </div>
                </div>
              )}
              <div className="reset-actions">
                <button type="button" className="secondary" onClick={handleClearLocalOverride}>
                  Reset to original
                </button>
                <button type="button" onClick={handleSaveLocalOverride}>
                  Save local override
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showResetConfirm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <div className="text-base font-semibold">Reset Session Data</div>
              <button type="button" className="btn-link" onClick={() => setShowResetConfirm(false)}>
                Close
              </button>
            </div>
            <div className="grid">
              <div className="note" style={{ fontSize: '14px' }}>
                This clears all scans on this device and resets the session for all stations.
              </div>
              <div className="reset-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowResetConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setShowResetConfirm(false);
                    await handleResetSession();
                  }}
                >
                  Reset Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showEndConfirm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <div className="text-base font-semibold">End Run</div>
              <button type="button" className="btn-link" onClick={() => setShowEndConfirm(false)}>
                Close
              </button>
            </div>
            <div className="grid">
              <div className="note" style={{ fontSize: '14px' }}>
                End run now? This will stop all stations from accepting scans.
              </div>
              <div className="reset-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowEndConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setShowEndConfirm(false);
                    await handleGlobalEnd();
                  }}
                >
                  Confirm End
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
