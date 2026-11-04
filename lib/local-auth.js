// The firm's own accounts (VPS, 2026-11-04): what Supabase Auth did, on the firm's PostgreSQL (db/vps-auth.sql).
// lib/accounts.js keeps calling authCall(path, { method, body, admin }) and gets the same { status, data } as from Supabase
// (/auth/v1/token, /signup, /verify, /admin/users, /admin/generate_link, /settings, /user), so login, sign-up, account management,
// the closing of a firm and « Continuer avec Google » (lib/google-signin.js) do not change.
// Passwords: the bcrypt hashes taken over from Supabase are checked as they are (everyone keeps their password) and replaced by a
// scrypt hash at the next successful login. Tokens: random, only their sha-256 is stored. Nothing secret is logged.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const sha = s => createHash('sha256').update(String(s)).digest('hex');
const token = prefix => prefix + randomBytes(32).toString('base64url');
const ACCESS_MS = 60 * 60 * 1000, REFRESH_MS = 30 * 24 * 60 * 60 * 1000, LINK_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const localAuthEnabled = (env = process.env) => Boolean(env.DATABASE_URL) && env.OFFICE_MANAGER_AUTH !== 'supabase';

// ---- passwords ---------------------------------------------------------------------------------------------------------------
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function checkPasswordHash(password, stored) {
  if (!stored || !password) return false;
  if (stored.startsWith('scrypt$')) {
    const [, N, r, p, salt, hash] = stored.split('$');
    const want = Buffer.from(hash, 'base64');
    const got = await scrypt(String(password), Buffer.from(salt, 'base64'), want.length, { N: Number(N), r: Number(r), p: Number(p) });
    return got.length === want.length && timingSafeEqual(got, want);
  }
  if (/^\$2[aby]\$\d\d\$/.test(stored)) { const { default: bcrypt } = await import('bcryptjs'); return bcrypt.compare(String(password), stored); }
  return false;
}

// ---- users and sessions --------------------------------------------------------------------------------------------------------
const publicUser = u => u && ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.email_confirmed_at || null,
  confirmed_at: u.email_confirmed_at || null, user_metadata: u.raw_user_meta_data || {}, app_metadata: { provider: 'email', ...(u.raw_app_meta_data || {}) },
  is_anonymous: false, created_at: u.created_at, updated_at: u.updated_at, last_sign_in_at: u.last_sign_in_at || null });

async function openSession(db, user) {
  const access = token('om_at_'), refresh = token('om_rt_');
  const now = Date.now();
  await db.query(`insert into auth.om_sessions (user_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at) values ($1, $2, $3, $4, $5)`,
    [user.id, sha(access), new Date(now + ACCESS_MS).toISOString(), sha(refresh), new Date(now + REFRESH_MS).toISOString()]);
  await db.query(`update auth.users set last_sign_in_at = now() where id = $1`, [user.id]);
  return { access_token: access, token_type: 'bearer', expires_in: ACCESS_MS / 1000, expires_at: Math.floor((now + ACCESS_MS) / 1000), refresh_token: refresh, user: publicUser(user) };
}
const userById = async (db, id) => (await db.query(`select * from auth.users where id = $1`, [id]))[0] || null;
const userByEmail = async (db, email) => (await db.query(`select * from auth.users where lower(email) = lower($1)`, [String(email || '').trim()]))[0] || null;
const banned = u => u?.banned_until && new Date(u.banned_until) > new Date();

// The person behind an access token (lib/user-auth.js), or null.
export async function userFromAccessToken(accessToken, db) {
  if (!accessToken) return null;
  db = db || (await import('./pg-db.js')).pgDb;
  const row = (await db.query(`select u.* from auth.om_sessions s join auth.users u on u.id = s.user_id
    where s.access_hash = $1 and s.revoked_at is null and s.access_expires_at > now() and s.refresh_expires_at > now()`, [sha(accessToken)]))[0];
  return row && !banned(row) ? publicUser(row) : null;
}

