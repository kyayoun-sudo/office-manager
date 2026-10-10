// OPPORTUNITIES — Firm Manager, then Mission Controller (Paul, 2026-10-10).
// « Quelqu'un ouvre l'application, il a une page où il met un TDR. Firm Manager le lit, il le range
//   là où on range les TDR, il crée le document, et on enclenche le travail. » Then « quand la lettre
//   de confirmation du client arrive, il envoie le message à Mission Controller », who does the KYC
//   and the independence in the SAME file before the mission starts (decision recorded 2026-10-10).
//
// The one record of Phases 0 and 1 is the firm's own workbook (its acceptance template, copied once
// per opportunity) — see lib/acceptance-workbook.js. This module only keeps references and the
// progress (OFFICE_MANAGER_OPPORTUNITIES.json in the agents' memory): ids, links, stage, the agents'
// PROPOSALS (never written into the workbook until a person confirms them), who answered what.
//
// Firm Manager (stages, one per server call):
//   read     the TDR / AMI is READ (text, scans); the fields of the workbook's first sheet are filled
//            from what the document proves (with the quote), nothing invented;
//   file     the opportunity folder is found or created under the folder the template names
//            (« déposer dans 03_… / [dossier de l'opportunité] »); the TDR is moved there (never
//            overwritten, never deleted); the template is copied there under the name its own
//            « mode d'emploi » gives; the first sheet is written; possible duplicate → stop, review;
//   prepare  Phase 0 is PREPARED: conflict search in the firm's missions, capabilities and load, public
//            reputation (web, with sources) → one proposal per procedure; questions only a person can
//            attest (confidential information shared, commitment taken) are left to the team.
// People answer (each answer is written in the workbook with who and when); only the Associé decides
// « poursuivre / ne pas poursuivre » (separation: never the preparer or the reviewer).
// Confirmation letter received → event OPPORTUNITY_WON → Mission Controller: « faire le KYC et
// l'indépendance » — its own preparation of Phase 1 (web checks with sources), people confirm.
// The workbook filled by hand is read again at the agents' rounds (one truth: the workbook).

import { randomUUID } from 'node:crypto';
import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId, homeFolderId } from './memory-runtime.js';
import { loadScan, loadJsonFile, updateJsonFile } from './mapping-scan.js';
import { firstAvailable, deepResearch, parseJsonLoose } from './ai-plus.js';
import { fileForAI } from './agent-outputs.js';
import { describeWorkbook, copyName, validateWrites, writeToDriveCopy, readDriveCopy } from './acceptance-workbook.js';

export const FILE = 'OFFICE_MANAGER_OPPORTUNITIES.json';
const STRUCTURE_FILE = 'OFFICE_MANAGER_ACCEPTANCE_TEMPLATE.json';
const STAGING = 'A_RANGER';
const STAGING_SUB = 'OPPORTUNITES';
const FOLDER = 'application/vnd.google-apps.folder';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ORDER = ['anthropic', 'openai', 'gemini'];
const MAX_BYTES = 3 * 1024 * 1024;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const q = encodeURIComponent;
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const cut = (s, n) => String(s ?? '').slice(0, n);
const words = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !/^(sa|sarl|ste|societe|the|des|les|pour|and|audit|mission|group|groupe|ltd|inc)$/.test(w));
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Who owns which sheet, which rows are decisions ----

export function sheetOwner(sheet) {
  for (const s of [String(sheet.name || '').toUpperCase(), String(sheet.title || '').toUpperCase().split('—').slice(0, 2).join(' ')]) {
    if (/CONCLUSION|SYNTH[ÈE]SE/.test(s)) return 'decision';
    if (/PHASE[ _]?1(?!\d)/.test(s)) return 'mission-controller';
    if (/PHASE[ _]?0(?!\d)|OPPORTUNIT/.test(s)) return 'firm-manager';
  }
  return 'firm-manager';
}
// Rows that only the Associé (partners) or a Manager may fill; the agents never propose them.
export function rowAuthority(row) {
  // The row's own title (an instruction that merely mentions the Associé is not a decision).
  const title = String(row.label || '').split(' — ')[0];
  if (/^Section pr[ée]par[ée]e par|^Pr[ée]par[ée] par$|^Date de pr[ée]paration$/i.test(title)) return 'team';
  const l = title + ' ' + row.fields.map(f => f.header || '').join(' ');
  if (/D[ÉE]CISION|Nom de l.Associ|Visa|signature de l.Associ|date d.approbation|Commentaire de l.Associ|Date de la d[ée]cision|\(Associ[ée]\)|(sign[ée]e?|revue?) par l.Associ/i.test(l)) return 'partner';
  if (/Recommandation|RISQUE GLOBAL|Cotation propos|Nom du Manager|Justification de la cotation|\(Manager\)/i.test(l)) return 'manager';
  return 'team';
}
const identityField = f => /Pr[ée]par[ée] par|Revu[e]? par|^Date|Statut de l.onglet/i.test(f.header || '');
const identityRow = r => /^(Pr[ée]par[ée] par|Date de pr[ée]paration|Revu par|Date de revue|Statut de l.onglet)$/i.test(r.label || '') || /Section pr[ée]par[ée]e par/i.test(r.label || '');

// ---- Memory (references and progress only) ----

async function loadAll(d) { return (await loadJsonFile(FILE, d.drive || driveAdapter, d.folder || memoryFolderId())).state || { opportunities: {}, signals: [] }; }
async function update(d, mutate) {
  return (await updateJsonFile(FILE, s => mutate(s || { opportunities: {}, signals: [] }), { drive: d.drive || driveAdapter, folder: d.folder || memoryFolderId() })).state;
}
async function saveOpp(o, d) {
  o.updated_at = now();
  await update(d, s => { s.opportunities = s.opportunities || {}; s.opportunities[o.id] = o; return s; });
  return o;
}
export async function getOpportunity(id, d = {}) {
  const o = (await loadAll(d)).opportunities?.[id];
  if (!o) throw fail('OPPORTUNITY_NOT_FOUND', 404);
  return o;
}
export async function listOpportunities(orgId, d = {}) {
  const s = await loadAll(d);
  const list = Object.values(s.opportunities || {}).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(o => ({ id: o.id, title: o.title, client: o.client, reference: o.reference, status: o.status, stage: o.stage, created_at: o.created_at, updated_at: o.updated_at,
      deadline: o.deadline || null, folder: o.folder || null, workbook: o.workbook || null, waiting: waitingFor(o), error: o.error || null }));
  return { opportunities: list, signals: (s.signals || []).filter(x => !x.done).slice(0, 30), template: s.template || null };
}
function waitingFor(o) {
  if (o.status === 'failed') return 'Arrêt : ' + (o.error || '');
  if (o.status === 'duplicate') return 'Doublon possible : à revoir';
  if (o.status === 'running') return 'Le Firm Manager travaille (' + (o.stage || '') + ')';
  if (o.status === 'phase0') return 'Questions de la Phase 0 pour l’équipe, puis décision de l’Associé';
  if (o.status === 'go') return 'Poursuivre : en attente de la réponse du client';
  if (o.status === 'stop') return 'Ne pas poursuivre (décision de l’Associé)';
  if (o.status === 'won') return 'Retenu : Mission Controller doit faire le KYC et l’indépendance';
  if (o.status === 'phase1') return 'KYC et indépendance en cours (Mission Controller)';
  return '';
}

