import { rest } from './supabase.js';
import { trainingDrive } from './training-drive.js';

// Simulation = a training firm, child of the real firm (2026-11-18). Same engine, isolated data.
const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const text = (v, code, max = 120) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); if (!t || t.length > max) throw fail(code); return t; };
const SQL_CODES = ['NOT_IN_PARENT', 'PARENT_IS_SIMULATION', 'INVALID_SIMULATION', 'SERVER_ONLY'];
const sqlCode = e => SQL_CODES.find(c => String(e?.message || '').includes(c));
const defaultAudit = async () => {};

export async function createSimulation(user, parentOrg, body = {}, d = {}) {
  if (!user?.email_confirmed_at || user.is_anonymous === true) throw fail('EMAIL_NOT_VERIFIED', 403);
  const name = text(body.name, 'SIMULATION_NAME_REQUIRED');
  const fetchRows = d.fetchRows || rest, drive = d.drive || trainingDrive;
  const displayName = text(user.user_metadata?.display_name || String(user.email || '').split('@')[0], 'INVALID_NAME');
  // Check the parent folder BEFORE creating the firm: a failure after the SQL would leave a firm without folder.
  const parent = drive.defaultParent();
  if (!parent) throw fail('TRAINING_PARENT_REQUIRED', 400);
  let out;
  try {
    out = await fetchRows('rpc/office_create_simulation', { method: 'POST', body: JSON.stringify({ p_auth_user_id: user.id, p_parent_org: parentOrg, p_name: name, p_display_name: displayName }) });
  } catch (e) { const c = sqlCode(e); throw c ? fail(c, c === 'NOT_IN_PARENT' ? 403 : 400) : e; }
  out = Array.isArray(out) ? out[0] : out;
  if (!out?.org_id) throw fail('SIMULATION_SETUP_FAILED', 500);
  if (out.created === false) {
    // A firm left without folder by an interrupted creation is repaired by the retry.
    const has = (await fetchRows('office_firm_drive?org_id=eq.' + q(out.org_id) + '&select=drive_id&limit=1'))?.[0];
    if (has?.drive_id) return { org_id: out.org_id, name, folder_id: null, created: false };
  }
  // The Drive folder under « Entraînements » of the PARENT firm's Drive; the simulation's Drive IS that folder.
  const folderName = ('SIMULATION ' + name + ' ' + new Date().toISOString().slice(0, 10)).slice(0, 60);
  const folder = await drive.createFolder(parent, folderName);
  await fetchRows('office_firm_drive?on_conflict=org_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ org_id: out.org_id, drive_id: 'folder:' + folder.id, drive_name: folderName }]) });
  await (d.audit || defaultAudit)(out.org_id, 'SIMULATION_CREATED', user.email, { parent: parentOrg, name, source: body.source || null, folder: folder.id });
  return { org_id: out.org_id, name, folder_id: folder.id, created: out.created !== false };
}

export async function listSimulations(user, parentOrg, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const orgs = await fetchRows('office_organizations?parent_org_id=eq.' + q(parentOrg) + '&account_kind=eq.simulation&select=id,name,created_at&order=created_at.desc&limit=200') || [];
  if (!orgs.length) return [];
  const mine = await fetchRows('office_app_users?auth_user_id=eq.' + q(user.id) + '&org_id=in.(' + orgs.map(o => q(o.id)).join(',') + ')&select=org_id,role,active&limit=500') || [];
  const by = new Map(mine.map(m => [m.org_id, m]));
  // Owners / partners of the parent firm see every simulation of it (to read its journal) without being members (2026-11-21).
  const seeAll = Boolean(((await fetchRows('office_app_users?org_id=eq.' + q(parentOrg) + '&auth_user_id=eq.' + q(user.id) + '&active=eq.true&select=org_id,role&limit=1').catch(() => [])) || [])
    .find(r => r.org_id === parentOrg && ['owner', 'partner'].includes(r.role)));
  return orgs.filter(o => seeAll || by.has(o.id)).map(o => ({ org_id: o.id, name: o.name, member: by.has(o.id), role: by.get(o.id)?.role || null, created_at: o.created_at, archived: by.get(o.id)?.active === false }));
}

export async function archiveSimulation(user, parentOrg, simOrg, d = {}) {
  const fetchRows = d.fetchRows || rest;
  // Only a simulation of the CURRENT firm can be archived: never a real firm the caller happens to own.
  const org = (await fetchRows('office_organizations?id=eq.' + q(simOrg) + '&select=account_kind,parent_org_id&limit=1'))?.[0];
  if (!org || org.account_kind !== 'simulation' || org.parent_org_id !== parentOrg) throw fail('NOT_A_SIMULATION', 403);
  const me = (await fetchRows('office_app_users?org_id=eq.' + q(simOrg) + '&auth_user_id=eq.' + q(user.id) + '&active=eq.true&select=role&limit=1'))?.[0];
  if (!me || me.role !== 'owner') throw fail('NOT_SIMULATION_OWNER', 403);
  await fetchRows('office_app_users?org_id=eq.' + q(simOrg), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false }) });
  await (d.audit || defaultAudit)(simOrg, 'SIMULATION_ARCHIVED', user.email, {});
  return { archived: true };
}

