import test from 'node:test';
import assert from 'node:assert/strict';
import { closeOwnAccount, login, signUp, setupState, mayReopen } from '../lib/accounts.js';

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

test('the last owner closes the space; logging in again opens a NEW space from zero (nothing deleted)', async () => {
  const { t, fetchRows } = db();
  t.office_app_users.push({ org_id: 'o', auth_user_id: 'u1', email: 'paul@c.ci', display_name: 'Paul', role: 'owner', active: true }, { org_id: 'o', auth_user_id: 'u2', email: 'awa@c.ci', display_name: 'Awa', role: 'manager', active: true });
  t.office_missions.push({ org_id: 'o', id: 'm1', status: 'fieldwork' }, { org_id: 'o', id: 'm2', status: 'archived' });
  t.office_firm_drive.push({ org_id: 'o', drive_id: 'OLD_DRIVE_ID_123', drive_name: 'Ancien' });
  const users = { 'paul@c.ci': { id: 'u1', password: 'Secret12345' }, 'awa@c.ci': { id: 'u2', password: 'Secret12345' } };
  await assert.rejects(closeOwnAccount('o', { auth_user_id: 'u1', email: 'paul@c.ci', role: 'owner' }, { confirm: 'paul@c.ci' }, { fetchRows }), /LAST_OWNER_CLOSES_FIRM/);
  const r = await closeOwnAccount('o', { auth_user_id: 'u1', email: 'paul@c.ci', role: 'owner' }, { confirm: 'paul@c.ci', close_firm: true }, { fetchRows, disconnectGoogle: async () => null });
  assert.equal(r.firm_closed, true);
  assert.ok(t.office_app_users.every(u => !u.active), 'every access closes with the space');
  assert.equal((await setupState('o', fetchRows, async () => ({ status: 500 }))).has_accounts, false, 'the start page offers « Démarrer » again');
  // A former manager cannot take the space.
  await assert.rejects(login('o', { email: 'awa@c.ci', password: 'Secret12345' }, { authCall: auth(users), fetchRows }), /ACCOUNT_PENDING/);
  // The owner just logs in: a new space.
  const s = await login('o', { email: 'paul@c.ci', password: 'Secret12345' }, { authCall: auth(users), fetchRows });
  assert.equal(s.user.role, 'owner');
  assert.equal(t.office_missions.find(m => m.id === 'm1').status, 'archived', 'previous missions archived, not deleted');
  assert.equal(t.office_missions.length, 2);
  assert.equal(t.office_firm_drive.length, 0, 'the Drive is chosen again');
  const space = t.office_firm_settings[0].settings.space;
  assert.equal(space.generation, 2); assert.equal(space.closed_by, 'paul@c.ci'); assert.equal(space.previous_drive.drive_id, 'OLD_DRIVE_ID_123');
  assert.equal(t.office_app_users.find(u => u.auth_user_id === 'u2').active, false, 'others wait for a role');
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