// ---- The firm's template (found in the Drive, or given by its link) and its structure ----

const TEMPLATE_NAME = /ACCEPTATION/i;
export function findTemplate(items) {
  const files = (items || []).filter(i => i.mimeType !== FOLDER && TEMPLATE_NAME.test(i.name || '') && /TEMPLATE|MOD[ÈE]LE/i.test((i.name || '') + ' ' + (i.path || '')) &&
    /spreadsheet|sheet|excel/i.test(i.mimeType || i.name || '') && !/ENTRAINEMENT|ZZ_|TEST_AGENT|FICTI/i.test(i.path || ''));
  const score = i => (/WORKING_PAPER_TEMPLATES/i.test(i.path || '') ? 4 : 0) + (/OPPORTUNIT/i.test(i.name || '') ? 2 : 0);
  return files.sort((a, b) => score(b) - score(a))[0] || null;
}

export async function templateStructure(d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const s = await loadAll(d);
  let tpl = s.template?.id ? s.template : null;
  if (!tpl) {
    const { state } = await loadScan(drive, folder).catch(() => ({ state: null }));
    const f = findTemplate(state?.items);
    if (!f) throw fail('ACCEPTANCE_TEMPLATE_NOT_FOUND', 409);
    tpl = { id: f.id, name: f.name, path: f.path, found: 'drive_map' };
  }
  const meta = await drive.getMeta(tpl.id);
  if (!meta) throw fail('ACCEPTANCE_TEMPLATE_NOT_FOUND', 409);
  const cached = (await loadJsonFile(STRUCTURE_FILE, drive, folder)).state;
  if (cached?.source_id === tpl.id && cached.source_modified === meta.modifiedTime && cached.structure) return { template: { ...tpl, name: meta.name, mimeType: meta.mimeType, url: meta.webViewLink || null }, structure: cached.structure };
  const buf = await drive.downloadBuffer(tpl.id);
  const structure = await describeWorkbook(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  await updateJsonFile(STRUCTURE_FILE, () => ({ source_id: tpl.id, source_name: meta.name, source_modified: meta.modifiedTime, read_at: now(), structure }), { drive, folder });
  if (!s.template?.id) await update(d, st => { st.template = { id: tpl.id, name: meta.name, path: tpl.path || null, found: tpl.found }; return st; });
  return { template: { ...tpl, name: meta.name, mimeType: meta.mimeType, url: meta.webViewLink || null }, structure };
}

// The owner may point to the template by its link (Paul: « je t'envoie le lien pour savoir où il se trouve »).
export async function setTemplate(orgId, body = {}, account = null, d = {}) {
  const m = String(body.link || body.file_id || '').match(/[-\w]{25,}/);
  if (!m) throw fail('TEMPLATE_LINK_REQUIRED');
  const meta = await (d.drive || driveAdapter).getMeta(m[0]);
  if (!meta) throw fail('ACCEPTANCE_TEMPLATE_NOT_FOUND', 404);
  await update(d, s => { s.template = { id: meta.id || m[0], name: meta.name, found: 'link', set_by: account?.display_name || account?.email || null, set_at: now() }; return s; });
  const { structure } = await templateStructure(d);
  return { template: { id: m[0], name: meta.name }, sheets: structure.sheets.map(s => ({ name: s.name, rows: s.rows.length })), naming: structure.naming };
}

// ---- Entry: a TDR deposited, linked, or found in the Drive ----

async function stagingFolder(d) {
  const root = d.home || homeFolderId() || d.folder || memoryFolderId();
  if (!root) throw fail('DRIVE_NOT_CHOSEN', 409);
  const tidy = d.tidy || (await import('./tidy-drive.js')).tidyDrive;
  const drop = await tidy.findOrCreateFolder(root, STAGING);
  return (await tidy.findOrCreateFolder(drop.id, STAGING_SUB)).id;
}

export async function createOpportunity(orgId, req, body = {}, account = null, d = {}) {
  const drive = d.drive || driveAdapter;
  const files = [];
  if (body.base64) {
    const name = cut(String(body.name || '').trim(), 200);
    if (!name) throw fail('FILE_NAME_REQUIRED');
    const buffer = Buffer.from(String(body.base64), 'base64');
    if (!buffer.length) throw fail('FILE_EMPTY');
    if (buffer.length > MAX_BYTES) throw fail('FILE_TOO_LARGE');
    const parent = await stagingFolder(d);
    const f = await drive.createBinary({ name, parentId: parent, buffer, mimeType: cut(body.mime || 'application/octet-stream', 120) });
    files.push({ id: f.id, name, staged: true });
  }
  for (const id of (Array.isArray(body.file_ids) ? body.file_ids : []).map(x => (String(x).match(/[-\w]{25,}/) || [])[0]).filter(Boolean).slice(0, 6)) files.push({ id, staged: Boolean(body.staged) });
  if (!files.length) throw fail('TDR_REQUIRED');
  // The same file never opens two opportunities.
  const all = await loadAll(d);
  const already = Object.values(all.opportunities || {}).find(o => (o.tdr_files || []).some(f => files.some(x => x.id === f.id)));
  if (already) return { opportunity: { id: already.id, status: already.status }, duplicate: true };
  const who = account?.display_name || account?.email || 'Firm Manager';
  const o = { id: randomUUID(), title: cut(body.title || files[0].name || 'Nouvelle opportunité', 200), source: cut(body.source || (body.base64 ? 'dépôt' : 'lien Drive'), 40),
    notes: cut(body.notes, 2000), created_by: who, created_at: now(), status: 'running', stage: 'read', tdr_files: files, log: [], proposals: {}, answers: [] };
  await saveOpp(o, d);
  await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: 'firm-manager', action_type: 'OPPORTUNITY_CREATED', source_ref: 'opportunity:' + o.id, decision: 'TDR reçu (' + o.source + ') par ' + who, status: 'started' }).catch(() => null);
  await (d.fire || (await import('./agent-passes.js')).fireInternal)(req, '/api/app?route=opportunity-step', { opportunity_id: o.id });
  return { opportunity: { id: o.id, status: o.status, stage: o.stage } };
}

