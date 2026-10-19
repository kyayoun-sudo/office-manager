import { createHash, randomUUID } from 'node:crypto';
import { rest } from './supabase.js';
import { audit } from './audit-log.js';
import { FIRM_LEAD, MANAGERS, ROLE_LABELS } from './roles.js';
import { canonicalStatus } from './mission-status.js';

// DIRECT MISSION CREATION (Paul, 2026-10-19): « un petit cabinet a un client aujourd'hui pour une mission demain ;
// on reçoit souvent les états financiers avant d'y aller, on y va direct ; un auditeur peut recevoir une mission à lui ».
// Second path next to Opportunités (TDR / AMI / appel d'offres): a name, a client, and the mission exists, « En cours »,
// its creator on the team. Nothing is faked: no tender, no opportunity, no acceptance is invented. The source of the
// mission (ORIGINS) is kept apart from the professional acceptance, which stays followed as OPEN ITEMS (FOLLOWUPS) that
// anyone can see and complete later — they never block the work. Who may close an item is checked (acceptance =
// associé, as in lib/permissions.js; letter and independence = manager or associé). Everything is traced.

const q = encodeURIComponent;
const cut = (s, n = 200) => (s == null ? '' : String(s)).trim().slice(0, n);
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, ...extra });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const ORIGINS = Object.freeze({
  direct: 'Demande directe du client', existing_client: 'Client existant', recurring: 'Mission récurrente',
  referral: 'Recommandation', appointment: 'Nomination (mandat)', tender: 'Appel d’offres / TDR / AMI', other: 'Autre'
});
export const TYPES = Object.freeze({
  statutory: 'Audit légal / commissariat aux comptes', contractual: 'Audit contractuel', project: 'Audit de projet / bailleur',
  review: 'Examen limité / revue', agreed: 'Procédures convenues', due_diligence: 'Due diligence', advisory: 'Conseil / autre'
});
// The professional items that stay open after a direct creation. `by` = who may close them.
export const FOLLOWUPS = Object.freeze({
  acceptance: { label: 'Acceptation / maintien de la mission (KYC, intégrité du client, compétence, risques)', by: FIRM_LEAD },
  independence: { label: 'Indépendance de l’équipe (déclarations)', by: MANAGERS },
  engagement_letter: { label: 'Lettre de mission / termes de la mission signés', by: MANAGERS }
});
const FOLLOWUP_STATES = ['open', 'done', 'not_applicable'];

// A Drive folder link (…/folders/<id>, ?id=<id>) or a bare id.
export function driveFolderId(link) {
  const s = cut(link, 500);
  if (!s) return null;
  const m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,200}$/.test(s) ? s : null;
}

const uuidFrom = text => { const h = createHash('sha256').update(text).digest('hex'); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-5' + h.slice(13, 16) + '-8' + h.slice(17, 20) + '-' + h.slice(20, 32); };

// The open items as shown on the mission: stored decisions + what the mission itself says (dates, folder).
export function followupView(mission = {}) {
  const f = mission.followups && typeof mission.followups === 'object' ? mission.followups : {};
  const items = Object.entries(FOLLOWUPS).map(([key, def]) => {
    const s = f[key] || {};
    return { key, label: def.label, status: FOLLOWUP_STATES.includes(s.status) ? s.status : 'open', by: s.by || null, at: s.at || null, note: s.note || null, link: s.link || null, blocking: false };
  });
  if (!mission.planned_start || !mission.planned_end) items.push({ key: 'dates', label: 'Dates de la mission', status: 'open', derived: true, blocking: false });
  if (!mission.drive_folder_id) items.push({ key: 'folder', label: f.folder?.id ? 'Dossier Drive à vérifier (lien donné, pas encore confirmé)' : 'Dossier des documents (lien Drive)', status: 'open', derived: true, blocking: false });
  return { origin: mission.origin || null, origin_label: ORIGINS[mission.origin] || null, engagement_type: mission.engagement_type || null,
    type_label: TYPES[mission.engagement_type] || null, period: mission.period_label || null, created_by: mission.created_by || null,
    open: items.filter(i => i.status === 'open').length, items,
    note: 'Ces éléments restent à compléter. Ils ne bloquent pas le travail sur la mission ; ils restent visibles jusqu’à ce qu’une personne habilitée les règle.' };
}

async function ensureOwnProfile(orgId, account, fetchRows) {
  const email = String(account?.email || '').trim().toLowerCase();
  if (!email) return { id: null, issue: 'Compte sans e-mail : affectation à faire dans Équipe.' };
  const rows = (await fetchRows(`office_staff_profiles?org_id=eq.${q(orgId)}&email=eq.${q(email)}&active=eq.true&select=id&limit=2`)) || [];
  if (rows.length === 1) return { id: rows[0].id };
  if (rows.length > 1) return { id: null, issue: 'Plusieurs fiches pour ' + email + ' dans Équipe : affectation à faire à la main.' };
  // The person's own verified account (never another person): same profile as the account sync (lib/people-sync.js).
  const name = cut(account.display_name, 120) || email.split('@')[0].replace(/[._-]+/g, ' ');
  const [row] = (await fetchRows('office_staff_profiles', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{ org_id: orgId, full_name: name, email, role_title: ROLE_LABELS[account.role] || null, active: true, profile_status: 'needs_review', skills: [] }]) })) || [];
  return row?.id ? { id: row.id, created: true } : { id: null, issue: 'Fiche Équipe non créée : affectation à faire.' };
}

