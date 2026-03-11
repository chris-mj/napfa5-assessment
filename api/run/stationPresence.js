import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

function clampActiveSeconds(input) {
  const n = Number(input);
  if (!Number.isFinite(n)) return 30;
  return Math.max(10, Math.min(120, Math.round(n)));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
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

  const activeWithinSec = clampActiveSeconds(req.query?.activeWithinSec);
  const cutoffIso = new Date(Date.now() - activeWithinSec * 1000).toISOString();

  if (req.method === 'POST') {
    const stationId = String(req.body?.stationId || '').trim();
    const deviceId = String(req.body?.deviceId || '').trim();
    if (!stationId || !deviceId) {
      res.status(400).json({ error: 'Missing stationId or deviceId' });
      return;
    }

    const upsertRow = {
      run_config_id: config.id,
      session_id: config.session_id,
      station_id: stationId,
      device_id: deviceId,
      last_seen_at: new Date().toISOString()
    };
    const { error: upsertErr } = await supabase
      .from('run_station_presence')
      .upsert(upsertRow, { onConflict: 'run_config_id,station_id,device_id' });
    if (upsertErr) {
      res.status(500).json({ error: 'Failed to update station presence' });
      return;
    }
  }

  const stationId = String((req.method === 'POST' ? req.body?.stationId : req.query?.stationId) || '').trim();
  if (!stationId) {
    res.status(400).json({ error: 'Missing stationId' });
    return;
  }

  const { data: rows, error: listErr } = await supabase
    .from('run_station_presence')
    .select('device_id, last_seen_at')
    .eq('run_config_id', config.id)
    .eq('station_id', stationId)
    .gt('last_seen_at', cutoffIso)
    .order('last_seen_at', { ascending: false });
  if (listErr) {
    res.status(500).json({ error: 'Failed to load station presence' });
    return;
  }

  res.status(200).json({
    ok: true,
    runConfigId: config.id,
    sessionId: config.session_id,
    stationId,
    activeWithinSec,
    activeDevices: (rows || []).length
  });
}
