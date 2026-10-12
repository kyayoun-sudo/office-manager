import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { uploadSpecialistCv, adaptedCv, packagePdf, cvPdf, firmExperience } from '../lib/cv-bank.js';
import { CAP_FILE } from '../lib/capabilities.js';
import { TEMPLATES_FILE } from '../lib/doc-templates.js';

function world(extra = {}) {
  const files = new Map(); let n = 0;
  const put = (name, parent, buf, mt) => { const id = 'F' + (++n); files.set(id, { name, parent, buf, mt: mt || 't' + n }); return id; };
  const drive = {
    findFilesByExactName: async (name, parent) => [...files.entries()].filter(([, f]) => f.name === name && (f.parent === parent || [CAP_FILE, TEMPLATES_FILE].includes(name))).map(([id, f]) => ({ id, modifiedTime: f.mt })),
    downloadBuffer: async id => files.get(id).buf,
    createBinary: async ({ name, parentId, buffer }) => ({ id: put(name, parentId, buffer) }),
    updateBinary: async (id, { buffer }) => { files.get(id).buf = buffer; files.get(id).mt = 'u' + (++n); },
    getMeta: async id => ({ id, modifiedTime: files.get(id)?.mt, parents: [files.get(id)?.parent], webViewLink: 'https://drive/' + id }),
    readText: async id => ({ text: files.get(id)?.text || '' }),
    exportPdf: async () => { throw new Error('PDF_CONVERSION_UNAVAILABLE'); }
  };
  const fetchRows = async path => {
    if (path.startsWith('office_staff_profiles')) return [{ id: 's1', full_name: 'Awa Koné', email: 'awa@c.ci', cv_drive_file_id: 'CVAWA' }];
    if (path.startsWith('office_mission_assignments')) return [{ office_mission_id: 'm1', mission_role: 'Manager', planned_start: '2025-02-01', planned_end: '2025-06-30' }];
    if (path.startsWith('office_missions')) return [{ id: 'm1', name: 'Audit projet Eau 2024', client_name: 'ONG Eau & Vie', status: 'closed' }];
    return [];
  };
  files.set('CVAWA', { name: 'CV Awa.pdf', parent: 'HR', buf: Buffer.from('x'), text: 'Awa Koné, expert-comptable, 10 ans d’audit de projets financés par la Banque mondiale.' });
  return { files, put, d: { drive, fetchRows, folder: 'MEM', home: 'HOME', hrFolderId: async () => 'HR', findOrCreateFolder: async (p, nm) => ({ id: p + '/' + nm }), audit: async () => ({}), firmName: 'Cabinet Exemple',
    getOpportunity: async () => ({ id: 'o1', client: 'ONG X', reference: 'AMI-14', summary: 'Audit financier de projet bailleur', folder: { id: 'OPPF' } }), ...extra } };
}
const sec = { role: 'secretary', email: 's@c.ci' };

test('a specialist’s CV inserted in the platform: filed in the HR folder, added to the firm’s capabilities (without AI: what was typed)', async () => {
  const { files, d } = world({ ai: async () => { throw new Error('down'); } });
  await assert.rejects(uploadSpecialistCv('org', { person: 'Jean', name: 'cv.pdf', base64: 'eA==' }, { role: 'auditor' }, d), /ROLE_NOT_ALLOWED/);
  const r = await uploadSpecialistCv('org', { person: 'Jean Fiscaliste', speciality: 'Fiscalité minière', name: 'cv jean.pdf', base64: Buffer.from('cv').toString('base64') }, sec, d);
  assert.equal(files.get(r.file.id).parent, 'HR/CV_SPECIALISTES_EXTERNES');
  assert.match(r.file.name, /^CV_Jean_Fiscaliste_\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.equal(r.read, 'manual');
  const cap = JSON.parse([...files.values()].find(f => f.name === CAP_FILE).buf);
  const p = cap.people.find(x => x.full_name === 'Jean Fiscaliste');
  assert.deepEqual([p.kind, p.external_specialist, p.cv_file_id, p.specialist_skills], ['consultant', true, r.file.id, ['Fiscalité minière']]);
});

test('the CV adapted to the TDR: original CV + missions done in the firm, nothing invented, PDF in the opportunity’s CV folder', async () => {
  let input = null;
  const { files, d } = world({ ai: async (o, a) => { input = a.input; return { provider: 'anthropic', text: JSON.stringify({ nom: 'Awa Koné', titre: 'Expert-comptable', poste_propose: 'Chef de mission', resume: 'Audit de projets bailleurs', experiences: [{ periode: '2025', organisation: 'ONG Eau & Vie', role: 'Manager', description: 'Audit projet Eau 2024', pertinent: true }], manques_pour_le_tdr: [] }) }; } });
  assert.deepEqual((await firmExperience('org', { name: 'Awa Koné' }, d)).map(x => [x.mission, x.role]), [['Audit projet Eau 2024', 'Manager']]);
  const r = await adaptedCv('org', { opportunity_id: 'o1', person: 'Awa Koné', email: 'awa@c.ci', role: 'Chef de mission' }, sec, d);
  assert.match(input, /Banque mondiale/); assert.match(input, /Audit projet Eau 2024/);
  assert.equal(files.get(r.pdf.id).parent, 'OPPF/CV'); assert.equal(r.pdf.name, 'CV_Awa_Kone_AMI_14.pdf');
  assert.ok((await PDFDocument.load(files.get(r.pdf.id).buf)).getPageCount() >= 1);
  const again = await adaptedCv('org', { opportunity_id: 'o1', person: 'Awa Koné' }, sec, d);
  assert.equal(again.pdf.name, 'CV_Awa_Kone_AMI_14_v2.pdf');
  const none = world({ ai: async () => { throw new Error('down'); } });
  const r2 = await adaptedCv('org', { opportunity_id: 'o1', person: 'Awa Koné' }, sec, none.d);
  assert.deepEqual(r2.gaps, ['CV adapté sans IA : relire et compléter']);
});

test('the MI and its CVs in one PDF', async () => {
  const { files, put, d } = world();
  const mi = put('MI_X.pdf', 'OPPF', await cvPdf({ nom: 'MI' }, null));
  const cv1 = put('CV1.pdf', 'OPPF/CV', await cvPdf({ nom: 'A', resume: 'r' }, null));
  put(TEMPLATES_FILE, 'MEM', Buffer.from(JSON.stringify({ templates: [], documents: [{ id: 'DOC-1', pdf: { id: mi, name: 'MI_X.pdf' } }] })));
  const r = await packagePdf('org', { document_id: 'DOC-1', cv_pdf_ids: [cv1] }, sec, d);
  assert.equal(r.package.name, 'MI_X_COMPLET.pdf'); assert.equal(r.package.parts, 2);
  assert.equal((await PDFDocument.load(files.get(r.package.id).buf)).getPageCount(), 2);
  assert.equal(JSON.parse([...files.values()].find(f => f.name === TEMPLATES_FILE).buf).documents[0].package.id, r.package.id);
});