// Create the mission now. `body.request_id` (made by the browser) is its id: a double click never creates two missions.
export async function createMissionQuick(orgId, body = {}, account, d = {}) {
  if (!account?.email) throw fail('USER_SESSION_REQUIRED', 401);
  const fetchRows = d.fetchRows || rest;
  const name = cut(body.name, 160), client = cut(body.client, 200);
  if (!name) throw fail('MISSION_NAME_REQUIRED');
  if (!client) throw fail('CLIENT_REQUIRED');
  const origin = ORIGINS[body.origin] ? body.origin : 'direct';
  const type = TYPES[body.engagement_type] ? body.engagement_type : null;
  const start = DAY.test(body.planned_start || '') ? body.planned_start : null;
  const end = DAY.test(body.planned_end || '') ? body.planned_end : null;
  if (start && end && end < start) throw fail('END_BEFORE_START');
  const id = UUID.test(String(body.request_id || '')) ? String(body.request_id).toLowerCase() : randomUUID();
  const org = 'org_id=eq.' + q(orgId);

  // Already created (same request, a retry): give it back.
  const again = (await fetchRows(`office_missions?${org}&id=eq.${q(id)}&select=id,name,status&limit=1`))?.[0];
  if (again) return { mission: again, created: false, already: true, url: '/mission.html?id=' + again.id };

  // Same client + same name already there: never a silent second mission (principle 7).
  if (body.confirm_duplicate !== true) {
    const rows = (await fetchRows(`office_missions?${org}&select=id,name,client_name,status&order=created_at.desc&limit=500`).catch(() => [])) || [];
    const same = rows.filter(m => canonicalStatus(m.status) !== 'cancelled' && norm(m.name) === norm(name) && (!m.client_name || norm(m.client_name) === norm(client)));
    if (same.length) throw fail('POSSIBLE_DUPLICATE', 409, { duplicates: same.slice(0, 5).map(m => ({ id: m.id, name: m.name, status: m.status })) });
  }

  // Documents folder: kept only once Drive confirms it is a folder (« je ne peux pas encore le prouver » otherwise).
  const folderId = driveFolderId(body.folder);
  let folder = null;
  if (folderId) {
    const meta = await (d.getMeta || (async x => (await import('./drive-adapter.js')).driveAdapter.getMeta(x)))(folderId).catch(() => null);
    const ok = meta && !meta.trashed && meta.mimeType === 'application/vnd.google-apps.folder';
    folder = { id: folderId, verified: Boolean(ok), name: ok ? cut(meta.name, 200) : null };
  }

  const now = (d.now ? d.now() : new Date()).toISOString();
  const by = account.display_name || account.email;
  const followups = folder ? { folder: { id: folder.id, verified: folder.verified, at: now } } : {};
  if (origin === 'tender') followups.note = 'Venue d’un appel d’offres, créée directement (sans fiche Opportunité).';
  const row = { id, org_id: orgId, name, client_name: client, status: 'fieldwork', planned_start: start, planned_end: end,
    drive_folder_id: folder?.verified ? folder.id : null, origin, engagement_type: type, period_label: cut(body.period, 80) || null,
    created_by: cut(account.email, 200), followups, status_changed_at: now };
  const insert = r => fetchRows('office_missions?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(r) });
  let migration = true;
  try { await insert(row); }
  catch (e) {
    if (!/column|PGRST204|42703|schema cache/i.test(String(e.message || e))) throw e;
    // db/mission-quick.sql not installed yet: the mission is still created; origin and open items wait for it.
    migration = false;
    const { origin: _o, engagement_type: _t, period_label: _p, created_by: _c, followups: _f, status_changed_at: _s, ...base } = row;
    await insert(base);
  }
  const mission = (await fetchRows(`office_missions?${org}&id=eq.${q(id)}&select=id,name,status&limit=1`))?.[0];
  if (!mission) throw fail('MISSION_NOT_CREATED', 500);

  // The creator works on it straight away (an auditor with « sa » mission sees it: lib/mission-access.js).
  const issues = [];
  try {
    const profile = await ensureOwnProfile(orgId, account, fetchRows);
    if (profile.issue) issues.push(profile.issue);
    if (profile.id) await fetchRows('office_mission_assignments?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ id: uuidFrom(orgId + ':' + id + ':' + profile.id), org_id: orgId, office_mission_id: id, staff_profile_id: profile.id,
        mission_role: cut(body.my_role, 60) || 'responsable', status: 'confirmed', allocation_pct: 100, planned_start: start, planned_end: end }) });
  } catch (e) { issues.push('Affectation non enregistrée (' + cut(e.message, 80) + ') : à faire dans Équipe.'); }

  // Every agent is told (references only), as when a mission starts from an opportunity.
  const announced = await (d.announce || (async (o, m, i) => (await import('./mission-start.js')).announceMissionStarted(o, m, i)))(orgId, { id, name, drive_folder_id: row.drive_folder_id }, { folder_id: row.drive_folder_id, mode: 'direct' }).catch(e => ({ error: cut(e.message, 120) }));
  await (d.audit || audit)(orgId, { agent: 'office-manager', mission_id: id, action_type: 'MISSION_CREATED_DIRECT', status: 'succeeded',
    decision: 'origine : ' + (ORIGINS[origin] || origin), output_ref: 'office_missions:' + id, approved_by: cut(by, 120), approved_at: now,
    source_ref: folder ? 'drive:' + folder.id + (folder.verified ? '' : ' (non vérifié)') : null }, { fetchRows }).catch(() => null);

  return { mission, created: true, url: '/mission.html?id=' + id, folder, issues, migration,
    followups: followupView({ ...row, ...(migration ? {} : { followups: {} }) }), announced: announced?.announced ?? 0 };
}

