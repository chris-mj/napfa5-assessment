import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;

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
    .select('id')
    .eq('pairing_token', pairingToken)
    .maybeSingle();

  if (configError || !config) {
    res.status(403).json({ error: 'Invalid pairing token' });
    return;
  }

  res.status(200).json({
    ok: true,
    serverNowMs: Date.now()
  });
}
