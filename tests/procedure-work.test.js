import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildCycleWorkpaper } from '../lib/cycle-workpapers.js';
import * as P from '../lib/procedure-work.js';
import { askProcedure, executeProcedureActions } from '../lib/procedure-workspace.js';

const M = '11111111-1111-1111-1111-111111111111';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const card = { code: 'ACH-03', title: 'Test de détail', objective: 'Dépenses réelles', steps: [{ text: 'Retrouver la facture' }], wp_columns: ['Sample ID / Référence', 'Date', 'Tiers', 'Montant', 'Pièce / source', 'Résultat PASS/EXCEPTION', 'Écart', 'Commentaire'], conclusion_template: 'Travaux exécutés conformément à ACH-03.' };
const LIB = { sops: [{ file_id: 'sopA', modified_time:'m1', procedures: [card, { code: 'ACH-08', title: 'Doublons' }, { code: 'ACH-02', title: 'Walkthrough' }] }] };
const cycle = { cycle_code: 'ACH', cycle_title: 'Achats', status: 'IN_SCOPE', preparer: 'ali@c.ci', sop_file_id: 'sopA', modified_time:'m1', procedures: [
  { code: 'ACH-03', title: 'Test de détail', type: 'CORE', active: true, sampling_mode: 'programme_sample', sample_size: 3 },
  { code: 'ACH-08', title: 'Doublons', type: 'RISK_DEPENDENT', active: true, sampling_mode: 'risk_targeted' },
  { code: 'ACH-02', title: 'Walkthrough', type: 'CORE', active: true, sampling_mode: 'walkthrough', preparer: 'sam@c.ci' }] };
const programme = { id: 'prog1', office_mission_id: M, version: 1, status: 'validated', cycles: [cycle], reviews: { manager: true }, materiality: { overall: 10000000, performance: 5000000, currency: 'FCFA' }, workpapers: [{ cycle_code: 'ACH', file_id: 'WP1' }] };
const ali = { role: 'auditor', email: 'ali@c.ci' };

test('conversation continues real evidence preparation into Excel, adds the auditor note, and leaves test decisions human', async () => {
  let pass = 0;
  const { t, d } = world({ ai: async (_, options) => {
    if (options.input.includes('PIÈCES :')) return { text: JSON.stringify({ attributes: [{ name: 'Montant' }], reason: 'Le montant de la pièce correspond.', missing: ['Visa du responsable'], proposed_result: 'PASS' }) };
    pass++;
    return { text: pass === 1 ? JSON.stringify({ answer: 'Je prépare les observations.', assessment: 'Le visa reste à obtenir.', next: 'Qui peut fournir le visa ?',
      actions: [{ type: 'prepare-observations', sample_id: 'S01' }, { type: 'write-workpaper' }] }) : 'Les observations sont écrites. Le visa reste à obtenir.' };
  } });
  t.files.POPFILEXXXXXXXXXXXXXXXXX = { buf: await populationXlsx(), mt: 'p1' };
  t.files.WP1 = { buf: await buildCycleWorkpaper({ firm: 'C', mission: { id: M, name: 'Projet' }, programme, cycle, procedures: [{ ...card, ...cycle.procedures[0] }] }), mt: 'w1' };
  await P.setPopulation('org', M, 'ACH-03', { file: 'POPFILEXXXXXXXXXXXXXXXXX', columns: { ref: 0, date: 1, party: 2, amount: 4 }, gl_total: 7599500.5 }, ali, d);
  await P.drawSample('org', M, 'ACH-03', {}, ali, d);
  await P.addEvidence('org', M, 'ACH-03', { sample_id: 'S01', name: 'Facture.docx', mime: 'application/msword', base64: Buffer.from('facture').toString('base64') }, ali, d);
  const result = await askProcedure('org', M, 'ACH-03', { message: 'Continue, remplis les observations et écris dans Excel.' }, ali, d);
  assert.deepEqual(result.outcomes.map(o => o.status), ['done', 'done']);
  assert.equal(result.outcomes[1].verified, true);
  assert.equal(result.work.items[0].result, null);
  assert.equal(result.work.conclusion, undefined);
  assert.match(result.work.items[0].comment, /Observation IA à revoir/);
  assert.deepEqual(result.work.items[0].observation_prepared.evidence_ids.length, 1);
  assert.equal(result.brief.received.length, 1);
  assert.deepEqual(result.brief.observed[0].missing, ['Visa du responsable']);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.files.WP1.buf);
  let found = false; wb.getWorksheet('ACH-03').eachRow(r => r.eachCell(c => { if (String(c.value).includes('Observation IA à revoir')) found = true; }));
  assert.ok(found, 'prepared observation was really saved in the workbook');
  const before = result.work.items[0].comment;
  const note = await executeProcedureActions('org', M, 'ACH-03', [{ type: 'add-note', sample_id: 'S01', note: 'Le responsable revient lundi.' }], 'Ajoute : Le responsable revient lundi.', ali, d);
  assert.equal(note[0].status, 'done');
  const current = await P.procedureView('org', M, 'ACH-03', ali, d);
  assert.equal(current.work.items[0].comment, before + '\nLe responsable revient lundi.');
  assert.equal(current.work.items[0].result, null);
  const redo = await P.prepareObservation('org', M, 'ACH-03', { sample_id: 'S01' }, ali, d);
  assert.equal(redo.changed, false, 'existing observations are preserved');
  const forged = await executeProcedureActions('org', M, 'ACH-03', [{ type: 'add-note', sample_id: 'S01', note: 'Invented approval' }, { type: 'write-workpaper' }], 'Ajoute ma précision', ali, d);
  assert.equal(forged.length, 1); assert.equal(forged[0].reason, 'NOTE_MUST_COME_FROM_AUDITOR');
  await assert.rejects(P.prepareObservation('org', M, 'ACH-03', { sample_id: 'S01', user_note: 'x' }, { role: 'auditor', email: 'outsider@example.test' }, d), /NOT_YOUR_PROCEDURE/);
  t.work[0].status = 'submitted';
  const locked = await executeProcedureActions('org', M, 'ACH-03', [{ type: 'write-workpaper' }], 'Continue', ali, d);
  assert.equal(locked[0].status, 'blocked');
});

