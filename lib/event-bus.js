import { rest } from './supabase.js';

// THE EVENT BUS — the system's nervous system (architecture §11-14, 2026-10-09).
// Agents do not call each other with free conversations: they publish small structured events,
// and the bus says who must react. An event carries ids and references, never a document's content.
// Idempotency: the same event (same idempotency key) is recorded once and handled once — a repeated
// signal never creates a second mission, a second PBC line or a second e-mail.
//
// Workflow authority stays separate: an event says « this happened » or « I recommend »; the
// consumer checks its own rules before changing anything, and a human still validates what matters.

const q = encodeURIComponent;
const cut = (s, n) => s == null ? null : String(s).slice(0, n);

// Who reacts to what (the architecture's examples; extended agent by agent, brick by brick).
export const ROUTES = Object.freeze({
  DOCUMENT_CLASSIFIED: 'mission-controller',        // Orpailleur → Mission Controller updates its PBC view
  NEEDS_HUMAN_CLASSIFICATION: 'mission-controller', // a mission document waits for a human answer
  POSSIBLE_DUPLICATE: 'mission-controller',         // nothing created; review required
  OPPORTUNITY_WON: 'mission-controller',            // Firm Manager → Mission Controller: KYC + independence (2026-10-10)
  MISSION_READY_FOR_ARCHIVE: 'orpailleur'           // Mission Controller → Orpailleur (archive pass, later brick)
});

function smallPayload(p = {}) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) {
    if (v == null || v === '') continue;
    if (typeof v === 'string') out[k] = v.slice(0, 400);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else { const j = JSON.stringify(v); if (j && j.length <= 600) out[k] = v; }
  }
  let s = JSON.stringify(out);
  while (s.length > 3800) { const k = Object.keys(out).pop(); delete out[k]; s = JSON.stringify(out); }
  return out;
}

// Publish an event (never blocks the agent's real work: a failure is returned, not thrown).
export async function emit(orgId, ev, d = {}) {
  const fetchRows = d.fetchRows || rest;
  if (!orgId || !/^[A-Z][A-Z0-9_]{2,60}$/.test(String(ev.type || ''))) return { error: 'INVALID_EVENT' };
  const key = cut(ev.idempotency_key || [ev.type, ev.object_type, ev.object_id, ev.version || ''].join(':'), 300);
  if (!key || key.length < 8) return { error: 'IDEMPOTENCY_KEY_REQUIRED' };
  const row = { org_id: orgId, event_type: ev.type, agent_id: cut(ev.agent, 60), actor_id: cut(ev.actor, 200), engagement_id: ev.engagement_id || null,
    object_type: cut(ev.object_type, 60), object_id: cut(ev.object_id, 200), source_reference: cut(ev.source, 300), consumer: ROUTES[ev.type] || cut(ev.consumer, 60) || null,
    idempotency_key: key, small_payload: smallPayload(ev.payload), occurred_at: ev.occurred_at || new Date().toISOString() };
  try {
    const r = await fetchRows('office_events?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([row]) });
    return r?.[0] ? { id: r[0].id, recorded: true } : { recorded: false, duplicate: true };
  } catch (e) { return { error: cut(e.message || e, 200) }; }
}

export async function pendingEvents(orgId, consumer, d = {}) {
  const fetchRows = d.fetchRows || rest;
  return await fetchRows('office_events?org_id=eq.' + q(orgId) + '&consumer=eq.' + q(consumer) + '&status=in.(new,failed)&attempts=lt.5' +
    '&select=id,event_type,agent_id,engagement_id,object_type,object_id,source_reference,small_payload,occurred_at,attempts&order=occurred_at.asc&limit=' + (d.limit || 50)).catch(() => []) || [];
}

async function settle(orgId, ev, status, result, fetchRows) {
  await fetchRows('office_events?org_id=eq.' + q(orgId) + '&id=eq.' + q(ev.id) + '&status=in.(new,failed)', { method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status, result: cut(result, 500), attempts: (ev.attempts || 0) + 1, handled_at: new Date().toISOString() }) }).catch(() => null);
}

// Each consumer handles its pending events, oldest first. handlers: { EVENT_TYPE: async (ev) => 'what was done' }.
// A handler returning { ignore: '…' } marks the event ignored (with the reason); a throw marks it failed
// (retried at the next tick, at most 5 times).
export async function dispatch(orgId, consumer, handlers, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const out = { handled: 0, ignored: 0, failed: 0 };
  for (const ev of await pendingEvents(orgId, consumer, d)) {
    const h = handlers[ev.event_type];
    if (!h) { await settle(orgId, ev, 'ignored', 'aucun traitement prévu pour ' + ev.event_type, fetchRows); out.ignored++; continue; }
    try {
      const r = await h(ev);
      if (r && r.ignore) { await settle(orgId, ev, 'ignored', r.ignore, fetchRows); out.ignored++; }
      else { await settle(orgId, ev, 'handled', typeof r === 'string' ? r : r?.result || 'traité', fetchRows); out.handled++; }
    } catch (e) { await settle(orgId, ev, 'failed', String(e.message || e), fetchRows); out.failed++; }
  }
  return out;
}

export async function listEvents(orgId, { engagementId, limit = 100 } = {}, fetchRows = rest) {
  return await fetchRows('office_events?org_id=eq.' + q(orgId) + (engagementId ? '&engagement_id=eq.' + q(engagementId) : '') +
    '&select=id,event_type,agent_id,consumer,engagement_id,object_type,object_id,source_reference,small_payload,occurred_at,status,result,handled_at&order=occurred_at.desc&limit=' + Math.min(limit, 500)).catch(() => []) || [];
}
