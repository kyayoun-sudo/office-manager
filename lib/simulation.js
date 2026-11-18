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
  return orgs.filter(o => by.has(o.id)).map(o => ({ org_id: o.id, name: o.name, role: by.get(o.id).role, created_at: o.created_at, archived: by.get(o.id).active === false }));
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