async function populationXlsx() {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('GL');
  ws.addRow(['Extraction du grand livre']);
  ws.addRow(['N° pièce', 'Date', 'Fournisseur', 'Libellé', 'Montant']);
  const lines = [['F1', '2025-03-03', 'Alpha', 'achat', 150000], ['F2', '2025-03-08', 'Beta', 'achat', 1000000], ['F3', '2025-04-02', 'Alpha', 'achat', 150000],
    ['F4', '2025-05-10', 'Gamma', 'achat', 6200000], ['', '2025-06-01', 'Delta', 'divers', '12 500,50'], ['F6', '2025-06-03', 'Beta', 'achat', 87000]];
  for (const l of lines) ws.addRow(l);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
function world(extra = {}) {
  const t = { work: [], files: {} };
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_work_programmes')) return [programme];
    if (path.startsWith('office_missions')) return [{ id: M, name: 'Projet', status: 'fieldwork', drive_folder_id: 'MF' }];
    if (path.startsWith('office_procedure_work')) {
      if (o.method === 'POST') { const r = { id: 'w' + (t.work.length + 1), items: [], population: {}, sample: {}, wp_sync: {}, ...JSON.parse(o.body)[0] }; t.work.push(r); return [r]; }
      if (o.method === 'PATCH') { const r = t.work.find(x => x.id === /id=eq\.([^&]+)/.exec(path)[1]); Object.assign(r, JSON.parse(o.body)); return [r]; }
      const code = /procedure_code=eq\.([^&]+)/.exec(path)?.[1];
      return t.work.filter(x => !code || x.procedure_code === decodeURIComponent(code));
    }
    return [];
  };
  const drive = {
    getMeta: async id => ({ id, name: id === 'POPFILEXXXXXXXXXXXXXXXXX' ? 'GL achats.xlsx' : id, mimeType: t.files[id]?.mime || XLSX, modifiedTime: t.files[id]?.mt || 'm1', parents: ['SUB'], size: 10 }),
    downloadBuffer: async id => t.files[id].buf,
    updateBinary: async (id, { buffer, expectedModifiedTime }) => { if (expectedModifiedTime !== t.files[id].mt) throw new Error('MEMORY_CONFLICT'); t.files[id] = { ...t.files[id], buf: buffer, mt: 'm' + Date.now() }; },
    createBinary: async ({ name, parentId, buffer }) => { const id = 'E' + Object.keys(t.files).length; t.files[id] = { buf: buffer, name, parent: parentId, mt: 'e' }; return { id }; },
    findFilesByExactName: async () => [],
    listChildren: async id => id === 'MF' ? [{ id: 'WPF', name: 'WORKING_PAPERS', mimeType: 'application/vnd.google-apps.folder' }] : [],
    readText: async () => ({ text: 'Facture F2 Beta 1 000 000 FCFA du 08/03/2025, visa DAF' })
  };
  const d = { fetchRows, drive, sources:async()=>[], methodology: async () => LIB, audit: async () => ({}), findOrCreateFolder: async (p, n) => ({ id: p + '/' + n }), permissions: async () => ({ granted: true }), ...extra };
  return { t, d };
}