// Large TDR (scans of several MB): the browser sends the file straight to Google into the staging
// folder (same mechanism as « Déposer des documents »), then the opportunity starts from its id.
export async function startTdrUpload(orgId, body = {}, req = null, d = {}) {
  const name = cut(String(body.name || '').trim(), 200);
  if (!name) throw fail('FILE_NAME_REQUIRED');
  const size = Number(body.size) || 0;
  if (size <= 0) throw fail('FILE_EMPTY');
  if (size > 1024 * 1024 * 1024) throw fail('FILE_TOO_LARGE');
  const parent = await stagingFolder(d);
  const { googleAccessToken, assertWritableTarget } = await import('./google-drive.js');
  await assertWritableTarget(parent);
  const token = await (d.token || googleAccessToken)();
  const origin = cut(req?.headers?.origin || (req?.headers?.host ? 'https://' + req.headers.host : ''), 200);
  const mimeType = cut(body.mime || 'application/octet-stream', 120);
  const r = await (d.fetchImpl || fetch)('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(size), ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ name, parents: [parent] })
  });
  const url = r.headers?.get?.('location');
  if (!r.ok || !url) throw fail('UPLOAD_SESSION_REFUSED_' + r.status, 502);
  return { upload_url: url, name };
}

// ---- The Firm Manager's work, one stage per call ----

const READ = `Tu es le Firm Manager d'un cabinet d'audit, d'expertise et de conseil. Tu LIS un TDR, un avis d'appel d'offres, un AMI (appel à manifestation d'intérêt), une demande de proposition ou un projet de contrat (texte, scan ou image).
On te donne les champs de la FICHE D'OPPORTUNITÉ du cabinet (cellule | rubrique | aide | valeurs permises | type).
Remplis UNIQUEMENT ce que le document prouve, avec la citation exacte. Rien d'inventé, rien de déduit du nom du fichier. Dates au format AAAA-MM-JJ. Pour un champ à liste, une des valeurs permises exactement, sinon laisse vide.
Ne remplis pas : les noms des personnes du cabinet, le CRM, le profil public de l'entité (chiffre d'affaires, taille, actionnariat, auditeur précédent) sauf s'il est écrit dans le document.
JSON STRICT : {"client":"","reference":"","document_kind":"TDR|AMI|appel d'offres|demande de proposition|contrat|autre","summary":"","submission_deadline":"","values":[{"cell":"","value":"","quote":""}],"open_questions":[""]}`;

const PREPARE_P0 = `Tu es le Firm Manager d'un cabinet d'audit. Tu PRÉPARES la Phase 0 (identification de l'opportunité) dans le classeur du cabinet : pour chaque procédure on te donne sa ligne (référence, ce qu'il faut faire, instruction) et ses champs (cellule | en-tête | valeurs permises).
On te donne aussi : la fiche de l'opportunité, la recherche de conflits dans les missions du cabinet, les capacités et la charge de l'équipe, et une recherche publique sur le prospect (avec sources).
Pour chaque procédure que tu peux documenter avec des FAITS, propose les valeurs des champs (résultat factuel, réponse Oui / Non / N-A, preuve ou source, commentaire) et dis pourquoi.
Ne propose JAMAIS : une décision de l'Associé, un nom de personne en « préparé / revu par », une date de revue, ni la réponse à une question qu'une personne seule peut attester (information confidentielle communiquée, engagement pris, enregistrement fait par quelqu'un) — pour celles-ci, mets "for_team": true et formule la question à poser.
Propose aussi, pour la fiche (premier onglet), les champs du profil public trouvés dans la recherche (chiffre d'affaires, taille, actionnariat, auditeur précédent, raison de la demande), chacun avec sa source.
Un « Non » ou un signal d'alerte doit être justifié par un fait sourcé. Rien d'inventé : si tu ne sais pas, ne propose rien.
JSON STRICT : {"rows":[{"sheet":"","row":0,"values":{"CELL":"valeur"},"why":"","sources":[""],"for_team":false,"question":""}],"conclusion":{"proposed":"","why":""}}`;

const RESEARCH_P0 = `Recherche publique sur un prospect d'un cabinet d'audit (réponse en français, sources entre crochets [source](url)) :
### Identité et activité (dénomination exacte, forme, pays, secteur, taille, chiffre d'affaires si publié, actionnariat connu, dirigeants)
### Auditeur précédent (si public)
### Réputation (presse, litiges connus, sanctions, controverses) — faits seulement, datés et sourcés
Rien d'inventé : si rien de fiable, dis-le.`;

