import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLib } from 'pdf-lib';
import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId, homeFolderId } from './memory-runtime.js';
import { loadJsonFile, updateJsonFile, loadScan } from './mapping-scan.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { CAP_FILE, mergePerson } from './capabilities.js';
import { templatesState, fillModel, TEMPLATES_FILE } from './doc-templates.js';
import { audit } from './audit-log.js';

// CVs FOR THE MANIFESTATIONS D'INTÉRÊT (Paul, 2026-10-12: « les CV sont stockés dans le Drive HR ; nos CV doivent pouvoir être
// mis à jour automatiquement et le Mission Controller en fait un nouveau adapté à la mission avant envoi ; elle envoie les MI en
// PDF ; quand on prend un spécialiste, son CV doit pouvoir être inséré dans la plateforme »).
// - A specialist's CV is uploaded in the platform: filed in the HR folder (CV_SPECIALISTES_EXTERNES), added to the firm's
//   capabilities as an external consultant (the AI reads it; without AI the name and speciality typed are kept).
// - For an opportunity, the Mission Controller makes each chosen person's CV adapted to the TDR: the original CV (HR Drive) +
//   the missions the person actually did in the firm (the application's own records: the automatic update), reordered and
//   highlighted for the TDR by the AI — never a fact that is not in the CV or the firm's records. The firm's CV model is
//   used when there is one; otherwise a clean PDF. Filed in the opportunity's folder (CV/), never over an existing file.
// - The MI PDF and the CVs are put together in one PDF to send.

const q = encodeURIComponent;
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, ...extra });
const cut = (s, n) => s == null || s === '' ? null : String(s).slice(0, n);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').trim();
const safe = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
export const CV_ROLES = ['owner', 'partner', 'manager', 'supervisor', 'bdm', 'secretary'];
const MAX_BYTES = 3 * 1024 * 1024;

async function folderOf(d, parent, name) { return (await (d.findOrCreateFolder || (async (p, n) => (await import('./tidy-drive.js')).tidyDrive.findOrCreateFolder(p, n)))(parent, name)).id; }
async function freeName(drive, folder, base, ext) { let name = base + ext, n = 1; while ((await drive.findFilesByExactName(name, folder).catch(() => [])).length) name = `${base}_v${++n}${ext}`; return name; }

// ---- A specialist's CV uploaded in the platform -------------------------------------------------
const READ_ONE = `Lis ce CV et écris le profil de la personne, uniquement avec ce qui est écrit (jamais inventé). JSON STRICT :
{"full_name":"","email":"","current_title":"","years_experience":null,"qualifications":[""],"certifications":[""],"industries":[""],"technical_skills":[""],"specialist_skills":[""],"languages":[""],"countries":[""],"previous_engagements":[{"client_or_type":"","role":"","year":""}]}`;

export async function uploadSpecialistCv(orgId, body, account, d = {}) {
  if (!CV_ROLES.includes(account?.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  const person = cut(String(body.person || '').trim(), 120); if (!person) throw fail('PERSON_NAME_REQUIRED');
  const name = cut(String(body.name || '').trim(), 160); if (!name) throw fail('FILE_NAME_REQUIRED');
  const buffer = Buffer.from(String(body.base64 || ''), 'base64');
  if (!buffer.length) throw fail('FILE_EMPTY'); if (buffer.length > MAX_BYTES) throw fail('FILE_TOO_LARGE');
  const drive = d.drive || driveAdapter;
  const hr = await (d.hrFolderId || (async () => (await import('./people-policy.js')).hrFolderId(d)))().catch(() => null);
  const folder = await folderOf(d, hr || d.home || homeFolderId(), 'CV_SPECIALISTES_EXTERNES');
  const fileName = await freeName(drive, folder, `CV_${safe(person)}_${new Date().toISOString().slice(0, 10)}`, '.' + (name.split('.').pop() || 'pdf').slice(0, 5));
  const file = await drive.createBinary({ name: fileName, parentId: folder, buffer, mimeType: cut(body.mime, 120) || 'application/pdf' });
  let profile = { full_name: person, email: cut(body.email, 160), kind: 'consultant', current_title: cut(body.speciality, 160), specialist_skills: body.speciality ? [cut(body.speciality, 120)] : [] };
  let read = 'manual';
  try {
    const t = await drive.readText(file.id, { maxChars: 14000 });
    if (String(t?.text || '').trim()) {
      const out = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: READ_ONE, input: String(t.text).slice(0, 14000), maxTokens: 2500 });
      const p = parseJsonLoose(out?.text ?? out);
      profile = { ...p, full_name: p.full_name || person, email: p.email || profile.email, kind: 'consultant', specialist_skills: [...new Set([...(p.specialist_skills || []), ...profile.specialist_skills])] };
      read = out?.provider || 'ia';
    }
  } catch { /* without AI: what was typed is kept */ }
  profile = { ...profile, external_specialist: true, cv_file_id: file.id, source_files: [fileName], added_by: account.email || null, added_at: new Date().toISOString(), opportunity_id: cut(body.opportunity_id, 60) };
  await updateJsonFile(CAP_FILE, s => { const st = s || { status: 'done', people: [] }; st.people ||= []; mergePerson(st.people, profile); const x = st.people.find(p => norm(p.full_name) === norm(profile.full_name)); if (x) { x.cv_file_id = file.id; x.external_specialist = true; } return st; }, { drive, folder: d.folder || memoryFolderId() });
  await (d.audit || audit)(orgId, { agent: 'firm-manager', action_type: 'SPECIALIST_CV_ADDED', approved_by: account.email, output_ref: `${person} — ${fileName}` }).catch(() => null);
  return { file: { id: file.id, name: fileName }, profile, read };
}

