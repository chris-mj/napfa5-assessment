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
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Missing auth token' });
    return;
  }

  const { runConfigId, sessionId } = req.body || {};
  if (!runConfigId || !sessionId) {
    res.status(400).json({ error: 'Missing runConfigId or sessionId' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    res.status(401).json({ error: 'Invalid auth token' });
    return;
  }

  const { data: membership } = await supabase
    .from('memberships')
    .select('role, school_id')
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (!membership || !['admin', 'superadmin'].includes(membership.role)) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('id, school_id')
    .eq('id', sessionId)
    .maybeSingle();

  if (!session || session.school_id !== membership.school_id) {
    res.status(403).json({ error: 'Session not accessible' });
    return;
  }

  const { data: config } = await supabase
    .from('run_configs')
    .select('id, session_id')
    .eq('id', runConfigId)
    .maybeSingle();

  if (!config || config.session_id !== sessionId) {
    res.status(404).json({ error: 'Run config not found' });
    return;
  }

  const { error: deleteError } = await supabase
    .from('run_events')
    .delete()
    .eq('run_config_id', runConfigId);

  if (deleteError) {
    res.status(500).json({ error: 'Failed to reset run events' });
    return;
  }

  res.status(200).json({ ok: true });
}
