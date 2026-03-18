import crypto from 'crypto';
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

function normalizePin(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function createReusableToken() {
  return `napfa5qr_${crypto.randomBytes(24).toString('hex')}`;
}

async function getAuthorizedTarget(req, supabase, membershipId) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return { error: { status: 401, error: 'Missing auth token' } };

  const { data: requesterData, error: requesterError } = await supabase.auth.getUser(token);
  if (requesterError || !requesterData?.user) {
    return { error: { status: 401, error: 'Invalid auth token' } };
  }

  const requester = requesterData.user;
  const requesterEmail = String(requester.email || '').toLowerCase();
  const isPlatformOwner = requesterEmail === PLATFORM_OWNER_EMAIL.toLowerCase();

  const { data: targetMembership, error: membershipError } = await supabase
    .from('memberships')
    .select('id, user_id, school_id, role, qr_login_token, qr_login_pin_hash, qr_login_enabled')
    .eq('id', membershipId)
    .maybeSingle();

  if (membershipError || !targetMembership?.id) {
    return { error: { status: 404, error: 'Target membership not found' } };
  }

  const targetRole = String(targetMembership.role || '').toLowerCase();
  if (!QR_LOGIN_ROLES.has(targetRole)) {
    return { error: { status: 403, error: 'QR login is only available for score_taker or viewer roles' } };
  }

  if (!isPlatformOwner) {
    const { data: requesterMemberships, error: requesterMembershipError } = await supabase
      .from('memberships')
      .select('role')
      .eq('user_id', requester.id)
      .eq('school_id', targetMembership.school_id);

    if (requesterMembershipError) {
      return { error: { status: 500, error: 'Failed to verify requester access' } };
    }

    const requesterRoles = new Set((requesterMemberships || []).map((row) => String(row.role || '').toLowerCase()));
    if (!(requesterRoles.has('admin') || requesterRoles.has('superadmin'))) {
      return { error: { status: 403, error: 'Not authorized to manage QR login for this user' } };
    }
  }

  const { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(targetMembership.user_id);
  const authUser = authUserData?.user;
  if (authUserError || !authUser) {
    return { error: { status: 404, error: 'Target auth user not found' } };
  }

  return {
    authUser,
    targetMembership,
    targetRole: targetRole === 'score_viewer' ? 'viewer' : targetRole,
  };
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

  const body = readJsonBody(req);
  const membershipId = String(body.membershipId || '').trim();
  const regenerate = body.regenerate === true;
  if (!membershipId) {
    res.status(400).json({ error: 'Missing membershipId' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const resolved = await getAuthorizedTarget(req, supabase, membershipId);
  if (resolved.error) {
    res.status(resolved.error.status).json({ error: resolved.error.error, code: resolved.error.code || null });
    return;
  }

  const { authUser, targetMembership, targetRole } = resolved;
  const normalizedPin = normalizePin(body.pin);
  if (normalizedPin && normalizedPin.length !== 6) {
    res.status(400).json({ error: 'PIN must be exactly 6 digits.', code: 'INVALID_PIN_FORMAT' });
    return;
  }

  const hasExistingToken = !!targetMembership.qr_login_token && !!targetMembership.qr_login_enabled;
  const existingPinHash = targetMembership.qr_login_pin_hash || null;
  const isScoreTaker = targetRole === 'score_taker';

  if (isScoreTaker && !hasExistingToken && !existingPinHash && !normalizedPin) {
    res.status(400).json({
      error: 'Score taker QR login requires a 6-digit PIN before first issue.',
      code: 'PIN_REQUIRED',
    });
    return;
  }

  const nextToken = (hasExistingToken && !regenerate) ? targetMembership.qr_login_token : createReusableToken();
  const nextPinHash = isScoreTaker
    ? (normalizedPin ? hashPin(normalizedPin) : existingPinHash)
    : null;

  const { error: updateError } = await supabase
    .from('memberships')
    .update({
      qr_login_token: nextToken,
      qr_login_pin_hash: nextPinHash,
      qr_login_enabled: true,
      qr_login_updated_at: new Date().toISOString(),
    })
    .eq('id', targetMembership.id);

  if (updateError) {
    const updateMessage = String(updateError.message || '');
    if (/permission denied for schema audit/i.test(updateMessage)) {
      res.status(500).json({
        error: 'Failed to save QR login settings because the memberships audit trigger cannot write to schema audit. Grant the server-side database role access to audit or adjust the trigger owner, then try again.',
        code: 'AUDIT_SCHEMA_PERMISSION_DENIED',
      });
      return;
    }
    res.status(500).json({ error: updateMessage || 'Failed to save QR login settings' });
    return;
  }

  res.status(200).json({
    ok: true,
    membershipId: targetMembership.id,
    email: String(authUser.email || '').trim(),
    fullName: authUser.user_metadata?.full_name || '',
    role: targetRole,
    token: nextToken,
    qrValue: `napfa5-login://access?token=${encodeURIComponent(nextToken)}`,
    requiresPin: isScoreTaker,
    regenerated: regenerate || !hasExistingToken,
    pinConfigured: !!nextPinHash,
  });
}
