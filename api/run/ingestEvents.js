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
    .select('id, session_id, pairing_token')
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

  const payload = events.map((event) => ({
    event_id: event.id,
    run_config_id: config.id,
    session_id: config.session_id,
    station_id: event.stationId || null,
    event_type: event.type,
    occurred_at: new Date(event.capturedAtMs).toISOString(),
    payload: {
      runner_id: event.runnerId || null,
      ref_event_id: event.refEventId || null
    }
  }));

  const { error: bulkError } = await supabase.from('run_events').upsert(payload, { onConflict: 'event_id' });
  if (!bulkError) {
    res.status(200).json({ acceptedIds: events.map((e) => e.id), failedIds: [] });
    return;
  }

  const acceptedIds = [];
  const failedIds = [];
  for (const event of payload) {
    const { error } = await supabase.from('run_events').upsert([event], { onConflict: 'event_id' });
    if (error) failedIds.push(event.event_id);
    else acceptedIds.push(event.event_id);
  }

  res.status(207).json({ acceptedIds, failedIds, error: failedIds.length ? 'Partial failure' : undefined });
}