export async function missionFollowups(orgId, missionId, d = {}) {
  if (!UUID.test(String(missionId || ''))) throw fail('VALID_MISSION_ID_REQUIRED');
  const fetchRows = d.fetchRows || rest;
  const base = `office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}`;
  let m;
  try { m = (await fetchRows(base + '&select=id,name,planned_start,planned_end,drive_folder_id,origin,engagement_type,period_label,created_by,followups&limit=1'))?.[0]; }
  catch { m = (await fetchRows(base + '&select=id,name,planned_start,planned_end,drive_folder_id&limit=1'))?.[0]; if (m) m.migration = false; }
  if (!m) throw fail('MISSION_NOT_FOUND', 404);
  return { ...followupView(m), migration: m.migration !== false };
}

// The documents folder given later (« là où sont les états financiers »): kept once Drive confirms it is a folder.
export async function setMissionFolder(orgId, body = {}, account, d = {}) {
  if (!account?.email) throw fail('USER_SESSION_REQUIRED', 401);
  const fetchRows = d.fetchRows || rest;
  const missionId = String(body.mission_id || '');
  if (!UUID.test(missionId)) throw fail('VALID_MISSION_ID_REQUIRED');
  const id = driveFolderId(body.folder);
  if (!id) throw fail('DRIVE_FOLDER_LINK_REQUIRED');
  const meta = await (d.getMeta || (async x => (await import('./drive-adapter.js')).driveAdapter.getMeta(x)))(id).catch(() => null);
  if (!meta || meta.trashed || meta.mimeType !== 'application/vnd.google-apps.folder') throw fail('DRIVE_FOLDER_NOT_VERIFIED', 422);
  const base = `office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}`;
  const m = (await fetchRows(base + '&select=id,name,drive_folder_id&limit=1'))?.[0];
  if (!m) throw fail('MISSION_NOT_FOUND', 404);
  if (m.drive_folder_id && m.drive_folder_id !== id && body.replace !== true) throw fail('MISSION_ALREADY_HAS_FOLDER', 409);
  await fetchRows(base, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ drive_folder_id: id }) });
  await (d.audit || audit)(orgId, { agent: 'office-manager', mission_id: missionId, action_type: 'MISSION_FOLDER_SET', status: 'succeeded',
    source_ref: 'drive:' + id, approved_by: cut(account.display_name || account.email, 120), approved_at: new Date().toISOString() }, { fetchRows }).catch(() => null);
  return { folder: { id, name: cut(meta.name, 200), verified: true } };
}

