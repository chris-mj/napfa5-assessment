import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
const PLATFORM_OWNER_EMAIL = 'christopher_teo_ming_jian@moe.edu.sg';
const QR_LOGIN_ROLES = new Set(['score_taker', 'viewer', 'score_viewer']);

function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function resolveLoginRedirect(req, body) {
  const rawOrigin = req.headers.origin || body.origin || '';
  if (!rawOrigin) return null;
  try {
    const url = new URL(rawOrigin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.pathname = '/login';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

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

  const body = readJsonBody(req);
  const membershipId = String(body.membershipId || '').trim();
  if (!membershipId) {
    res.status(400).json({ error: 'Missing membershipId' });
    return;
  }

  const redirectTo = resolveLoginRedirect(req, body);
  if (!redirectTo) {
    res.status(400).json({ error: 'Missing or invalid origin' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: requesterData, error: requesterError } = await supabase.auth.getUser(token);
  if (requesterError || !requesterData?.user) {
    res.status(401).json({ error: 'Invalid auth token' });
    return;
  }

  const requester = requesterData.user;
  const requesterEmail = String(requester.email || '').toLowerCase();
  const isPlatformOwner = requesterEmail === PLATFORM_OWNER_EMAIL.toLowerCase();

  const { data: targetMembership, error: membershipError } = await supabase
    .from('memberships')
    .select('id, user_id, school_id, role')
    .eq('id', membershipId)
    .maybeSingle();

  if (membershipError || !targetMembership?.id) {
    res.status(404).json({ error: 'Target membership not found' });
    return;
  }

  const targetRole = String(targetMembership.role || '').toLowerCase();
  if (!QR_LOGIN_ROLES.has(targetRole)) {
    res.status(403).json({ error: 'QR login is only available for score_taker or viewer roles' });
    return;
  }

  if (!isPlatformOwner) {
    const { data: requesterMemberships, error: requesterMembershipError } = await supabase
      .from('memberships')
      .select('role')
      .eq('user_id', requester.id)
      .eq('school_id', targetMembership.school_id);

    if (requesterMembershipError) {
      res.status(500).json({ error: 'Failed to verify requester access' });
      return;
    }

    const requesterRoles = new Set((requesterMemberships || []).map((row) => String(row.role || '').toLowerCase()));
    if (!(requesterRoles.has('admin') || requesterRoles.has('superadmin'))) {
      res.status(403).json({ error: 'Not authorized to generate QR login for this user' });
      return;
    }
  }

  const { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(targetMembership.user_id);
  const authUser = authUserData?.user;
  if (authUserError || !authUser) {
    res.status(404).json({ error: 'Target auth user not found' });
    return;
  }

  const targetEmail = String(authUser.email || '').trim();
  if (!targetEmail) {
    res.status(400).json({ error: 'Target user has no email address' });
    return;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('user_id', targetMembership.user_id)
    .maybeSingle();

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: targetEmail,
    options: { redirectTo },
  });

  if (linkError || !linkData?.properties?.action_link) {
    res.status(500).json({ error: linkError?.message || 'Failed to generate QR login link' });
    return;
  }

  res.status(200).json({
    ok: true,
    actionLink: linkData.properties.action_link,
    email: targetEmail,
    fullName: profile?.full_name || authUser.user_metadata?.full_name || '',
    role: targetRole === 'score_viewer' ? 'viewer' : targetRole,
    redirectTo,
  });
}
