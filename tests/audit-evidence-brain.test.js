import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { learnAuditDocument, reasonAuditProcedure } from '../lib/audit-evidence-brain.js';
import { executeMissionWork } from '../lib/enhanced-auditor-execution.js';

const text = 'BANQUE A — Société X — janvier 2026. Encaissement client F001 : 1500 EUR.';
const doc = { id: 'scan', name: 'zz004.dat', role: 'autre' };
const drive = { getMeta: async () => ({ modifiedTime: 'v1', mimeType: 'text/plain' }), readText: async () => ({ text }) };
const fileForAI = async () => ({ text, visual: false });
const aiRead = async () => ({ provider: 'test', text: JSON.stringify({ document_type: 'relevé bancaire', entity: 'Société X', period: 'janvier 2026', summary: 'Encaissement reçu', facts: [{ value: '1500 EUR', quote: '1500 EUR' }, { value: 'inventé', quote: 'Texte absent' }] }) });

test('un nom erroné ne décide pas de la nature de la pièce ; seules les citations présentes sont retenues', async () => {
  const k = await learnAuditDocument(doc, drive, { fileForAI, ai: async (providers, args) => { assert.ok(JSON.parse(args.input).text.includes('BANQUE A')); return aiRead(); } });
  assert.equal(k.document_type, 'relevé bancaire'); assert.equal(k.facts.length, 1); assert.equal(k.facts[0].verified_in_text, true);
  assert.equal(k.status, 'EXCERPTS_READ'); assert.ok(k.limitations.length);
});

test('la connaissance est réutilisée seulement si sa révision est connue et courante', async () => {
  const k = await learnAuditDocument(doc, drive, { fileForAI, ai: aiRead });
  assert.equal(await learnAuditDocument({ ...doc, audit_read: k }, drive, { ai: () => { throw Error('should not call'); } }), k);
  let calls = 0;
  const changed = { ...drive, getMeta: async () => ({ modifiedTime: 'v2' }) };
  const fresh = await learnAuditDocument({ ...doc, audit_read: k }, changed, { fileForAI, ai: async () => { calls++; return aiRead(); } });
  assert.equal(calls, 1); assert.notEqual(fresh.revision, k.revision);
});

test('une pièce modifiée pendant sa lecture ne devient pas une connaissance actuelle', async () => {
  let n = 0;
  await assert.rejects(learnAuditDocument(doc, { ...drive, getMeta: async () => ({ modifiedTime: String(++n) }) }, { fileForAI, ai: aiRead }), /SOURCE_CHANGED/);
});

function setup(responses, extra = {}) {
  let comparisons = 0;
  const inputs = [], notes = [];
  const args = { orgId: 'O', missionId: 'M', card: { code: 'REC-01', objective: 'Vérifier les encaissements après clôture', steps: ['Rapprocher créances et encaissements'] },
    wpRead: { instructions: [{ text: 'Rapprocher F001', address: 'Test!B2' }] }, work: { items: [{ ref: 'F001', amount: 1500, evidence: [] }] },
    documents: [doc], drive, compare: async item => { comparisons++; return { proposed_result: 'PASS', reason: item.evidence[0].file_id }; }, scan: async () => ({ checked_rows: 10 }) };
  const d = { missionBrief: async () => ({ documents: [], open: [], settled: [] }), noteMission: async (o, m, n) => { notes.push(...n); }, closeNote: async () => null, fileForAI,
    ai: async (p, a) => { inputs.push(JSON.parse(a.input)); return { provider: 'test', text: JSON.stringify(responses.shift() || { understanding: 'Terminé', orders: [] }) }; }, ...extra };
  return { args, d, inputs, notes, comparisons: () => comparisons };
}
const read = { action: 'read_document', params: { document_id: 'scan' }, why: 'Lire le contenu avant le rapprochement' };
const compare = { action: 'compare_item', params: { item_index: 0, document_ids: ['scan'], why: 'Règlement F001 de janvier, à rapprocher de la créance' }, why: 'Le SOP le demande' };
const step = { instruction: 'Rapprocher le règlement de la créance F001', sop_reference: 'REC-01', working_paper_reference: 'Test!B2', document_ids: ['scan'], why: 'Test des encaissements après clôture' };

