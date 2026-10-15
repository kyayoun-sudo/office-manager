import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { makeDocx } from './helpers/make-docx.js';
import { modelFields, fillModel, uploadTemplate, prepareValues, createDocument, opportunityValues, TEMPLATES_FILE, registerTemplateReference, templatesState } from '../lib/doc-templates.js';

test('a confirmed existing model is registered once by reference, stays unchanged and requires recheck when changed', async () => {
  const { d, files, created } = world(), bytes = await splitRunsDocx();
  files.set('existing', { name: 'MI.docx', parent: 'ORIGINAL', buf: bytes, mt: 'v1' });
  const dep = { ...d, documentReferences: async () => [{ document_role: 'template', file_id: 'existing', version: 'v1' }], drive: { ...d.drive,
    getMeta: async id => id === 'existing' ? { id, name: 'MI.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', modifiedTime: files.get(id).mt } : d.drive.getMeta(id) } };
  const body = { kind: 'mi', file_id: 'existing' }, account = { role: 'secretary', email: 's@example.org' };
  const a = await registerTemplateReference('org', body, account, dep);
  const b = await registerTemplateReference('org', body, account, dep);
  assert.equal(a.template.id, 'existing'); assert.equal(b.template.version, 1);
  assert.equal((await templatesState(dep)).templates.length, 1);
  assert.deepEqual(files.get('existing').buf, bytes); assert.equal(created.some(f => f.parent === 'HOME/MODELES'), false);
  files.get('existing').mt = 'v2';
  await assert.rejects(prepareValues('org', { template_id: 'existing', opportunity_id: 'o1' }, account, dep), /CONFIRMED_DOCUMENT_CHANGED/);
});

async function splitRunsDocx() {
  // Word often cuts a field in several runs: {{CLI + ENT}}.
  const buf = await makeDocx(['Objet : manifestation d’intérêt', 'Client : {{CLIENT}} — référence [REFERENCE]', 'Date limite : {{ Date limite }}', 'Notre compréhension : {{COMPREHENSION}}']);
  const zip = await JSZip.loadAsync(buf);
  let xml = await zip.file('word/document.xml').async('string');
  xml = xml.replace('<w:t xml:space="preserve">Client : {{CLIENT}} — référence [REFERENCE]</w:t>', '<w:t xml:space="preserve">Client : {{CLI</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>ENT}} — référence [REFERENCE]</w:t>');
  zip.file('word/document.xml', xml);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}
async function text(buf) { const z = await JSZip.loadAsync(buf); return (await z.file('word/document.xml').async('string')).replace(/<w:br\/>/g, '\n').replace(/<[^>]+>/g, ''); }

test('fields of a Word model, even cut across runs; filled; what is not known says « à compléter »', async () => {
  const buf = await splitRunsDocx();
  assert.deepEqual((await modelFields(buf)).map(f => f.key), ['CLIENT', 'REFERENCE', 'DATE_LIMITE', 'COMPREHENSION']);
  const r = await fillModel(buf, { CLIENT: 'ONG Eau & Vie', REFERENCE: 'AMI-2026-14', DATE_LIMITE: '30 octobre 2026' });
  const t = await text(r.buffer);
  assert.match(t, /Client : ONG Eau &amp; Vie — référence AMI-2026-14/);
  assert.match(t, /Notre compréhension : \[À COMPLÉTER : COMPREHENSION\]/);
  assert.deepEqual(r.missing, ['COMPREHENSION']);
  assert.ok(!/\{\{|\}\}/.test(t));
});

function world() {
  const files = new Map(); let n = 0; const created = [];
  const drive = {
    findFilesByExactName: async (name, parent) => [...files.entries()].filter(([, f]) => f.name === name && (!parent || f.parent === parent || name === TEMPLATES_FILE)).map(([id, f]) => ({ id, modifiedTime: f.mt })),
    downloadBuffer: async id => files.get(id).buf,
    createBinary: async ({ name, parentId, buffer }) => { const id = 'F' + (++n); files.set(id, { name, parent: parentId, buf: buffer, mt: 't' + n }); created.push({ id, name, parent: parentId }); return { id }; },
    updateBinary: async (id, { buffer }) => { files.get(id).buf = buffer; files.get(id).mt = 'u' + (++n); },
    getMeta: async id => ({ id, modifiedTime: files.get(id)?.mt, webViewLink: 'https://drive/' + id }),
    exportPdf: async () => Buffer.from('%PDF-1.4')
  };
  return { files, created, d: { permissions: async () => ({ granted: true }), drive, folder: 'MEM', home: 'HOME', findOrCreateFolder: async (p, nm) => ({ id: p + '/' + nm }), audit: async () => ({}), firmName: 'Cabinet Exemple',
    getOpportunity: async id => id === 'o1' ? { id: 'o1', title: 'AMI-2026-14 — ONG Eau & Vie', client: 'ONG Eau & Vie', reference: 'AMI-2026-14', deadline: '2026-10-30', folder: { id: 'OPPF' }, summary: 'Audit des comptes du projet Eau potable 2025', team: { status: 'validated', members: [{ name: 'Awa K.', role: 'Associée' }, { name: 'Ali T.', role: 'Manager' }] } } : null } };
}

