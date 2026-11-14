// Two identical missions can no longer be created (Paul, 2026-11-14 : « on peut créer 2 missions identiques ; il faut quelque chose pour
// empêcher la création de 2 missions identiques »).
//
// Before: the direct creation compared the exact name only, a « Créer quand même » click by anyone passed, a failed read of the missions
// let everything through, the correction of a mission compared the exact name only, and the mission created from an opportunity was not
// compared at all. Now ONE rule for every path:
//   - same mission = same client (or one of the two without a client) AND (same name by its words — `findSameMission`, the rule already
//     used to merge the agents' duplicates — OR same exercise year AND same type of engagement, whatever the names);
//   - a cancelled mission never counts; an archived one does (re-creating last year's archived audit is a duplicate);
//   - only an owner / partner may still create it, with a written reason, traced (MISSION_DUPLICATE_OVERRIDDEN);
//   - the missions cannot be read → nothing is created (DUPLICATE_CHECK_UNAVAILABLE), never a silent pass;
//   - two creations at the same instant: `settleRace` keeps the oldest and cancels the newer one (nothing deleted).

import { rest } from './supabase.js';
import { audit } from './audit-log.js';
import { FIRM_LEAD } from './roles.js';
import { findSameMission } from './mission-dedupe.js';

const q = encodeURIComponent;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const yearOf = (...v) => { const y = v.map(x => String(x || '').match(/20\d\d/g) || []).flat(); return y.length ? y[y.length - 1] : null; };
const dead = s => ['cancelled', 'canceled'].includes(String(s || '').toLowerCase());
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, code, ...extra });

// candidate: { id?, name, client, period?, type?, start?, end? }; missions: rows of office_missions.
export function sameMissions(candidate, missions) {
  const client = norm(candidate.client);
  const year = yearOf(candidate.period, candidate.name, candidate.end, candidate.start);
  const pool = (missions || []).filter(m => m && m.id !== candidate.id && !dead(m.status)
    && (!client || !norm(m.client_name) || norm(m.client_name) === client));
  const out = new Map();
  // By the name's words, only among this client's missions (a generic name never matches another client's mission), never two years.
  for (const m of pool) {
    if (findSameMission(candidate.name, [m]) && !out.has(m.id)) {
      const a = yearOf(candidate.name), b = yearOf(m.name);
      if (!a || !b || a === b) out.set(m.id, { mission: m, why: 'même nom' });
    }
    const my = yearOf(m.period_label, m.name, m.planned_end, m.planned_start);
    if (client && norm(m.client_name) === client && year && my === year && candidate.type && m.engagement_type === candidate.type && !out.has(m.id))
      out.set(m.id, { mission: m, why: `même client, même exercice (${year}) et même type de mission` });
  }
  return [...out.values()];
}

const SELECT = 'id,name,client_name,status,engagement_type,period_label,planned_start,planned_end,created_at';
async function readMissions(orgId, fetchRows) {
  try { return await fetchRows(`office_missions?org_id=eq.${q(orgId)}&select=${SELECT}&order=created_at.asc&limit=5000`) || []; }
  catch {
    try { return await fetchRows(`office_missions?org_id=eq.${q(orgId)}&select=id,name,client_name,status,planned_start,planned_end,created_at&order=created_at.asc&limit=5000`) || []; }
    catch { throw fail('DUPLICATE_CHECK_UNAVAILABLE', 503); }
  }
}

// Throws POSSIBLE_DUPLICATE (with the missions found and whether this person may override) unless an owner / partner gave a reason.
export async function guardAgainstDuplicate(orgId, candidate, account, opts = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const dups = sameMissions(candidate, await readMissions(orgId, fetchRows));
  if (!dups.length) return { duplicates: [] };
  const mayOverride = FIRM_LEAD.includes(account?.role);
  const reason = String(opts.reason || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const list = dups.slice(0, 5).map(x => ({ id: x.mission.id, name: x.mission.name, client: x.mission.client_name || null, status: x.mission.status, why: x.why }));
  if (!mayOverride || reason.length < 10) throw fail('POSSIBLE_DUPLICATE', 409, { duplicates: list, override_allowed: mayOverride, reason_required: mayOverride });
  await (d.audit || audit)(orgId, { agent: 'office-manager', mission_id: candidate.id || null, action_type: 'MISSION_DUPLICATE_OVERRIDDEN', status: 'succeeded',
    decision: (reason + ' — semblable à : ' + list.map(x => x.name).join(', ')).slice(0, 900), approved_by: account.display_name || account.email,
    approved_at: new Date().toISOString() }, { fetchRows }).catch(() => null);
  return { duplicates: list, overridden: true, reason };
}

// After an insert: if another identical mission was created at the same instant (both passed the check), the oldest stays and the
// newer one — ours — is cancelled. Skipped when a partner deliberately overrode. Returns the mission to use.
export async function settleRace(orgId, created, candidate, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const all = await readMissions(orgId, fetchRows).catch(() => null);
  if (!all) return created;
  const twins = sameMissions({ ...candidate, id: created.id }, all).map(x => x.mission);
  const mine = all.find(m => m.id === created.id) || created;
  const older = twins.filter(m => String(m.created_at || '') < String(mine.created_at || '') || (m.created_at === mine.created_at && m.id < mine.id));
  if (!older.length) return created;
  await fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(created.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'cancelled' }) });
  await (d.audit || audit)(orgId, { agent: 'office-manager', mission_id: created.id, action_type: 'MISSION_DUPLICATE_CANCELLED', status: 'succeeded',
    decision: 'Créée en même temps qu’une mission identique : ' + older[0].name + ' (gardée).', approved_at: new Date().toISOString() }, { fetchRows }).catch(() => null);
  return { ...older[0], kept_instead: true };
}
