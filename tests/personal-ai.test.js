import test from 'node:test';
import assert from 'node:assert/strict';
import { runAs, tryPersonal, connectMyAI, disconnectMyAI, myAIView, NOTICE_VERSION, NOTICE, personalEnv } from '../lib/personal-ai.js';
import { firstAvailable } from '../lib/ai-plus.js';

const sealer = async () => ({ seal: k => 'sealed:' + k, open: s => s.replace(/^sealed:/, '') });
function db(allowed = true) {
  const rows = [], sent = [];
  const fetchRows = async (url, o = {}) => {
    sent.push({ url, method: o.method || 'GET', body: o.body ? JSON.parse(o.body) : null });
    if (url.startsWith('office_firm_settings')) return [{ settings: { personal_ai_allowed: allowed } }];
    if (url.startsWith('office_user_ai_keys?on_conflict')) { for (const r of JSON.parse(o.body)) { const i = rows.findIndex(x => x.provider === r.provider); i >= 0 ? rows[i] = r : rows.push(r); } return []; }
    if (url.startsWith('office_user_ai_keys') && o.method === 'PATCH') { const b = JSON.parse(o.body); const p = (url.match(/provider=eq\.(\w+)/) || [])[1]; rows.filter(r => !p || r.provider === p).forEach(r => Object.assign(r, b)); return []; }
    if (url.startsWith('office_user_ai_keys')) return rows.filter(r => r.active && (!url.includes('notice_version') || r.notice_version === NOTICE_VERSION));
    return [];
  };
  return { rows, sent, fetchRows };
}
const me = { auth_user_id: 'u1', email: 'awa@cab.ci', display_name: 'Awa' };

test('Mon IA: connecting requires the warning accepted (current version); the key is checked, kept sealed, never shown back', async () => {
  const { rows, fetchRows } = db();
  const d = { fetchRows, sealer, audit: async () => null, callModel: async () => ({ text: 'OK' }) };
  assert.match(NOTICE, /ne sont pas responsables|n’en sont pas responsables/);
  await assert.rejects(connectMyAI('o', me, { provider: 'anthropic', key: 'sk-ant-' + 'x'.repeat(30) }, d), /NOTICE_NOT_ACCEPTED/);
  await assert.rejects(connectMyAI('o', me, { provider: 'anthropic', key: 'sk-ant-' + 'x'.repeat(30), accept_notice: true, notice_version: 'old' }, d), /NOTICE_NOT_ACCEPTED/);
  await assert.rejects(connectMyAI('o', me, { provider: 'anthropic', key: 'bad key', accept_notice: true, notice_version: NOTICE_VERSION }, d), /KEY_INVALID/);
  await assert.rejects(connectMyAI('o', me, { provider: 'anthropic', key: 'sk-ant-' + 'y'.repeat(30), accept_notice: true, notice_version: NOTICE_VERSION }, { ...d, callModel: async () => { throw new Error('ANTHROPIC_401: invalid x-api-key'); } }), /KEY_REFUSED_BY_PROVIDER/);
  const r = await connectMyAI('o', me, { provider: 'anthropic', key: 'sk-ant-' + 'z'.repeat(26) + 'ABCD', accept_notice: true, notice_version: NOTICE_VERSION }, d);
  assert.equal(r.key_hint, '…ABCD');
  assert.match(rows[0].key_enc, /^sealed:/);
  assert.equal(rows[0].notice_version, NOTICE_VERSION); assert.equal(rows[0].notice_accepted_by, 'Awa');
  const view = await myAIView('o', me, { fetchRows });
  assert.equal(JSON.stringify(view).includes('zzzz'), false, 'the key never goes back to the browser');
  await assert.rejects(connectMyAI('o', me, { provider: 'openai', key: 'sk-' + 'x'.repeat(30), accept_notice: true, notice_version: NOTICE_VERSION }, { ...d, fetchRows: db(false).fetchRows }), /PERSONAL_AI_DISABLED_BY_FIRM/);
  await disconnectMyAI('o', me, { provider: 'anthropic' }, d);
  assert.equal(rows[0].active, false); assert.equal(rows[0].key_enc, null);
});

test('Mon IA: a person\'s request tries their AI first, then the firm\'s AI exactly as before; without a person, the firm\'s AI only', async () => {
  const { rows, fetchRows } = db();
  rows.push({ provider: 'openai', key_enc: 'sealed:sk-mine', model: 'gpt-x', active: true, notice_version: NOTICE_VERSION });
  const calls = [];
  const env = { ANTHROPIC_API_KEY: 'firm', ANTHROPIC_MODEL: 'm', OPENAI_API_KEY: 'firm-oa' };
  const callModel = async (args, dd) => { calls.push([args.provider, dd.env?.OPENAI_API_KEY || null, dd.env?.ANTHROPIC_API_KEY]); if (fail && dd.env.OPENAI_API_KEY === 'sk-mine') throw new Error('OPENAI_429'); return { provider: args.provider, text: 'ok' }; };
  let fail = false;
  const d = { env, fetchRows, sealer, callModel };
  const a = await runAs('o', me, () => firstAvailable(['anthropic', 'openai'], { input: 'x' }, d));
  assert.equal(a.via, 'personal'); assert.deepEqual(calls[0], ['openai', 'sk-mine', 'firm']);
  calls.length = 0; fail = true;
  const b = await runAs('o', me, () => firstAvailable(['anthropic', 'openai'], { input: 'x' }, d));
  assert.equal(b.via, undefined); assert.deepEqual(calls.map(c => c[0]), ['openai', 'anthropic'], 'quota reached: the firm\'s AI answers');
  calls.length = 0;
  const c = await firstAvailable(['anthropic'], { input: 'x' }, d);
  assert.equal(c.provider, 'anthropic'); assert.deepEqual(calls, [['anthropic', 'firm-oa', 'firm']], 'background work: firm only');
  assert.equal(await tryPersonal(['openai'], {}, callModel, d), null);
  assert.equal(personalEnv({ provider: 'gemini', key: 'g', model: 'gm' }, {}).GEMINI_API_KEY, 'g');
});