export async function opportunityStep(orgId, req, body = {}, d = {}) {
  const id = String(body.opportunity_id || '');
  const o = await getOpportunity(id, d);
  if (o.status !== 'running') return o;
  const say = m => { o.log = [...(o.log || []), { at: now(), m: cut(m, 400) }].slice(-80); };
  const next = async stage => { o.stage = stage; await saveOpp(o, d); await (d.fire || (await import('./agent-passes.js')).fireInternal)(req, '/api/app?route=opportunity-step', { opportunity_id: o.id }); return o; };
  const ai = d.ai || firstAvailable, research = d.research || deepResearch;
  try {
    const { template, structure } = await (d.templateStructure || templateStructure)(d);
    const fiche = structure.sheets.find(s => sheetOwner(s) === 'firm-manager' && !/PHASE[ _]?0/i.test(s.name + s.title)) || structure.sheets[0];
    if (o.stage === 'read') {
      const files = [];
      for (const f of o.tdr_files) { try { files.push(await (d.fileForAI || fileForAI)(f.id)); } catch (e) { say('Document illisible (' + (f.name || f.id) + ') : ' + cut(e.message || e, 80)); } }
      if (!files.length) throw fail('TDR_UNREADABLE', 422);
      o.tdr_files = o.tdr_files.map(f => { const r = files.find(x => x.id === f.id); return r ? { ...f, name: r.name, url: r.url, mimeType: r.mimeType } : f; });
      const text = files.filter(f => !f.visual).map(f => '### ' + f.name + '\n' + f.text).join('\n\n').slice(0, 120000);
      const visual = files.filter(f => f.visual);
      const fields = fiche.rows.filter(r => !identityRow(r)).flatMap(r => r.fields.map(f => f.cell + ' | ' + (r.label || '') + ' | ' + cut(r.help, 160) + ' | ' + (f.options ? f.options.join(' / ') : '') + ' | ' + f.type));
      const r = await ai(visual.length ? ['anthropic', 'gemini', 'openai'] : ORDER, { instructions: READ, input: 'CHAMPS DE LA FICHE (' + fiche.name + ') :\n' + fields.join('\n') + (o.notes ? '\n\nPRÉCISIONS DE LA PERSONNE : ' + o.notes : '') + '\n\nDOCUMENTS :\n' + (text || '(voir les documents joints)'), files: visual, maxTokens: 6000 });
      const x = parseJsonLoose(r.text) || {};
      o.read_by = r.provider; o.client = cut(x.client, 200) || null; o.reference = cut(x.reference, 120) || null; o.kind = cut(x.document_kind, 40) || null;
      o.summary = cut(x.summary, 1500); o.deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(x.submission_deadline || '')) ? x.submission_deadline : null; o.open_questions = (x.open_questions || []).slice(0, 12).map(s => cut(s, 300));
      o.fiche_values = (x.values || []).filter(v => v && v.cell && String(v.value ?? '').trim()).slice(0, 60).map(v => ({ cell: cut(v.cell, 8), value: cut(v.value, 1500), quote: cut(v.quote, 400) }));
      if (o.client) o.title = (o.reference ? o.reference + ' — ' : '') + o.client;
      say('Document lu (' + files.length + ', ' + r.provider + ') : ' + (o.client || 'client non identifié') + (o.reference ? ', référence ' + o.reference : '') + '.');
      return next('file');
    }
    if (o.stage === 'file') return await fileStage(orgId, o, { template, structure, fiche }, say, next, d);
    if (o.stage === 'prepare') {
      const p0 = structure.sheets.filter(s => sheetOwner(s) === 'firm-manager' && s !== fiche);
      const facts = await conflictSearch(orgId, o, d);
      const cap = await (d.capabilityContext || (async (...a) => (await import('./capabilities.js')).capabilityContext(...a)))(orgId, d).catch(() => ({ people: [] }));
      const team = (cap.people || []).filter(p => p.kind === 'employee').map(p => ({ name: p.full_name, title: p.title, industries: p.industries, specialist: p.specialist_skills, certifications: p.certifications, load_pct: p.load_pct })).slice(0, 60);
      const web = await research({ instructions: RESEARCH_P0, question: 'Prospect : ' + (o.client || o.title) + (o.reference ? '\nRéférence : ' + o.reference : '') + '\nRésumé du document : ' + cut(o.summary, 1500) });
      o.research = { text: cut(web.text, 20000), sources: (web.sources || []).slice(0, 25), web: Boolean(web.web), provider: web.provider || null, error: web.error || null };
      const rows = p0.flatMap(s => s.rows.filter(r => rowAuthority(r) === 'team' && !identityRow(r)).map(r => ({ sheet: s.name, row: r.row, ref: r.ref, label: r.label, help: cut(r.help, 300), fields: r.fields.filter(f => !identityField(f)).map(f => f.cell + ' | ' + (f.header || '') + (f.options ? ' | ' + f.options.join('/') : '')) })));
      const profile = fiche.rows.filter(r => !identityRow(r)).map(r => ({ sheet: fiche.name, row: r.row, label: r.label, fields: r.fields.map(f => f.cell) }));
      const r = await ai(ORDER, { instructions: PREPARE_P0, input: 'FICHE : ' + JSON.stringify({ client: o.client, reference: o.reference, deadline: o.deadline, summary: o.summary, values: o.fiche_values }).slice(0, 12000) +
        '\n\nPROCÉDURES : ' + JSON.stringify(rows).slice(0, 30000) + '\n\nCHAMPS DE LA FICHE (profil public) : ' + JSON.stringify(profile).slice(0, 6000) +
        '\n\nRECHERCHE DE CONFLITS (missions du cabinet) : ' + JSON.stringify(facts).slice(0, 6000) + '\n\nÉQUIPE (capacités, charge) : ' + JSON.stringify(team).slice(0, 20000) +
        '\n\nRECHERCHE PUBLIQUE : ' + (o.research.web ? o.research.text.slice(0, 20000) + '\nSOURCES : ' + JSON.stringify(o.research.sources).slice(0, 4000) : '(indisponible : ' + (o.research.error || 'aucune clé') + ')'), maxTokens: 9000 });
      const x = parseJsonLoose(r.text) || {};
      o.proposals = keepProposals(structure, x.rows, ['firm-manager']);
      o.phase0_conclusion = x.conclusion ? { proposed: cut(x.conclusion.proposed, 80), why: cut(x.conclusion.why, 1200) } : null;
      o.conflicts = facts;
      say('Phase 0 préparée : ' + Object.keys(o.proposals).length + ' proposition(s), ' + (o.research.web ? (o.research.sources || []).length + ' source(s) publique(s)' : 'sans recherche web') + '. Questions et décision : à l’équipe et à l’Associé.');
      o.status = 'phase0'; o.stage = 'phase0';
      await saveOpp(o, d);
      return o;
    }
  } catch (e) {
    o.status = 'failed'; o.error = cut(e.message || e, 300); say('Arrêt : ' + o.error);
    await saveOpp(o, d);
  }
  return o;
}

