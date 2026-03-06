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

  const { token } = req.body || {};
  if (!token) {
    res.status(400).json({ error: 'Missing token' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data, error } = await supabase
    .from('run_configs')
    .select('id, session_id, name, template_key, laps_required, enforcement, scan_gap_ms, runner_id_format, runner_id_min, runner_id_max, class_prefixes, class_index_min, class_index_max, structured_level_min, structured_level_max, structured_class_min, structured_class_max, structured_index_min, structured_index_max, pairing_token')
    .eq('pairing_token', token)
    .maybeSingle();

  if (error || !data) {
    res.status(404).json({ error: 'Token not found' });
    return;
  }

  res.status(200).json({
    runConfigId: data.id,
    sessionId: data.session_id,
    name: data.name || undefined,
    templateKey: data.template_key,
    lapsRequired: data.laps_required,
    enforcement: data.enforcement || undefined,
    scanGapMs: data.scan_gap_ms || undefined,
    runnerIdFormat: data.runner_id_format || 'numeric',
    runnerIdMin: data.runner_id_min ?? undefined,
    runnerIdMax: data.runner_id_max ?? undefined,
    classPrefixes: Array.isArray(data.class_prefixes) ? data.class_prefixes : undefined,
    classIndexMin: data.class_index_min ?? undefined,
    classIndexMax: data.class_index_max ?? undefined,
    structuredLevelMin: data.structured_level_min ?? undefined,
    structuredLevelMax: data.structured_level_max ?? undefined,
    structuredClassMin: data.structured_class_min ?? undefined,
    structuredClassMax: data.structured_class_max ?? undefined,
    structuredIndexMin: data.structured_index_min ?? undefined,
    structuredIndexMax: data.structured_index_max ?? undefined
  });
}