async function createLink(db, userId, kind, { passwordHash = null, meta = null } = {}) {
  const raw = token('om_lk_');
  await db.query(`insert into auth.om_links (token_hash, user_id, kind, expires_at, password_hash, user_meta) values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [sha(raw), userId, kind, new Date(Date.now() + LINK_MS).toISOString(), passwordHash, meta == null ? null : JSON.stringify(meta)]);
  return raw;
}
// Uses a single-use link (by its raw value or its hash); confirms the address; opens a session.
// Security review 2026-11-04 (account pre-hijacking): a sign-up link applies ITS password; a magic link (Google proved the address)
// that confirms an address nobody had confirmed yet removes any password set before, and ends any session of that account.
async function useLink(db, { raw, hash, kinds }) {
  const h = hash || sha(raw || '');
  const rows = await db.query(`update auth.om_links set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() and kind = any($2::text[])
    returning user_id, kind, password_hash, user_meta`, [h, kinds]);
  if (!rows.length) return null;
  const link = rows[0], before = await userById(db, link.user_id);
  if (!before) return null;
  if (link.kind === 'signup') {
    await db.query(`update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()), encrypted_password = coalesce($2, encrypted_password),
      raw_user_meta_data = coalesce($3::jsonb, raw_user_meta_data), updated_at = now() where id = $1`, [link.user_id, link.password_hash, link.user_meta == null ? null : JSON.stringify(link.user_meta)]);
    await db.query(`update auth.om_links set used_at = now() where user_id = $1 and kind = 'signup' and used_at is null`, [link.user_id]);
  } else if (!before.email_confirmed_at) {
    await db.query(`update auth.users set email_confirmed_at = now(), encrypted_password = null, updated_at = now() where id = $1`, [link.user_id]);
    await db.query(`update auth.om_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [link.user_id]);
    await db.query(`update auth.om_links set used_at = now() where user_id = $1 and kind = 'signup' and used_at is null`, [link.user_id]);
  }
  const user = await userById(db, link.user_id);
  return user && !banned(user) ? openSession(db, user) : null;
}

// ---- the e-mail that confirms an address ---------------------------------------------------------------------------------------
async function sendConfirmation(email, link, d) {
  if (d.sendMail) return d.sendMail({ to: email, link });
  const env = d.env || process.env;
  if (!env.SMTP_HOST || !env.SMTP_FROM) throw Object.assign(new Error('EMAIL_SENDER_NOT_CONFIGURED'), { statusCode: 503 });
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: String(env.SMTP_PORT) === '465',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined });
  await transport.sendMail({ from: env.SMTP_FROM, to: email, subject: 'Confirmez votre adresse — Office Manager',
    text: `Bonjour,\n\nPour confirmer votre adresse et ouvrir votre compte, ouvrez ce lien (valable 24 h) :\n${link}\n\nSi vous n'avez rien demandé, ignorez ce message.` });
}
const publicUrl = env => String(env.OFFICE_MANAGER_PUBLIC_URL || '').replace(/\/$/, '');