async function fileStage(orgId, o, { template, structure, fiche }, say, next, d) {
  const drive = d.drive || driveAdapter;
  const tidy = d.tidy || (await import('./tidy-drive.js')).tidyDrive;
  const { state } = await loadScan(drive, d.folder || memoryFolderId()).catch(() => ({ state: null }));
  const items = state?.items || [];
  // Where the template says the copies go (« déposer dans 03_… / [dossier de l'opportunité] »).
  const destName = structure.naming?.destination_folder;
  if (!destName) throw fail('TEMPLATE_DESTINATION_UNKNOWN', 422);
  const dest = items.filter(i => i.mimeType === FOLDER && i.name === destName).sort((a, b) => String(a.path).split('/').length - String(b.path).split('/').length)[0];
  if (!dest) throw fail('FOLDER_NOT_FOUND_' + destName, 409);
  // Possible duplicate: another opportunity of the same reference (or client + deadline) → stop.
  const all = await loadAll(d);
  const twin = Object.values(all.opportunities || {}).find(x => x.id !== o.id && x.folder && ((o.reference && x.reference && clean(x.reference) === clean(o.reference)) || (o.client && x.client && clean(x.client) === clean(o.client) && o.deadline && x.deadline === o.deadline)));
  if (twin) { o.status = 'duplicate'; o.duplicate_of = twin.id; say('POSSIBLE DUPLICATE — REVIEW REQUIRED : même référence ou même client et même échéance que « ' + twin.title + ' ». Rien n’a été créé.'); await saveOpp(o, d); return o; }
  // The opportunity folder: an existing child carrying the reference, or a new one.
  const children = items.filter(i => i.mimeType === FOLDER && String(i.path || '').startsWith(dest.path + '/') && String(i.path).split('/').length === String(dest.path).split('/').length + 1);
  const ref = clean(o.reference);
  let folder = ref && ref.length >= 4 ? children.find(c => clean(c.name).includes(ref)) : null;
  const folderName = cut(((o.reference ? o.reference + ' — ' : 'OPP ' + today() + ' — ') + (o.client || o.title)).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim(), 150);
  if (!folder) folder = await tidy.findOrCreateFolder(dest.id, folderName);
  const fmeta = await drive.getMeta(folder.id).catch(() => null);
  o.folder = { id: folder.id, name: folder.name || folderName, url: fmeta?.webViewLink || null, path: dest.path + '/' + (folder.name || folderName) };
  say((folder.created || !children.some(c => c.id === folder.id) ? 'Dossier de l’opportunité : ' : 'Dossier existant réutilisé : ') + o.folder.path + '.');
  // The TDR goes there (moved from the drop place or from the top of the opportunities folder; a file
  // already filed elsewhere is left where it is and only linked). Same name there → both kept.
  for (const f of o.tdr_files) {
    const meta = await drive.getMeta(f.id).catch(() => null);
    if (!meta) continue;
    const parent = (meta.parents || [])[0] || null;
    if (parent === folder.id) { f.filed = true; continue; }
    if (f.staged || parent === dest.id) {
      let name = meta.name.replace(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}_/, '');
      if (await tidy.nameTaken(folder.id, name, f.id).catch(() => false)) name = name.replace(/(\.[^.]+)?$/, ' (' + today() + ')$1');
      await tidy.move(f.id, parent, folder.id, name !== meta.name ? name : null);
      const after = await drive.getMeta(f.id).catch(() => null);
      f.filed = Boolean(after && (after.parents || []).includes(folder.id));
      f.name = after?.name || name; f.url = after?.webViewLink || f.url || null;
      say(f.filed ? 'TDR rangé et vérifié dans le dossier : « ' + f.name + ' ».' : 'TDR : déplacement non vérifié, à contrôler (« ' + meta.name + ' »).');
    } else { f.filed = false; f.url = meta.webViewLink || f.url || null; say('TDR laissé à sa place (déjà rangé ailleurs) et relié : « ' + meta.name + ' ».'); }
  }
  // The workbook: the template copied there under the name its mode d'emploi gives (once).
  const name = copyName(structure.naming?.pattern, { client: o.client || 'CLIENT', reference: o.reference || today() });
  const existing = (await drive.findFilesByExactName(name, folder.id).catch(() => [])) || [];
  let wb = existing[0] || null;
  if (!wb) wb = await drive.copyFile(template.id, name, folder.id);
  const wmeta = await drive.getMeta(wb.id);
  o.workbook = { id: wb.id, name: wmeta?.name || name, url: wmeta?.webViewLink || null, mimeType: wmeta?.mimeType || XLSX };
  // The first sheet: what the TDR proves, plus the links (TDR, folder) and the reception date.
  const writes = [];
  for (const v of o.fiche_values || []) writes.push({ sheet: fiche.name, cell: v.cell, value: v.value });
  const tdr = o.tdr_files[0];
  const byLabel = re => fiche.rows.find(r => re.test(r.label || ''))?.fields?.[0]?.cell;
  const put = (re, value) => { const c = byLabel(re); if (c && value && !writes.some(w => w.cell === c)) writes.push({ sheet: fiche.name, cell: c, value }); };
  put(/^TDR re[çc]u/i, 'Oui'); put(/Nom du fichier TDR/i, tdr?.name); put(/Lien Drive vers le TDR/i, tdr?.url); put(/Lien Drive du dossier/i, o.folder.url);
  put(/Date de r[ée]ception/i, today());
  const valid = [];
  for (const w of writes) { try { valid.push(...validateWrites(structure, [w])); } catch (e) { say('Champ non écrit (' + w.cell + ') : ' + cut(e.message, 80)); } }
  await writeToDriveCopy(drive, o.workbook.id, valid, { mimeType: o.workbook.mimeType });
  // Verified: read back what was written.
  const back = await readDriveCopy(drive, o.workbook.id, valid, { mimeType: o.workbook.mimeType }).catch(() => ({}));
  const ok = valid.filter(w => String(back[w.sheet + '!' + w.cell] ?? '').trim() !== '').length;
  o.fiche_written = { at: now(), cells: valid.length, verified: ok };
  say('Classeur « ' + o.workbook.name + ' » ' + (existing[0] ? 'retrouvé' : 'créé') + ' dans le dossier ; fiche remplie (' + ok + '/' + valid.length + ' champs vérifiés).');
  await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: 'firm-manager', action_type: 'OPPORTUNITY_FILED', source_ref: 'opportunity:' + o.id, output_ref: o.workbook.id, decision: 'TDR rangé, classeur créé et fiche remplie', status: 'done' }).catch(() => null);
  return next('prepare');
}

const clean = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '');

// The firm's missions that share words with the prospect (preliminary conflict search, facts only).
export async function conflictSearch(orgId, o, d = {}) {
  const rows = await (d.fetchRows || rest)('office_missions?org_id=eq.' + q(orgId) + '&select=id,name,mission_code,status&limit=2000').catch(() => []) || [];
  const w = words(o.client);
  if (!w.length) return { searched: 'missions du cabinet', terms: [], matches: [] };
  const matches = rows.map(m => ({ m, hit: w.filter(x => words(m.name + ' ' + (m.mission_code || '')).includes(x)).length })).filter(x => x.hit >= Math.min(2, w.length)).slice(0, 15)
    .map(x => ({ mission: x.m.name, code: x.m.mission_code, status: x.m.status }));
  return { searched: 'missions du cabinet (' + rows.length + ')', terms: w, matches };
}

// Agents' proposals: only on rows the agent owns, never decision rows, never identity fields, values
// checked against the cell's list. Kept apart until a person confirms them.
export function keepProposals(structure, rows, owners) {
  const out = {};
  for (const p of rows || []) {
    const sheet = structure.sheets.find(s => s.name === p.sheet);
    if (!sheet || !owners.includes(sheetOwner(sheet)) && !(owners.includes('firm-manager') && sheet === structure.sheets[0])) continue;
    const row = sheet.rows.find(r => r.row === Number(p.row));
    if (!row || rowAuthority(row) !== 'team' || identityRow(row)) continue;
    // Independence is what the firm's people know about themselves: the agent asks, never answers.
    if (/IND[ÉE]PENDANCE/i.test(row.section || '') && !p.for_team) continue;
    if (/IND[ÉE]PENDANCE/i.test(row.section || '')) { out[sheet.name + '!' + row.row] = { values: {}, why: cut(p.why, 800), sources: [], for_team: true, question: cut(p.question, 400) }; continue; }
    const values = {};
    for (const [cell, v] of Object.entries(p.values || {})) {
      const f = row.fields.find(x => x.cell === cell);
      if (!f || identityField(f) || v == null || String(v).trim() === '') continue;
      try { values[cell] = validateWrites(structure, [{ sheet: sheet.name, cell, value: v }])[0].value; } catch { /* not a valid value for this cell */ }
    }
    if (!Object.keys(values).length && !p.for_team) continue;
    out[sheet.name + '!' + row.row] = { values, why: cut(p.why, 800), sources: (p.sources || []).slice(0, 6).map(s => cut(s, 300)), for_team: Boolean(p.for_team), question: cut(p.question, 400) };
  }
  return out;
}

// ---- People answer; the Associé decides ----

const ROLE_RANK = { collaborator: 1, manager: 2, partner: 3, owner: 4 };
function mayFill(authority, role) {
  const r = ROLE_RANK[role] || 0;
  return authority === 'partner' ? r >= 3 : authority === 'manager' ? r >= 2 : r >= 1;
}

