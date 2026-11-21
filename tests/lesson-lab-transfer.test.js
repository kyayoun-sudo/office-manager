import test from 'node:test';
import assert from 'node:assert/strict';
import { labRemember, labV1Configured } from '../lib/eynowa-lab-v1.js';
import { transferLesson, lessonLabText } from '../lib/lesson-lab-transfer.js';
import { setLessonStatus, emptyLab } from '../lib/shadow.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const SIM_LESSON = (extra = {}) => ({ id: 'L-sim', agent: 'orpailleur', category: 'classement', situation: 'Un relevé rangé d’après son nom.', lesson: 'Lire le contenu avant de nommer.', rule: 'Ne jamais ranger d’après le seul nom.',
  type: 'hypothesis', source: 'simulation:22222222-2222-4222-8222-222222222222', status: 'active', needs_owner: false, history: [{ at: '2026-11-21T10:00:00Z', status: 'active', why: 'validée' }], evidence: [], ...extra });
const PLAIN_LESSON = { id: 'L-plain', agent: 'sika', lesson: 'Vérifier le taux.', rule: 'Toujours vérifier le taux.', type: 'firm_rule', source: null, status: 'under_review', needs_owner: true, history: [], evidence: [] };

function world(lessons) {
  const state = { ...emptyLab(), lessons };
  return { state, d: { loadLab: async () => ({ ...emptyLab(), ...state }), updateJsonFile: async (name, fn) => { await fn(state); } } };
}
const okRemember = (calls = []) => async args => { calls.push(args); return { stored: true, memory_id: 'mem-1', tenant: args.tenant }; };
const ENV = { EYNOWA_LAB_URL: 'https://lab.example/', EYNOWA_LAB_V1_KEY: 'secret-v1-key' };

test('the client needs its URL and its own key, and sends the validation, tenant and idempotency key', async () => {
  assert.equal(labV1Configured({}), false); assert.equal(labV1Configured(ENV), true);
  await assert.rejects(labRemember({ tenant: ORG, text: 'x' }, { env: {} }), /EYNOWA_LAB_V1_NOT_CONFIGURED/);
  let seen;
  const fetchImpl = async (url, o) => { seen = { url, o }; return { ok: true, status: 200, text: async () => JSON.stringify({ stored: true, memory_id: 'mem-9', tenant: ORG }) }; };
  const r = await labRemember({ tenant: ORG, text: 'une leçon', validatedBy: 'Paul', validatedAt: '2026-11-21T10:00:00Z', idempotencyKey: 'k1', metadata: { agent: 'sika' } }, { env: ENV, fetchImpl });
  assert.deepEqual(r, { stored: true, memory_id: 'mem-9', tenant: ORG });
  assert.equal(seen.url, 'https://lab.example/v1/memory/remember'); assert.equal(seen.o.headers.Authorization, 'Bearer secret-v1-key');
  const body = JSON.parse(seen.o.body);
  assert.deepEqual([body.scope.tenant, body.validation.validated_by, body.idempotency_key], [ORG, 'Paul', 'k1']);
});

test('a write counts only with stored:true and a memory id; the Lab’s refusal code is kept; the key is never in the error', async () => {
  const reply = (status, data) => async () => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });
  const args = { tenant: ORG, text: 'x', validatedBy: 'P', validatedAt: 'now', idempotencyKey: 'k' };
  await assert.rejects(labRemember(args, { env: ENV, fetchImpl: reply(200, { stored: false }) }), /EYNOWA_LAB_NOT_STORED/);
  await assert.rejects(labRemember(args, { env: ENV, fetchImpl: reply(200, { stored: true }) }), /EYNOWA_LAB_NOT_STORED/);
  await assert.rejects(labRemember(args, { env: ENV, fetchImpl: reply(403, { error: 'TENANT_NOT_ALLOWED' }) }), /TENANT_NOT_ALLOWED/);
  await assert.rejects(labRemember(args, { env: ENV, fetchImpl: reply(502, 'oops') }), e => !String(e.message).includes('secret-v1-key') && /EYNOWA_LAB_HTTP_502|oops/.test(e.message));
});