test('population read by code: header found, amounts parsed, total reconciled to the GL — an unexplained difference blocks the sample', async () => {
  const { t, d } = world(); t.files.POPFILEXXXXXXXXXXXXXXXXX = { buf: await populationXlsx(), mt: 'p1' };
  const pre = await P.populationPreview('org', M, 'ACH-03', { file: 'https://drive.google.com/file/d/POPFILEXXXXXXXXXXXXXXXXX/view' }, ali, d);
  assert.equal(pre.header_row, 1); assert.deepEqual(pre.guess, { ref: 0, date: 1, party: 2, amount: 4 });
  const bad = await P.setPopulation('org', M, 'ACH-03', { file: 'POPFILEXXXXXXXXXXXXXXXXX', columns: pre.guess, gl_total: '7 000 000' }, ali, d);
  assert.equal(bad.work.population.rows, 6); assert.equal(bad.work.population.total, 7599500.5); assert.equal(bad.work.population.status, 'DIFFERENCE');
  await assert.rejects(P.drawSample('org', M, 'ACH-03', {}, ali, d), /EXPLAIN_POPULATION_DIFFERENCE_FIRST/);
  const ok = await P.setPopulation('org', M, 'ACH-03', { file: 'POPFILEXXXXXXXXXXXXXXXXX', columns: pre.guess, gl_total: '7 599 500,50' }, ali, d);
  assert.equal(ok.work.population.status, 'RECONCILED');
  await assert.rejects(P.setPopulation('org', M, 'ACH-03', { file: 'POPFILEXXXXXXXXXXXXXXXXX', columns: pre.guess }, { role: 'auditor', email: 'other@c.ci' }, d), /NOT_YOUR_PROCEDURE/);
});

test('sample by code: random with a kept seed (same seed = same items), risk criteria proposed then chosen, walkthrough = the row chosen', async () => {
  assert.deepEqual(P.seededPick(100, 5, 42), P.seededPick(100, 5, 42));
  assert.equal(new Set(P.seededPick(10, 10, 7)).size, 10);
  const { t, d } = world(); t.files.POPFILEXXXXXXXXXXXXXXXXX = { buf: await populationXlsx(), mt: 'p1' };
  const cols = { ref: 0, date: 1, party: 2, amount: 4 };
  await P.setPopulation('org', M, 'ACH-03', { file: 'POPFILEXXXXXXXXXXXXXXXXX', columns: cols, gl_total: 7599500.5 }, ali, d);
  const s = await P.drawSample('org', M, 'ACH-03', {}, ali, d);
  assert.equal(s.work.items.length, 3); assert.ok(s.work.sample.seed);
  const rows = (await P.readTable('POPFILEXXXXXXXXXXXXXXXXX', d.drive));
  assert.deepEqual(s.work.items.map(i => i.row), P.seededPick(6, 3, s.work.sample.seed).map(i => i + 3), 'the seed redraws the same lines');
  assert.equal(rows.header_row, 1);
  await P.setPopulation('org', M, 'ACH-08', { file: 'POPFILEXXXXXXXXXXXXXXXXX', columns: cols, gl_total: 7599500.5 }, ali, d);
  const cand = await P.drawSample('org', M, 'ACH-08', {}, ali, d);
  const reasons = Object.fromEntries(cand.candidates.map(c => [c.ref || c.party, c.reasons]));
  assert.deepEqual(reasons.F1, ['même tiers et même montant ailleurs']);
  assert.ok(reasons.F2.includes('montant rond')); assert.ok(reasons.F4.includes('au-dessus du seuil de planification'));
  assert.ok(reasons.Delta.includes('sans référence'));
  const chosen = await P.drawSample('org', M, 'ACH-08', { rows: [3, 5] }, ali, d);
  assert.deepEqual(chosen.work.items.map(i => [i.sample_id, i.ref, i.reasons]), [['S01', 'F1', ['même tiers et même montant ailleurs']], ['S02', 'F3', ['même tiers et même montant ailleurs']]]);
  await assert.rejects(P.drawSample('org', M, 'ACH-02', {}, { role: 'auditor', email: 'sam@c.ci' }, d), /POPULATION_FIRST/);
});

