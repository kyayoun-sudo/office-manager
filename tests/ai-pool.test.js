import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchPool, providerFailure, resetPoolHealth, trackedProviderCall, poolStatus } from '../lib/ai-pool.js';
import { firstAvailable, multiModel } from '../lib/ai-plus.js';
import { sdkProviderConfig } from '../lib/ai-sdk-provider.js';
import { Agent, Runner, tool } from '@openai/agents';
// The package the app depends on (pnpm in CI does not expose its internal @openai/agents-core).
import { Usage } from '@openai/agents';

test.beforeEach(() => resetPoolHealth());
const env = { OPENAI_API_KEY: 'synthetic-openai', MISTRAL_API_KEY: 'synthetic-mistral' };

test('erreurs de crédit, clé, quota, délai et requête sont distinguées', () => {
  assert.equal(providerFailure(Error('OPENAI_429: insufficient_quota')).reason, 'CREDIT_REQUIRED');
  assert.equal(providerFailure(Error('ANTHROPIC_400: Your credit balance is too low')).reason, 'CREDIT_REQUIRED');
  assert.equal(providerFailure({ status: 402 }).reason, 'CREDIT_REQUIRED');
  assert.equal(providerFailure({ status: 401 }).reason, 'CREDENTIAL_REJECTED');
  assert.equal(providerFailure({ status: 429, retryAfter: 100 }).delay, 100000);
  assert.equal(providerFailure({ status: 500 }).reason, 'TEMPORARILY_UNAVAILABLE');
  assert.equal(providerFailure({ status: 400 }).delay, 0);
});

test('sans crédit : relais immédiat puis aucun nouvel appel au fournisseur suspendu', async () => {
  const calls = [];
  const callModel = async ({ provider }) => { calls.push(provider); if (provider === 'openai') throw Error('OPENAI_429: insufficient_quota'); return { provider, text: 'ok' }; };
  assert.equal((await firstAvailable(null, { input: 'x' }, { env, callModel })).provider, 'mistral');
  calls.length = 0;
  assert.equal((await firstAvailable(null, { input: 'x' }, { env, callModel })).provider, 'mistral');
  assert.deepEqual(calls, ['mistral']);
  const status = await poolStatus(['openai'], { env }); assert.equal(status.openai.reason, 'CREDIT_REQUIRED');
  assert.ok(!JSON.stringify(status).includes('synthetic'));
});

test('un fournisseur rapide répond seul ; un lent est doublé et annulé après succès du remplaçant', async () => {
  const calls = [];
  await dispatchPool(['openai', 'mistral'], async p => { calls.push(p); return 'ok'; }, { env, hedgeMs: 15 });
  assert.deepEqual(calls, ['openai']); resetPoolHealth();
  let aborted = false;
  const out = await dispatchPool(['openai', 'mistral'], (p, signal) => p === 'openai' ? new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
  }) : Promise.resolve('relève'), { env, hedgeMs: 5 });
  assert.equal(out, 'relève'); assert.equal(aborted, true);
});

test('cooldown persistant : une autre instance le lit, une clé changée ou un autre cabinet reste isolé', async () => {
  const rows = new Map(); const healthStore = { get: async id => rows.get(id.orgId + id.hash), set: async (id, value) => rows.set(id.orgId + id.hash, value) };
  const d = { env, orgId: 'A', healthStore, now: () => 1000 };
  await assert.rejects(trackedProviderCall('openai', async () => { throw Error('OPENAI_402'); }, d));
  resetPoolHealth(); let called = false;
  await assert.rejects(trackedProviderCall('openai', async () => { called = true; }, d), /PAUSED/); assert.equal(called, false);
  assert.equal(await trackedProviderCall('openai', async () => 'B', { ...d, orgId: 'B' }), 'B');
  assert.equal(await trackedProviderCall('openai', async () => 'new', { ...d, env: { OPENAI_API_KEY: 'rotated' } }), 'new');
  assert.equal(await trackedProviderCall('openai', async () => 'recovered', { ...d, now: () => 2000000 }), 'recovered');
});

test('plusieurs tâches simultanées n’attendent pas toutes le même fournisseur occupé', async () => {
  let release; const held = new Promise(r => { release = r; }); const called = [];
  const first = dispatchPool(['openai'], async () => { await held; return 'first'; }, { env });
  await new Promise(r => setImmediate(r));
  assert.equal(await dispatchPool(['openai', 'mistral'], async p => { called.push(p); return p; }, { env }), 'mistral');
  release(); await first; assert.deepEqual(called, ['mistral']);
});

test('tous suspendus : retour explicite, aucune boucle ni nouvel appel payant', async () => {
  for (const p of ['openai', 'mistral']) await assert.rejects(trackedProviderCall(p, async () => { throw { status: 402 }; }, { env }));
  let called = false;
  await assert.rejects(dispatchPool(['openai', 'mistral'], () => { called = true; }, { env }), e => e.message === 'NO_AI_PROVIDER_AVAILABLE' && e.skipped.length === 2);
  assert.equal(called, false);
});

