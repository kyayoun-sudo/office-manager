// Does the AI really receive the memory? (2026-11-02 audit)
// 1) the firm's validated lessons reach every AI call of « Ma procédure », not only the modules that name their agent;
// 2) the part of the mission's memory given to the AI is chosen for the question, not the first N in file order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { callModel } from '../lib/ai-plus.js';
import { asAgent } from '../lib/agent-context.js';
import { focusTerms, pickRelevant, noteWeight } from '../lib/memory-select.js';
import { missionBrief } from '../lib/mission-brief.js';

const ok = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });

test('an AI call made during « Ma procédure » carries the Enhanced Auditor\'s validated lessons, even when the module names no agent', async () => {
  const sent = [];
  const env = { ANTHROPIC_API_KEY: 'a', ANTHROPIC_MODEL: 'm' };
  const d = { env, activeLessons: async (agent, dd) => agent === 'enhanced-auditor' ? ['Le budget initial vient du PTBA initial (mission ' + dd.missionId + ')'] : [],
    fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body).system); return ok({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }); } };
  await asAgent({ agent: 'enhanced-auditor', missionId: 'M1' }, () => callModel({ provider: 'anthropic', instructions: 'Remplis D2', input: 'x' }, d));
  assert.match(sent[0], /MÉMOIRE CENTRALE LOCALE/); assert.match(sent[0], /budget initial vient du PTBA initial \(mission M1\)/);
  // Outside a procedure request, nothing is added (and a module that names its agent keeps its choice).
  await callModel({ provider: 'anthropic', instructions: 'Remplis D2', input: 'x' }, d);
  assert.doesNotMatch(sent[1], /MÉMOIRE CENTRALE LOCALE/);
  await asAgent({ agent: 'enhanced-auditor', missionId: 'M1' }, () => callModel({ provider: 'anthropic', agentKey: 'orpailleur', instructions: 'Range', input: 'x' }, d));
  assert.match(sent[2], /MÉMOIRE CENTRALE LOCALE/); assert.doesNotMatch(sent[2], /PTBA initial/);
});

test('the « Ma procédure » route sets the Enhanced Auditor as the speaking agent, and a mission is kept only if the person may open it', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../api/app.js', import.meta.url), 'utf8');
  const { agentOfRoute } = await import('../lib/agent-context.js');
  assert.equal(agentOfRoute('procedure').agent, 'enhanced-auditor');
  assert.ok(src.includes('if (speaking?.missionId && !isSignedInternal(req, orgId)) await requireMissionAccess(orgId, speaking.missionId, req.account).catch(() => { speaking.missionId = null; });'), 'mission id checked');
  assert.ok(src.indexOf('requireMissionAccess(orgId, speaking.missionId') < src.indexOf('asAgent(speaking'), 'checked before the agent speaks');
});

test('an old decision about the sheet in question reaches the AI, even behind 100 newer unrelated notes', () => {
  const notes = [{ id: 'old', kind: 'decision', about: 'D2', text: 'D2 : amendements = final − initial, décidé par Paul', origin: 'personne', by: 'paul@cab.ci' }];
  for (let i = 0; i < 100; i++) notes.push({ id: 'n' + i, kind: 'fact', about: 'D1', text: 'Grand livre ' + i + ' lu', origin: 'agent' });
  const newestFirst = [...notes].reverse(); // memoryView order
  const before = newestFirst.slice(0, 40); // what the AI received before
  assert.equal(before.some(n => n.id === 'old'), false, 'the defect: the decision was never seen');
  const { kept, left_out } = pickRelevant(newestFirst, { terms: focusTerms('remplis D2 avec le TEB'), limit: 40, text: n => n.about + ' ' + n.text, weight: noteWeight });
  assert.ok(kept.some(n => n.id === 'old')); assert.equal(kept.length, 40); assert.equal(left_out, 61);
  // Without any match, the most recent stay (same as before) and the people's decisions are favoured.
  const plain = pickRelevant(newestFirst, { terms: [], limit: 40, text: n => n.text, weight: () => 0 });
  assert.deepEqual(plain.kept.map(n => n.id), before.map(n => n.id));
});

