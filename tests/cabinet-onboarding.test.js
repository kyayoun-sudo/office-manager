import test from 'node:test';
import assert from 'node:assert/strict';
import { createCabinet, createInvitation, acceptInvitation, revokeInvitation, myCabinets, listInvitations } from '../lib/cabinet-onboarding.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const owner = { email: 'owner@cabinet.test', role: 'owner' };
const it = { email: 'it@cabinet.test', role: 'it_admin' };
const audit = async () => {};

// A tiny in-memory office_invitations / office_app_users, enough to follow the claims.
function world() {
  const inv = [], users = [];
  const fetchRows = async (path, o = {}) => {
    const body = o.body ? JSON.parse(o.body) : null;
    const idOf = () => decodeURIComponent(path.match(/(?:\?|&)id=eq\.([^&]+)/)[1]);
    if (path === 'office_invitations' && o.method === 'POST') { const r = { id: 'i' + (inv.length + 1), ...body[0] }; inv.push(r); return [r]; }
    if (path.startsWith('office_invitations?secret_hash=eq.')) { const h = path.split('secret_hash=eq.')[1].split('&')[0]; return inv.filter(r => r.secret_hash === h); }
    if (path.startsWith('office_invitations?') && o.method === 'PATCH') {
      const r = inv.find(x => x.id === idOf());
      if (!r || (path.includes('used_at=is.null') && r.used_at) || (path.includes('revoked_at=is.null') && r.revoked_at)) return [];
      Object.assign(r, body); return [r];
    }
    if (path.startsWith('office_invitations?org_id=eq.')) return inv.slice().reverse();
    if (path.startsWith('office_app_users?on_conflict')) { users.push(body[0]); return null; }
    if (path.startsWith('office_app_users?auth_user_id=eq.')) return users.filter(u => path.includes(u.auth_user_id)).map(u => ({ org_id: u.org_id, role: u.role, display_name: u.display_name }));
    if (path.startsWith('office_organizations?id=in.')) return [{ id: ORG, name: 'Cabinet Alpha' }];
    throw new Error('unexpected ' + path);
  };
  return { inv, users, d: { fetchRows, audit } };
}

test('creating a firm uses the verified identity and a valid time zone, never a body-supplied user', async () => {
  let sent;
  const d = { audit, fetchRows: async (path, o) => { sent = JSON.parse(o.body); return [{ org_id: ORG, created: true }]; } };
  const out = await createCabinet({ id: 'u1', email: 'Owner@Cabinet.test' }, { firm_name: 'Cabinet Alpha', timezone: 'Africa/Abidjan', auth_user_id: 'attacker' }, d);
  assert.equal(out.org_id, ORG); assert.equal(sent.p_auth_user_id, 'u1'); assert.equal(sent.p_email, 'owner@cabinet.test');
  await assert.rejects(createCabinet({ id: 'u1', email: 'o@c.test' }, { firm_name: 'X', timezone: 'Mars/Base' }, d), /INVALID_TIMEZONE/);
  await assert.rejects(createCabinet({ id: 'u1', email: 'o@c.test' }, { firm_name: ' ' }, d), /CABINET_NAME_REQUIRED/);
});

test('a link invitation works once, only for its own address; only the hash is stored', async () => {
  const { inv, users, d } = world();
  const made = await createInvitation(ORG, owner, { kind: 'link', email: 'Awa@Cabinet.test', role: 'auditor' }, d);
  assert.ok(made.token && !JSON.stringify(inv).includes(made.token), 'the secret is never stored');
  await assert.rejects(acceptInvitation({ id: 'x', email: 'intrus@other.test' }, { token: made.token }, d), /INVITATION_FOR_ANOTHER_ADDRESS/);
  const ok = await acceptInvitation({ id: 'awa', email: 'awa@cabinet.test' }, { token: made.token, display_name: 'Awa' }, d);
  assert.deepEqual([ok.org_id, ok.role], [ORG, 'auditor']);
  assert.deepEqual(users.map(u => [u.org_id, u.auth_user_id, u.role, u.active]), [[ORG, 'awa', 'auditor', true]]);
  assert.equal((await acceptInvitation({ id: 'awa', email: 'awa@cabinet.test' }, { token: made.token }, d)).already, true, 'a second click is harmless');
  await assert.rejects(acceptInvitation({ id: 'bob', email: 'awa@cabinet.test' }, { token: made.token }, d), /INVITATION_ALREADY_USED/);
});

test('a code invitation expires, can be revoked, and nobody grants more than they hold', async () => {
  const { d } = world();
  await assert.rejects(createInvitation(ORG, it, { kind: 'code', role: 'partner' }, d), /ROLE_NOT_GRANTABLE/);
  await assert.rejects(createInvitation(ORG, { role: 'partner', email: 'p@c.test' }, { kind: 'code', role: 'owner' }, d), /ROLE_NOT_GRANTABLE/);
  await assert.rejects(createInvitation(ORG, { role: 'auditor', email: 'a@c.test' }, { kind: 'code', role: 'auditor' }, d), /ROLE_NOT_ALLOWED/);
  const code = await createInvitation(ORG, it, { kind: 'code', role: 'senior' }, d);
  assert.match(code.code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  await revokeInvitation(ORG, it, code.id, d);
  await assert.rejects(acceptInvitation({ id: 'u', email: 'u@c.test' }, { code: code.code }, d), /INVITATION_REVOKED/);
  const late = await createInvitation(ORG, it, { kind: 'code', role: 'senior' }, { ...d, now: () => Date.now() - 8 * 24 * 3600 * 1000 });
  await assert.rejects(acceptInvitation({ id: 'u', email: 'u@c.test' }, { code: late.code.toLowerCase() }, d), /INVITATION_EXPIRED/);
  assert.deepEqual((await listInvitations(ORG, it, d)).map(i => i.state), ['expired', 'revoked']);
});

test('my firms: the active memberships of the person, with their names', async () => {
  const { d, users } = world();
  users.push({ org_id: ORG, auth_user_id: 'u1', role: 'manager', display_name: 'U' });
  assert.deepEqual(await myCabinets({ id: 'u1' }, d), [{ org_id: ORG, name: 'Cabinet Alpha', role: 'manager' }]);
});
