import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
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

function verifyPin(pin, storedHash) {
  const normalizedHash = String(storedHash || '');
  if (!normalizedHash) return false;

  if (normalizedHash.startsWith('scrypt:')) {
    const [, salt, expected] = normalizedHash.split(':');
    if (!salt || !expected) return false;
    const actual = crypto.scryptSync(String(pin), salt, 32).toString('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = Buffer.from(actual, 'hex');
    if (expectedBuffer.length !== actualBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  }

  // Legacy fallback for earlier local SHA-256 test tokens.
  const actual = crypto.createHash('sha256').update(String(pin)).digest('hex');
  const expectedBuffer = Buffer.from(normalizedHash, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
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

  const body = readJsonBody(req);
  const token = String(body.token || '').trim();
  if (!token) {
    res.status(400).json({ error: 'Missing token' });
    return;
  }

  const redirectTo = resolveLoginRedirect(req, body);
  if (!redirectTo) {
    res.status(400).json({ error: 'Missing or invalid origin' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .select('id, user_id, role, qr_login_pin_hash, qr_login_enabled')
    .eq('qr_login_token', token)
    .maybeSingle();

  if (membershipError || !membership?.id || !membership.qr_login_enabled) {
    res.status(404).json({ error: 'QR login token not found or disabled', code: 'TOKEN_NOT_FOUND' });
    return;
  }

  const role = String(membership.role || '').toLowerCase();
  if (!QR_LOGIN_ROLES.has(role)) {
    res.status(403).json({ error: 'QR login is only available for score_taker or viewer roles' });
    return;
  }

  const normalizedRole = role === 'score_viewer' ? 'viewer' : role;
  if (normalizedRole === 'score_taker') {
    const normalizedPin = normalizePin(body.pin);
    if (normalizedPin.length !== 6) {
      res.status(401).json({ error: 'PIN required for score taker QR login', code: 'PIN_REQUIRED' });
      return;
    }
    const expectedHash = membership.qr_login_pin_hash || '';
    if (!verifyPin(normalizedPin, expectedHash)) {
      res.status(401).json({ error: 'Incorrect PIN', code: 'INVALID_PIN' });
      return;
    }
  }

  const { data: authUserData, error: authUserError } = await supabase.auth.admin.getUserById(membership.user_id);
  const authUser = authUserData?.user;
  if (authUserError || !authUser?.email) {
    res.status(404).json({ error: 'Target auth user not found' });
    return;
  }

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: String(authUser.email).trim(),
    options: { redirectTo },
  });

  if (linkError || !linkData?.properties?.action_link) {
    res.status(500).json({ error: linkError?.message || 'Failed to generate QR login link' });
    return;
  }

  res.status(200).json({
    ok: true,
    actionLink: linkData.properties.action_link,
    role: normalizedRole,
  });
}