test('focus terms keep the short audit references (D2, PRJ-01, GL) and drop common words', () => {
  const t = focusTerms('Peux-tu remplir la feuille D2 pour PRJ-01 avec le GL ?');
  for (const w of ['d2', 'prj-01', 'prj', 'gl', 'remplir', 'feuille']) assert.ok(t.includes(w), w);
  for (const w of ['la', 'le', 'avec', 'pour']) assert.equal(t.includes(w), false, w);
});

test('the mission brief puts what concerns the focus first and says how much was left out', async () => {
  const docs = [];
  for (let i = 0; i < 200; i++) docs.push({ id: 'd' + i, name: 'releve_' + i + '.pdf', title: 'Relevé bancaire', uses: [] });
  docs.splice(3, 0, { id: 'teb', name: 'TEB_2024.xlsx', title: 'Tableau d’exécution budgétaire', uses: [{ what: 'feuille', where: 'D2' }] });
  const brief = await missionBrief('o', 'M1', 'enhanced-auditor', { focus: 'D2 PRJ-03', fetchRows: async () => [{ id: 'M1' }], missionMemory: async () => docs, missionNotes: async () => [], activeLessons: async () => [] });
  assert.ok(brief.documents.some(x => x.id === 'teb')); assert.equal(brief.documents.length, 150); assert.equal(brief.left_out.documents, 51);
});

test('every screen that works for an agent makes it speak: the Excel add-in and the other pages too', async () => {
  const { agentOfRoute, AGENT_OF_ROUTE } = await import('../lib/agent-context.js');
  const id = 'ef188e85-0522-4fd2-937c-0549dedef5f1';
  assert.deepEqual(agentOfRoute('workfile', id), { agent: 'enhanced-auditor', missionId: id }, 'Excel add-in');
  assert.equal(agentOfRoute('work-programme').agent, 'mission-controller');
  assert.equal(agentOfRoute('pbc').agent, 'mission-controller');
  assert.equal(agentOfRoute('opportunities').agent, 'grand-controleur');
  assert.equal(agentOfRoute('tidy').agent, 'orpailleur');
  assert.equal(agentOfRoute('shadow').agent, 'shadow');
  assert.equal(agentOfRoute('sika-expenses').agent, 'sika');
  assert.equal(agentOfRoute('login'), null, 'no agent speaks on accounts or settings');
  assert.equal(agentOfRoute('procedure', 'not-an-id').missionId, null, 'only a real mission id');
  // Every listed route exists in api/app.js (no typo that would silently leave a screen without its agent).
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../api/app.js', import.meta.url), 'utf8');
  const missing = Object.keys(AGENT_OF_ROUTE).filter(r => !new RegExp("^  '?" + r + "'?: \{", 'm').test(src));
  assert.deepEqual(missing, []);
  assert.match(src, /asAgent\(speaking, \(\) => run\(orgId, req\)\)/, 'the common entry of api/app.js applies it');
});

test('an AI call made from the Excel add-in route carries the Enhanced Auditor\'s lessons', async () => {
  const { asAgent: as, agentOfRoute } = await import('../lib/agent-context.js');
  const sent = [];
  const d = { env: { ANTHROPIC_API_KEY: 'a', ANTHROPIC_MODEL: 'm' }, activeLessons: async agent => agent === 'enhanced-auditor' ? ['Leçon du cabinet pour le working file'] : [],
    fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body).system); return ok({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }); } };
  await as(agentOfRoute('workfile'), () => callModel({ provider: 'anthropic', instructions: 'Revois la feuille', input: 'x' }, d));
  assert.match(sent[0], /Leçon du cabinet pour le working file/);
});

test('the common brain of the agents gives the mission memory chosen for its task', async () => {
  const { think } = await import('../lib/agent-brain.js');
  let focus = null;
  await think({ orgId: 'o', missionId: 'M1', agent: 'mission-controller', task: 'Rapprocher les relevés bancaires de la demande PBC-07', actions: {} },
    { missionBrief: async (o, m, a, dd) => { focus = dd.focus; return { documents: [], open: [], settled: [] }; }, ai: async () => ({ text: '{"understanding":"","orders":[]}' }) }).catch(() => null);
  assert.match(String(focus), /PBC-07/);
});
