import test from 'node:test';
import assert from 'node:assert/strict';
import { countAiCall, dailyLimit } from '../lib/ai-usage.js';
import { firstAvailable } from '../lib/ai-plus.js';

// 2026-10-30: several firms share the installation's AI keys. Counted per firm and per day; a limit only when the
// installation sets one (OFFICE_MANAGER_AI_DAILY_LIMIT).
const ORG = '11111111-1111-4111-8111-111111111111';
const counter = (start = 0) => { let n = start; const seen = []; return { seen, fetchRows: async (path, o) => { seen.push({ path, body: JSON.parse(o.body) }); return ++n; } }; };

test('no limit set: counted, never refused', async () => {
  assert.equal(dailyLimit({}), null);
  assert.equal(dailyLimit({ OFFICE_MANAGER_AI_DAILY_LIMIT: 'abc' }), null);
  const c = counter(5000);
  const r = await countAiCall({ orgId: ORG, env: {}, fetchRows: c.fetchRows });
  assert.equal(r.counted, true); assert.equal(r.calls, 5001);
  assert.equal(c.seen[0].path, 'rpc/office_ai_usage_increment');
  assert.equal(c.seen[0].body.p_org_id, ORG);
});

test('limit set by the installation: refused once exceeded, per firm', async () => {
  const env = { OFFICE_MANAGER_AI_DAILY_LIMIT: '3' };
  const c = counter(2);
  assert.equal((await countAiCall({ orgId: ORG, env, fetchRows: c.fetchRows })).calls, 3);
  await assert.rejects(countAiCall({ orgId: ORG, env, fetchRows: c.fetchRows }), /AI_DAILY_LIMIT_REACHED/);
});

test('the count cannot be read: the request goes on (a cost brake, not a lock); no firm: nothing counted', async () => {
  const env = { OFFICE_MANAGER_AI_DAILY_LIMIT: '1' };
  const r = await countAiCall({ orgId: ORG, env, fetchRows: async () => { throw new Error('SUPABASE_404: {"code":"PGRST202"}'); } });
  assert.equal(r.counted, false);
  assert.deepEqual(await countAiCall({ orgId: null, env, fetchRows: async () => 99 }), { counted: false });
});

test('firstAvailable: the shared pool is counted; the limit stops it before any provider is called', async () => {
  let called = 0;
  const env = { OPENAI_API_KEY: 'k', OFFICE_MANAGER_AI_DAILY_LIMIT: '1' };
  const d = { env, orgId: ORG, callModel: async () => { called++; return { text: 'ok', provider: 'openai' }; }, countAiCall: async () => { throw Object.assign(new Error('AI_DAILY_LIMIT_REACHED'), { statusCode: 429 }); } };
  await assert.rejects(firstAvailable(['openai'], { instructions: 'x', input: 'y' }, d), /AI_DAILY_LIMIT_REACHED/);
  assert.equal(called, 0, 'no provider called once the limit is reached');
  let counted = 0;
  const r = await firstAvailable(['openai'], { instructions: 'x', input: 'y' }, { ...d, countAiCall: async () => { counted++; return { counted: true }; } });
  assert.equal(r.text, 'ok'); assert.equal(counted, 1);
});
