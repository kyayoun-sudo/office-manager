import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { extractStructuredOffice } from '../lib/office-structured-reader.js';
import { recognizePbcText, findPbcLists, decidePbcList, pbcListsToConfirm, identityOf } from '../lib/pbc-lists.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const memory = () => { const r = { st: {}, load: async () => r.st, update: async fn => { r.st = fn(r.st) || r.st; } }; return r; };

test('the firm model is recognised by its hidden signature, whatever the file and sheet are called (real Excel reader)', async () => {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Feuil1');
  s.addRow(['Ref', 'Intitulé']); s.addRow(['X', 'rien qui ressemble à une liste']);
  const m = wb.addWorksheet('AUDIT_META'); m.state = 'veryHidden';
  m.addRow(['Document_Type', 'PBC_MASTER_CHECKLIST']); m.addRow(['Mission_Code', 'ABC']); m.addRow(['Famille', 'AG']);
  const text = (await extractStructuredOffice(Buffer.from(await wb.xlsx.writeBuffer()), XLSX, 30000)).text;
  const v = recognizePbcText(text);
  assert.equal(v.is_pbc_list, true); assert.equal(v.level, 'identity'); assert.equal(v.confidence, 100);
  assert.equal(v.mission_code, 'ABC'); assert.equal(v.scope, 'mission');
  // The empty template (no mission code yet) is the firm's reference, not a mission's list.
  assert.equal(recognizePbcText('Document_Type\tPBC_MASTER_CHECKLIST\nMission_Code\t[À COMPLÉTER]').scope, 'firm');
  // File keywords alone are also a signature.
  assert.equal(recognizePbcText('x', { keywords: 'OFFICE_MANAGER;DOCUMENT_TYPE=PBC_MASTER_CHECKLIST' }).level, 'identity');
});

test('a Working File has a PBC sheet but its own signature says it is not the list', () => {
  const text = 'PBC\tDocument demandé\tStatut\tReçu\nPBC-CASH-01\tRelevés bancaires\tDemandé\tNon\nPBC-CASH-02\tConfirmations bancaires\tReçu\tOui\nDocument_Type\tWORKING_FILE';
  const v = recognizePbcText(text);
  assert.equal(v.is_pbc_list, false); assert.equal(v.level, 'identity');
  assert.equal(identityOf(text).document_type, 'WORKING_FILE');
});

test('a client list in another format is recognised by its content, with a certainty below 100', () => {
  const tsv = 'Liste des documents à fournir — audit 2025\n\nN°\tPièce\tDate limite\tFourni\tObservations\n1\tRelevés bancaires au 31/12\t15/01\tNon\t\n2\tGrand livre 2025\t15/01\tOui\t\n3\tContrats de prêt\t20/01\tNon\t';
  const v = recognizePbcText(tsv);
  assert.equal(v.is_pbc_list, true); assert.equal(v.level, 'content');
  assert.ok(v.confidence >= 60 && v.confidence < 100, String(v.confidence));
  assert.equal(v.columns.document.label, 'Pièce'); assert.equal(v.columns.due.label, 'Date limite');
  // English CSV, separated by commas.
  const csv = 'Ref,Requested item,Due date,Received,Status\nR1,Bank statements December,15/01,No,Open\nR2,General ledger,15/01,Yes,Closed';
  assert.equal(recognizePbcText(csv).is_pbc_list, true);
  // Word / PDF text with aligned columns.
  const pdf = 'Réf      Document demandé            Échéance     Statut\nP1       Balance générale            15/01        Reçu\nP2       Relevé bancaire SGCI        15/01        Demandé';
  assert.equal(recognizePbcText(pdf).is_pbc_list, true);
});

test('ordinary documents are not lists: a ledger, a letter, an invoice', () => {
  assert.equal(recognizePbcText('Compte\tLibellé\tDébit\tCrédit\n401000\tFournisseurs\t100\t0\n512000\tBanque\t0\t100').is_pbc_list, false);
  assert.equal(recognizePbcText('Madame, Monsieur,\nVeuillez trouver ci-joint les documents demandés.\nCordialement').is_pbc_list, false);
  assert.equal(recognizePbcText('Facture n° 12\tDésignation\tQuantité\tPrix\nAudit\t1\t500').is_pbc_list, false);
});