test('les fichiers sont envoyés uniquement aux fournisseurs compatibles et multiModel utilise le même pool', async () => {
  const calls = [];
  const d = { env, callModel: async ({ provider }) => { calls.push(provider); return { provider, text: 'ok' }; } };
  await firstAvailable(null, { input: 'x', files: [{ mimeType: 'application/pdf' }] }, d); assert.deepEqual(calls, ['openai']);
  await assert.rejects(trackedProviderCall('openai', async () => { throw { status: 402 }; }, d)); calls.length = 0;
  const out = await multiModel({ input: 'x' }, null, d); assert.equal(out[0].provider, 'mistral'); assert.deepEqual(calls, ['mistral']);
});

const response = output => ({ usage: new Usage(), output });
const message = value => ({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: value }] });

test('SDK : une panne après un outil change d’IA au tour suivant, avec le résultat de l’outil, sans rejouer son action', async () => {
  const calls = []; let executed = 0, openaiCalls = 0;
  const config = sdkProviderConfig('auto', env, Math.random, { hedgeMs: 100, getModel: async p => ({ getResponse: async req => {
    calls.push(p);
    if (p === 'openai' && ++openaiCalls === 1) return response([{ type: 'function_call', callId: 'once', name: 'read_sample', arguments: '{}' }]);
    if (p === 'openai') throw Object.assign(Error('credit'), { status: 402 });
    assert.ok(req.input.some(x => x.type === 'function_call_result' && JSON.stringify(x).includes('sample-data')), JSON.stringify(req.input));
    return response([message('Reprise avec le résultat déjà obtenu')]);
  } }) });
  const { provider, getProviderUsage, ...runnerConfig } = config;
  const agent = new Agent({ name: 'test', tools: [tool({ name: 'read_sample', description: 'read', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }, execute: async () => { executed++; return 'sample-data'; } })] });
  const out = await new Runner(runnerConfig).run(agent, 'read', { maxTurns: 4 });
  assert.match(out.finalOutput, /Reprise/); assert.equal(executed, 1); assert.deepEqual(calls, ['openai', 'openai', 'mistral']); assert.equal(provider, 'pool');
});

test('SDK streaming : un seul résultat d’inférence est exposé, sans fragments d’un fournisseur perdant', async () => {
  const { provider, getProviderUsage, ...config } = sdkProviderConfig('auto', env, Math.random, { getModel: async () => ({ getResponse: async () => response([message('OK')]) }) });
  const stream = await new Runner(config).run(new Agent({ name: 'test' }), 'x', { stream: true });
  for await (const event of stream) { /* consume stream */ }
  assert.equal(stream.finalOutput, 'OK');
});

test('les suspensions passent dans la vraie contrainte SQL du checkpoint et restent lisibles après redémarrage', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { readFile } = await import('node:fs/promises');
  const db = new PGlite();
  try {
    const schema = await readFile(new URL('../db/memory.sql', import.meta.url), 'utf8');
    await db.exec(schema.slice(schema.indexOf('create table if not exists public.office_agent_checkpoints'), schema.indexOf('alter table public.office_agent_checkpoints')));
    const healthStore = {
      get: async id => (await db.query('select report from office_agent_checkpoints where org_id=$1 and agent_key=$2', [id.orgId, id.agent_key])).rows[0]?.report,
      set: async (id, report) => db.query('insert into office_agent_checkpoints (org_id,agent_key,status,report) values ($1,$2,$3,$4) on conflict (org_id,agent_key) do update set report=excluded.report', [id.orgId, id.agent_key, 'PAUSED', JSON.stringify(report)])
    };
    const d = { env, orgId: '11111111-1111-4111-8111-111111111111', healthStore };
    await assert.rejects(trackedProviderCall('openai', async () => { throw { status: 402 }; }, d));
    resetPoolHealth();
    await assert.rejects(trackedProviderCall('openai', async () => { throw Error('should never call'); }, d), /PAUSED/);
    const rows = await db.query('select * from office_agent_checkpoints');
    assert.equal(rows.rows.length, 1); assert.ok(!JSON.stringify(rows.rows).includes('synthetic'));
  } finally { await db.close(); }
});

test('une requête annulée et une erreur de contenu ne suspendent pas une IA saine', async () => {
  await assert.rejects(trackedProviderCall('openai', async () => { throw new DOMException('cancel', 'AbortError'); }, { env }));
  await assert.rejects(trackedProviderCall('openai', async () => { throw { status: 400, message: 'input too long' }; }, { env }));
  assert.equal((await poolStatus(['openai'], { env })).openai.state, 'not_yet_verified');
  assert.equal(await trackedProviderCall('openai', async () => 'ok', { env }), 'ok');
});

test('une suspension peut être levée par un diagnostic manuel réussi', async () => {
  const { checkProvider } = await import('../lib/provider-diagnostics.js');
  await assert.rejects(trackedProviderCall('openai', async () => { throw { status: 402 }; }, { env }));
  const r = await checkProvider('openai', { env, callModel: async () => ({ provider: 'openai', text: 'OK' }) });
  assert.equal(r.ok, true); assert.equal((await poolStatus(['openai'], { env })).openai.state, 'recently_available');
});
