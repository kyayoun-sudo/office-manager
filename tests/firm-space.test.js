import test from 'node:test';
import assert from 'node:assert/strict';
import { login, signUp, setupState, mayReopen } from '../lib/accounts.js';

// A tiny PostgREST in memory: office_app_users, office_firm_settings, office_missions, office_firm_drive.
function db() {
  const t = { office_app_users: [], office_firm_settings: [], office_missions: [], office_firm_drive: [] };
  const parse = path => { const [table, qs] = path.split('?'); const p = new URLSearchParams(qs || ''); return { table, p }; };
  const match = (row, p) => [...p.entries()].every(([k, v]) => {
    if (['select', 'limit', 'on_conflict', 'order'].includes(k)) return true;
    if (v.startsWith('eq.')) return String(row[k]) === decodeURIComponent(v.slice(3));
    if (v.startsWith('neq.')) return String(row[k]) !== decodeURIComponent(v.slice(4));
    if (v.startsWith('not.in.(')) return !v.slice(8, -1).split(',').includes(row[k]);
    return true;
  });
  const fetchRows = async (path, opts = {}) => {
    const { table, p } = parse(path);
    const rows = t[table];
    if (!opts.method || opts.method === 'GET') return rows.filter(r => match(r, p)).map(r => ({ ...r }));
    if (opts.method === 'POST') { for (const r of JSON.parse(opts.body)) { const i = rows.findIndex(x => p.get('on_conflict') && x[p.get('on_conflict')] === r[p.get('on_conflict')]); if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push(r); } return null; }
    if (opts.method === 'PATCH') { const ch = JSON.parse(opts.body); const hit = rows.filter(r => match(r, p)); hit.forEach(r => Object.assign(r, ch)); return hit.map(r => ({ ...r })); }
    if (opts.method === 'DELETE') { t[table] = rows.filter(r => !match(r, p)); return null; }
  };
  return { t, fetchRows };
}
const auth = users => async (path, o = {}) => {
  if (path.startsWith('token?grant_type=password')) { const u = users[o.body.email]; return u && u.password === o.body.password ? { status: 200, data: { user: { id: u.id }, refresh_token: 'r', access_token: 'a' } } : { status: 400 }; }
  if (path === 'admin/users') { if (users[o.body.email]) return { status: 422, data: { msg: 'already been registered' } }; users[o.body.email] = { id: '11111111-2222-4333-8444-555555555555', password: o.body.password }; return { status: 200, data: { id: users[o.body.email].id } }; }
  return { status: 200, data: {} };
};

test('a space closed earlier: its former owner restarts it from zero (« EFFACER », same identity), keeps their login', async () => {
  const { t, fetchRows } = db();
  t.office_app_users.push({ org_id: 'o', auth_user_id: 'u1', email: 'paul@c.ci', display_name: 'Paul', role: 'owner', active: false }, { org_id: 'o', auth_user_id: 'u2', email: 'awa@c.ci', display_name: 'Awa', role: 'manager', active: false });
  t.office_firm_settings.push({ org_id: 'o', settings: { space: { closed_by: 'paul@c.ci' } } });
  const users = { 'paul@c.ci': { id: 'u1', password: 'Secret12345' }, 'awa@c.ci': { id: 'u2', password: 'Secret12345' } };
  const { restartFirm } = await import('../lib/accounts.js');
  // Login and sign-up say the space is closed (the page then asks for « EFFACER »).
  await assert.rejects(login('o', { email: 'paul@c.ci', password: 'Secret12345' }, { authCall: auth(users), fetchRows }), /FIRM_CLOSED/);
  // A former manager cannot take the space.
  await assert.rejects(login('o', { email: 'awa@c.ci', password: 'Secret12345' }, { authCall: auth(users), fetchRows }), /ACCOUNT_PENDING/);
  await assert.rejects(restartFirm('o', { email: 'awa@c.ci', password: 'Secret12345', confirm: 'EFFACER' }, { authCall: auth(users), fetchRows, purgeFirm: async () => { throw new Error('must not'); } }), /ACCOUNT_PENDING/);
  await assert.rejects(restartFirm('o', { email: 'paul@c.ci', password: 'faux', confirm: 'EFFACER' }, { authCall: auth(users), fetchRows }), /INVALID_CREDENTIALS/);
  await assert.rejects(restartFirm('o', { email: 'paul@c.ci', password: 'Secret12345', confirm: 'oui' }, { authCall: auth(users), fetchRows }), /TYPE_EFFACER_TO_CONFIRM/);
  let kept = null;
  const purgeFirm = async (org, who, d) => { kept = d.keepAuthUser; for (const k of Object.keys(t)) t[k] = t[k].filter(r => r.org_id !== org); return { erased: true }; };
  const r = await restartFirm('o', { email: 'paul@c.ci', password: 'Secret12345', confirm: 'effacer' }, { authCall: auth(users), fetchRows, purgeFirm });
  assert.equal(r.restarted, true); assert.equal(r.session.user.role, 'owner');
  assert.equal(kept, 'u1', 'the person restarting keeps their login');
  assert.deepEqual(t.office_app_users.map(u => [u.email, u.role, u.active]), [['paul@c.ci', 'owner', true]], 'a blank space with one owner');
  // Open again: a second restart is refused.
  await assert.rejects(restartFirm('o', { email: 'paul@c.ci', password: 'Secret12345', confirm: 'EFFACER' }, { authCall: auth(users), fetchRows, purgeFirm }), /FIRM_NOT_CLOSED/);
});

