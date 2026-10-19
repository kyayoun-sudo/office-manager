import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { extractStructuredOffice } from '../lib/office-structured-reader.js';
import { pickTemplate, scoreTemplate, askTemplatesFolder, templatesFolder, TEMPLATES_REF } from '../lib/workfile-templates.js';
import { prepareCycleWorkpapers } from '../lib/cycle-workpapers.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const cycle = { cycle_code: 'C02_ACH', cycle_title: 'Achats', procedures: [{ code: 'ACH-01', active: true }, { code: 'ACH-03', active: true }, { code: 'ACH-08', active: false }] };

// Three firms' models, three different forms. Names say nothing.
async function book(sheets) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) { const ws = wb.addWorksheet(name); rows.forEach(r => ws.addRow(r)); }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const text = async buf => (await extractStructuredOffice(buf, XLSX, 60000)).text;

test('the model of a cycle is chosen by the tests it CONTAINS, whatever the file, sheet or column names', async () => {
  const purchases = await book({ 'Feuil1': [['Programme'], ['Réf', 'Travaux'], ['ACH-01', 'Rapprochement GL / balance'], ['ACH-03', 'Test de détail des achats']] });
  const cash = await book({ 'CASH-01': [['Test de trésorerie']], 'CASH-02': [['Confirmations']] });
  const other = await book({ 'Lead': [['Sheet for ACH-01 only']] });
  const files = [{ id: 'a', name: 'Classeur1.xlsx' }, { id: 'b', name: 'achats MODELE.xlsx' }, { id: 'c', name: 'zz.xlsx' }];
  const texts = { a: await text(purchases), b: await text(cash), c: await text(other) };
  const r = await pickTemplate(cycle, files, async id => texts[id]);
  assert.equal(r.status, 'FOUND'); assert.equal(r.file.id, 'a', 'the purchases content wins, not the name « achats »');
  assert.deepEqual(r.found, ['ACH-01', 'ACH-03']); assert.equal(r.total, 2, 'an inactive test is not required');
  // A code inside a longer code is not a match (ACH-01 ≠ ACH-010).
  assert.deepEqual(scoreTemplate('ACH-010 ACH-030', cycle).found, []);
});

test('two equally good models, or none: nothing is guessed', async () => {
  const same = 'ACH-01 ACH-03';
  const amb = await pickTemplate(cycle, [{ id: 'x', name: 'x' }, { id: 'y', name: 'y' }], async () => same);
  assert.equal(amb.status, 'AMBIGUOUS'); assert.equal(amb.candidates.length, 2);
  assert.equal((await pickTemplate(cycle, [{ id: 'z', name: 'z' }], async () => 'CASH-01')).status, 'NO_MODEL_FOR_CYCLE');
});

test('the Enhanced Auditor asks once where the models are; the answer or « none » is then used', async () => {
  let st = null; const update = async (n, fn) => { const r = fn(st); if (r) st = r; };
  await askTemplatesFolder('org', { updateJsonFile: update, folder: 'MEM' });
  await askTemplatesFolder('org', { updateJsonFile: update, folder: 'MEM' });
  const reqs = Object.values(st.requests); assert.equal(reqs.length, 1, 'asked once'); assert.match(reqs[0].question, /Working Files modèles/);
  assert.equal(reqs[0].document_type, TEMPLATES_REF.document_type);
  let asked = 0;
  assert.equal((await templatesFolder('org', { documentReferences: async () => [], askLocation: async () => { asked++; } })).status, 'ASKED'); assert.equal(asked, 1);
  assert.equal((await templatesFolder('org', { documentReferences: async () => [{ ...TEMPLATES_REF, file_id: 'F', org_id: 'org' }] })).folder_id, 'F');
  assert.equal((await templatesFolder('org', { documentReferences: async () => [{ ...TEMPLATES_REF, availability: 'CONFIRMED_NOT_AVAILABLE' }] })).status, 'NONE');
});

function world() {
  const files = {}, copies = [], patches = [];
  const programme = { id: 'p1', version: 1, status: 'validated', cycles: [cycle], materiality: { workpapers_folder: 'https://drive.google.com/drive/folders/1WPFOLDERxxxxxxxxxxxxxxxxx' }, reviews: {}, workpapers: [] };
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'PATCH') { patches.push(JSON.parse(o.body)); return []; }
    if (path.startsWith('office_missions')) return [{ id: 'm1', name: 'Projet', client_name: 'Client' }];
    if (path.startsWith('office_work_programmes')) return [programme];
    return [];
  };
  const drive = { findFilesByExactName: async () => [], getMeta: async id => ({ id, parents: ['1WPFOLDERxxxxxxxxxxxxxxxxx'] }),
    copyFile: async (id, name, parent) => { copies.push({ id, name, parent }); return { id: 'COPY' }; },
    createBinary: async () => ({ id: 'GEN' }), readText: async id => files[id] || '' };
  return { files, copies, patches, d: { fetchRows, drive, methodology: async () => ({ sops: [] }), firmName: 'C', audit: async () => null } };
}

test('with the models folder known, the cycle gets a COPY of the firm’s model; while asked, it waits; with none, the base file', async () => {
  const w = world(); w.files.M1 = 'ACH-01 ACH-03 achats';
  const r = await prepareCycleWorkpapers('org', 'm1', { email: 'a@x' }, { ...w.d, templatesFolder: async () => ({ status: 'KNOWN', folder_id: 'MODELS' }), listTemplateFiles: async () => [{ id: 'M1', name: 'Modele.xlsx' }] });
  assert.equal(r.workpapers[0].status, 'CREATED_FROM_MODEL'); assert.equal(w.copies[0].id, 'M1'); assert.equal(r.workpapers[0].model.id, 'M1');
  const w2 = world();
  const waiting = await prepareCycleWorkpapers('org', 'm1', null, { ...w2.d, templatesFolder: async () => ({ status: 'ASKED', question: 'Où ?' }) });
  assert.equal(waiting.workpapers[0].status, 'WAITING_MODELS_FOLDER'); assert.equal(w2.copies.length, 0);
  const w3 = world();
  const none = await prepareCycleWorkpapers('org', 'm1', null, { ...w3.d, templatesFolder: async () => ({ status: 'NONE' }) });
  assert.equal(none.workpapers[0].status, 'CREATED'); assert.equal(none.workpapers[0].model_note, 'NO_FIRM_MODELS');
});
