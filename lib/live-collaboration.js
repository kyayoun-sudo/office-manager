import { rest } from './supabase.js';
import { visiblePeople, MANAGERS } from './roles.js';
import { chatState } from './chat.js';
const q = encodeURIComponent;
const fail = code => Object.assign(new Error(code), { statusCode: 400 });

// Heartbeats describe a recently visible application tab, never working time.
export async function collaboration(orgId, account, input = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const now = d.now ? d.now() : Date.now();
  const email = String(account?.email || '').toLowerCase();
  if (!email) throw Object.assign(new Error('USER_SESSION_REQUIRED'), { statusCode: 401 });
  const scope = `org_id=eq.${q(orgId)}&email=eq.${q(email)}`;
  if (input.action === 'heartbeat') {
    await fetchRows('office_presence?on_conflict=org_id,email', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ org_id: orgId, email, last_seen_at: new Date(now).toISOString() }]) });
  }
  if (input.action === 'read') {
    const state = await chatState(orgId, account, { conversation: input.conversation }, { fetchRows, now: () => now });
    const message = state.messages.find(m => m.id === input.message_id);
    if (!message) throw fail('MESSAGE_NOT_VISIBLE');
    // An append-only cursor cannot move backwards when two browser tabs race.
    await fetchRows('office_chat_reads?on_conflict=org_id,email,message_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify([{ org_id: orgId, email, message_id: message.id }]) });
  }
  const state = await chatState(orgId, account, {}, { fetchRows, now: () => now });
  if (!state.available) return { available: false };
  const ids = (state.recent_messages || []).map(m => q(m.id));
  const reads = [];
  for (let i = 0; i < ids.length; i += 100) reads.push(...(await fetchRows('office_chat_reads?' + scope + '&message_id=in.(' + ids.slice(i, i + 100).join(',') + ')&select=message_id&limit=100') || []));
  const seen = new Set((reads || []).map(r => r.message_id));
  const incoming = (state.recent_messages || []).filter(m => m.sender_email.toLowerCase() !== email);
  // Each read marks a conversation through the displayed server message timestamp.
  const through = new Map();
  for (const m of state.recent_messages || []) if (seen.has(m.id)) through.set(m.conversation, Math.max(through.get(m.conversation) || 0, Date.parse(m.created_at)));
  const unread = incoming.filter(m => Date.parse(m.created_at) > (through.get(m.conversation) || 0));
  let people = [];
  if (MANAGERS.includes(account.role)) {
    const allowed = await visiblePeople(orgId, account, fetchRows);
    const [presence, users] = await Promise.all([
      fetchRows(`office_presence?org_id=eq.${q(orgId)}&last_seen_at=gte.${q(new Date(now - 45000).toISOString())}&select=email,last_seen_at&limit=1000`),
      fetchRows(`office_app_users?org_id=eq.${q(orgId)}&active=eq.true&select=email,display_name&limit=1000`)
    ]);
    const active = new Map(users.map(u => [u.email.toLowerCase(), u]));
    people = presence.filter(p => active.has(p.email) && (!allowed || allowed.has(p.email))).map(p => ({ email: p.email, name: active.get(p.email).display_name || p.email }));
  }
  return { available: true, unread: unread.length, unread_ids: unread.map(m => m.id), conversations: Object.fromEntries(state.conversations.map(c => [c.key, unread.filter(m => m.conversation === c.key).length])), people, presence_visible: MANAGERS.includes(account.role), checked_at: new Date(now).toISOString() };
}
