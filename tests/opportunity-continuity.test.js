import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { unresolvedOpportunityQuestions } from '../lib/opportunities.js';
import { rewriteMethodology } from '../lib/doc-templates.js';

function queue(o, role) {
  const html = readFileSync(new URL('../opportunites.html', import.meta.url), 'utf8');
  const start = html.indexOf('  var skipped = {};');
  const end = html.indexOf('  function drawMine(', start);
  const sandbox = { o, role, mayReview: role => ['owner', 'partner', 'manager', 'supervisor'].includes(role), agentSections: () => [] };
  return runInNewContext(html.slice(start, end) + '\nqueueFor(o, role)', sandbox);
}

test('KYC decision stays actionable despite preparer/date/comment values; an answered decision is not asked twice', () => {
  const row = { row: 70, label: 'Décision', authority: 'partner', may_fill: true, identity: false,
    fields: [{ cell: 'C70', header: 'Décision', value: '', options: ['ACCEPTE', 'REFUSE'] }, { cell: 'D70', header: 'Commentaire', value: 'KYC préparé' }, { cell: 'E70', header: 'Préparé par', value: 'Mission Controller (IA)' }] };
  const o = { status: 'phase1', sheets: [{ name: '04_CONCLUSION', owner: 'decision', open: true, rows: [row] }] };
  assert.equal(queue(o, 'partner')[0].kind, 'decide');
  row.fields[0].value = 'ACCEPTE'; assert.equal(queue(o, 'partner').length, 0);
  row.fields[0].value = ''; row.may_fill = false; assert.equal(queue(o, 'owner').length, 0, 'existing server authority remains enforced');
});

test('a KYC question remains actionable when only a source is filled', () => {
  const row = { row: 61, label: 'Sanctions', authority: 'team', may_fill: true, fields: [{ cell: 'E61', header: 'Résultat', value: '' }, { cell: 'F61', header: 'Preuve / lien', value: 'https://example.org/source' }], proposal: { for_team: true, question: 'Confirmer le résultat' } };
  const o = { status: 'phase1', sheets: [{ name: '03_PHASE_1', owner: 'mission-controller', open: true, rows: [row] }] };
  assert.equal(queue(o, 'manager')[0].kind, 'ask');
  row.fields[0].value = 'Aucune sanction identifiée'; assert.equal(queue(o, 'manager').length, 0);
});

test('known reception date and real TDR links resolve stale questions without fabricating CRM/source facts', () => {
  const questions = ['Quelle est la date de réception ?', 'Quel est le nom du fichier TDR et le lien Drive du TDR ou du dossier ?', 'Quel est le lien URL ou la plateforme source de l’avis ?', 'Quelle est la référence CRM et quels collaborateurs sont affectés ?'];
  const o = { open_questions: questions, tdr_received_at: '2026-10-09', tdr_files: [{ id: 'tdr', name: 'TDR.pdf', url: 'https://drive.google.com/file/d/tdr/view' }], folder: { url: 'https://drive.google.com/drive/folders/mission' } };
  assert.deepEqual(unresolvedOpportunityQuestions(o), questions.slice(2));
  assert.deepEqual(o.open_questions, questions, 'historical questions remain in memory');
  assert.deepEqual(unresolvedOpportunityQuestions({ open_questions: questions }), questions);
});

test('methodology rewriting is a proposal using the validated team; no AI call without the existing permission', async () => {
  let calls = 0;
  const body = { opportunity_id: 'opp', draft: 'Nous proposons une revue documentaire.' };
  const account = { role: 'manager', email: 'manager@example.org' };
  const d = { permissions: async () => ({ granted: true }), getOpportunity: async () => ({ id: 'opp', title: 'Audit', team: { status: 'validated', members: [{ name: 'Auditor' }] } }),
    ai: async (order, args) => { calls++; assert.match(args.instructions, /Ne promets pas/); assert.match(args.input, /Auditor/); return { text: 'Méthodologie reformulée', provider: 'test' }; } };
  const result = await rewriteMethodology('org', body, account, d);
  assert.equal(result.status, 'proposal'); assert.equal(calls, 1);
  await assert.rejects(rewriteMethodology('org', body, account, { ...d, permissions: async () => ({ granted: false }) }), /AGENTS_NOT_AUTHORIZED/);
  assert.equal(calls, 1);
});