// The view of an opportunity for the page: its workbook's questions, grouped as in the workbook,
// with the current values (read from the workbook itself), the agents' proposals and who may answer.
export async function opportunityView(orgId, id, account = null, d = {}) {
  const o = await getOpportunity(id, d);
  const out = { ...o, research: o.research ? { sources: o.research.sources, web: o.research.web, error: o.research.error, text: o.research.text } : null };
  if (!o.workbook) return out;
  const { structure } = await (d.templateStructure || templateStructure)(d);
  const cells = structure.sheets.flatMap(s => s.rows.flatMap(r => r.fields.map(f => ({ sheet: s.name, cell: f.cell }))));
  const values = await readDriveCopy(d.drive || driveAdapter, o.workbook.id, cells, { mimeType: o.workbook.mimeType }).catch(e => ({ __error: String(e.message || e) }));
  const role = account?.role || null;
  const phaseOpen = { 'firm-manager': true, 'mission-controller': ['won', 'phase1'].includes(o.status) || Boolean(o.phase1), decision: true };
  out.sheets = structure.sheets.map(s => ({ name: s.name, title: s.title, owner: sheetOwner(s), open: phaseOpen[sheetOwner(s)],
    rows: s.rows.map(r => ({ row: r.row, section: r.section, ref: r.ref, label: r.label, help: r.help, authority: rowAuthority(r), identity: identityRow(r), may_fill: mayFill(rowAuthority(r), role),
      fields: r.fields.map(f => ({ ...f, value: values[s.name + '!' + f.cell] ?? '' })),
      proposal: (o.proposals || {})[s.name + '!' + r.row] || (o.phase1?.proposals || {})[s.name + '!' + r.row] || null })) }));
  out.read_error = values.__error || null;
  out.viewer = { role, name: account?.display_name || account?.email || null };
  return out;
}

export async function answerRow(orgId, body = {}, account = null, d = {}) {
  const o = await getOpportunity(String(body.opportunity_id || ''), d);
  if (!o.workbook) throw fail('WORKBOOK_NOT_READY', 409);
  const { structure } = await (d.templateStructure || templateStructure)(d);
  const sheet = structure.sheets.find(s => s.name === body.sheet);
  if (!sheet) throw fail('SHEET_NOT_FOUND', 404);
  const owner = sheetOwner(sheet);
  if (owner === 'mission-controller' && !['won', 'phase1'].includes(o.status) && !o.phase1) throw fail('PHASE1_NOT_OPEN', 409);
  const row = sheet.rows.find(r => r.row === Number(body.row));
  if (!row) throw fail('ROW_NOT_FOUND', 404);
  const authority = rowAuthority(row);
  if (!mayFill(authority, account?.role)) throw fail(authority === 'partner' ? 'PARTNER_DECISION_ONLY' : 'MANAGER_ONLY', 403);
  const who = account?.display_name || account?.email;
  if (!who) throw fail('PERSONAL_SESSION_REQUIRED', 401);
  const writes = Object.entries(body.values || {}).map(([cell, value]) => ({ sheet: sheet.name, cell, value }));
  // Who answered, and when — in the row's own « Préparé par » / « Date » columns.
  const prep = row.fields.find(f => /Pr[ée]par[ée] par/i.test(f.header || '')), date = row.fields.find(f => /^Date$/i.test(f.header || ''));
  if (prep && !writes.some(w => w.cell === prep.cell)) writes.push({ sheet: sheet.name, cell: prep.cell, value: who });
  if (date && !writes.some(w => w.cell === date.cell)) writes.push({ sheet: sheet.name, cell: date.cell, value: today() });
  const valid = validateWrites(structure, writes.filter(w => row.fields.some(f => f.cell === w.cell)));
  // The Associé's decision carries who decided and when: the rows « Nom de l'Associé » and « Date de
  // la décision » that follow it in the same block are filled with the person signed in, today.
  if (authority === 'partner' && /D[ÉE]CISION/i.test(row.label || '') && valid.some(w => w.value !== '')) {
    for (const r of sheet.rows.filter(x => x.row > row.row && x.row <= row.row + 6 && x.section === row.section)) {
      const f = r.fields[0];
      if (/^Nom de l.Associ/i.test(r.label || '') && f) valid.push(...validateWrites(structure, [{ sheet: sheet.name, cell: f.cell, value: who }]));
      if (/^Date de la d[ée]cision/i.test(r.label || '') && f) valid.push(...validateWrites(structure, [{ sheet: sheet.name, cell: f.cell, value: today() }]));
    }
  }
  // Separation of functions (the template's own rule): the Associé who decides is never the
  // preparer or the reviewer of the file.
  if (authority === 'partner' && /D[ÉE]CISION/i.test(row.label || '')) {
    const ids = structure.sheets.find(s => s.name === sheet.name).rows.filter(identityRow).flatMap(r => r.fields.filter(f => !/date/i.test(r.label || '') && f.type === 'text').map(f => ({ sheet: sheet.name, cell: f.cell })));
    const cur = await readDriveCopy(d.drive || driveAdapter, o.workbook.id, ids, { mimeType: o.workbook.mimeType }).catch(() => ({}));
    if (Object.values(cur).some(v => v && String(v).trim().toLowerCase() === String(who).trim().toLowerCase())) throw fail('SEPARATION_OF_FUNCTIONS', 409);
  }
  await writeToDriveCopy(d.drive || driveAdapter, o.workbook.id, valid, { mimeType: o.workbook.mimeType });
  const back = await readDriveCopy(d.drive || driveAdapter, o.workbook.id, valid, { mimeType: o.workbook.mimeType }).catch(() => ({}));
  const verified = valid.every(w => String(back[w.sheet + '!' + w.cell] ?? '') !== '' || w.value === '');
  o.answers = [...(o.answers || []), { at: now(), by: who, role: account?.role || null, sheet: sheet.name, row: row.row, ref: row.ref, cells: valid.map(w => w.cell), from_proposal: Boolean(body.from_proposal), verified }].slice(-500);
  // The Associé's Phase 0 decision moves the opportunity on.
  if (owner === 'firm-manager' && authority === 'partner') {
    const dec = valid.find(w => { const f = row.fields.find(x => x.cell === w.cell); return f?.options?.length; });
    if (dec && /^POURSUIVRE/i.test(dec.value)) o.status = 'go';
    else if (dec && /^NE PAS/i.test(dec.value)) o.status = 'stop';
  }
  await saveOpp(o, d);
  await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: owner, action_type: authority === 'team' ? 'WORKBOOK_ANSWER' : 'WORKBOOK_DECISION', source_ref: 'opportunity:' + o.id + ':' + sheet.name + '!' + row.row, output_ref: o.workbook.id, decision: cut(who + ' : ' + valid.map(w => w.cell + '=' + w.value).join(' ; '), 400), status: verified ? 'done' : 'unverified' }).catch(() => null);
  return { written: valid.length, verified, status: o.status };
}

// ---- The client's confirmation: the opportunity is won → Mission Controller ----

