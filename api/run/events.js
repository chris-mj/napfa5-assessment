import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

function toIsoSince(value) {
  if (!value) return null;
  if (String(value).match(/^\d+$/)) {
    const ms = Number(value);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
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

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: config, error: configError } = await supabase
    .from('run_configs')
    .select('id, session_id')
    .eq('pairing_token', pairingToken)
    .maybeSingle();

  if (configError || !config) {
    res.status(403).json({ error: 'Invalid pairing token' });
    return;
  }

  const sinceIso = toIsoSince(req.query?.since);
  let query = supabase
    .from('run_events')
    .select('event_id, run_config_id, session_id, station_id, event_type, occurred_at, payload')
    .eq('run_config_id', config.id)
    .order('occurred_at', { ascending: true });

  if (sinceIso) {
    query = query.gt('occurred_at', sinceIso);
  }

  const { data: events, error: eventsError } = await query;
  if (eventsError) {
    res.status(500).json({ error: 'Failed to load events' });
    return;
  }

  const mapped = (events || []).map((event) => ({
    id: event.event_id,
    sessionId: event.session_id,
    runConfigId: event.run_config_id,
    stationId: event.station_id,
    type: event.event_type,
    capturedAtMs: new Date(event.occurred_at).getTime(),
    runnerId: event.payload?.runner_id || null,
    refEventId: event.payload?.ref_event_id || null
  }));

  res.status(200).json({
    runConfigId: config.id,
    sessionId: config.session_id,
    events: mapped
  });
}