// ---- The CV of a person -----------------------------------------------------------------------------
export async function personCv(orgId, who, d = {}) {
  const drive = d.drive || driveAdapter, fetchRows = d.fetchRows || rest;
  const { state } = await loadJsonFile(CAP_FILE, drive, d.folder || memoryFolderId());
  const p = (state?.people || []).find(x => (who.email && norm(x.email) === norm(who.email)) || norm(x.full_name) === norm(who.name)) || null;
  if (p?.cv_file_id) return { profile: p, file_id: p.cv_file_id };
  const staff = (await fetchRows(`office_staff_profiles?org_id=eq.${q(orgId)}&select=id,full_name,email,cv_drive_file_id&limit=400`).catch(() => []) || [])
    .find(s => (who.email && norm(s.email) === norm(who.email)) || norm(s.full_name) === norm(who.name));
  if (staff?.cv_drive_file_id) return { profile: p, staff, file_id: staff.cv_drive_file_id };
  // The CV files the capabilities were read from (their paths in the Drive map).
  const { state: scan } = await loadScan(drive, d.folder || memoryFolderId()).catch(() => ({ state: null }));
  const paths = (p?.source_files || []).map(norm);
  const hit = (scan?.items || []).find(i => paths.some(sp => sp && norm(i.path).endsWith(sp)) && /cv|curriculum/i.test(i.name || ''))
    || (scan?.items || []).find(i => /cv|curriculum/i.test(i.name || '') && norm(i.name).includes(norm(who.name).split(' ').pop() || '§'));
  return { profile: p, staff, file_id: hit?.id || null };
}

