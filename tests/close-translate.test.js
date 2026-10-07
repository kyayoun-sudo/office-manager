import test from 'node:test';
import assert from 'node:assert/strict';
import { closeOwnAccount } from '../lib/accounts.js';
import { translateTexts } from '../lib/translate-ui.js';

const me = { auth_user_id: '11111111-1111-1111-1111-111111111111', email: 'paul@taty.info', role: 'owner' };

test('close account: typed e-mail required; the last owner must confirm closing the firm', async () => {
  const calls = [];
  const fetchRows = async (path, opts) => { calls.push([path, opts]); return path.includes('role=eq.owner') ? [{ auth_user_id: me.auth_user_id }] : []; };
  await assert.rejects(closeOwnAccount('org', me, { confirm: 'x@y.z' }, { fetchRows }), /CONFIRM_WITH_YOUR_EMAIL/);
  await assert.rejects(closeOwnAccount('org', me, { confirm: 'PAUL@taty.info' }, { fetchRows }), /LAST_OWNER_CLOSES_FIRM/);
  let revoked = false;
  const out = await closeOwnAccount('org', me, { confirm: 'paul@taty.info', close_firm: true }, { fetchRows, disconnectGoogle: async () => { revoked = true; } });
  assert.deepEqual(out, { closed: true, firm_closed: true });
  assert.ok(revoked);
  assert.ok(calls.some(([p, o]) => o?.method === 'PATCH' && o.body.includes('"active":false')));
});

test('close account: a collaborator closes only their own account', async () => {
  const fetchRows = async () => [];
  const out = await closeOwnAccount('org', { ...me, role: 'collaborator' }, { confirm: 'paul@taty.info' }, { fetchRows, disconnectGoogle: async () => { throw new Error('must not'); } });
  assert.equal(out.firm_closed, false);
});

test('translate: same length array, cached, limits enforced', async () => {
  let n = 0;
  const runAI = async ({ input }) => { n++; return { text: JSON.stringify(JSON.parse(input).map(t => 'EN:' + t)) }; };
  const a = await translateTexts({ texts: ['Missions', 'À valider', 'Missions'] }, { runAI });
  assert.equal(a.translations['À valider'], 'EN:À valider');
  await translateTexts({ texts: ['Missions'] }, { runAI });
  assert.equal(n, 1);
  await assert.rejects(translateTexts({ texts: ['x'], to: 'de' }, { runAI }), /LANGUAGE_NOT_SUPPORTED/);
});
