import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mapWorkingFile, mayWrite, headerFields } from '../lib/workfile-map.js';
import { knownFacts, proposeKnown, fillKnown, workfileAssist, reviewPieces, piecesState } from '../lib/workfile-assist.js';

const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } };
const DARK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };

function workbook() {
  const wb = new ExcelJS.Workbook();
  const syn = wb.addWorksheet('01_SYNTHESE');
  syn.getCell('A1').value = 'Synthèse de la mission';
  syn.getCell('A4').value = 'IDENTIFICATION'; syn.getCell('A4').fill = DARK; syn.getCell('B4').value = 'IDENTIFICATION'; syn.getCell('B4').fill = DARK;
  [['A8', 'Cabinet'], ['A9', 'Mission / Engagement ID'], ['A10', 'Entité auditée'], ['A17', 'Préparé par']].forEach(([a, t]) => { syn.getCell(a).value = t; syn.getCell(a.replace('A', 'B')).fill = YELLOW; });
  const t = wb.addWorksheet('PRJ-01');
  t.getCell('A1').value = 'PRJ-01 — Compréhension convention';
  t.getCell('A7').value = "Conclusion de l'auditeur"; t.getCell('B7').fill = YELLOW;
  t.getCell('A8').value = 'Préparé par / date'; t.getCell('B8').fill = YELLOW;
  t.getCell('D8').value = 'Revu par / date'; t.getCell('E8').fill = YELLOW;
  ['N°', 'Point à vérifier', 'Constat', 'Conforme ?', 'Résultat'].forEach((h, i) => { const c = t.getCell(10, i + 1); c.value = h; c.fill = DARK; c.font = { bold: true }; });
  for (let r = 11; r <= 15; r++) { t.getCell(r, 1).value = r - 10; t.getCell(r, 3).fill = YELLOW; t.getCell(r, 4).fill = YELLOW; t.getCell(r, 5).value = { formula: `IF(D${r}="","EN COURS",IF(D${r}="Oui","PASS","EXCEPTION"))` }; }
  return wb;
}

test('the map finds the identity fields; never « Revu par » nor the auditor’s conclusion', () => {
  const map = mapWorkingFile(workbook());
  const prj = map.sheets.find(s => s.name === 'PRJ-01');
  assert.deepEqual(prj.fields.map(f => [f.kind, f.address, f.writable]), [['conclusion', 'B7', false], ['preparer', 'B8', true], ['reviewer', 'E8', false]]);
  assert.equal(mayWrite(map, 'PRJ-01', 'B8').ok, true);
  assert.equal(mayWrite(map, 'PRJ-01', 'E8').reason, 'REVIEWER_FIELD');
  assert.equal(mayWrite(map, 'PRJ-01', 'B7').reason, 'JUDGMENT_OF_THE_AUDITOR');
  const syn = map.sheets.find(s => s.name === '01_SYNTHESE');
  assert.deepEqual(syn.fields.map(f => f.kind), ['firm', 'mission', 'entity', 'preparer']);
  assert.ok(syn.fields.some(f => f.kind === 'mission' && f.address === 'B9'));
  assert.ok(syn.fields.some(f => f.kind === 'entity' && f.address === 'B10'));
});

test('a filled field and a header row are not proposed', () => {
  const wb = workbook(); wb.getWorksheet('PRJ-01').getCell('B8').value = 'Awa — 01/10/2026';
  const map = mapWorkingFile(wb);
  const facts = knownFacts({ mission: { name: 'Projet Eau', client_name: 'ONG X' }, preparer: 'paul@x.ci', account: { email: 'paul@x.ci', display_name: 'Paul KOMENAN' }, now: new Date('2026-10-24T10:00:00Z') });
  const props = proposeKnown(map, ['PRJ-01', '01_SYNTHESE'], facts);
  assert.ok(!props.some(p => p.sheet === 'PRJ-01' && p.address === 'B8'));
  assert.ok(!props.some(p => p.address === 'E8' || p.address === 'B7'));
  assert.equal(headerFields(wb.getWorksheet('PRJ-01'), new Set([10])).some(f => f.address.endsWith('10')), false);
});

test('what the application knows is proposed with its source (preparer and date, mission, entity)', () => {
  const map = mapWorkingFile(workbook());
  const facts = knownFacts({ mission: { name: 'Projet Eau', client_name: 'ONG X', period_label: 'Exercice 2025' }, preparer: 'paul@x.ci', account: { email: 'paul@x.ci', display_name: 'Paul KOMENAN' }, firmName: 'Cabinet A', now: new Date('2026-10-24T10:00:00Z') });
  const props = proposeKnown(map, ['PRJ-01', '01_SYNTHESE'], facts);
  const at = (s, a) => props.find(p => p.sheet === s && p.address === a);
  assert.equal(at('PRJ-01', 'B8').value, 'Paul KOMENAN — 24/10/2026');
  assert.match(at('PRJ-01', 'B8').source, /préparateur/);
  assert.equal(at('01_SYNTHESE', 'B9').value, 'Projet Eau');
  assert.equal(at('01_SYNTHESE', 'B10').value, 'ONG X');
  assert.equal(at('01_SYNTHESE', 'B17').value, 'Paul KOMENAN');
  assert.equal(at('01_SYNTHESE', 'B8').value, 'Cabinet A');
});

