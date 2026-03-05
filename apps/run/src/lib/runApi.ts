import { supabase } from './supabase';

const PROD_BASE = 'https://napfa5-assessment.vercel.app';

function normalizeBaseUrl(base: string) {
  return base.replace(/\/+$/, '');
}

export function getRunApiBaseUrl() {
  const configuredBase = (import.meta.env.VITE_RUN_API_BASE_URL as string | undefined)?.trim();
  if (configuredBase) return normalizeBaseUrl(configuredBase);
  if (import.meta.env.DEV) return '';
  return PROD_BASE;
}

export function runApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getRunApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

async function parseJsonOrThrow(response: Response, context: string) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const sample = (await response.text().catch(() => '')).slice(0, 160);
    throw new Error(`${context}: non-JSON response (${response.status}). ${sample}`);
  }
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new Error(`${context}: invalid JSON response (${response.status}).`);
  }
  return body as Record<string, any>;
}

function validateEndpoint() {
  return runApiUrl('/api/run/validateToken');
}

function shouldTryApiFirst() {
  return true;
}

export async function postValidateToken(token: string) {
  const endpoint = validateEndpoint();
  if (shouldTryApiFirst()) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      const body = await parseJsonOrThrow(response, 'validateToken');
      if (response.status !== 404 && response.status !== 405) {
        return { response, body, endpoint };
      }
    } catch {
      // Fall through to Supabase fallback.
    }
  }

  if (!supabase) {
    return {
      response: new Response(JSON.stringify({ error: 'Validation endpoint unavailable.' }), { status: 503 }),
      body: { error: 'Validation endpoint unavailable.' },
      endpoint
    };
  }

  const { data, error } = await supabase
    .from('run_configs')
    .select('id, session_id, name, template_key, laps_required, enforcement, scan_gap_ms')
    .eq('pairing_token', token)
    .maybeSingle();

  if (error || !data) {
    const message = error?.message || 'Token not found';
    return {
      response: new Response(JSON.stringify({ error: message }), { status: 404 }),
      body: { error: message },
      endpoint: 'supabase:run_configs'
    };
  }

  const mapped = {
    runConfigId: data.id,
    sessionId: data.session_id,
    name: data.name || undefined,
    templateKey: data.template_key,
    lapsRequired: data.laps_required,
    enforcement: data.enforcement || undefined,
    scanGapMs: data.scan_gap_ms || undefined
  };

  return {
    response: new Response(JSON.stringify(mapped), { status: 200 }),
    body: mapped,
    endpoint: 'supabase:run_configs'
  };
}

export async function fetchRunEvents(input: {
  pairingToken: string;
  sinceMs?: number;
}) {
  const url = new URL(runApiUrl('/api/run/events'), window.location.origin);
  if (input.sinceMs && Number.isFinite(input.sinceMs)) {
    url.searchParams.set('since', String(input.sinceMs));
  }
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${input.pairingToken}` },
    cache: 'no-store'
  });
  const body = await parseJsonOrThrow(response, 'events');
  if (!response.ok) {
    throw new Error(body.error || `events failed (${response.status})`);
  }
  const events = Array.isArray(body.events) ? body.events : [];
  return {
    sessionId: body.sessionId,
    runConfigId: body.runConfigId,
    events
  };
}

export async function ingestRunEvents(input: {
  pairingToken: string;
  sessionId: string;
  runConfigId?: string;
  events: Array<{
    id: string;
    runnerId: string;
    stationId: string;
    type: string;
    capturedAtMs: number;
    refEventId?: string | null;
  }>;
}) {
  const response = await fetch(runApiUrl('/api/run/ingestEvents'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.pairingToken}`
    },
    cache: 'no-store',
    body: JSON.stringify({
      sessionId: input.sessionId,
      runConfigId: input.runConfigId,
      events: input.events
    })
  });
  const body = await parseJsonOrThrow(response, 'ingestEvents');
  if (!response.ok && response.status !== 207) {
    throw new Error(body.error || `ingestEvents failed (${response.status})`);
  }
  if (!Array.isArray(body.acceptedIds) || !Array.isArray(body.failedIds)) {
    throw new Error('ingestEvents: malformed response (missing acceptedIds/failedIds).');
  }
  return {
    acceptedIds: body.acceptedIds as string[],
    failedIds: body.failedIds as string[],
    status: response.status
  };
}
