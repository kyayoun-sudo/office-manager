import { rest } from './supabase.js';
import { NOT_ARCHIVED_FILTER } from './mission-status.js';

// INSTANT INTERNAL MESSAGING (2026-10-08, « une messagerie instantanée interne »). Between the
// people of the firm, inside the app: no validation, quick. Messages are visible for about 24 h,
// then ARCHIVED (kept, out of the conversation; « Voir l'archive » shows them). Important
// decisions, validations and audited items stay recorded elsewhere (À valider, audit log, mission
// file). Formal external e-mails stay in the controlled workflow (validated before sending).
// Conversations: « cabinet » (everyone), one per mission (« mission:<id> »), and direct
// conversations between two people (« dm:<email>|<email> », readable only by those two).

const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86400000;
const me = account => String(account?.email || '').toLowerCase();

export function directKey(a, b) { return 'dm:' + [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('|'); }

// Who may read / write a conversation.
export function canUse(key, account) {
  if (key === 'cabinet') return true;
  if (/^mission:[0-9a-f-]{36}$/i.test(key)) return true;
  const m = /^dm:([^|]+)\|([^|]+)$/.exec(key || '');
  return Boolean(m && me(account) && (m[1] === me(account) || m[2] === me(account)));
}

function missing(e) { return /office_chat_messages|PGRST|42P01|relation/i.test(String(e?.message || e)); }

export async function chatState(orgId, account, input = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const now = d.now ? d.now() : Date.now();
  const org = 'org_id=eq.' + q(orgId);
  const [users, missions] = await Promise.all([
    fetchRows('office_app_users?' + org + '&active=eq.true&select=email,display_name,role&limit=300').catch(() => []),
    fetchRows('office_missions?' + org + '&' + NOT_ARCHIVED_FILTER + '&select=id,name&order=created_at.desc&limit=100').catch(() => [])
  ]);
  let recent = [];
  try {
    recent = await fetchRows('office_chat_messages?' + org + '&archived=eq.false&created_at=gte.' + q(new Date(now - DAY).toISOString()) + '&select=id,conversation,sender_email,sender_name,body,created_at&order=created_at.asc&limit=2000') || [];
  } catch (e) { if (missing(e)) return { available: false, reason: 'MIGRATION_MISSING', users: [], missions: [], conversations: [], messages: [] }; throw e; }
  const mine = recent.filter(m => canUse(m.conversation, account));
  const key = input.conversation || 'cabinet';
  if (!canUse(key, account)) throw fail('CONVERSATION_FORBIDDEN', 403);
  let messages = mine.filter(m => m.conversation === key);
  if (input.archive) {
    messages = await fetchRows('office_chat_messages?' + org + '&conversation=eq.' + q(key) + '&select=id,conversation,sender_email,sender_name,body,created_at,archived&order=created_at.desc&limit=200').catch(() => []) || [];
    messages.reverse();
  }
  const last = new Map();
  for (const m of mine) last.set(m.conversation, m);
  const label = c => c === 'cabinet' ? 'Tout le cabinet' : c.startsWith('mission:') ? (missions.find(x => 'mission:' + x.id === c)?.name || 'Mission') : (users.find(u => c.split(':')[1].split('|').filter(x => x !== me(account))[0] === String(u.email).toLowerCase())?.display_name || c.split(':')[1].split('|').filter(x => x !== me(account))[0]);
  const conversations = [...new Set(['cabinet', ...last.keys()])].map(c => ({ key: c, label: label(c), last: last.get(c) ? { body: String(last.get(c).body).slice(0, 120), at: last.get(c).created_at, from: last.get(c).sender_name } : null }))
    .sort((a, b) => String(b.last?.at || '').localeCompare(String(a.last?.at || '')));
  return { available: true, me: me(account), conversation: key, label: label(key), conversations, messages,
    users: users.filter(u => String(u.email).toLowerCase() !== me(account)).map(u => ({ email: String(u.email).toLowerCase(), name: u.display_name || u.email })),
    missions: missions.map(m => ({ key: 'mission:' + m.id, name: m.name })) };
}

export async function sendChat(orgId, account, input = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  if (!me(account)) throw fail('USER_SESSION_REQUIRED', 401);
  let key = String(input.conversation || 'cabinet');
  if (input.to) { const to = String(input.to).toLowerCase().trim(); if (!EMAIL.test(to)) throw fail('INVALID_RECIPIENT'); key = directKey(me(account), to); }
  if (key.startsWith('mission:') && !UUID.test(key.slice(8))) throw fail('INVALID_CONVERSATION');
  if (!canUse(key, account)) throw fail('CONVERSATION_FORBIDDEN', 403);
  const body = String(input.body || '').trim();
  if (!body || body.length > 4000) throw fail('INVALID_BODY');
  try {
    const [row] = await fetchRows('office_chat_messages', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ org_id: orgId, conversation: key, sender_email: me(account), sender_name: account.display_name || me(account), body }]) });
    return { ...row, conversation: key };
  } catch (e) { if (missing(e)) throw fail('MIGRATION_MISSING_DB_MEMORY_SQL', 409); throw e; }
}

// Each tick: messages older than 24 h leave the conversations (kept in the archive).
export async function archiveOldChat(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const now = d.now ? d.now() : Date.now();
  try {
    await fetchRows('office_chat_messages?org_id=eq.' + q(orgId) + '&archived=eq.false&created_at=lt.' + q(new Date(now - DAY).toISOString()), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ archived: true }) });
    return { archived: true };
  } catch { return { archived: false }; }
}