// ---- too many wrong passwords (Supabase Auth answered 429; lib/accounts.js shows TOO_MANY_ATTEMPTS) ---------------------------------
// Security review 2026-11-04: counted per (caller address + account) — a stranger cannot lock someone out from his own address —
// per caller address over all accounts (credential stuffing), and per account over all addresses (a search spread over many
// addresses; high enough that one stranger alone cannot lock a person out). IPv6 addresses count per /64. The try is RESERVED before
// the password is checked (parallel tries cannot slip through); a right password gives back only the try of ITS account (pair and
// account counters), never the address counter. Over the account cap the account is not locked: it gets one try every
// ACCOUNT_SLOW_MS whatever the address (a spread search becomes very slow, the real person still gets in). A counter inside its
// window is never dropped; if the table is still full after sweeping the expired ones, untracked tries share ONE global pace
// (UNTRACKED_EVERY_MS for the whole server): never free, never everyone locked out.
// Known limit: counters live in this process (a restart forgets them); the address is the one lib/attempts.js trusts (Caddy, Vercel).
const failures = new Map();
// (Review of 313e10b) Over the account cap the pace DOUBLES after each try (5 s, 10 s, 20 s… up to 10 min): only a handful of extra
// guesses. An address that has already signed in to this account (last 30 days) is not paced: the real person gets in from her usual
// place. A full table makes room by dropping the OLDEST address / pair counters, never an account counter: the account cap always holds.
const PAIR_MAX = 10, ADDRESS_MAX = 50, ACCOUNT_MAX = 100, FAIL_WINDOW_MS = 10 * 60 * 1000, TRACK_MAX = 50000, ACCOUNT_SLOW_MS = 5000, TRUST_MS = 30 * 24 * 60 * 60 * 1000;
const trusted = new Map(); // 'acct|who' -> Map(addressKey -> last success)
function live(key, now) { const f = failures.get(key); if (f && now - f.since > FAIL_WINDOW_MS) { failures.delete(key); return null; } return f || null; }
function sweep(now) { for (const [k, f] of failures) if (now - f.since > FAIL_WINDOW_MS) failures.delete(k); }
function makeRoom(n, now) {
  sweep(now);
  for (const k of failures.keys()) { if (failures.size + n <= TRACK_MAX) return; if (!k.startsWith('acct|')) failures.delete(k); }
  for (const k of failures.keys()) { if (failures.size + n <= TRACK_MAX) return; failures.delete(k); }
}
const isTrusted = (acct, addr, now) => (now - (trusted.get(acct)?.get(addr) || 0)) < TRUST_MS;
// Reserves one try for these keys; false = refused (429).
function reserve(limits, now = Date.now()) {
  const addr = limits.find(([k]) => k.startsWith('addr|'))?.[0].slice(5);
  for (const [k, max] of limits) {
    const f = live(k, now);
    if (!f || f.count < max) continue;
    if (!k.startsWith('acct|')) return false;
    if (isTrusted(k, addr, now)) continue;            // the person's usual address is never paced
    if (now < (f.next || 0)) return false;            // the account's pace, doubling
    f.step = Math.min((f.step || ACCOUNT_SLOW_MS / 2) * 2, FAIL_WINDOW_MS);
    f.next = now + f.step;
  }
  const missing = limits.filter(([k]) => !live(k, now));
  if (missing.length && failures.size + missing.length > TRACK_MAX) makeRoom(missing.length, now);
  for (const [k] of missing) failures.set(k, { count: 0, since: now });
  for (const [k] of limits) failures.get(k).count++;
  return true;
}
async function admit(limits) { return reserve(limits); }
function rememberSuccess(limits, now = Date.now()) {
  const acct = limits.find(([k]) => k.startsWith('acct|'))?.[0], addr = limits.find(([k]) => k.startsWith('addr|'))?.[0].slice(5);
  if (!acct || !addr) return;
  if (!trusted.has(acct)) { if (trusted.size > TRACK_MAX) trusted.delete(trusted.keys().next().value); trusted.set(acct, new Map()); }
  const m = trusted.get(acct); m.delete(addr); m.set(addr, now); if (m.size > 20) m.delete(m.keys().next().value);
}
function giveBack(limits, now = Date.now()) { for (const [k] of limits) if (!k.startsWith('addr|')) { const f = live(k, now); if (f) f.count = Math.max(0, f.count - 1); } }
// IPv6 counts per /64 (one machine usually holds a whole /64).
function addressKey(ip) {
  const a = String(ip || 'unknown').trim().toLowerCase().slice(0, 64);
  if (!a.includes(':') || /^::ffff:\d+\.\d+\.\d+\.\d+$/.test(a)) return a.replace(/^::ffff:/, '');
  const [head, tail = ''] = a.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return full.slice(0, 4).map(x => x.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}
const limitsFor = (ip, who) => { const a = addressKey(ip); return [['pair|' + a + '|' + who, PAIR_MAX], ['addr|' + a, ADDRESS_MAX], ['acct|' + who, ACCOUNT_MAX]]; };
export function _resetFailures() { failures.clear(); trusted.clear(); }
export const _addressKey = addressKey;

// ---- authCall, as Supabase answered it -------------------------------------------------------------------------------------------
export async function localAuthCall(path, { method = 'POST', body = {}, ip = null } = {}, d = {}) {
  const opts = { ip };
  const db = d.db || (await import('./pg-db.js')).pgDb;
  const env = d.env || process.env;
  const [route, qs = ''] = String(path).split('?');
  const grant = new URLSearchParams(qs).get('grant_type');
  const bad = (status, error, description) => ({ status, data: { error, error_description: description, msg: description } });
  body = body || {};

  if (route === 'token' && grant === 'password') {
    if (!/^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{1,63}$/.test(String(body.email || '').trim())) return bad(400, 'invalid_grant', 'Invalid login credentials'); // no counter for a malformed address
    const limits = limitsFor(opts.ip, 'pw:' + String(body.email || '').trim().toLowerCase());
    if (!(await admit(limits))) return bad(429, 'over_request_rate_limit', 'Too many attempts');
    const user = await userByEmail(db, body.email);
    if (!user || banned(user) || !(await checkPasswordHash(body.password, user.encrypted_password))) return bad(400, 'invalid_grant', 'Invalid login credentials');
    giveBack(limits); rememberSuccess(limits);
    if (!user.email_confirmed_at) return bad(400, 'invalid_grant', 'Email not confirmed');
    if (!String(user.encrypted_password).startsWith('scrypt$')) await db.query(`update auth.users set encrypted_password = $2, updated_at = now() where id = $1`, [user.id, await hashPassword(body.password)]);
    return { status: 200, data: await openSession(db, user) };
  }
  if (route === 'token' && grant === 'refresh_token') {
    const rt = String(body.refresh_token || '');
    const s = (await db.query(`select * from auth.om_sessions where refresh_hash = $1 and revoked_at is null and refresh_expires_at > now()`, [sha(rt)]))[0];
    const user = s && await userById(db, s.user_id);
    if (!user || banned(user)) return bad(400, 'invalid_grant', 'Invalid Refresh Token');
    // A new access token; the refresh token stays the same until it expires (several tabs refresh at once without losing the session).
    const access = token('om_at_');
    await db.query(`update auth.om_sessions set access_hash = $2, access_expires_at = $3 where id = $1`, [s.id, sha(access), new Date(Date.now() + ACCESS_MS).toISOString()]);
    return { status: 200, data: { access_token: access, token_type: 'bearer', expires_in: ACCESS_MS / 1000, expires_at: Math.floor((Date.now() + ACCESS_MS) / 1000), refresh_token: rt, user: publicUser(user) } };
  }
  if (route === 'logout') {
    await db.query(`update auth.om_sessions set revoked_at = now() where refresh_hash = $1`, [sha(body.refresh_token || '')]);
    return { status: 204, data: null };
  }
  if (route === 'signup') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || String(body.password || '').length < 8) return bad(422, 'validation_failed', 'Invalid email or password');
    let user = await userByEmail(db, email);
    // An address already confirmed: the same neutral answer as Supabase (nobody learns which addresses have an account).
    if (user?.email_confirmed_at) return { status: 200, data: { id: user.id, email, user_metadata: {}, identities: [] } };
    // The account is created WITHOUT a password: each sign-up keeps ITS password with ITS link. Opening a link is not enough to
    // confirm: the person types the password of that sign-up (confirmSignupLink). Someone who registers the address of another
    // person cannot confirm it (no access to the mailbox), and the owner of the mailbox cannot confirm the intruder's sign-up
    // (they do not know its password) — security review 2026-11-04. Earlier links stay valid; the first one confirmed voids the others.
    if (!user) user = (await db.query(`insert into auth.users (email, encrypted_password) values ($1, null) returning *`, [email]))[0];
    const raw = await createLink(db, user.id, 'signup', { passwordHash: await hashPassword(body.password), meta: body.data || {} });
    const base = publicUrl(env);
    if (!base) throw Object.assign(new Error('PUBLIC_URL_NOT_CONFIGURED'), { statusCode: 503 });
    await sendConfirmation(email, `${base}/auth/v1/verify?type=signup&token=${encodeURIComponent(raw)}`, d);
    return { status: 200, data: publicUser(user) };
  }
  if (route === 'verify' && body.type === 'signup') {
    // A sign-up link is used only with the password chosen for THAT sign-up (never the link alone).
    const h = sha(body.token || '');
    const link = (await db.query(`select l.password_hash, u.email from auth.om_links l join auth.users u on u.id = l.user_id
      where l.token_hash = $1 and l.kind = 'signup' and l.used_at is null and l.expires_at > now()`, [h]))[0];
    if (!link) return bad(403, 'otp_expired', 'Token has expired or is invalid');
    const limits = limitsFor(opts.ip, 'link:' + h);
    if (!(await admit(limits))) return bad(429, 'over_request_rate_limit', 'Too many attempts');
    if ((body.email && String(body.email).trim().toLowerCase() !== String(link.email).toLowerCase()) || !(await checkPasswordHash(body.password, link.password_hash)))
      return bad(400, 'invalid_grant', 'Invalid login credentials');
    giveBack(limits); rememberSuccess(limits);
    const s = await useLink(db, { hash: h, kinds: ['signup'] });
    return s ? { status: 200, data: s } : bad(403, 'otp_expired', 'Token has expired or is invalid');
  }
  if (route === 'verify') {
    const s = await useLink(db, { raw: body.token, hash: body.token_hash, kinds: ['magiclink'] });
    return s ? { status: 200, data: s } : bad(403, 'otp_expired', 'Token has expired or is invalid');
  }
  if (route === 'settings' && method === 'GET') return { status: 200, data: { external: { email: true, google: false }, mailer_autoconfirm: false } };
  if (route === 'admin/users' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(422, 'validation_failed', 'Invalid email');
    if (await userByEmail(db, email)) return { status: 422, data: { code: 'email_exists', msg: 'A user with this email address has already been registered' } };
    const user = (await db.query(`insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ($1, $2, $3, $4::jsonb) returning *`,
      [email, body.password ? await hashPassword(body.password) : null, body.email_confirm ? new Date().toISOString() : null, JSON.stringify(body.user_metadata || {})]))[0];
    return { status: 200, data: publicUser(user) };
  }
  const one = route.match(/^admin\/users\/([^/]+)$/);
  if (one) {
    if (!UUID.test(one[1])) return bad(404, 'user_not_found', 'User not found');
    if (method === 'PUT') {
      if (!body.password) return bad(422, 'validation_failed', 'Nothing to update');
      const rows = await db.query(`update auth.users set encrypted_password = $2, updated_at = now() where id = $1 returning *`, [one[1], await hashPassword(body.password)]);
      if (!rows.length) return bad(404, 'user_not_found', 'User not found');
      await db.query(`update auth.om_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [one[1]]);
      return { status: 200, data: publicUser(rows[0]) };
    }
    if (method === 'DELETE') {
      const rows = await db.query(`delete from auth.users where id = $1 returning id`, [one[1]]);
      return rows.length ? { status: 200, data: {} } : bad(404, 'user_not_found', 'User not found');
    }
    if (method === 'GET') { const u = await userById(db, one[1]); return u ? { status: 200, data: publicUser(u) } : bad(404, 'user_not_found', 'User not found'); }
  }
  if (route === 'admin/generate_link') {
    const user = await userByEmail(db, body.email);
    if (!user) return bad(404, 'user_not_found', 'User not found');
    const raw = await createLink(db, user.id, body.type === 'signup' ? 'signup' : 'magiclink');
    return { status: 200, data: { properties: { hashed_token: sha(raw), verification_type: body.type || 'magiclink' }, user: publicUser(user) } };
  }
  return bad(404, 'not_found', 'Unknown auth route');
}

// GET /auth/v1/verify?type=signup&token=… (the link of the e-mail): nothing is confirmed yet. The person lands on the login page,
// which asks for the e-mail and the password chosen at sign-up and sends them with the token (route confirm-signup).
export async function verifyLinkRedirect(query, d = {}) {
  const db = d.db || (await import('./pg-db.js')).pgDb;
  const raw = String(query.token || '');
  const ok = /^om_lk_[A-Za-z0-9_-]{20,80}$/.test(raw) && (await db.query(`select 1 from auth.om_links where token_hash = $1 and kind = 'signup' and used_at is null and expires_at > now()`, [sha(raw)])).length;
  if (!ok) return '/login.html#error=access_denied&error_code=otp_expired&error_description=' + encodeURIComponent('Le lien a expiré ou a déjà servi.');
  return '/login.html#' + new URLSearchParams({ confirm_token: raw });
}