test('a renamed and moved list is found again by its ID, without being read again', async () => {
  const reg = memory(), reads = [];
  const list = 'Réf\tDocument demandé\tÉchéance\tStatut\nP1\tRelevés bancaires\t15/01\tDemandé\nP2\tBalance générale\t15/01\tReçu';
  const read = async id => { reads.push(id); return id === 'L' ? list : 'Compte\tDébit\n401\t1'; };
  const batch = [{ path: '/Clients/ABC/02_COMPTA/x.pdf' }];
  const items1 = [{ id: 'L', name: 'Copie de Classeur1.xlsx', mimeType: XLSX, path: '/Clients/ABC/Copie de Classeur1.xlsx', modifiedTime: 't1' },
    { id: 'G', name: 'GL.xlsx', mimeType: XLSX, path: '/Clients/ABC/02_COMPTA/GL.xlsx', modifiedTime: 't1' }];
  const a = await findPbcLists(items1, batch, read, { pbcRegistry: reg, pbcSearch: async () => [] });
  assert.deepEqual(a.missions.map(m => m.file_id), ['L']);
  assert.equal(reg.st.pbc_lists.L.status, 'to_confirm');
  assert.ok('G' in reg.st.pbc_not_lists, 'the ledger is remembered as not a list');
  // Renamed and moved into a request sub-folder: same ID, no new reading, still this mission's list.
  reads.length = 0;
  const items2 = [{ ...items1[0], name: 'zz.xlsx', path: '/Clients/ABC/04_DEMANDES/zz.xlsx' }, items1[1]];
  const b = await findPbcLists(items2, batch, read, { pbcRegistry: reg, pbcSearch: async () => [] });
  assert.deepEqual(b.missions.map(m => m.path), ['/Clients/ABC/04_DEMANDES/zz.xlsx']);
  assert.deepEqual(reads, []);
  // Another mission's list is never given for these files.
  const c = await findPbcLists([{ id: 'O', name: 'liste.xlsx', mimeType: XLSX, path: '/Clients/XYZ/liste.xlsx' }], batch, async () => list, { pbcRegistry: memory(), pbcSearch: async () => [] });
  assert.deepEqual(c.missions, []);
});

test('a person confirms once or says no; a « no » is never proposed again', async () => {
  const reg = memory(), events = [];
  reg.st = { pbc_lists: { L: { file_id: 'L', name: 'suivi.xlsx', version: 't1', level: 'content', confidence: 80, status: 'to_confirm' }, M: { file_id: 'M', name: 'm.xlsx', version: 't1', level: 'content', confidence: 70, status: 'to_confirm' } } };
  const d = { pbcRegistry: reg, emit: async (o, e) => { events.push(e.type); return { recorded: true }; }, audit: async () => null };
  assert.equal((await pbcListsToConfirm(d)).length, 2);
  await assert.rejects(decidePbcList('org', { file_id: 'L', decision: 'confirm' }, { email: 's@x', role: 'secretary' }, d), /ROLE_NOT_ALLOWED/);
  const ok = await decidePbcList('org', { file_id: 'L', decision: 'confirm', mission_id: 'm1' }, { email: 'a@x', role: 'auditor' }, d);
  assert.equal(ok.status, 'confirmed'); assert.equal(ok.confirmed_by, 'a@x'); assert.equal(ok.mission_id, 'm1');
  await decidePbcList('org', { file_id: 'M', decision: 'reject' }, { email: 'a@x', role: 'senior' }, d);
  assert.equal(reg.st.pbc_lists.M.status, 'rejected'); assert.equal(reg.st.pbc_not_lists.M, 't1');
  assert.deepEqual(events, ['PBC_LIST_CONFIRMED', 'PBC_LIST_REJECTED']);
  assert.equal((await pbcListsToConfirm(d)).length, 0);
  const found = await findPbcLists([{ id: 'M', name: 'm.xlsx', mimeType: XLSX, path: '/A/m.xlsx', modifiedTime: 't1' }], [{ path: '/A/x.pdf' }], async () => { throw new Error('not read'); }, { pbcRegistry: reg, pbcSearch: async () => [] });
  assert.deepEqual(found.missions, []);
});

test('a list among the files the Orpailleur has just read is judged from that text, without a second reading', async () => {
  const reg = memory();
  const text = 'Réf\tDocument demandé\tÉchéance\tStatut\nP1\tRelevés bancaires\t15/01\tDemandé\nP2\tBalance générale\t15/01\tReçu';
  const f = { id: 'B', name: 'scan 12.xlsx', mimeType: XLSX, path: '/Clients/ABC/scan 12.xlsx' };
  const r = await findPbcLists([f], [f], async () => { throw new Error('second reading'); }, { pbcRegistry: reg, pbcSearch: async () => [], pbcKnownTexts: new Map([['B', text]]) });
  assert.deepEqual(r.missions.map(m => m.file_id), ['B']);
  assert.equal(reg.st.pbc_lists.B.level, 'content');
});