// Dates filled in later by anyone on the mission (not a professional decision); the creator's assignment follows them.
export async function setMissionDates(orgId, body = {}, account, d = {}) {
  if (!account?.email) throw fail('USER_SESSION_REQUIRED', 401);
  const fetchRows = d.fetchRows || rest;
  const missionId = String(body.mission_id || '');
  if (!UUID.test(missionId)) throw fail('VALID_MISSION_ID_REQUIRED');
  const start = DAY.test(body.planned_start || '') ? body.planned_start : null;
  const end = DAY.test(body.planned_end || '') ? body.planned_end : null;
  if (!start && !end) throw fail('DATES_REQUIRED');
  if (start && end && end < start) throw fail('END_BEFORE_START');
  const base = `office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}`;
  const m = (await fetchRows(base + '&select=id,planned_start,planned_end&limit=1'))?.[0];
  if (!m) throw fail('MISSION_NOT_FOUND', 404);
  const patch = { ...(start ? { planned_start: start } : {}), ...(end ? { planned_end: end } : {}) };
  const s = patch.planned_start || m.planned_start, e = patch.planned_end || m.planned_end;
  if (s && e && e < s) throw fail('END_BEFORE_START');
  await fetchRows(base, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  await (d.audit || audit)(orgId, { agent: 'office-manager', mission_id: missionId, action_type: 'MISSION_DATES_SET', status: 'succeeded',
    decision: [s, e].filter(Boolean).join(' → '), approved_by: cut(account.display_name || account.email, 120), approved_at: new Date().toISOString() }, { fetchRows }).catch(() => null);
  return { planned_start: s || null, planned_end: e || null };
}

// A person settles (or reopens) an open item. Never done by an agent; who and when are kept.
export async function setFollowup(orgId, body = {}, account, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const key = String(body.key || ''), status = String(body.status || '');
  const def = FOLLOWUPS[key];
  if (!def) throw fail('UNKNOWN_ITEM');
  if (!FOLLOWUP_STATES.includes(status)) throw fail('UNKNOWN_STATUS');
  if (!def.by.includes(account?.role)) throw fail(key === 'acceptance' ? 'PARTNER_DECIDES_ACCEPTANCE' : 'MANAGER_OR_PARTNER_REQUIRED', 403);
  if (status === 'not_applicable' && !cut(body.note, 500)) throw fail('REASON_REQUIRED');
  const missionId = String(body.mission_id || '');
  const base = `office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}`;
  const m = (await fetchRows(base + '&select=id,followups&limit=1').catch(e => { throw /column|42703|PGRST/.test(String(e.message)) ? fail('MIGRATION_MANQUANTE (db/mission-quick.sql)', 503) : e; }))?.[0];
  if (!m) throw fail('MISSION_NOT_FOUND', 404);
  const at = (d.now ? d.now() : new Date()).toISOString();
  const followups = { ...(m.followups || {}) };
  const prev = followups[key] || {};
  followups[key] = { status, by: account.display_name || account.email, at, note: cut(body.note, 500) || null, link: cut(body.link, 500) || null,
    history: [...(prev.history || []).slice(-19), ...(prev.status ? [{ status: prev.status, by: prev.by, at: prev.at, note: prev.note }] : [])] };
  await fetchRows(base, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ followups }) });
  await (d.audit || audit)(orgId, { agent: 'office-manager', mission_id: missionId, action_type: 'MISSION_FOLLOWUP_' + status.toUpperCase(), status: 'succeeded',
    decision: key, approved_by: cut(account.display_name || account.email, 120), approved_at: at, output_ref: body.link ? cut(body.link, 500) : null }, { fetchRows }).catch(() => null);
  return followupView({ ...m, followups });
}