test('evidence filed under the mission with the sample in its name; the Enhanced Auditor proposes, the auditor decides; PASS needs evidence', async () => {
  const { t, d } = world({ ai: async (order, args) => { assert.ok(args.files.length === 0 && /Beta/.test(args.input)); return { provider: 'anthropic', text: '{"attributes":[{"name":"montant","on_line":"1000000","on_evidence":"1 000 000","match":"oui"}],"proposed_result":"PASS","reason":"facture conforme"}' }; } });
  t.files.POPFILEXXXXXXXXXXXXXXXXX = { buf: await populationXlsx(), mt: 'p1' };
  await P.setPopulation('org', M, 'ACH-08', { file: 'POPFILEXXXXXXXXXXXXXXXXX', columns: { ref: 0, date: 1, party: 2, amount: 4 }, gl_total: 7599500.5 }, ali, d);
  await P.drawSample('org', M, 'ACH-08', { rows: [4] }, ali, d);
  await assert.rejects(P.recordItem('org', M, 'ACH-08', { sample_id: 'S01', result: 'PASS' }, ali, d), /PASS_NEEDS_EVIDENCE/);
  await assert.rejects(P.aiProposal('org', M, 'ACH-08', { sample_id: 'S01' }, ali, d), /EVIDENCE_FIRST/);
  const ev = await P.addEvidence('org', M, 'ACH-08', { sample_id: 'S01', name: 'facture F2.docx', mime: 'application/msword', base64: Buffer.from('x').toString('base64') }, ali, d);
  assert.equal(ev.filed.name, 'ACH-08_S01_facture F2.docx');
  assert.equal(Object.values(t.files).find(f => f.name === 'ACH-08_S01_facture F2.docx').parent, 'WPF/PIECES_ACH/ACH-08');
  const pr = await P.aiProposal('org', M, 'ACH-08', { sample_id: 'S01' }, ali, d);
  assert.equal(pr.proposal.proposed_result, 'PASS'); assert.equal(pr.work.items[0].result, null, 'the AI never decides');
  const off = world({ permissions: async () => ({ granted: false }) });
  off.t.work = t.work; off.t.files = t.files;
  assert.equal((await P.aiProposal('org', M, 'ACH-08', { sample_id: 'S01' }, ali, off.d)).ai, 'not_allowed');
  const down = world({ ai: async () => { throw new Error('NO_AI_PROVIDER_CONFIGURED'); } }); down.t.work = t.work; down.t.files = t.files;
  assert.equal((await P.aiProposal('org', M, 'ACH-08', { sample_id: 'S01' }, ali, down.d)).ai, 'unavailable', 'without AI the screen says so; manual entry');
  await assert.rejects(P.recordItem('org', M, 'ACH-08', { sample_id: 'S01', result: 'EXCEPTION' }, ali, d), /EXCEPTION_NEEDS_EXPLANATION/);
  const r = await P.recordItem('org', M, 'ACH-08', { sample_id: 'S01', result: 'PASS', attribute: 'montant, date, visa' }, ali, d);
  assert.equal(r.work.items[0].followed_ai, true);
});