test('an activated simulation lesson is stored once, for the validating firm, with a stable idempotency key', async () => {
  const w = world([SIM_LESSON()]), calls = [];
  const rec = await transferLesson(ORG, 'L-sim', 'Paul', { ...w.d, remember: okRemember(calls), now: () => Date.UTC(2026, 10, 21, 12) });
  assert.equal(rec.status, 'stored'); assert.equal(rec.memory_id, 'mem-1');
  assert.equal(calls[0].tenant, ORG); assert.equal(calls[0].validatedBy, 'Paul'); assert.equal(calls[0].idempotencyKey, 'om-lesson-L-sim'); assert.equal(calls[0].validatedAt, '2026-11-21T10:00:00Z');
  assert.match(calls[0].text, /Lire le contenu avant de nommer/);
  assert.equal(w.state.lessons[0].lab_transfer.status, 'stored');
  await transferLesson(ORG, 'L-sim', 'Paul', { ...w.d, remember: okRemember(calls) });
  assert.equal(calls.length, 1); // already stored: nothing sent twice
});

test('a Lab failure is written on the lesson, honestly, and a retry can still store it', async () => {
  const w = world([SIM_LESSON()]);
  const down = async () => { throw new Error('EYNOWA_LAB_TIMEOUT'); };
  const first = await transferLesson(ORG, 'L-sim', 'Paul', { ...w.d, remember: down });
  assert.deepEqual([first.status, first.error, first.attempts], ['failed', 'EYNOWA_LAB_TIMEOUT', 1]);
  assert.equal(w.state.lessons[0].lab_transfer.status, 'failed');
  const second = await transferLesson(ORG, 'L-sim', 'Paul', { ...w.d, remember: down });
  assert.equal(second.attempts, 2);
  const third = await transferLesson(ORG, 'L-sim', 'Paul', { ...w.d, remember: okRemember() });
  assert.equal(third.status, 'stored');
});

test('nothing is sent without a validator, with personal data, for a plain lesson, or a lesson not yet active; without config it says so', async () => {
  const calls = [];
  const w = world([SIM_LESSON(), SIM_LESSON({ id: 'L-mail', lesson: 'Écrire à jean@client.com.' }), SIM_LESSON({ id: 'L-draft', status: 'under_review' }), PLAIN_LESSON]);
  assert.equal((await transferLesson(ORG, 'L-sim', '', { ...w.d, remember: okRemember(calls) })).why, 'HUMAN_VALIDATION_REQUIRED');
  assert.equal((await transferLesson(ORG, 'L-mail', 'Paul', { ...w.d, remember: okRemember(calls) })).why, 'NOT_GENERIC_OR_PROTECTED');
  await assert.rejects(transferLesson(ORG, 'L-draft', 'Paul', { ...w.d, remember: okRemember(calls) }), /LESSON_NOT_ACTIVE/);
  await assert.rejects(transferLesson(ORG, 'L-plain', 'Paul', { ...w.d, remember: okRemember(calls) }), /NOT_A_SIMULATION_LESSON/);
  await assert.rejects(transferLesson(ORG, 'L-none', 'Paul', { ...w.d, remember: okRemember(calls) }), /LESSON_NOT_FOUND/);
  assert.equal(calls.length, 0);
  assert.equal((await transferLesson(ORG, 'L-sim', 'Paul', { ...w.d, env: {} })).status, 'not_configured');
  assert.ok(lessonLabText(SIM_LESSON()).length < 8000);
});

test('activating a simulation lesson sends it; a plain lesson does not; a Lab failure never blocks the activation', async () => {
  const calls = [];
  const w = world([SIM_LESSON({ status: 'under_review', needs_owner: true, history: [] }), PLAIN_LESSON]);
  const out = await setLessonStatus(ORG, { id: 'L-sim', status: 'active' }, 'Paul', { ...w.d, remember: okRemember(calls) });
  assert.equal(out.status, 'active'); assert.equal(out.lab_transfer.status, 'stored'); assert.equal(calls.length, 1);
  await setLessonStatus(ORG, { id: 'L-plain', status: 'active' }, 'Paul', { ...w.d, remember: okRemember(calls) });
  assert.equal(calls.length, 1);
  const w2 = world([SIM_LESSON({ status: 'under_review', needs_owner: true, history: [] })]);
  const down = await setLessonStatus(ORG, { id: 'L-sim', status: 'active' }, 'Paul', { ...w2.d, remember: async () => { throw new Error('EYNOWA_LAB_HTTP_502'); } });
  assert.equal(down.status, 'active'); assert.equal(down.lab_transfer.status, 'failed');
  assert.equal(w2.state.lessons[0].status, 'active');
});