export async function markWon(orgId, req, body = {}, account = null, d = {}) {
  const o = await getOpportunity(String(body.opportunity_id || ''), d);
  if (!['go', 'phase0'].includes(o.status)) throw fail('NOT_WAITING_FOR_CLIENT', 409);
  const drive = d.drive || driveAdapter;
  const tidy = d.tidy || (await import('./tidy-drive.js')).tidyDrive;
  const who = account?.display_name || account?.email || null;
  let letter = null;
  if (body.base64) {
    const name = cut(String(body.name || 'Lettre de confirmation').trim(), 200);
    const buffer = Buffer.from(String(body.base64), 'base64');
    if (!buffer.length || buffer.length > MAX_BYTES) throw fail(buffer.length ? 'FILE_TOO_LARGE' : 'FILE_EMPTY');
    let n = name;
    if (await tidy.nameTaken(o.folder.id, n).catch(() => false)) n = n.replace(/(\.[^.]+)?$/, ' (' + today() + ')$1');
    const f = await drive.createBinary({ name: n, parentId: o.folder.id, buffer, mimeType: cut(body.mime || 'application/pdf', 120) });
    const meta = await drive.getMeta(f.id).catch(() => null);
    letter = { id: f.id, name: n, url: meta?.webViewLink || null, verified: Boolean(meta && (meta.parents || []).includes(o.folder.id)) };
  } else {
    const m = String(body.link || '').match(/[-\w]{25,}/);
    if (!m) throw fail('CONFIRMATION_LETTER_REQUIRED');
    const meta = await drive.getMeta(m[0]);
    if (!meta) throw fail('FILE_NOT_FOUND', 404);
    letter = { id: m[0], name: meta.name, url: meta.webViewLink || null, verified: true, linked: true };
  }
  o.status = 'won'; o.won = { at: now(), by: who, letter };
  o.log = [...(o.log || []), { at: now(), m: 'Lettre de confirmation du client reçue (« ' + letter.name + ' ») : message envoyé au Mission Controller pour le KYC et l’indépendance.' }];
  await saveOpp(o, d);
  const ev = await (d.emit || (await import('./event-bus.js')).emit)(orgId, { type: 'OPPORTUNITY_WON', agent: 'firm-manager', actor: who, object_type: 'opportunity', object_id: o.id,
    source: 'drive:' + letter.id, idempotency_key: 'OPPORTUNITY_WON:' + o.id, payload: { title: o.title, client: o.client, reference: o.reference, workbook_id: o.workbook?.id, folder_id: o.folder?.id } });
  // The Mission Controller reads its events now rather than at its next round (same bus, same rules).
  const handled = await (d.handleMissionEvents || (async (...a) => (await import('./mission-events.js')).handleMissionEvents(...a)))(orgId).catch(e => ({ error: cut(e.message || e, 200) }));
  return { status: o.status, letter, event: ev, mission_controller: handled };
}

// Mission Controller's handler for OPPORTUNITY_WON: its to-do « faire le KYC et l'indépendance ».
export async function onOpportunityWon(orgId, ev, d = {}) {
  const o = await getOpportunity(ev.object_id, d).catch(() => null);
  if (!o) return { ignore: 'opportunité inconnue' };
  if (o.phase1) return 'déjà pris en charge';
  o.phase1 = { opened_at: now(), todo: 'Faire le KYC et l’indépendance (Phase 1 du classeur) avant le début de la mission', proposals: {}, status: 'todo' };
  o.status = 'phase1';
  o.log = [...(o.log || []), { at: now(), m: 'Mission Controller : à faire — KYC et indépendance dans le classeur « ' + (o.workbook?.name || '') + ' ».' }];
  await saveOpp(o, d);
  return 'KYC et indépendance à faire pour « ' + o.title + ' »';
}

const PREPARE_P1 = `Tu es le Mission Controller d'un cabinet d'audit. Tu PRÉPARES la Phase 1 (acceptation : documents, KYC / AML, conflits, auditeur précédent, intégrité de la direction, compétences) dans le classeur du cabinet.
On te donne : chaque ligne (référence, contrôle, section) et ses champs (cellule | en-tête | valeurs permises), la fiche de l'opportunité, la recherche de conflits dans les missions du cabinet, les capacités et la charge de l'équipe, et des VÉRIFICATIONS PUBLIQUES (sanctions, personnes politiquement exposées, registre du commerce, litiges, presse) avec leurs sources.
Pour chaque contrôle que des FAITS sourcés permettent de documenter, propose : le résultat factuel, la personne ou l'entité concernée, la source / le lien, le red flag Oui/Non (Oui seulement sur un fait négatif sourcé), un commentaire. Sépare toujours le fait (sourcé) de l'appréciation.
Ne propose JAMAIS : l'indépendance des personnes du cabinet (section indépendance : liens, intérêts, menaces — seules les personnes le savent : "for_team": true avec la question à leur poser), une décision, une cotation du risque, une recommandation, un nom en « préparé / revu par », une date de revue.
Une recherche qui ne trouve rien n'est pas une preuve d'absence : écris « aucune correspondance trouvée dans [sources consultées] à la date du … ».
JSON STRICT : {"rows":[{"sheet":"","row":0,"values":{"CELL":"valeur"},"why":"","sources":[""],"for_team":false,"question":""}]}`;

const RESEARCH_P1 = `Vérifications publiques pour l'acceptation d'un client par un cabinet d'audit (réponse en français, chaque fait avec sa source [source](url) et sa date) :
### Identité légale (dénomination exacte, forme, numéro RCCM ou registre, siège, date de création)
### Actionnaires, bénéficiaires effectifs et dirigeants connus publiquement
### Sanctions internationales (listes ONU, UE, OFAC, Royaume-Uni) pour l'entité et les dirigeants nommés
### Personnes politiquement exposées parmi les dirigeants / bénéficiaires
### Litiges, fraudes, sanctions réglementaires, presse négative
### Auditeur précédent (si public)
Rien d'inventé ; « aucune correspondance trouvée » quand c'est le cas, avec les sources consultées.`;

export async function prepareKyc(orgId, req, body = {}, account = null, d = {}) {
  const o = await getOpportunity(String(body.opportunity_id || ''), d);
  if (!o.phase1) throw fail('PHASE1_NOT_OPEN', 409);
  if (o.phase1.status === 'preparing') return { status: 'preparing' };
  o.phase1.status = 'preparing'; o.phase1.requested_by = account?.display_name || account?.email || null;
  await saveOpp(o, d);
  await (d.fire || (await import('./agent-passes.js')).fireInternal)(req, '/api/app?route=opportunity-kyc-step', { opportunity_id: o.id });
  return { status: 'preparing' };
}

