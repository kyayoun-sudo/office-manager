import { rest } from './supabase.js';
import { primeOrgKind } from './simulation-guard.js';

// Journal of a simulation (2026-11-21, step 3): what people asked the agents, what the agents answered, what people corrected.
// Written ONLY for a simulation whose type was read without error; never throws (the journal never blocks the work).
const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ['consigne', 'reponse', 'correction'];
const MAX_BODY = 4000;
const SEE_ALL = ['owner', 'partner'];

// Audit events that are a correction by a person (plus any event refused by a person, see isCorrection).
export const CORRECTION_TYPES = Object.freeze(['PIECE_PROFILE_CORRECTED', 'WORKFILE_CELLS_WRITTEN', 'WORKFILE_IMPORT_UNDONE', 'WORKFILE_SHEET_CLEARED',
  'PIECES_RENAMED', 'MISSION_DETAILS_CORRECTED', 'MISSION_DUPLICATE_OVERRIDDEN']);
export const isCorrection = e => Boolean(e) && (CORRECTION_TYPES.includes(e.action_type) || e.status === 'rejected');

export async function recordJournal(orgId, entry = {}, d = {}) {
  try {
    if (!orgId || !KINDS.includes(entry.kind)) return null;
    const body = String(entry.body ?? '').trim().slice(0, MAX_BODY);
    if (!body) return null;
    const kind = await primeOrgKind(orgId, d);
    if (kind?.kind !== 'simulation') return null;
    const row = { org_id: orgId, agent: String(entry.agent || 'office-manager').slice(0, 60), kind: entry.kind, body,
      actor_id: UUID.test(String(entry.actor_id || '')) ? entry.actor_id : null, actor_email: entry.actor_email ? String(entry.actor_email).slice(0, 254) : null,
      mission_id: UUID.test(String(entry.mission_id || '')) ? entry.mission_id : null, ref: entry.ref ? String(entry.ref).slice(0, 120) : null };
    await (d.fetchRows || rest)('office_simulation_journal', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([row]) });
    return row;
  } catch { return null; }
}

// A correction seen by audit(): who did it is the approver / reviewer written in the event.
export function journalFromAudit(orgId, e, d = {}) {
  if (!isCorrection(e)) return null;
  const what = [e.action_type, e.status === 'rejected' ? '(refusé)' : '', e.output_ref || e.source_ref || ''].filter(Boolean).join(' ');
  return recordJournal(orgId, { kind: 'correction', agent: e.agent, mission_id: e.mission_id, actor_email: e.approved_by || e.reviewer || null, body: what, ref: e.action_type }, d);
}

// Owner of the simulation and owners / partners of the PARENT firm read everything; any other member only their own entries.
export async function readJournal(user, currentOrg, simOrg, query = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const org = (await fetchRows('office_organizations?id=eq.' + q(simOrg) + '&select=account_kind,parent_org_id&limit=1'))?.[0];
  if (!org || org.account_kind !== 'simulation' || (currentOrg !== simOrg && org.parent_org_id !== currentOrg)) throw fail('NOT_A_SIMULATION', 403);
  const role = async o => (await fetchRows('office_app_users?org_id=eq.' + q(o) + '&auth_user_id=eq.' + q(user.id) + '&active=eq.true&select=role&limit=1'))?.[0]?.role || null;
  const mine = await role(simOrg);
  const parentRole = org.parent_org_id ? await role(org.parent_org_id) : null;
  const all = mine === 'owner' || SEE_ALL.includes(parentRole);
  if (!all && !mine) throw fail('JOURNAL_NOT_ALLOWED', 403);
  let path = 'office_simulation_journal?org_id=eq.' + q(simOrg);
  if (!all) path += '&actor_id=eq.' + q(user.id);
  if (query.agent) path += '&agent=eq.' + q(String(query.agent).slice(0, 60));
  if (query.mission && UUID.test(String(query.mission))) path += '&mission_id=eq.' + q(query.mission);
  if (KINDS.includes(query.kind)) path += '&kind=eq.' + q(query.kind);
  if (query.before && !Number.isNaN(Date.parse(query.before))) path += '&at=lt.' + q(new Date(query.before).toISOString());
  const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);
  const entries = await fetchRows(path + '&select=id,at,actor_email,agent,mission_id,kind,body,ref&order=at.desc&limit=' + limit) || [];
  return { entries, scope: all ? 'all' : 'own', next: entries.length === limit ? entries[entries.length - 1].at : null };
}
