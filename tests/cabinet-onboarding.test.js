import test from 'node:test';
import assert from 'node:assert/strict';
import { registerCabinet, createCabinet, myCabinets } from '../lib/cabinet-onboarding.js';
const id = '11111111-1111-4111-8111-111111111111';
const req = { headers: { authorization: 'Bearer ' + 'a'.repeat(30) }, body: { firm_name: 'Cabinet A', display_name: 'Responsable', auth_user_id: 'attacker' } };
const user = { id, email: 'owner@example.test', email_confirmed_at: '2026-01-01' };

test('registration uses normal signup, no auto confirmation or shared secret', async () => {
  let sent;
  const out = await registerCabinet({ email: user.email, password: 'StrongPass123', display_name: 'Responsable', firm_name: 'Cabinet A' }, {
    authCall: async (path, options) => { sent = { path, options }; return { status: 200, data: { user: { id: 'masked' } } }; }
  });
  assert.equal(sent.path, 'signup');
  assert.equal(sent.options.admin, undefined);
  assert.equal(sent.options.body.email_confirm, undefined);
  assert.deepEqual(out, { confirmation_required: true });
});
test('creation uses verified identity and refuses operational access during rollout', async () => {
  let sent;
  const out = await createCabinet(req, { verifyUser: async () => user,
    fetchRows: async (path, options) => { sent = { path, body: JSON.parse(options.body) }; return { org_id: 'cabinet-a', created: true }; } });
  assert.equal(sent.path, 'rpc/office_create_cabinet');
  assert.equal(sent.body.p_auth_user_id, id);
  assert.equal(out.operational_access, false);
  assert.equal(out.pilot_token, undefined);
});
test('unverified and anonymous identities cannot create a cabinet', async () => {
  for (const value of [null, { id }, { ...user, is_anonymous: true }]) {
    await assert.rejects(createCabinet(req, { verifyUser: async () => value,
      fetchRows: () => { throw new Error('database must not be called'); } }), /TOKEN_EXPIRED|EMAIL_NOT_VERIFIED/);
  }
});
test('shared pilot credential alone never authenticates onboarding', async () => {
  await assert.rejects(createCabinet({ headers: { 'x-office-manager-token': 'shared' }, body: req.body }), /USER_SESSION_REQUIRED/);
});
test('cabinet lookup is scoped to the verified person', async () => {
  let path;
  await myCabinets(req, { verifyUser: async () => user, fetchRows: async value => { path = value; return []; } });
  assert.match(path, new RegExp('auth_user_id=eq.' + id));
  assert.match(path, /active=eq.true/);
});