export async function kycStep(orgId, req, body = {}, d = {}) {
  const o = await getOpportunity(String(body.opportunity_id || ''), d);
  if (o.phase1?.status !== 'preparing') return o;
  const ai = d.ai || firstAvailable, research = d.research || deepResearch;
  try {
    const { structure } = await (d.templateStructure || templateStructure)(d);
    const p1 = structure.sheets.filter(s => sheetOwner(s) === 'mission-controller');
    const web = await research({ instructions: RESEARCH_P1, question: 'Entité : ' + (o.client || o.title) + (o.reference ? '\nRéférence : ' + o.reference : '') + '\nContexte : ' + cut(o.summary, 1500) + (o.research?.text ? '\nDéjà trouvé en Phase 0 : ' + cut(o.research.text, 4000) : ''), maxTokens: 7000 });
    o.phase1.research = { text: cut(web.text, 25000), sources: (web.sources || []).slice(0, 30), web: Boolean(web.web), provider: web.provider || null, error: web.error || null };
    const facts = await conflictSearch(orgId, o, d);
    const cap = await (d.capabilityContext || (async (...a) => (await import('./capabilities.js')).capabilityContext(...a)))(orgId, d).catch(() => ({ people: [] }));
    const team = (cap.people || []).filter(p => p.kind === 'employee').map(p => ({ name: p.full_name, title: p.title, industries: p.industries, specialist: p.specialist_skills, certifications: p.certifications, load_pct: p.load_pct })).slice(0, 60);
    const rows = p1.flatMap(s => s.rows.filter(r => rowAuthority(r) === 'team' && !identityRow(r)).map(r => ({ sheet: s.name, row: r.row, section: r.section, ref: r.ref, label: r.label, fields: r.fields.filter(f => !identityField(f)).map(f => f.cell + ' | ' + (f.header || '') + (f.options ? ' | ' + f.options.join('/') : '')) })));
    const r = await ai(ORDER, { instructions: PREPARE_P1, input: 'FICHE : ' + JSON.stringify({ client: o.client, reference: o.reference, summary: o.summary, values: o.fiche_values }).slice(0, 10000) +
      '\n\nLIGNES : ' + JSON.stringify(rows).slice(0, 45000) + '\n\nCONFLITS (missions du cabinet) : ' + JSON.stringify(facts).slice(0, 5000) + '\n\nÉQUIPE : ' + JSON.stringify(team).slice(0, 15000) +
      '\n\nVÉRIFICATIONS PUBLIQUES : ' + (o.phase1.research.web ? o.phase1.research.text.slice(0, 25000) + '\nSOURCES : ' + JSON.stringify(o.phase1.research.sources).slice(0, 5000) : '(indisponibles : ' + (o.phase1.research.error || 'aucune clé') + ')'), maxTokens: 12000 });
    o.phase1.proposals = keepProposals(structure, (parseJsonLoose(r.text) || {}).rows, ['mission-controller']);
    o.phase1.status = 'ready'; o.phase1.prepared_at = now(); o.phase1.prepared_by = r.provider;
    o.log = [...(o.log || []), { at: now(), m: 'Mission Controller : Phase 1 préparée — ' + Object.keys(o.phase1.proposals).length + ' proposition(s), ' + (o.phase1.research.web ? o.phase1.research.sources.length + ' source(s)' : 'sans vérification web') + '. Chaque réponse est confirmée par une personne.' }];
  } catch (e) {
    o.phase1.status = 'failed'; o.phase1.error = cut(e.message || e, 300);
  }
  await saveOpp(o, d);
  return o;
}

// ---- Rounds: TDR found in the Drive; the workbook filled by hand ----

const TDR_LIKE = /(tdr|t\.d\.r|termes?[\s_-]*de[\s_-]*r[ée]f|terms?[\s_-]*of[\s_-]*ref|\btor\b|cahier[\s_-]*des[\s_-]*charges|appel[\s_-]*d.?offres?|\brfp\b|\bdao\b|\bami\b|manifestation[\s_-]*d.?int[ée]r[êe]t|request[\s_-]*for[\s_-]*proposal|demande[\s_-]*de[\s_-]*proposition)/i;

// Firm Manager's round: TDR-like files that appeared in the opportunities folder (and not yet tied to
// an opportunity) are SIGNALLED on the Opportunités page — a person creates the opportunity from it.
export async function opportunityRound(orgId, d = {}) {
  const drive = d.drive || driveAdapter;
  const s = await loadAll(d);
  const since = s.round_at || new Date(Date.now() - 7 * 86400000).toISOString();
  const startedAt = now();
  let structure = null;
  try { structure = (await (d.templateStructure || templateStructure)(d)).structure; } catch (e) { return { skipped: String(e.message || e) }; }
  const { state } = await loadScan(drive, d.folder || memoryFolderId()).catch(() => ({ state: null }));
  const dest = (state?.items || []).find(i => i.mimeType === FOLDER && i.name === structure.naming?.destination_folder);
  const known = new Set(Object.values(s.opportunities || {}).flatMap(o => (o.tdr_files || []).map(f => f.id)).concat((s.signals || []).map(x => x.file_id)));
  const changed = dest ? await drive.changedSince(since, { limit: 800 }).catch(() => []) : [];
  const folders = new Set((state?.items || []).filter(i => i.mimeType === FOLDER && dest && (i.id === dest.id || String(i.path || '').startsWith(dest.path + '/'))).map(i => i.id));
  const found = (changed || []).filter(f => f.mimeType !== FOLDER && !known.has(f.id) && TDR_LIKE.test(f.name || '') && (f.parents || []).some(p => folders.has(p)));
  // The workbooks: values typed by hand are seen (the page reads the workbook itself; here the round
  // only records that it changed, so the agents know).
  let touched = 0;
  for (const o of Object.values(s.opportunities || {})) {
    if (!o.workbook?.id || ['stop', 'failed'].includes(o.status)) continue;
    const meta = await drive.getMeta(o.workbook.id).catch(() => null);
    if (meta?.modifiedTime && meta.modifiedTime !== o.workbook.seen_modified) { touched++; o.workbook.seen_modified = meta.modifiedTime; o.workbook.changed_at = meta.modifiedTime; }
  }
  await update(d, st => {
    st.round_at = startedAt;
    st.signals = [...(st.signals || []), ...found.map(f => ({ file_id: f.id, name: f.name, url: f.webViewLink || null, at: startedAt, by: f.lastModifyingUser?.displayName || null, done: false }))].slice(-200);
    for (const o of Object.values(s.opportunities || {})) if (st.opportunities?.[o.id] && o.workbook) st.opportunities[o.id].workbook = { ...st.opportunities[o.id].workbook, seen_modified: o.workbook.seen_modified, changed_at: o.workbook.changed_at };
    return st;
  });
  return { new_tdr: found.length, workbooks_changed: touched };
}

export async function dismissSignal(orgId, body = {}, d = {}) {
  await update(d, st => { for (const x of st.signals || []) if (x.file_id === body.file_id) x.done = true; return st; });
  return { done: true };
}

export function validOpportunityId(id) { return ID.test(String(id || '')); }