test('an erased space: the next person to create an account is the owner of a blank space', async () => {
  const { t, fetchRows } = db();
  const users = {};
  const r = await signUp('o', { email: 'paul@c.ci', password: 'Secret12345', display_name: 'Paul' }, { authCall: auth(users), fetchRows, env: {} });
  assert.equal(r.owner, true);
  assert.equal(t.office_app_users[0].role, 'owner');
  assert.equal((await setupState('o', fetchRows, async () => ({ status: 500 }))).has_accounts, true);
});

test('a closed space: a newcomer signing up first never becomes owner', async () => {
  const { t, fetchRows } = db();
  t.office_app_users.push({ org_id: 'o', auth_user_id: 'u1', email: 'paul@c.ci', role: 'owner', active: false });
  const users = {};
  const r = await signUp('o', { email: 'intrus@x.ci', password: 'Secret12345', display_name: 'X' }, { authCall: auth(users), fetchRows, env: {} });
  assert.equal(r.pending, true);
  assert.equal(t.office_app_users.find(u => u.email === 'intrus@x.ci').role, 'collaborator');
  assert.equal(mayReopen({ email: 'boss@c.ci', role: 'collaborator' }, {}, { FIRST_OWNER_EMAILS: 'boss@c.ci' }), true);
});

import { purgeFirm, binAgentMemory, AGENT_MEMORY_NAME } from '../lib/firm-purge.js';

test('erasing: nothing happens unless the SQL function is installed; then Drive memory, database, logins', async () => {
  const order = [];
  const notInstalled = async path => { order.push(path); if (path.startsWith('rpc/')) throw new Error('SUPABASE_404: {"code":"PGRST202"}'); return []; };
  await assert.rejects(purgeFirm('o', { email: 'paul@c.ci' }, { fetchRows: notInstalled, binAgentMemory: async () => { throw new Error('must not'); } }), /PURGE_SQL_NOT_INSTALLED/);
  assert.equal(order.length, 1, 'stopped at the dry run');
  const calls = [], deleted = [];
  const fetchRows = async (path, o = {}) => {
    calls.push([path, o.body ? JSON.parse(o.body) : null]);
    if (path.startsWith('rpc/')) return { rows: { office_missions: 3, office_app_users: 3 }, not_erased: [] };
    if (path.startsWith('office_app_users?org_id=eq.o')) return [{ auth_user_id: 'u1' }, { auth_user_id: 'u2' }, { auth_user_id: 'u3' }];
    if (path.startsWith('office_app_users?auth_user_id=eq.u3')) return [{ org_id: 'other-firm' }];
    return [];
  };
  const r = await purgeFirm('o', { email: 'paul@c.ci' }, { fetchRows, keepAuthUser: 'u1', audit: async () => null, disconnectGoogle: async () => null,
    binAgentMemory: async () => ({ binned: ['OFFICE_MANAGER_TIDY_STATE.json', 'SHADOW_LAB.json'] }),
    authCall: async (path, o) => { deleted.push(path); return { status: 200 }; } });
  const rpcs = calls.filter(c => c[0].startsWith('rpc/')).map(c => c[1].p_dry_run);
  assert.deepEqual(rpcs, [true, false], 'dry run, then the erasure');
  assert.equal(calls.find(c => c[0].startsWith('rpc/'))[1].p_confirm, 'EFFACER o');
  assert.deepEqual(deleted, ['admin/users/u2'], 'u1 restarts (kept), u3 belongs to another firm (kept)');
  assert.deepEqual(r.accounts, { deleted: 1, kept_other_firm: 1, failed: 0, kept_restarting: 1 });
  assert.equal(r.drive.binned.length, 2);
});

test('only the agents\' memory goes to the Drive bin — never the firm\'s documents', async () => {
  for (const n of ['OFFICE_MANAGER_TIDY_STATE.json', 'OFFICE_MANAGER_MAP.xlsx', 'SHADOW_LAB.json', 'ORPAILLEUR_JOURNAL.xlsx', 'GRAND_CONTROLEUR_MEMORY.json', 'PIPELINE_APPELS_OFFRES.xlsx', 'MEMORY', 'AGENTS', 'CLIENTS']) assert.ok(AGENT_MEMORY_NAME.test(n), n);
  for (const n of ['Lettre de mission.pdf', 'SOTRAPEX_AUDIT_2025', 'Grand_livre.xlsx', '01_CLIENTS_ET_MISSIONS', 'office_manager_notes.docx']) assert.ok(!AGENT_MEMORY_NAME.test(n), n);
  const trashed = [];
  const google = { loadGoogleConnection: async () => null, loadFirmDrive: async () => null, connectedGoogle: () => true, firmMemoryId: () => 'MEM', firmDriveId: () => 'ROOT', connectionAccessToken: async () => 't' };
  const fetchImpl = async (url, o = {}) => {
    if (!o.method) return { ok: true, json: async () => ({ files: [{ id: 'a', name: 'OFFICE_MANAGER_TIDY_STATE.json', mimeType: 'application/json' }, { id: 'b', name: 'Contrat client.pdf', mimeType: 'application/pdf' }, { id: 'c', name: 'AGENTS', mimeType: 'application/vnd.google-apps.folder' }, { id: 'd', name: 'OFFICE_MANAGER_X', mimeType: 'application/vnd.google-apps.folder' }] }) };
    trashed.push(url.split('/files/')[1].split('?')[0]); return { ok: true };
  };
  const r = await binAgentMemory('o', { google, fetchImpl });
  assert.deepEqual(trashed, ['a', 'c']);
  assert.deepEqual(r.binned, ['OFFICE_MANAGER_TIDY_STATE.json', 'AGENTS']);
  const same = await binAgentMemory('o', { google: { ...google, firmMemoryId: () => 'ROOT' }, fetchImpl });
  assert.equal(same.skipped, 'NO_SEPARATE_MEMORY_FOLDER', 'never the Drive root itself');
});