// Collaborators of a simulation (2026-11-21, step 2). Only the OWNER of the simulation manages them, from the parent firm's screen.
// Invitation by address only (a shared code could be held by anyone), external addresses allowed, 20 active members at most.
const MAX_MEMBERS = 20;
const realAudit = async (orgId, action, who, detail) => {
  try { const { audit } = await import('./audit-log.js'); await audit(orgId, { agent: 'office-manager', action_type: action, approved_by: who || null, output_ref: JSON.stringify(detail || {}) }); } catch { /* the journal never blocks */ }
};
export async function ownedSimulation(user, parentOrg, simOrg, d) {
  const fetchRows = d.fetchRows || rest;
  const org = (await fetchRows('office_organizations?id=eq.' + q(simOrg) + '&select=account_kind,parent_org_id&limit=1'))?.[0];
  if (!org || org.account_kind !== 'simulation' || org.parent_org_id !== parentOrg) throw fail('NOT_A_SIMULATION', 403);
  const me = (await fetchRows('office_app_users?org_id=eq.' + q(simOrg) + '&auth_user_id=eq.' + q(user.id) + '&active=eq.true&select=role,email&limit=1'))?.[0];
  if (!me || me.role !== 'owner') throw fail('NOT_SIMULATION_OWNER', 403);
  return { fetchRows, account: { role: 'owner', email: me.email || user.email } };
}
const activeMembers = async (fetchRows, simOrg) => await fetchRows('office_app_users?org_id=eq.' + q(simOrg) + '&active=eq.true&select=auth_user_id,email,role&limit=500') || [];
async function assertNotLastOwner(fetchRows, simOrg, target) {
  if (target.role !== 'owner') return;
  const others = (await activeMembers(fetchRows, simOrg)).filter(m => m.auth_user_id !== target.auth_user_id && m.role === 'owner');
  if (!others.length) throw fail('LAST_SIMULATION_OWNER', 409);
}
async function memberOf(fetchRows, simOrg, authUserId) {
  const m = (await fetchRows('office_app_users?org_id=eq.' + q(simOrg) + '&auth_user_id=eq.' + q(String(authUserId || '')) + '&select=auth_user_id,email,role,active&limit=1'))?.[0];
  if (!m) throw fail('MEMBER_NOT_FOUND', 404);
  return m;
}

export async function simulationMembers(user, parentOrg, simOrg, d = {}) {
  const { fetchRows, account } = await ownedSimulation(user, parentOrg, simOrg, d);
  const members = await fetchRows('office_app_users?org_id=eq.' + q(simOrg) + '&select=auth_user_id,email,display_name,role,active&order=created_at.asc&limit=500') || [];
  const { listInvitations } = await import('./cabinet-onboarding.js');
  const invitations = (await listInvitations(simOrg, account, { fetchRows, now: d.now })).filter(i => i.state === 'open');
  return { members, invitations, max: MAX_MEMBERS };
}

export async function inviteToSimulation(user, parentOrg, simOrg, body = {}, d = {}) {
  const { fetchRows, account } = await ownedSimulation(user, parentOrg, simOrg, d);
  if (body.kind === 'code') throw fail('SIMULATION_CODE_INVITE_REFUSED', 400);
  const { listInvitations, createInvitation } = await import('./cabinet-onboarding.js');
  const open = (await listInvitations(simOrg, account, { fetchRows, now: d.now })).filter(i => i.state === 'open').length;
  if ((await activeMembers(fetchRows, simOrg)).length + open >= MAX_MEMBERS) throw fail('SIMULATION_FULL', 409);
  const out = await createInvitation(simOrg, account, { kind: 'link', email: body.email, role: body.role }, { fetchRows, now: d.now, audit: async () => {} });
  await (d.audit || realAudit)(simOrg, 'SIMULATION_MEMBER_INVITED', user.email, { email: out.email, role: out.role });
  return out;
}

export async function revokeSimulationInvitation(user, parentOrg, simOrg, id, d = {}) {
  const { fetchRows, account } = await ownedSimulation(user, parentOrg, simOrg, d);
  const { revokeInvitation } = await import('./cabinet-onboarding.js');
  const out = await revokeInvitation(simOrg, account, String(id || ''), { fetchRows, now: d.now, audit: async () => {} });
  await (d.audit || realAudit)(simOrg, 'SIMULATION_INVITATION_REVOKED', user.email, { id });
  return out;
}

export async function setSimulationRole(user, parentOrg, simOrg, body = {}, d = {}) {
  const { fetchRows } = await ownedSimulation(user, parentOrg, simOrg, d);
  const { ROLES } = await import('./roles.js');
  const role = String(body.role || '');
  if (!ROLES.includes(role)) throw fail('INVALID_ROLE', 400);
  const target = await memberOf(fetchRows, simOrg, body.user_id);
  if (target.active === false) throw fail('MEMBER_NOT_ACTIVE', 409);
  if (role !== 'owner') await assertNotLastOwner(fetchRows, simOrg, target);
  await fetchRows('office_app_users?org_id=eq.' + q(simOrg) + '&auth_user_id=eq.' + q(target.auth_user_id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ role }) });
  await (d.audit || realAudit)(simOrg, 'SIMULATION_ROLE_CHANGED', user.email, { member: target.email, from: target.role, to: role });
  return { user_id: target.auth_user_id, role };
}

export async function removeSimulationMember(user, parentOrg, simOrg, body = {}, d = {}) {
  const { fetchRows } = await ownedSimulation(user, parentOrg, simOrg, d);
  const target = await memberOf(fetchRows, simOrg, body.user_id);
  await assertNotLastOwner(fetchRows, simOrg, target);
  await fetchRows('office_app_users?org_id=eq.' + q(simOrg) + '&auth_user_id=eq.' + q(target.auth_user_id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false }) });
  await (d.audit || realAudit)(simOrg, 'SIMULATION_MEMBER_REMOVED', user.email, { member: target.email });
  return { removed: true };
}