test('a model uploaded in the application (kept, never replaced), filled for an opportunity: code first, AI proposes the rest, Word + PDF in its folder', async () => {
  const { d, created } = world();
  const base64 = (await splitRunsDocx()).toString('base64');
  await assert.rejects(uploadTemplate('org', { kind: 'mi', name: 'MI.docx', base64 }, { role: 'auditor' }, d), /ROLE_NOT_ALLOWED/);
  const up = await uploadTemplate('org', { kind: 'mi', name: 'MI.docx', base64, label: 'MI bailleurs' }, { role: 'secretary', email: 's@c.ci' }, d);
  assert.equal(up.template.fields.length, 4); assert.equal(created[0].parent, 'HOME/MODELES');
  const up2 = await uploadTemplate('org', { kind: 'mi', name: 'MI.docx', base64, label: 'MI bailleurs' }, { role: 'secretary', email: 's@c.ci' }, d);
  assert.equal(up2.template.version, 2); assert.notEqual(up2.template.id, up.template.id, 'a new version is a new file');
  let asked = null;
  const prep = await prepareValues('org', { template_id: up2.template.id, opportunity_id: 'o1' }, { role: 'secretary', email: 's@c.ci' },
    { ...d, ai: async (o, a) => { asked = a.input; return { provider: 'anthropic', text: '{"values":{"COMPREHENSION":{"value":"Audit des comptes du projet Eau potable 2025","source":"TDR"}}}' }; } });
  assert.match(asked, /^CHAMPS : COMPREHENSION/, 'only what the application does not know goes to the AI');
  assert.deepEqual(prep.fields.map(f => [f.key, f.origin]), [['CLIENT', 'application'], ['REFERENCE', 'application'], ['DATE_LIMITE', 'application'], ['COMPREHENSION', 'IA — TDR']]);
  const values = Object.fromEntries(prep.fields.map(f => [f.key, f.value]));
  const origins = Object.fromEntries(prep.fields.map(f => [f.key, f.origin]));
  const doc = await createDocument('org', { template_id: up2.template.id, opportunity_id: 'o1', values, origins }, { role: 'secretary', email: 's@c.ci' }, d);
  assert.match(doc.document.word.name, /^MI_ONG_Eau_&_Vie_AMI-2026-14_\d{4}-\d{2}-\d{2}\.docx$/);
  assert.equal(doc.document.pdf.name, doc.document.word.name.replace('.docx', '.pdf'));
  assert.deepEqual(doc.document.missing, []); assert.equal(doc.document.origins.COMPREHENSION, 'IA — TDR');
  assert.ok(created.filter(c => c.parent === 'OPPF').length === 2);
  const again = await createDocument('org', { template_id: up2.template.id, opportunity_id: 'o1', values }, { role: 'secretary', email: 's@c.ci' }, d);
  assert.match(again.document.word.name, /_v2\.docx$/, 'never over an existing file');
  const down = await prepareValues('org', { template_id: up2.template.id, opportunity_id: 'o1' }, { role: 'bdm' }, { ...d, ai: async () => { throw new Error('down'); } });
  assert.equal(down.ai, 'unavailable'); assert.equal(down.fields.find(f => f.key === 'COMPREHENSION').value, '');
});

test('what the application knows about an opportunity', () => {
  const v = opportunityValues({ client: 'X', reference: 'R', title: 'T', deadline: '2026-10-30', team: { status: 'proposed', members: [{ name: 'A' }] } }, 'Cab');
  assert.equal(v.DATE_LIMITE, '30 octobre 2026'); assert.equal(v.EQUIPE, null, 'a team not validated is not written'); assert.equal(v.CABINET, 'Cab');
});