test('submitted only when complete; the results and the conclusion are written in the cycle working paper, never over someone’s cell', async () => {
  const { t, d } = world();
  t.files.POPFILEXXXXXXXXXXXXXXXXX = { buf: await populationXlsx(), mt: 'p1' };
  t.files.WP1 = { buf: await buildCycleWorkpaper({ firm: 'C', mission: { id: M, name: 'Projet' }, programme, cycle, procedures: [{ ...card, ...cycle.procedures[0] }] }), mt: 'w1' };
  await P.setPopulation('org', M, 'ACH-03', { file: 'POPFILEXXXXXXXXXXXXXXXXX', columns: { ref: 0, date: 1, party: 2, amount: 4 }, gl_total: 7599500.5 }, ali, d);
  const s = await P.drawSample('org', M, 'ACH-03', {}, ali, d);
  await assert.rejects(P.submitProcedure('org', M, 'ACH-03', ali, d), e => e.gaps.map(g => g.gap).join() === 'ITEMS_WITHOUT_RESULT,CONCLUSION_REQUIRED');
  for (const it of s.work.items) await P.recordItem('org', M, 'ACH-03', { sample_id: it.sample_id, result: it.sample_id === 'S02' ? 'EXCEPTION' : 'PASS', evidence_ref: 'classeur p.' + it.row, comment: it.sample_id === 'S02' ? 'facture absente' : null, difference: it.sample_id === 'S02' ? it.amount : null }, ali, d);
  const view = await P.procedureView('org', M, 'ACH-03', ali, d);
  assert.match(view.proposed_conclusion, /Population : 6 éléments .*3 élément\(s\) testé\(s\)\. 1 exception\(s\)/);
  await P.saveConclusion('org', M, 'ACH-03', { conclusion: view.proposed_conclusion }, ali, d);
  // Someone typed in the first result cell in Excel: kept, reported.
  const wb0 = new ExcelJS.Workbook(); await wb0.xlsx.load(t.files.WP1.buf); const ws0 = wb0.getWorksheet('ACH-03');
  let head = null; ws0.eachRow((r, n) => { if (!head && String(r.getCell(1).value) === 'Sample ID / Référence') head = n; });
  ws0.getRow(head + 1).getCell(6).value = 'note de Sam'; t.files.WP1.buf = Buffer.from(await wb0.xlsx.writeBuffer());
  const w = await P.writeWorkpaper('org', M, 'ACH-03', ali, d);
  assert.equal(w.wp_sync.status, 'WRITTEN_WITH_CONFLICTS'); assert.deepEqual(w.wp_sync.conflicts, ['F' + (head + 1)]); assert.ok(w.wp_sync.verified);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.files.WP1.buf); const ws = wb.getWorksheet('ACH-03');
  const row = ws.getRow(head + 2).values.slice(1);
  assert.match(String(row[0]), /^S02( \/ F\d)?$/); assert.equal(row[5], 'EXCEPTION'); assert.equal(ws.getRow(head + 1).getCell(6).value, 'note de Sam');
  let conc = null; ws.eachRow((r, n) => { if (String(r.getCell(1).value) === 'Conclusion') conc = n; });
  assert.match(String(ws.getRow(conc + 1).getCell(1).value), /^Travaux exécutés conformément à ACH-03\. Population : 6/);
  const again = await P.writeWorkpaper('org', M, 'ACH-03', ali, d);
  assert.deepEqual(again.wp_sync.conflicts, ['F' + (head + 1)], 'rewriting its own cells is fine');
  const sub = await P.submitProcedure('org', M, 'ACH-03', ali, d);
  assert.equal(sub.work.status, 'submitted');
  await assert.rejects(P.recordItem('org', M, 'ACH-03', { sample_id: 'S01', result: 'PASS', evidence_ref: 'x' }, ali, d), /ALREADY_SUBMITTED/);
  assert.equal(P.systemic([{ result: 'EXCEPTION', party: 'A' }, { result: 'EXCEPTION', party: 'A' }]).same_party[0], 'a');
  const mine = await P.myProcedures('org', ali, d);
  assert.deepEqual(mine.procedures.map(p => [p.code, p.status]), [['ACH-03', 'submitted'], ['ACH-08', 'to_do']], 'ACH-02 is Sam’s');
});