function fakeDrive(wb) {
  let buf = null, modified = 't1';
  return {
    async init() { buf = Buffer.from(await wb.xlsx.writeBuffer()); return this; },
    async getMeta() { return { size: buf.length, modifiedTime: modified, name: 'NL.xlsx' }; },
    async downloadBuffer() { return buf; },
    async updateBinary(id, { buffer, expectedModifiedTime }) { if (expectedModifiedTime !== modified) throw new Error('MEMORY_CONFLICT'); buf = buffer; modified = 't2'; return { id }; },
    get buffer() { return buf; }
  };
}
const base = drive => ({ drive, fetchRows: async () => [{ id: 'm1', name: 'Projet Eau', client_name: 'ONG X', period_label: 'Exercice 2025' }], firmName: async () => 'Office Manager',
  view: async () => ({ workpaper: { file_id: 'f1' }, preparer: 'paul@x.ci', editable: true, work: { status: 'in_progress' } }), audit: async () => null,
  receivedPieces: async () => ({ files: [{ id: 'p1', name: 'scan001.pdf' }, { id: 'p2', name: 'IMG_22.jpg' }] }),
  missionDocuments: async () => [{ id: 'p1', type: 'Convention de financement', period: '2025', summary: 'Convention UE', role: 'convention' }], listDeposits: async () => [] });
const paul = { email: 'paul@x.ci', display_name: 'Paul KOMENAN', role: 'senior' };

test('« Oui, remplis » writes only the recomputed proposals, read back; never what the browser sends as a value', async () => {
  const drive = await fakeDrive(workbook()).init();
  const d = { ...base(drive), now: new Date('2026-10-24T10:00:00Z') };
  const view = await workfileAssist('o', 'm1', 'PRJ-01', paul, d);
  assert.ok(view.known.length >= 3);
  assert.ok(view.never.some(x => x.label === 'Revu par / date'));
  const r = await fillKnown('o', 'm1', 'PRJ-01', paul, { cells: [{ sheet: 'PRJ-01', address: 'B8', value: 'PIRATE' }, { sheet: 'PRJ-01', address: 'E8' }] }, d);
  assert.deepEqual(r.written.map(w => w.address), ['B8']);
  const back = new ExcelJS.Workbook(); await back.xlsx.load(drive.buffer);
  assert.equal(back.getWorksheet('PRJ-01').getCell('B8').value, 'Paul KOMENAN — 24/10/2026');
  assert.equal(back.getWorksheet('PRJ-01').getCell('E8').value, null);
  const again = await workfileAssist('o', 'm1', 'PRJ-01', paul, d);
  assert.ok(!again.known.some(k => k.sheet === 'PRJ-01' && k.address === 'B8'));
});

test('a reviewer cannot accept the proposals', async () => {
  const drive = await fakeDrive(workbook()).init();
  const d = { ...base(drive), view: async () => ({ workpaper: { file_id: 'f1' }, preparer: 'paul@x.ci', editable: false, work: {} }) };
  await assert.rejects(fillKnown('o', 'm1', 'PRJ-01', { email: 'rev@x.ci', role: 'manager' }, {}, d), /NOT_PREPARER/);
});

test('received pieces: understood ones are renamed from what was read, the others are sent to be read', async () => {
  const drive = await fakeDrive(workbook()).init();
  const st = await piecesState('o', 'm1', base(drive));
  assert.equal(st.to_read, 1);
  assert.equal(st.pieces[0].type, 'Convention de financement');
  let renamedWith = null, readWith = null;
  const d = { ...base(drive), deposit: { renamePieces: async (o, s) => { renamedWith = s; return { done: [{ id: 'p1', from: 'scan001.pdf', to: 'CONVENTION_DE_FINANCEMENT_ONG_X_2025.pdf' }] }; } },
    piecesReceived: async (o, req, body) => { readWith = body; return { analysis: { id: 'dep-1' } }; } };
  const r = await reviewPieces('o', null, 'm1', 'PRJ-01', paul, d);
  assert.deepEqual(renamedWith.understood.map(u => u.id), ['p1']);
  assert.deepEqual(readWith.files, [{ id: 'p2' }]);
  assert.equal(r.renamed.length, 1);
  assert.equal(r.to_read, 1);
});