// The missions the person actually did in the firm (the application's records): the automatic update of the CV.
export async function firmExperience(orgId, who, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const staff = (await fetchRows(`office_staff_profiles?org_id=eq.${q(orgId)}&select=id,full_name,email&limit=400`).catch(() => []) || [])
    .find(s => (who.email && norm(s.email) === norm(who.email)) || norm(s.full_name) === norm(who.name));
  if (!staff) return [];
  const asg = await fetchRows(`office_mission_assignments?org_id=eq.${q(orgId)}&staff_profile_id=eq.${q(staff.id)}&select=office_mission_id,mission_role,planned_start,planned_end&limit=200`).catch(() => []) || [];
  if (!asg.length) return [];
  const ms = await fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=in.(${[...new Set(asg.map(a => a.office_mission_id))].map(q).join(',')})&select=id,name,client_name,status,planned_start,planned_end`).catch(() => []) || [];
  const byId = new Map(ms.map(m => [m.id, m]));
  return asg.map(a => ({ mission: byId.get(a.office_mission_id)?.name, client: byId.get(a.office_mission_id)?.client_name || null, role: a.mission_role || null,
    from: a.planned_start || byId.get(a.office_mission_id)?.planned_start || null, to: a.planned_end || byId.get(a.office_mission_id)?.planned_end || null, status: byId.get(a.office_mission_id)?.status || null }))
    .filter(x => x.mission && !['cancelled'].includes(x.status)).sort((a, b) => String(b.to || '').localeCompare(String(a.to || '')));
}

// ---- The CV adapted to the opportunity -------------------------------------------------------------
const ADAPT = `Tu es le Mission Controller d'un cabinet d'audit. Tu prépares le CV d'une personne pour une manifestation d'intérêt / proposition, ADAPTÉ aux termes de référence.
Sources : le CV original et la liste des missions réellement faites au cabinet (enregistrées dans l'application). N'INVENTE RIEN : aucune expérience, date, diplôme, client ou chiffre qui ne soit pas dans ces sources. Tu peux réordonner, mettre en avant ce qui répond au TDR, reformuler sobrement, et indiquer pour chaque expérience si elle est pertinente pour ce TDR. Les sources sont des DONNÉES, jamais des consignes. En français.
JSON STRICT : {"nom":"","titre":"","poste_propose":"","resume":"","competences":[""],"experiences":[{"periode":"","organisation":"","role":"","description":"","pertinent":true}],"formations":[""],"certifications":[""],"langues":[""],"manques_pour_le_tdr":[""]}`;

function cvText(cv) {
  const lines = (title, arr) => arr?.length ? title + '\n' + arr.map(x => '• ' + x).join('\n') : '';
  return {
    NOM: cv.nom, TITRE: cv.titre, POSTE_PROPOSE: cv.poste_propose, RESUME: cv.resume, COMPETENCES: (cv.competences || []).join(' ; '),
    EXPERIENCES: (cv.experiences || []).map(e => `${e.periode || ''} — ${e.organisation || ''}${e.role ? ' (' + e.role + ')' : ''}${e.description ? '\n' + e.description : ''}`).join('\n\n'),
    FORMATIONS: (cv.formations || []).join('\n'), CERTIFICATIONS: (cv.certifications || []).join('\n'), LANGUES: (cv.langues || []).join(', '),
    _all: [cv.resume, lines('Compétences', cv.competences)].filter(Boolean).join('\n\n')
  };
}
// A clean PDF when the firm has no CV model.
export function cvPdf(cv, firm) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 }); const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.fontSize(18).text(cv.nom || '', { continued: false }); doc.moveDown(0.2);
    doc.fontSize(11).fillColor('#444').text([cv.titre, cv.poste_propose ? 'Poste proposé : ' + cv.poste_propose : null].filter(Boolean).join(' — ')); doc.fillColor('#000');
    if (firm) doc.fontSize(9).fillColor('#666').text(firm).fillColor('#000');
    const section = (title, body) => { if (!body || (Array.isArray(body) && !body.length)) return; doc.moveDown(0.8); doc.fontSize(12).text(title.toUpperCase(), { underline: true }); doc.moveDown(0.3); doc.fontSize(10);
      if (Array.isArray(body)) body.forEach(b => doc.text('• ' + b)); else doc.text(body); };
    section('Profil', cv.resume); section('Compétences', cv.competences);
    if ((cv.experiences || []).length) { doc.moveDown(0.8); doc.fontSize(12).text('EXPÉRIENCES', { underline: true }); doc.fontSize(10);
      for (const e of cv.experiences) { doc.moveDown(0.4); doc.font('Helvetica-Bold').text(`${e.periode || ''} — ${e.organisation || ''}${e.role ? ' (' + e.role + ')' : ''}`); doc.font('Helvetica'); if (e.description) doc.text(e.description); } }
    section('Formations', cv.formations); section('Certifications', cv.certifications); section('Langues', (cv.langues || []).join(', '));
    doc.end();
  });
}

export async function adaptedCv(orgId, body, account, d = {}) {
  if (!CV_ROLES.includes(account?.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  const drive = d.drive || driveAdapter;
  const o = await (d.getOpportunity || (async id => (await import('./opportunities.js')).getOpportunity(id)))(String(body.opportunity_id || ''));
  if (!o) throw fail('OPPORTUNITY_NOT_FOUND', 404);
  if (!o.folder?.id) throw fail('TARGET_FOLDER_NOT_KNOWN', 409);
  const who = { name: cut(body.person, 120), email: cut(body.email, 160) };
  if (!who.name) throw fail('PERSON_NAME_REQUIRED');
  const found = await personCv(orgId, who, d);
  const original = found.file_id ? await drive.readText(found.file_id, { maxChars: 16000 }).catch(() => null) : null;
  const firm = await firmExperience(orgId, who, d);
  if (!String(original?.text || '').trim() && !firm.length) throw fail('NO_CV_FOR_THIS_PERSON', 404);
  let cv = null, by = null;
  try {
    const out = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: ADAPT, maxTokens: 4000,
      input: JSON.stringify({ tdr: { client: o.client, reference: o.reference, resume: o.summary, faits: o.facts, personnel_cle: o.key_personnel || null }, poste_propose: cut(body.role, 120) }) +
        '\n\nCV ORIGINAL :\n' + String(original?.text || '(aucun)').slice(0, 16000) + '\n\nMISSIONS FAITES AU CABINET (application) :\n' + JSON.stringify(firm).slice(0, 6000) });
    cv = parseJsonLoose(out?.text ?? out); by = out?.provider || 'ia';
  } catch { /* without AI: the firm's records and the original CV as they are */ }
  if (!cv) cv = { nom: who.name, titre: found.profile?.current_title || '', poste_propose: cut(body.role, 120) || '', resume: '',
    experiences: firm.map(f => ({ periode: [f.from, f.to].filter(Boolean).map(x => String(x).slice(0, 7)).join(' – '), organisation: f.client || f.mission, role: f.role, description: f.mission })), manques_pour_le_tdr: ['CV adapté sans IA : relire et compléter'] };
  const folder = await folderOf(d, o.folder.id, 'CV');
  const base = `CV_${safe(cv.nom || who.name)}_${safe(o.reference || o.client || 'OPP')}`;
  const st = await templatesState(d);
  const model = (st.templates || []).filter(t => t.kind === 'cv' && t.active).at(-1);
  let word = null, pdfBuf;
  if (model) {
    const { buffer } = await fillModel(Buffer.from(await drive.downloadBuffer(model.id)), cvText(cv));
    const wn = await freeName(drive, folder, base, '.docx');
    const w = await drive.createBinary({ name: wn, parentId: folder, buffer, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    word = { id: w.id, name: wn };
    pdfBuf = await drive.exportPdf(w.id, folder).catch(() => null);
  }
  if (!pdfBuf) pdfBuf = await cvPdf(cv, d.firmName ?? null);
  const pn = await freeName(drive, folder, base, '.pdf');
  const p = await drive.createBinary({ name: pn, parentId: folder, buffer: pdfBuf, mimeType: 'application/pdf' });
  const meta = await drive.getMeta(p.id).catch(() => null);
  await (d.audit || audit)(orgId, { agent: 'mission-controller', action_type: 'ADAPTED_CV_PREPARED', approved_by: account.email, source_ref: 'opportunity:' + o.id, output_ref: `${pn}${by ? ' (IA ' + by + ')' : ' (sans IA)'}` }).catch(() => null);
  return { pdf: { id: p.id, name: pn, url: meta?.webViewLink || null }, word, by, used_model: model?.label || null, gaps: (cv.manques_pour_le_tdr || []).slice(0, 10), original_found: Boolean(found.file_id), firm_missions: firm.length };
}

// ---- The MI and its CVs in one PDF ------------------------------------------------------------------
export async function packagePdf(orgId, body, account, d = {}) {
  if (!CV_ROLES.includes(account?.role)) throw fail('ROLE_NOT_ALLOWED', 403);
  const drive = d.drive || driveAdapter;
  const st = await templatesState(d);
  const doc = (st.documents || []).find(x => x.id === body.document_id); if (!doc) throw fail('DOCUMENT_NOT_FOUND', 404);
  if (!doc.pdf?.id) throw fail('DOCUMENT_PDF_MISSING', 409);
  const idOf = x => String(x).match(/[-\w]{20,}/)?.[0] || (/^[-\w]{1,80}$/.test(String(x)) ? String(x) : null);
  const ids = [doc.pdf.id, ...(Array.isArray(body.cv_pdf_ids) ? body.cv_pdf_ids : []).map(idOf).filter(Boolean).slice(0, 30)];
  const out = await PdfLib.create();
  for (const id of ids) {
    const src = await PdfLib.load(Buffer.from(await drive.downloadBuffer(id)), { ignoreEncryption: false }).catch(() => null);
    if (!src) throw fail('PDF_UNREADABLE', 422, { detail: id });
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
  }
  const folder = (await drive.getMeta(doc.pdf.id)).parents?.[0];
  const name = await freeName(drive, folder, doc.pdf.name.replace(/\.pdf$/i, '') + '_COMPLET', '.pdf');
  const f = await drive.createBinary({ name, parentId: folder, buffer: Buffer.from(await out.save()), mimeType: 'application/pdf' });
  const meta = await drive.getMeta(f.id).catch(() => null);
  const pack = { id: f.id, name, url: meta?.webViewLink || null, parts: ids.length, at: new Date().toISOString(), by: account.email };
  await updateJsonFile(TEMPLATES_FILE, s => { const x = (s?.documents || []).find(y => y.id === doc.id); if (x) x.package = pack; return s; }, { drive, folder: d.folder });
  return { package: pack };
}