test('la vraie boucle IA lit une pièce non rattachée à la ligne, choisit cette pièce, reçoit le résultat et prépare un plan sourcé', async () => {
  const h = setup([{ understanding: 'Il faut lire scan', orders: [read] }, { understanding: 'La pièce contient le règlement F001', orders: [compare, { action: 'prepare_steps', params: { steps: [step] } }] }, { understanding: 'Comparaison préparée ; validation humaine requise', orders: [] }]);
  const r = await reasonAuditProcedure(h.args, h.d);
  assert.equal(r.item_proposals.length, 1); assert.equal(r.item_proposals[0].proposal.evidence_candidates[0].file_id, 'scan');
  assert.deepEqual(h.args.work.items[0].evidence, [], 'aucun lien humain ni résultat changé'); assert.equal(h.args.work.items[0].result, undefined);
  assert.equal(r.steps[0].sop_reference, 'REC-01'); assert.equal(h.comparisons(), 1);
  assert.equal(h.inputs[0].read.sop.code, 'REC-01'); assert.equal(h.inputs[0].read.working_paper.instructions[0].address, 'Test!B2');
  assert.match(h.inputs[1].read.feedback[0].done[0].result.text, /BANQUE A/);
  assert.equal(h.inputs[2].read.feedback[1].done[0].result.proposal.proposed_result, 'PASS'); assert.ok(h.notes.length);
});

test('fichier hors mission, pièce non lue et références SOP/WP inventées : refus explicites', async () => {
  const h = setup([{ orders: [{ ...read, params: { document_id: 'other-tenant' } }, compare, { action: 'prepare_steps', params: { steps: [{ ...step, working_paper_reference: 'Inventé!B1' }] } }, { action: 'sign_off', params: {} }] }]);
  const r = await reasonAuditProcedure(h.args, h.d);
  assert.equal(r.refused.length, 4); assert.equal(h.comparisons(), 0); assert.equal(r.steps.length, 0);
});

test('une révision changée après lecture invalide la sélection avant comparaison', async () => {
  const h = setup([{ orders: [read] }, { orders: [compare] }]);
  let version = 'v1'; h.args.drive = { ...drive, getMeta: async () => ({ modifiedTime: version }) };
  const ai = h.d.ai; h.d.ai = async (...a) => { const r = await ai(...a); if (h.inputs.length === 2) version = 'v2'; return r; };
  const r = await reasonAuditProcedure(h.args, h.d); assert.equal(h.comparisons(), 0); assert.match(r.refused[0].refused, /SOURCE_CHANGED/);
});

test('une pièce sans révision connue est revérifiée par son empreinte', async () => {
  const h = setup([{ orders: [read] }, { orders: [compare] }]);
  let content = text;
  h.args.drive = { ...drive, getMeta: async () => ({}) }; h.d.fileForAI = async () => ({ text: content, visual: false });
  const ai = h.d.ai; h.d.ai = async (...a) => { const r = await ai(...a); if (h.inputs.length === 2) content = 'Modifié'; return r; };
  const r = await reasonAuditProcedure(h.args, h.d); assert.equal(h.comparisons(), 0); assert.match(r.refused[0].refused, /SOURCE_CHANGED/);
});

test('panne IA : aucune sélection de pièces inventée par le code', async () => {
  const h = setup([], { ai: async () => { throw Error('AI_TIMEOUT'); } });
  const r = await reasonAuditProcedure(h.args, h.d); assert.equal(r.status, 'AI_UNAVAILABLE'); assert.deepEqual(r.item_proposals, []); assert.equal(h.comparisons(), 0);
});

test('une mission de plus de 30 pièces reste accessible par pages explicites', async () => {
  const h = setup([{ orders: [{ action: 'next_documents', params: {} }] }, { orders: [] }]);
  h.args.documents = Array.from({ length: 36 }, (_, i) => ({ id: 'D' + i, name: 'scan' + i }));
  const r = await reasonAuditProcedure(h.args, h.d);
  assert.equal(r.documents_total, 36); assert.equal(h.inputs[0].read.documents_not_in_first_page, 6);
  assert.equal(h.inputs[1].read.feedback[0].done[0].result.documents[5].id, 'D35');
});

