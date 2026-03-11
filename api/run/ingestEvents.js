import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    res.status(500).json({ error: 'Server not configured' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const pairingToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!pairingToken) {
    res.status(401).json({ error: 'Missing pairing token' });
    return;
  }

  const { sessionId, runConfigId, events } = req.body || {};
  if (!sessionId || !Array.isArray(events)) {
    res.status(400).json({ error: 'Invalid payload' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: config, error: configError } = await supabase
    .from('run_configs')
    .select('id, session_id, pairing_token, scan_gap_ms')
    .eq('pairing_token', pairingToken)
    .maybeSingle();

  if (configError || !config) {
    res.status(403).json({ error: 'Invalid pairing token' });
    return;
  }

  if (String(config.session_id) !== String(sessionId)) {
    res.status(403).json({ error: 'Token does not match session' });
    return;
  }

  if (runConfigId && String(runConfigId) !== String(config.id)) {
    res.status(403).json({ error: 'Token does not match run config' });
    return;
  }

  const dedupeWindowMsRaw = Number(config.scan_gap_ms);
  const dedupeWindowMs = Number.isFinite(dedupeWindowMsRaw)
    ? Math.max(1000, Math.min(60000, dedupeWindowMsRaw))
    : 10000;
  const sinceIso = new Date(Date.now() - dedupeWindowMs).toISOString();

  const { data: recentPasses, error: recentErr } = await supabase
    .from('run_events')
    .select('station_id, payload, created_at')
    .eq('run_config_id', config.id)
    .eq('event_type', 'PASS')
    .gt('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(2000);

  if (recentErr) {
    res.status(500).json({ error: 'Failed to load recent events for dedupe' });
    return;
  }

  const dedupeKeys = new Set();
  for (const row of recentPasses || []) {
    const tag = String(row?.payload?.runner_id || '').trim();
    const station = String(row?.station_id || '').trim();
    if (!tag || !station) continue;
    dedupeKeys.add(`${station}::${tag}`);
  }

  const acceptedIds = [];
  const failedIds = [];
  const toInsert = [];
  const batchPassKeys = new Set();

  for (const event of events) {
    const type = String(event.type || '');
    const station = String(event.stationId || '').trim();
    const tag = String(event.runnerId || '').trim();
    const passKey = type === 'PASS' && station && tag ? `${station}::${tag}` : '';

    if (passKey && (dedupeKeys.has(passKey) || batchPassKeys.has(passKey))) {
      // Cross-device duplicate within dedupe window: treat as accepted to prevent resend loops.
      acceptedIds.push(event.id);
      continue;
    }

    if (passKey) {
      batchPassKeys.add(passKey);
      dedupeKeys.add(passKey);
    }

    toInsert.push({
      event_id: event.id,
      run_config_id: config.id,
      session_id: config.session_id,
      station_id: event.stationId || null,
      event_type: event.type,
      occurred_at: new Date(event.capturedAtMs).toISOString(),
      payload: {
        runner_id: event.runnerId || null,
        ref_event_id: event.refEventId || null,
        client_payload: event.payload || null
      }
    });
  }

  if (toInsert.length) {
    const { error: bulkError } = await supabase.from('run_events').upsert(toInsert, { onConflict: 'event_id' });
    if (!bulkError) {
      acceptedIds.push(...toInsert.map((e) => e.event_id));
    } else {
      for (const event of toInsert) {
        const { error } = await supabase.from('run_events').upsert([event], { onConflict: 'event_id' });
        if (error) failedIds.push(event.event_id);
        else acceptedIds.push(event.event_id);
      }
    }
  }

  if (failedIds.length) {
    res.status(207).json({ acceptedIds, failedIds, error: 'Partial failure' });
    return;
  }
  res.status(200).json({ acceptedIds, failedIds: [] });
}