test('Shadow sees the Enhanced Auditor’s real work: proposals the auditor contradicted, speed, returned procedures, hand-filled cells', async () => {
  const { enhancedAuditorSignals } = await import('../lib/shadow-investigate.js');
  const rows = [{ id: 'w1', procedure_code: 'ACH-03', status: 'returned', updated_at: '2026-10-12T10:00:00Z', population: { status: 'DIFFERENCE', difference: 12, checked_at: '2026-10-12T08:00:00Z' }, wp_sync: { conflicts: ['F9'], at: '2026-10-12T09:00:00Z' },
    items: [{ sample_id: 'S01', result: 'EXCEPTION', comment: 'pas de visa', decided_at: '2026-10-12T09:10:00Z', followed_ai: false, ai: { proposed_result: 'PASS', reason: 'montant conforme' }, evidence: [{ at: '2026-10-12T09:00:00Z' }] }] }];
  const s = enhancedAuditorSignals(rows);
  assert.deepEqual(s.map(x => x.outcome).sort(), ['agreement', 'evidence', 'first_time_right', 'method', 'speed']);
  assert.match(s.find(x => x.outcome === 'speed').text, /10 min/);
  assert.match(s.find(x => x.outcome === 'agreement').text, /l’IA proposait PASS .* l’auditeur a retenu EXCEPTION — pas de visa/);
});

test('two people write their own tests in the same Working File at the same instant: the second write is redone, nobody loses work', async () => {
  const { t, d } = world();
  t.files.POPFILEXXXXXXXXXXXXXXXXX = { buf: await populationXlsx(), mt: 'p1' };
  t.files.WP1 = { buf: await buildCycleWorkpaper({ firm: 'C', mission: { id: M, name: 'Projet' }, programme, cycle, procedures: [{ ...card, ...cycle.procedures[0] }] }), mt: 'w1' };
  await P.setPopulation('org', M, 'ACH-03', { file: 'POPFILEXXXXXXXXXXXXXXXXX', columns: { ref: 0, date: 1, party: 2, amount: 4 }, gl_total: 7599500.5 }, ali, d);
  const s = await P.drawSample('org', M, 'ACH-03', {}, ali, d);
  for (const it of s.work.items) await P.recordItem('org', M, 'ACH-03', { sample_id: it.sample_id, result: 'PASS', evidence_ref: 'p.' + it.row }, ali, d);
  // While Ali writes, a colleague saves the same file (another sheet): Ali's first write is refused, then redone.
  const real = d.drive.updateBinary; let clashes = 0;
  d.drive.updateBinary = async (id, args) => {
    if (!clashes++) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.files[id].buf); wb.addWorksheet('COLLEGUE').addRow(['travail du collègue']); t.files[id] = { ...t.files[id], buf: Buffer.from(await wb.xlsx.writeBuffer()), mt: 'colleague' }; }
    return real(id, args);
  };
  const w = await P.writeWorkpaper('org', M, 'ACH-03', ali, { ...d, retryDelayMs: 1, retryJitterMs: 1 });
  assert.equal(clashes, 2, 'one refused write, one redone'); assert.ok(w.wp_sync.verified);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(t.files.WP1.buf);
  assert.equal(wb.getWorksheet('COLLEGUE').getRow(1).getCell(1).value, 'travail du collègue', 'the colleague’s work is kept');
  assert.ok(wb.getWorksheet('ACH-03'), 'and Ali’s test is written');
});


test('saving walkthrough answers preserves server-side sourced preparations and rejects browser replacements', async () => {
  const {d} = world();
  const v = await P.procedureView('org', M, 'ACH-03', ali, d);
  await P.patch('org', v.work, {walkthrough:[{kind:'sop-document-work',id:'server-plan',status:'applied'}]}, ali, d.fetchRows);
  const r = await P.saveConclusion('org', M, 'ACH-03', {conclusion:'À revoir',walkthrough:[{q:'Question',a:'Réponse'},{kind:'sop-document-work',id:'forged'}]}, ali, d);
  assert.deepEqual(r.work.walkthrough,[{q:'Question',a:'Réponse'},{kind:'sop-document-work',id:'server-plan',status:'applied'}]);
});


test('a stale procedure save cannot overwrite a newer reading or human confirmation',async()=>{
  const row={id:'W',updated_at:'2026-10-20T10:00:00.000Z',status:'to_do',walkthrough:[]};
  let url;
  await assert.rejects(P.patch('O',row,{walkthrough:[]},{email:'human@test'},async(path)=>{url=path;return [];}),/MEMORY_CONFLICT/);
  assert.match(url,/updated_at=eq\./);
  const saved=await P.patch('O',row,{walkthrough:[]},{email:'human@test'},async()=>[{...row,updated_by:'human@test'}]);
  assert.equal(saved.updated_by,'human@test');
});