test('le parcours de revue appelle le cerveau avec le SOP, les cellules du working file et tout le catalogue ; travail verrouillé préservé', async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('REC-01'); ws.getCell('B2').value = 'Rapprocher les créances et les encaissements';
  const bytes = Buffer.from(await wb.xlsx.writeBuffer()); let calls = 0; let patches = 0; let locked = false;
  const programme = { id: 'P', version: 1, cycles: [{ cycle_code: 'REC', procedures: [{ code: 'REC-01', active: true }] }], workpapers: [{ cycle_code: 'REC', file_id: 'WP' }] };
  const d = { fetchRows: async (path, opts) => { if (opts?.method === 'PATCH') { patches++; return []; } if (path.startsWith('office_work_programmes')) return [programme]; if (path.startsWith('office_procedure_work')) return [{ id: 'W', status: locked ? 'reviewed' : 'in_progress', items: [], walkthrough: [] }]; return []; },
    methodology: async () => ({ sops: [{ procedures: [{ code: 'REC-01', steps: [], ask: [] }] }] }), permissions: async () => ({ granted: true }), missionDocuments: async () => [doc], drive: { downloadBuffer: async () => bytes },
    reasonAuditProcedure: async args => { calls++; assert.equal(args.documents[0].id, 'scan'); assert.ok(args.wpRead.content[0].rows[0].cells[0].text.includes('Rapprocher')); return { status: 'PREPARED_REVIEW_REQUIRED', item_proposals: [] }; } };
  await executeMissionWork('O', 'M', d);
  assert.equal(calls, 1); locked = true; await executeMissionWork('O', 'M', d); assert.equal(calls, 1); assert.equal(patches, 0);
});

test('le bouton de préparation utilise les droits de la personne et conserve une préparation sans écrire Excel', async () => {
  const { prepareProcedureBrain } = await import('../lib/enhanced-auditor-execution.js');
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('REC-01').getCell('A1').value = 'REC-01';
  let patches = 0, brainCalls = 0;
  const work = { id: 'W', status: 'in_progress', items: [{ ref: 'F001', evidence: [] }], walkthrough: [{ q: 'Question', a: 'Réponse humaine' }] };
  const view = { editable: true, work, card: { code: 'REC-01' }, workpaper: { file_id: 'WP' } };
  const d = { view: async () => view, permissions: async () => ({ granted: true }), drive: { downloadBuffer: async () => Buffer.from(await wb.xlsx.writeBuffer()) }, missionDocuments: async () => [doc],
    reasonAuditProcedure: async () => { brainCalls++; return { status: 'PREPARED_REVIEW_REQUIRED', steps: [step], item_proposals: [{ item_index: 0, proposal: { proposed_result: 'PASS', evidence_candidates: [{ file_id: 'scan' }] } }] }; },
    patch: async (o, w, changes, account) => { patches++; assert.equal(account.email, 'auditor@example.org'); return { ...w, ...changes }; } };
  const r = await prepareProcedureBrain('O', 'M', 'REC-01', { email: 'auditor@example.org' }, d);
  assert.equal(r.work.walkthrough[0].a, 'Réponse humaine'); assert.equal(r.work.walkthrough.at(-1).kind, 'audit-brain-plan');
  assert.deepEqual(r.work.items[0].evidence, []); assert.equal(r.work.items[0].result, undefined); assert.equal(patches, 1);
  view.work.status = 'reviewed'; await assert.rejects(prepareProcedureBrain('O', 'M', 'REC-01', {}, d), /IN_REVIEW/);
  view.work.status = 'in_progress'; d.permissions = async () => ({ granted: false }); await assert.rejects(prepareProcedureBrain('O', 'M', 'REC-01', {}, d), /PERMISSION/);
  assert.equal(brainCalls, 1); assert.equal(patches, 1);
});

test('la lecture des pièces est reprise par lots et enregistrée dans le registre de la mission', async () => {
  const { auditorStep } = await import('../lib/enhanced-auditor.js');
  const state = { reviews: { M: { status: 'running', stage: 'knowledge', mission: { id: 'M', name: 'Audit' }, log: [] } } };
  const recorded = []; const docs = Array.from({ length: 4 }, (_, i) => ({ id: 'F' + i, name: 'scan' + i }));
  const memoryDrive = { ...drive, findFilesByExactName: async () => [{ id: 'STATE' }], readText: async () => ({ text: JSON.stringify(state) }),
    downloadBuffer: async () => Buffer.from(JSON.stringify(state)), updateBinary: async (id, b) => Object.assign(state, JSON.parse(b.buffer.toString())) };
  // Existing state reader/writer operate on this Drive; only the business reads and receipt writes are injected.
  const d = { drive: memoryDrive, folder: 'HOME', permissions: async () => ({ granted: true }), missionDocuments: async () => docs, fileForAI, ai: aiRead,
    recordMissionDocuments: async (mission, entries) => { assert.equal(mission.org_id, 'O'); recorded.push(...entries); }, fire: async () => null };
  const first = await auditorStep('O', {}, { mission_id: 'M' }, d);
  assert.equal(first.stage, 'knowledge'); assert.equal(recorded.length, 3);
  const second = await auditorStep('O', {}, { mission_id: 'M' }, d);
  assert.equal(second.stage, 'collect'); assert.equal(recorded.length, 4);
  assert.ok(recorded.every(x => x.audit_read.status === 'EXCERPTS_READ'));
});
