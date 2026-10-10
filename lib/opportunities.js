// OPPORTUNITIES — Firm Manager, then Mission Controller (Paul, 2026-10-10).
// « Quelqu'un ouvre l'application, il a une page où il met un TDR. Firm Manager le lit, il le range
//   là où on range les TDR, il crée le document, et on enclenche le travail. » Then « quand la lettre
//   de confirmation du client arrive, il envoie le message à Mission Controller », who does the KYC
//   and the independence in the SAME file before the mission starts (decision recorded 2026-10-10).
//
// The one record of Phases 0 and 1 is the firm's own workbook (its acceptance template, copied once
// per opportunity) — see lib/acceptance-workbook.js. This module only keeps references and the
// progress (OFFICE_MANAGER_OPPORTUNITIES.json in the agents' memory): ids, links, stage, the agents'
// work, who answered what.
//
// Man + machine (Paul, 2026-10-11: « il remplit tout ce qu'il peut trouver ; l'humain seulement là où on
// a besoin de lui ») — what the agents back with a SOURCE (the TDR, the firm's missions and people, a
// public page) is WRITTEN in the workbook straight away, into EMPTY cells only (never over a person's
// answer), the row signed « Préparé par : Firm Manager (IA) » / « Mission Controller (IA) » with the
// date; an unsourced answer stays a proposal; what only a person knows stays a question. Never written
// by an agent: decisions, manager ratings, independence, « revu par ». A person then reads a whole
// section and clicks « J'ai relu » — their name and the date go into the « Revu par » cells.
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
const signoffRow = r => /Section pr[ée]par[ée]e par/i.test(r.label || '');

// ---- Man + machine: the agents write what they can source; people review a section at once ----

export const AGENT_LABEL = { 'firm-manager': 'Firm Manager (IA)', 'mission-controller': 'Mission Controller (IA)' };
const blank = v => v == null || String(v).trim() === '';

// The writes an agent may make from its proposals: sourced, not a question, into empty cells only; the
// row's own « Préparé par » / « Date » columns, the section's sign-off row (preparer, date) and the
// sheet's header (« Préparé par », « Date de préparation », « Statut ») are filled the same way.
// `current` holds the workbook's values ('SHEET!CELL' → value). Returns the writes and the rows filled.
export function agentWrites(structure, proposals, current, agent, extra = []) {
  const label = AGENT_LABEL[agent] || agent;
  const writes = [], filled = {}, touched = new Map();
  const add = (sheet, cell, value) => {
    if (blank(value) || !blank(current[sheet + '!' + cell]) || writes.some(w => w.sheet === sheet && w.cell === cell)) return false;
    try { writes.push(...validateWrites(structure, [{ sheet, cell, value }])); return true; } catch { return false; }
  };
  const rowOf = (sheetName, n) => { const s = structure.sheets.find(x => x.name === sheetName); return s && { s, r: s.rows.find(x => x.row === Number(n)) }; };
  const fillRow = (s, r, values, why, sources) => {
    if (!r || rowAuthority(r) !== 'team' || identityRow(r) || /IND[ÉE]PENDANCE/i.test(r.section || '')) return;
    const cells = Object.entries(values || {}).filter(([cell, v]) => r.fields.some(f => f.cell === cell && !identityField(f)) && add(s.name, cell, v)).map(([cell]) => cell);
    if (!cells.length) return;
    const prep = r.fields.find(f => /Pr[ée]par[ée] par/i.test(f.header || '')), date = r.fields.find(f => /^Date$/i.test(f.header || ''));
    if (prep) add(s.name, prep.cell, label);
    if (date) add(s.name, date.cell, today());
    filled[s.name + '!' + r.row] = { agent, cells, why: cut(why, 800), sources: (sources || []).slice(0, 6), at: now() };
    if (!touched.has(s.name)) touched.set(s.name, new Set());
    touched.get(s.name).add(r.section || '');
  };
  for (const [key, p] of Object.entries(proposals || {})) {
    if (p.for_team || !(p.sources || []).some(x => !blank(x))) continue;
    const [sheetName, n] = key.split('!');
    const x = rowOf(sheetName, n);
    if (x) fillRow(x.s, x.r, p.values, p.why, p.sources);
  }
  for (const e of extra) { const x = rowOf(e.sheet, e.row); if (x) fillRow(x.s, x.r, e.values, e.why, e.sources || ['agent']); }
  for (const [sheetName, sections] of touched) {
    const s = structure.sheets.find(x => x.name === sheetName);
    for (const r of s.rows) {
      if (signoffRow(r) && sections.has(r.section || '')) { if (r.fields[0]) add(s.name, r.fields[0].cell, label); if (r.fields[1]) add(s.name, r.fields[1].cell, today()); }
      if (/^Pr[ée]par[ée] par$/i.test(r.label || '') && r.fields[0]) add(s.name, r.fields[0].cell, label);
      if (/^Date de pr[ée]paration$/i.test(r.label || '') && r.fields[0]) add(s.name, r.fields[0].cell, today());
      if (/^Statut de l.onglet$/i.test(r.label || '') && r.fields[0]) add(s.name, r.fields[0].cell, 'EN COURS');
    }
  }
  return { writes, filled };
}

// What Office Manager itself KNOWS (no AI needed): the opportunity is registered here (this is the
// firm's register of prospects), when and how it arrived, what the TDR asks, the conflict search done in
// the firm's missions, the fiche filled, the file handed to the Associé through the page. Rows found by
// their own title in the workbook; values checked against each cell's list.
export function officeFacts(structure, o) {
  const out = [];
  const ref = 'OM-' + String(o.id || '').slice(0, 8).toUpperCase();
  const src = ['Office Manager'];
  const rowBy = (sheet, re) => sheet.rows.find(r => re.test(String(r.label || '').split(' — ')[0]));
  const proc = (sheet, re, result, yes, link) => {
    const r = rowBy(sheet, re); if (!r) return;
    const values = {};
    for (const f of r.fields) {
      if (/R[ée]sultat/i.test(f.header || '') && result) values[f.cell] = result;
      else if (f.options?.includes('Oui') && yes) values[f.cell] = yes;
      else if (/Preuve|lien/i.test(f.header || '') && link) values[f.cell] = link;
    }
    if (Object.keys(values).length) out.push({ sheet: sheet.name, row: r.row, values, why: 'fait connu d’Office Manager', sources: src });
  };
  const fiche = structure.sheets[0];
  const one = (re, value) => { const r = rowBy(fiche, re); if (r?.fields[0] && value) out.push({ sheet: fiche.name, row: r.row, values: { [r.fields[0].cell]: value }, why: 'fait connu d’Office Manager', sources: src }); };
  one(/R[ée]f[ée]rence dans le registre des prospects/i, ref);
  one(/^Collaborateur ayant re[çc]u/i, o.created_by && o.created_by !== 'Firm Manager' ? o.created_by : null);
  one(/^Personne charg[ée]e des opportunit/i, AGENT_LABEL['firm-manager'] + (o.created_by && o.created_by !== 'Firm Manager' ? ' pour ' + o.created_by : ''));
  if (/AO|appel/i.test(o.kind || '')) one(/^Origine de l.opportunit/i, /priv/i.test(o.summary || '') ? 'Appel d\'offres privé' : 'Appel d\'offres public');
  const p0 = structure.sheets.find(s => sheetOwner(s) === 'firm-manager' && s !== fiche);
  if (p0) {
    const tdr = (o.tdr_files || [])[0];
    proc(p0, /^Enregistrer le prospect/i, 'Enregistré dans Office Manager (registre des opportunités) le ' + String(o.created_at || now()).slice(0, 10) + ', référence ' + ref, 'Oui', o.folder?.url);
    proc(p0, /^Documenter la date, l.origine/i, 'Reçu le ' + String(o.created_at || now()).slice(0, 10) + ' (' + (o.source || 'dépôt') + (o.created_by ? ', par ' + o.created_by : '') + '). Besoin : ' + cut(o.summary, 600), 'Oui', tdr?.url);
    if (o.conflicts) proc(p0, /v[ée]rification pr[ée]liminaire de conflit/i, 'Recherche dans les ' + (o.conflicts.searched || 'missions du cabinet') + ' sur « ' + (o.conflicts.terms || []).join(' ') + ' » : ' + (o.conflicts.matches?.length ? o.conflicts.matches.map(m => m.mission + ' (' + m.status + ')').join(' ; ') : 'aucune correspondance'), 'Oui');
    if (o.fiche_written?.verified) proc(p0, /^Compl[ée]ter les informations du prospect/i, 'Onglet 01 rempli par le Firm Manager (' + o.fiche_written.verified + ' champ(s) vérifiés) ; profil public complété depuis la recherche', 'Oui', o.workbook?.url);
    proc(p0, /^Transmettre le dossier/i, 'Transmis à l’Associé dans Office Manager le ' + today() + ' (décision demandée sur la page de l’opportunité)', 'Oui', o.workbook?.url);
    if (o.phase0_conclusion?.proposed) proc(p0, /^Documenter la conclusion de Phase 0/i, 'Conclusion proposée par le Firm Manager : ' + o.phase0_conclusion.proposed, 'Oui');
  }
  return out;
}

// Read the cells, write the agent's part, read back; the rows it filled are remembered (with their
// sources) for the page and for the reviewer.
async function writeAgentPart(o, structure, proposals, agent, d, extra = []) {
  const drive = d.drive || driveAdapter;
  const cells = structure.sheets.flatMap(s => s.rows.flatMap(r => r.fields.map(f => ({ sheet: s.name, cell: f.cell }))));
  const current = await readDriveCopy(drive, o.workbook.id, cells, { mimeType: o.workbook.mimeType });
  const { writes, filled } = agentWrites(structure, proposals, current, agent, extra);
  if (!writes.length) return { rows: 0, cells: 0, verified: 0 };
  await writeToDriveCopy(drive, o.workbook.id, writes, { mimeType: o.workbook.mimeType });
  const back = await readDriveCopy(drive, o.workbook.id, writes, { mimeType: o.workbook.mimeType }).catch(() => ({}));
  const verified = writes.filter(w => !blank(back[w.sheet + '!' + w.cell])).length;
  for (const k of Object.keys(filled)) filled[k].verified = filled[k].cells.every(c => !blank(back[k.split('!')[0] + '!' + c]));
  o.ai_filled = { ...(o.ai_filled || {}), ...filled };
  return { rows: Object.keys(filled).length, cells: writes.length, verified };
}

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
  if (o.status === 'go') return o.team?.status === 'validated' ? 'Poursuivre : équipe validée, en attente de la réponse du client' : 'Poursuivre : équipe à proposer et à valider';
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
Pour chaque procédure que tu peux documenter avec des FAITS, donne les valeurs des champs (résultat factuel, réponse Oui / Non / N-A, preuve ou source, commentaire) et dis pourquoi. Remplis TOUT ce que les faits fournis permettent : c'est toi qui fais le travail, l'équipe ne fait que relire. Ce que tu donnes avec une source est écrit directement dans le classeur : chaque ligne porte ses "sources" (« TDR », « missions du cabinet », « équipe du cabinet » ou l'adresse web) ; sans source, elle reste une simple proposition.
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
      // Written straight into the workbook: what is sourced, and the preparer's proposed conclusion.
      const extra = [];
      if (o.phase0_conclusion?.proposed) {
        for (const s of p0) {
          const c = s.rows.find(r => /^Conclusion propos[ée]e par le pr[ée]parateur/i.test(r.label || ''));
          if (!c?.fields[0]) continue;
          const m = s.rows.find(r => r.section === c.section && /^Motif/i.test(r.label || ''));
          extra.push({ sheet: s.name, row: c.row, values: { [c.fields[0].cell]: o.phase0_conclusion.proposed }, why: o.phase0_conclusion.why, sources: ['Phase 0 du Firm Manager'] });
          if (m?.fields[0]) extra.push({ sheet: s.name, row: m.row, values: { [m.fields[0].cell]: o.phase0_conclusion.why }, why: 'motif de la conclusion proposée', sources: ['Phase 0 du Firm Manager'] });
        }
      }
      extra.push(...officeFacts(structure, o));
      const w = await writeAgentPart(o, structure, o.proposals, 'firm-manager', d, extra);
      const asks = Object.values(o.proposals).filter(p => p.for_team).length;
      say('Phase 0 préparée et écrite dans le classeur : ' + w.rows + ' ligne(s) remplie(s) par le Firm Manager (' + w.verified + '/' + w.cells + ' cellules vérifiées), ' + (Object.keys(o.proposals).length - asks - w.rows > 0 ? (Object.keys(o.proposals).length - asks - w.rows) + ' proposition(s) sans source à confirmer, ' : '') + asks + ' question(s) pour l’équipe, ' + (o.research.web ? (o.research.sources || []).length + ' source(s) publique(s)' : 'sans recherche web') + '. À relire, puis décision de l’Associé.');
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

// Who may answer which row: the team (1), Managers and Supervisors (2), the Associé (3).
const ROLE_RANK = { collaborator: 1, auditor: 1, senior: 1, secretary: 1, quality_reviewer: 1, manager: 2, supervisor: 2, partner: 3, owner: 4 };
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
  out.viewer = { role, name: account?.display_name || account?.email || null, in_team: Boolean(memberOf(o, account)) };
  out.independence_questions = independenceQuestions(structure);
  const mine = memberOf(o, account);
  out.my_declaration = mine ? (o.declarations || {})[(mine.email || mine.name).toLowerCase()] || null : null;
  return out;
}

export async function answerRow(orgId, body = {}, account = null, d = {}) {
  return answerRows(orgId, { opportunity_id: body.opportunity_id, rows: [{ sheet: body.sheet, row: body.row, values: body.values, from_proposal: body.from_proposal }] }, account, d);
}

// Several rows answered at once (« Enregistrer » once, at the bottom of the workbook): every row is
// checked with the same rules (who may fill it, list values, separation of functions), then ONE write
// and one read-back for all of them.
export async function answerRows(orgId, body = {}, account = null, d = {}) {
  const o = await getOpportunity(String(body.opportunity_id || ''), d);
  if (!o.workbook) throw fail('WORKBOOK_NOT_READY', 409);
  const { structure } = await (d.templateStructure || templateStructure)(d);
  const who = account?.display_name || account?.email;
  const asked = (Array.isArray(body.rows) ? body.rows : []).slice(0, 300);
  if (!asked.length) throw fail('NOTHING_TO_SAVE');
  const drive = d.drive || driveAdapter;
  const plans = [];
  for (const a of asked) {
    const sheet = structure.sheets.find(s => s.name === a.sheet);
    if (!sheet) throw fail('SHEET_NOT_FOUND', 404);
    const owner = sheetOwner(sheet);
    if (owner === 'mission-controller' && !['won', 'phase1'].includes(o.status) && !o.phase1) throw fail('PHASE1_NOT_OPEN', 409);
    const row = sheet.rows.find(r => r.row === Number(a.row));
    if (!row) throw fail('ROW_NOT_FOUND', 404);
    const authority = rowAuthority(row);
    if (!mayFill(authority, account?.role)) throw fail(authority === 'partner' ? 'PARTNER_DECISION_ONLY' : 'MANAGER_ONLY', 403);
    if (!who) throw fail('PERSONAL_SESSION_REQUIRED', 401);
    const writes = Object.entries(a.values || {}).map(([cell, value]) => ({ sheet: sheet.name, cell, value }));
    // Who answered, and when — in the row's own « Préparé par » / « Date » columns.
    const prep = row.fields.find(f => /Pr[ée]par[ée] par/i.test(f.header || '')), date = row.fields.find(f => /^Date$/i.test(f.header || ''));
    if (prep && !writes.some(w => w.cell === prep.cell)) writes.push({ sheet: sheet.name, cell: prep.cell, value: who });
    if (date && !writes.some(w => w.cell === date.cell)) writes.push({ sheet: sheet.name, cell: date.cell, value: today() });
    const valid = validateWrites(structure, writes.filter(w => row.fields.some(f => f.cell === w.cell)));
    const decision = authority === 'partner' && /D[ÉE]CISION/i.test(row.label || '');
    // The Associé's decision carries who decided and when: the rows « Nom de l'Associé » and « Date de
    // la décision » that follow it in the same block are filled with the person signed in, today.
    if (decision && valid.some(w => w.value !== '')) {
      for (const r of sheet.rows.filter(x => x.row > row.row && x.row <= row.row + 6 && x.section === row.section)) {
        const f = r.fields[0];
        if (/^Nom de l.Associ/i.test(r.label || '') && f) valid.push(...validateWrites(structure, [{ sheet: sheet.name, cell: f.cell, value: who }]));
        if (/^Date de la d[ée]cision/i.test(r.label || '') && f) valid.push(...validateWrites(structure, [{ sheet: sheet.name, cell: f.cell, value: today() }]));
      }
    }
    // Separation of functions (the template's own rule): the Associé who decides is never the
    // preparer or the reviewer of the file.
    if (decision) {
      const ids = sheet.rows.filter(identityRow).flatMap(r => r.fields.filter(f => !/date/i.test(r.label || '') && f.type === 'text').map(f => ({ sheet: sheet.name, cell: f.cell })));
      const cur = await readDriveCopy(drive, o.workbook.id, ids, { mimeType: o.workbook.mimeType }).catch(() => ({}));
      if (Object.values(cur).some(v => v && String(v).trim().toLowerCase() === String(who).trim().toLowerCase())) throw fail('SEPARATION_OF_FUNCTIONS', 409);
    }
    plans.push({ sheet, row, owner, authority, valid, from_proposal: Boolean(a.from_proposal) });
  }
  const all = plans.flatMap(p => p.valid);
  await writeToDriveCopy(drive, o.workbook.id, all, { mimeType: o.workbook.mimeType });
  const back = await readDriveCopy(drive, o.workbook.id, all, { mimeType: o.workbook.mimeType }).catch(() => ({}));
  const ok = w => String(back[w.sheet + '!' + w.cell] ?? '') !== '' || w.value === '';
  for (const p of plans) {
    const verified = p.valid.every(ok);
    // A person corrected a row the agents had filled: kept as such (the page shows it).
    if (o.ai_filled?.[p.sheet.name + '!' + p.row.row]) o.ai_filled[p.sheet.name + '!' + p.row.row].corrected = { by: who, at: now() };
    o.answers = [...(o.answers || []), { at: now(), by: who, role: account?.role || null, sheet: p.sheet.name, row: p.row.row, ref: p.row.ref, cells: p.valid.map(w => w.cell), from_proposal: p.from_proposal, verified }].slice(-500);
    // The Associé's Phase 0 decision moves the opportunity on.
    if (p.owner === 'firm-manager' && p.authority === 'partner') {
      const dec = p.valid.find(w => { const f = p.row.fields.find(x => x.cell === w.cell); return f?.options?.length; });
      if (dec && /^POURSUIVRE/i.test(dec.value)) o.status = 'go';
      else if (dec && /^NE PAS/i.test(dec.value)) o.status = 'stop';
    }
  }
  // « Poursuivre » → the Firm Manager proposes the team (specification, phase 2), before any KYC.
  const startTeam = o.status === 'go' && !o.team && Boolean(d.req);
  if (startTeam) o.team = { status: 'proposing', asked_at: now() };
  await saveOpp(o, d);
  if (startTeam) await (d.fire || (await import('./agent-passes.js')).fireInternal)(d.req, '/api/app?route=opportunity-team-step', { opportunity_id: o.id });
  const verified = all.every(ok);
  for (const p of plans) await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: p.owner, action_type: p.authority === 'team' ? 'WORKBOOK_ANSWER' : 'WORKBOOK_DECISION', source_ref: 'opportunity:' + o.id + ':' + p.sheet.name + '!' + p.row.row, output_ref: o.workbook.id, decision: cut(who + ' : ' + p.valid.map(w => w.cell + '=' + w.value).join(' ; '), 400), status: p.valid.every(ok) ? 'done' : 'unverified' }).catch(() => null);
  return { written: all.length, rows: plans.length, verified, status: o.status };
}

// What the opportunities ask of THIS person, for the bell (each person gets their own, on their own
// platform): their independence declaration, the agents' questions nobody answered yet, sections the
// agents filled to read (Managers), the decision (Associés). Computed from the memory, nothing stored.
export async function opportunityTasks(account, d = {}) {
  if (!account) return [];
  const all = Object.values((await loadAll(d)).opportunities || {});
  const role = account.role, rank = ROLE_RANK[role] || 0, out = [];
  const href = (o, h = '') => '/opportunites.html?id=' + encodeURIComponent(o.id) + h;
  for (const o of all) {
    if (['stop', 'failed', 'duplicate', 'running'].includes(o.status)) continue;
    const me = memberOf(o, account);
    if (me && o.team?.status === 'validated' && !(o.declarations || {})[(me.email || me.name).toLowerCase()])
      out.push({ id: 'indep|' + o.id, title: 'Votre déclaration d’indépendance — ' + o.title, meta: 'Quelques questions Oui / Non, pour vous-même', href: href(o, '#h-indep'), at: o.team.validated_at || o.updated_at });
    const answered = new Set((o.answers || []).map(a => a.sheet + '!' + a.row));
    const asks = Object.entries({ ...(o.proposals || {}), ...(o.phase1?.proposals || {}) }).filter(([k, p]) => p.for_team && !answered.has(k)).length;
    const concerned = me || rank >= 2 || (o.created_by && [account.display_name, account.email].includes(o.created_by));
    if (asks && concerned) out.push({ id: 'ask|' + o.id + '|' + asks, title: asks + ' question(s) des agents — ' + o.title, meta: 'Ce qu’ils n’ont pas pu trouver eux-mêmes', href: href(o), at: o.updated_at });
    if (rank >= 2) {
      const read = new Set(Object.entries(o.reviews || {}).flatMap(([k, r]) => (r.rows || []).map(n => k.split('|')[0] + '!' + n)));
      const toRead = Object.keys(o.ai_filled || {}).filter(k => !read.has(k)).length;
      if (toRead) out.push({ id: 'read|' + o.id, title: 'À relire : ' + toRead + ' ligne(s) remplie(s) par les agents — ' + o.title, meta: 'Une relecture par section, en un clic', href: href(o), at: o.updated_at });
    }
    if (rank >= 3 && o.status === 'phase0') out.push({ id: 'dec|' + o.id, title: 'Décision « poursuivre » attendue — ' + o.title, meta: 'Phase 0 préparée', href: href(o), at: o.updated_at });
  }
  return out.slice(0, 20);
}

// The questions that pop up for THIS person on any page of the application (Paul, 2026-10-11: « des
// pop-up, pas des notifications »): answered right there, with buttons — their independence declaration
// (one question at a time, then certify), the agents' questions nobody answered, the Associé's decision.
export async function myQuestions(orgId, account, d = {}) {
  if (!account) return { questions: [] };
  const opps = Object.values((await loadAll(d)).opportunities || {}).filter(o => !['stop', 'failed', 'duplicate', 'running'].includes(o.status) && o.workbook);
  if (!opps.length) return { questions: [] };
  const { structure } = await (d.templateStructure || templateStructure)(d);
  const rank = ROLE_RANK[account.role] || 0, out = [];
  const rowOf = key => { const [sn, n] = key.split('!'); const s = structure.sheets.find(x => x.name === sn); return s && { s, r: s.rows.find(x => x.row === Number(n)) }; };
  const shape = (s, r) => {
    const choice = r.fields.find(f => f.options?.length) || null;
    const note = r.fields.find(f => !f.options?.length && f.type !== 'date' && !/Pr[ée]par[ée] par|Revu|^Date|Lien|Preuve/i.test(f.header || '')) || null;
    return { sheet: s.name, row: r.row, options: choice ? choice.options : null, choice_cell: choice?.cell || null, note_cell: note?.cell || null };
  };
  for (const o of opps) {
    const me = memberOf(o, account);
    if (me && o.team?.status === 'validated' && !(o.declarations || {})[(me.email || me.name).toLowerCase()])
      out.push({ id: 'indep|' + o.id, kind: 'independence', opportunity_id: o.id, title: o.title, questions: independenceQuestions(structure) });
    const answered = new Set((o.answers || []).map(a => a.sheet + '!' + a.row));
    const concerned = me || rank >= 2 || (o.created_by && [account.display_name, account.email].includes(o.created_by));
    for (const [key, p] of Object.entries({ ...(o.proposals || {}), ...(o.phase1?.proposals || {}) })) {
      if (!p.for_team || answered.has(key) || !concerned) continue;
      const x = rowOf(key); if (!x?.r || !mayFill(rowAuthority(x.r), account.role)) continue;
      if (sheetOwner(x.s) === 'mission-controller' && !o.phase1) continue;
      out.push({ id: 'ask|' + o.id + '|' + key, kind: 'question', opportunity_id: o.id, title: o.title, question: p.question || String(x.r.label || '').split(' — ')[0], ...shape(x.s, x.r) });
    }
    if (rank >= 3 && o.status === 'phase0') {
      const p0 = structure.sheets.filter(s => sheetOwner(s) === 'firm-manager');
      const r = p0.flatMap(s => s.rows.map(r => ({ s, r }))).find(x => rowAuthority(x.r) === 'partner' && /D[ÉE]CISION/i.test(x.r.label || '') && x.r.fields.some(f => f.options?.length));
      if (r) out.push({ id: 'dec|' + o.id, kind: 'decision', opportunity_id: o.id, title: o.title, question: 'Poursuivre cette opportunité ?',
        context: [o.summary && cut(o.summary, 300), o.phase0_conclusion?.proposed && 'Le Firm Manager propose : ' + o.phase0_conclusion.proposed + (o.phase0_conclusion.why ? ' — ' + cut(o.phase0_conclusion.why, 300) : '')].filter(Boolean).join('\n'), ...shape(r.s, r.r) });
    }
  }
  return { questions: out.slice(0, 15) };
}

// Prepare Phase 0 again (an opportunity read before the agents wrote in the workbook, or new facts):
// the Firm Manager does its research again and writes what it can source — into empty cells only.
export async function prepareAgain(orgId, req, body = {}, account = null, d = {}) {
  const o = await getOpportunity(String(body.opportunity_id || ''), d);
  if (!mayFill('manager', account?.role)) throw fail('MANAGER_ONLY', 403);
  if (o.status !== 'phase0' || !o.workbook) throw fail('NOT_IN_PHASE0', 409);
  o.status = 'running'; o.stage = 'prepare';
  o.log = [...(o.log || []), { at: now(), m: 'Phase 0 à refaire, demandé par ' + (account?.display_name || account?.email || '?') + ' : le Firm Manager remplit ce qu’il trouve (cases vides seulement).' }].slice(-80);
  await saveOpp(o, d);
  await (d.fire || (await import('./agent-passes.js')).fireInternal)(req, '/api/app?route=opportunity-step', { opportunity_id: o.id });
  return { status: 'running' };
}

// « J'ai relu cette section »: a Manager (or above) reads what the agents wrote in one section and signs
// the review once — their name and the date go into the « Revu par » / « Date de revue » cells of the
// rows the agents filled, of the section's sign-off row, and of the sheet's header when every section
// the agents filled in that sheet has been reviewed. Corrections are made row by row before (answerRow).
export async function reviewSection(orgId, body = {}, account = null, d = {}) {
  const o = await getOpportunity(String(body.opportunity_id || ''), d);
  if (!o.workbook) throw fail('WORKBOOK_NOT_READY', 409);
  const who = account?.display_name || account?.email;
  if (!who) throw fail('PERSONAL_SESSION_REQUIRED', 401);
  if (!mayFill('manager', account?.role)) throw fail('MANAGER_ONLY', 403);
  const { structure } = await (d.templateStructure || templateStructure)(d);
  const sheet = structure.sheets.find(s => s.name === body.sheet);
  if (!sheet) throw fail('SHEET_NOT_FOUND', 404);
  const section = String(body.section ?? '');
  const rows = sheet.rows.filter(r => (r.section || '') === section);
  const mine = rows.filter(r => (o.ai_filled || {})[sheet.name + '!' + r.row]);
  if (!mine.length) throw fail('NOTHING_TO_REVIEW', 409);
  const drive = d.drive || driveAdapter;
  const writes = [];
  const add = (cell, value) => { try { writes.push(...validateWrites(structure, [{ sheet: sheet.name, cell, value }])); } catch { /* not writable */ } };
  for (const r of mine) {
    const rev = r.fields.find(f => /^Revu[e]? par/i.test(f.header || '')), rd = r.fields.find(f => /^Date de revue/i.test(f.header || ''));
    if (rev) add(rev.cell, who);
    if (rd) add(rd.cell, today());
  }
  const so = rows.find(signoffRow);
  if (so) { if (so.fields[2]) add(so.fields[2].cell, who); if (so.fields[3]) add(so.fields[3].cell, today()); }
  const key = sheet.name + '|' + section;
  const reviews = { ...(o.reviews || {}), [key]: { by: who, role: account?.role || null, at: now(), rows: mine.map(r => r.row) } };
  const sections = new Set(Object.keys(o.ai_filled || {}).filter(k => k.startsWith(sheet.name + '!')).map(k => sheet.rows.find(r => r.row === Number(k.split('!')[1]))?.section || ''));
  if ([...sections].every(s => reviews[sheet.name + '|' + s])) {
    for (const r of sheet.rows) {
      if (/^Revu par$/i.test(r.label || '') && r.fields[0]) add(r.fields[0].cell, who);
      if (/^Date de revue$/i.test(r.label || '') && r.fields[0]) add(r.fields[0].cell, today());
      if (/^Statut de l.onglet$/i.test(r.label || '') && r.fields[0]) add(r.fields[0].cell, 'REVU');
    }
  }
  if (writes.length) await writeToDriveCopy(drive, o.workbook.id, writes, { mimeType: o.workbook.mimeType });
  const back = writes.length ? await readDriveCopy(drive, o.workbook.id, writes, { mimeType: o.workbook.mimeType }).catch(() => ({})) : {};
  const verified = writes.every(w => !blank(back[w.sheet + '!' + w.cell]));
  o.reviews = reviews; o.reviews[key].verified = verified;
  o.log = [...(o.log || []), { at: now(), m: who + ' a relu « ' + (section || sheet.title || sheet.name) + ' » (' + mine.length + ' ligne(s) remplie(s) par les agents).' }].slice(-80);
  await saveOpp(o, d);
  await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: sheetOwner(sheet), action_type: 'WORKBOOK_SECTION_REVIEWED', source_ref: 'opportunity:' + o.id + ':' + key, output_ref: o.workbook.id, decision: cut(who + ' a relu ' + mine.length + ' ligne(s)', 400), status: verified ? 'done' : 'unverified' }).catch(() => null);
  return { reviewed: mine.length, written: writes.length, verified };
}

// ---- Phase 2: the team (Firm Manager proposes, a manager or the Associé validates) ----
// Specification §10 phase 2: qualifications, CVs, past engagements, sector, skills, load, availability;
// each recommendation explained; human management validates or modifies the team. Then each proposed
// member answers the independence questions (phase 3) — before the KYC is closed and the letter sent.

const TEAM = `Tu es le Firm Manager d'un cabinet d'audit. Propose l'ÉQUIPE de cette opportunité (associé, manager, superviseur si utile, senior, auditeurs, spécialistes).
On te donne ce que dit le document (TDR / AMI : exigences, experts clés, langues, secteur, calendrier) et les personnes du cabinet (titre, compétences, certifications, secteurs, langues, missions passées, charge actuelle).
Règles : uniquement des personnes de la liste ; compétences et disponibilité d'abord ; chaque choix expliqué (expérience, compétences, charge, disponibilité) ; une proposition qu'une personne valide ; si une exigence n'est couverte par personne, dis-le (manque) au lieu de forcer quelqu'un.
JSON STRICT : {"team":[{"name":"","email":"","role":"Associé|Manager|Superviseur|Senior|Auditeur|Spécialiste","why":"","load_pct":null,"covers":[""]}],"gaps":[{"requirement":"","why":""}],"alternatives":[{"name":"","role":"","why":""}],"notes":""}`;

export async function teamStep(orgId, req, body = {}, d = {}) {
  const o = await getOpportunity(String(body.opportunity_id || ''), d);
  if (o.team?.status !== 'proposing') return o;
  try {
    const cap = await (d.capabilityContext || (async (...a) => (await import('./capabilities.js')).capabilityContext(...a)))(orgId, d).catch(() => ({ people: [] }));
    const people = (cap.people || []).filter(p => p.kind === 'employee').slice(0, 120).map(p => ({ name: p.full_name, email: p.email || null, title: p.title, grade: p.grade, years: p.years_experience, specialist: p.specialist_skills, technical: (p.technical_skills || []).slice(0, 20),
      certifications: p.certifications, industries: p.industries, languages: p.languages, past: (p.previous_engagements || []).slice(0, 6), load_pct: p.load_pct }));
    if (!people.length) throw fail('NO_TEAM_DATA', 409);
    const r = await (d.ai || firstAvailable)(ORDER, { instructions: TEAM, input: 'OPPORTUNITÉ : ' + JSON.stringify({ client: o.client, reference: o.reference, kind: o.kind, summary: o.summary, deadline: o.deadline, fiche: o.fiche_values }).slice(0, 15000) +
      '\n\nPERSONNES DU CABINET : ' + JSON.stringify(people).slice(0, 60000), maxTokens: 5000 });
    const x = parseJsonLoose(r.text) || {};
    const known = new Map(people.map(p => [String(p.name).toLowerCase(), p]));
    o.team = { status: 'proposed', proposed_at: now(), by: r.provider,
      proposed: (x.team || []).filter(m => known.has(String(m.name || '').toLowerCase())).slice(0, 15).map(m => ({ name: cut(m.name, 120), email: known.get(String(m.name).toLowerCase()).email || cut(m.email, 254) || null, role: cut(m.role, 30), why: cut(m.why, 600), load_pct: known.get(String(m.name).toLowerCase()).load_pct ?? null, covers: (m.covers || []).slice(0, 8).map(c => cut(c, 120)) })),
      gaps: (x.gaps || []).slice(0, 10).map(g => ({ requirement: cut(g.requirement, 200), why: cut(g.why, 300) })), alternatives: (x.alternatives || []).slice(0, 8).map(a => ({ name: cut(a.name, 120), role: cut(a.role, 30), why: cut(a.why, 300) })), notes: cut(x.notes, 800) };
    o.log = [...(o.log || []), { at: now(), m: 'Firm Manager : équipe proposée (' + o.team.proposed.length + ' personne(s)' + (o.team.gaps.length ? ', ' + o.team.gaps.length + ' manque(s)' : '') + ') — à valider par un manager ou l’Associé.' }];
  } catch (e) { o.team = { status: 'failed', error: cut(e.message || e, 300) }; }
  await saveOpp(o, d);
  return o;
}

export async function proposeTeam(orgId, req, body = {}, d = {}) {
  const o = await getOpportunity(String(body.opportunity_id || ''), d);
  if (o.team?.status === 'validated' && !body.force) throw fail('TEAM_ALREADY_VALIDATED', 409);
  o.team = { ...(o.team || {}), status: 'proposing', asked_at: now() };
  await saveOpp(o, d);
  await (d.fire || (await import('./agent-passes.js')).fireInternal)(req, '/api/app?route=opportunity-team-step', { opportunity_id: o.id });
  return { status: 'proposing' };
}

// A manager or the Associé validates (or changes) the team; the names go into the workbook's sheet.
export async function validateTeam(orgId, body = {}, account = null, d = {}) {
  if ((ROLE_RANK[account?.role] || 0) < 2) throw fail('MANAGER_ONLY', 403);
  const o = await getOpportunity(String(body.opportunity_id || ''), d);
  const members = (Array.isArray(body.members) ? body.members : []).filter(m => String(m.name || '').trim()).slice(0, 20)
    .map(m => ({ name: cut(String(m.name).trim(), 120), email: cut(String(m.email || '').trim().toLowerCase(), 254) || null, role: cut(m.role, 30) || 'Auditeur' }));
  if (!members.length) throw fail('TEAM_REQUIRED');
  const who = account?.display_name || account?.email || null;
  o.team = { ...(o.team || {}), status: 'validated', members, validated_by: who, validated_at: now() };
  if (o.workbook) {
    const { structure } = await (d.templateStructure || templateStructure)(d);
    const fiche = structure.sheets[0];
    const first = re => members.find(m => re.test(m.role || ''));
    const writes = [];
    for (const [re, roleRe] of [[/Associ[ée] responsable/i, /Associ/i], [/Manager pressenti/i, /Manager/i], [/Senior pressenti/i, /Senior/i]]) {
      const row = fiche.rows.find(r => re.test(r.label || '')); const m = first(roleRe);
      if (row && m) writes.push({ sheet: fiche.name, cell: row.fields[0].cell, value: m.name });
    }
    const valid = []; for (const w of writes) { try { valid.push(...validateWrites(structure, [w])); } catch { /* not an input cell */ } }
    if (valid.length) await writeToDriveCopy(d.drive || driveAdapter, o.workbook.id, valid, { mimeType: o.workbook.mimeType });
  }
  o.log = [...(o.log || []), { at: now(), m: 'Équipe validée par ' + (who || '?') + ' : ' + members.map(m => m.name + ' (' + m.role + ')').join(', ') + '. Chaque membre doit faire sa déclaration d’indépendance.' }];
  await saveOpp(o, d);
  await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: 'firm-manager', action_type: 'TEAM_VALIDATED', source_ref: 'opportunity:' + o.id, decision: cut('Équipe validée par ' + who + ' : ' + members.map(m => m.name).join(', '), 400), status: 'done' }).catch(() => null);
  return { status: 'validated', members };
}

// ---- Phase 3: each team member's own independence declaration (the threats of the firm's sheet) ----
const sameEmail = (a, b) => a && b && String(a).toLowerCase() === String(b).toLowerCase();
const sameName2 = (a, b) => String(a || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() === String(b || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function memberOf(o, account) {
  return (o.team?.members || []).find(m => sameEmail(m.email, account?.email) || sameName2(m.name, account?.display_name)) || null;
}

// The questions: the independence threats listed in the firm's own workbook (section « INDÉPENDANCE »).
export function independenceQuestions(structure) {
  const rows = structure.sheets.flatMap(s => s.rows.filter(r => /IND[ÉE]PENDANCE/i.test(r.section || '') && r.ref).map(r => ({ ref: r.ref, label: String(r.label || '').split(' — ')[0] })));
  return rows.length ? rows : [{ ref: 'IND', label: 'Existe-t-il un lien, un intérêt ou une situation qui menace votre indépendance vis-à-vis de ce client ?' }];
}

export async function declareIndependence(orgId, body = {}, account = null, d = {}) {
  const o = await getOpportunity(String(body.opportunity_id || ''), d);
  if (o.team?.status !== 'validated') throw fail('TEAM_NOT_VALIDATED', 409);
  const member = memberOf(o, account);
  if (!member) throw fail('NOT_IN_TEAM', 403);
  if (body.certify !== true) throw fail('CERTIFICATION_REQUIRED');
  const { structure } = await (d.templateStructure || templateStructure)(d);
  const qs = independenceQuestions(structure);
  const answers = {};
  for (const q of qs) {
    const a = String(body.answers?.[q.ref] || '');
    if (!/^(Oui|Non)$/.test(a)) throw fail('ANSWER_ALL_QUESTIONS');
    answers[q.ref] = { answer: a, detail: cut(body.details?.[q.ref], 600) || null };
  }
  const threats = qs.filter(q => answers[q.ref].answer === 'Oui').map(q => q.ref + ' ' + q.label);
  const key = (member.email || member.name).toLowerCase();
  o.declarations = { ...(o.declarations || {}), [key]: { name: member.name, role: member.role, by: account?.display_name || account?.email, at: now(), answers, threats } };
  o.log = [...(o.log || []), { at: now(), m: 'Déclaration d’indépendance de ' + member.name + (threats.length ? ' — ' + threats.length + ' situation(s) déclarée(s), à examiner par le Manager et l’Associé' : ' — aucune menace déclarée') + '.' }];
  // All members declared → the workbook's « déclarations individuelles » line is answered (with who and
  // when in the comment cell when there is one). A declared threat stays for the Manager in section C.
  const all = (o.team.members || []).every(m => o.declarations[(m.email || m.name).toLowerCase()]);
  if (all && o.workbook) {
    const row = structure.sheets.flatMap(s => s.rows.map(r => ({ s, r }))).find(x => /D[ée]clarations? d.ind[ée]pendance individuelles/i.test(x.r.label || ''));
    if (row) {
      const writes = [];
      const yn = row.r.fields.find(f => f.options?.includes('Oui')); if (yn) writes.push({ sheet: row.s.name, cell: yn.cell, value: 'Oui' });
      const txt = row.r.fields.find(f => f.type === 'text'); if (txt) writes.push({ sheet: row.s.name, cell: txt.cell, value: 'Déclarations faites dans Office Manager le ' + today() + ' par ' + o.team.members.map(m => m.name).join(', ') });
      try { await writeToDriveCopy(d.drive || driveAdapter, o.workbook.id, validateWrites(structure, writes), { mimeType: o.workbook.mimeType }); } catch { /* written by hand then */ }
    }
  }
  await saveOpp(o, d);
  await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: 'mission-controller', action_type: 'INDEPENDENCE_DECLARED', source_ref: 'opportunity:' + o.id, decision: cut(member.name + ' : ' + (threats.length ? 'menace(s) déclarée(s) : ' + threats.join(' ; ') : 'aucune menace'), 400), status: 'done' }).catch(() => null);
  return { declared: true, threats, all_declared: all };
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
  // …and starts its checks at once (nobody has to click): registers, sanctions, press, conflicts.
  const after = await getOpportunity(o.id, d).catch(() => null);
  const kyc = after?.phase1?.status === 'todo' && req ? await prepareKyc(orgId, req, { opportunity_id: o.id }, account, d).catch(e => ({ error: cut(e.message || e, 200) })) : null;
  return { status: after?.status || o.status, letter, event: ev, mission_controller: handled, kyc };
}

// Mission Controller's handler for OPPORTUNITY_WON: its to-do « faire le KYC et l'indépendance ».
export async function onOpportunityWon(orgId, ev, d = {}) {
  const o = await getOpportunity(ev.object_id, d).catch(() => null);
  if (!o) return { ignore: 'opportunité inconnue' };
  if (o.phase1) return 'déjà pris en charge';
  o.phase1 = { opened_at: now(), todo: 'Faire le KYC et l’indépendance (Phase 1 du classeur) avant le début de la mission' + (o.team?.status === 'validated' ? ' ; déclarations d’indépendance : ' + (o.team.members || []).filter(m => !(o.declarations || {})[(m.email || m.name).toLowerCase()]).length + ' membre(s) de l’équipe à attendre' : ' ; l’équipe n’est pas encore validée'), proposals: {}, status: 'todo' };
  o.status = 'phase1';
  o.log = [...(o.log || []), { at: now(), m: 'Mission Controller : à faire — KYC et indépendance dans le classeur « ' + (o.workbook?.name || '') + ' ».' }];
  await saveOpp(o, d);
  return 'KYC et indépendance à faire pour « ' + o.title + ' »';
}

const PREPARE_P1 = `Tu es le Mission Controller d'un cabinet d'audit. Tu PRÉPARES la Phase 1 (acceptation : documents, KYC / AML, conflits, auditeur précédent, intégrité de la direction, compétences) dans le classeur du cabinet.
On te donne : chaque ligne (référence, contrôle, section) et ses champs (cellule | en-tête | valeurs permises), la fiche de l'opportunité, la recherche de conflits dans les missions du cabinet, les capacités et la charge de l'équipe, et des VÉRIFICATIONS PUBLIQUES (sanctions, personnes politiquement exposées, registre du commerce, litiges, presse) avec leurs sources.
Pour chaque contrôle que des FAITS sourcés permettent de documenter, donne : le résultat factuel, la personne ou l'entité concernée, la source / le lien, le red flag Oui/Non (Oui seulement sur un fait négatif sourcé), un commentaire. Sépare toujours le fait (sourcé) de l'appréciation.
Remplis TOUT ce que les faits fournis permettent — c'est toi qui fais le travail, l'équipe relit : documents requis (Requis Oui/Non selon la nature de l'entité et du service ; Reçu Oui seulement si le document est dans le dossier ; la fiche de l'onglet 01 est faite : lien du classeur), identité et KYC depuis les registres et la presse, conflits depuis les missions du cabinet, auditeur précédent s'il est public, intégrité de la direction, compétences et ressources depuis l'équipe du cabinet. Chaque ligne porte ses "sources" (adresse web, « TDR », « missions du cabinet », « équipe du cabinet ») : avec une source, elle est écrite directement dans le classeur ; sans source, elle reste une proposition. Ce que seul le client ou une personne du cabinet peut fournir (document à demander au client, contact de l'auditeur précédent) : "for_team": true avec la question.
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
    const r = await ai(ORDER, { instructions: PREPARE_P1, input: 'FICHE : ' + JSON.stringify({ client: o.client, reference: o.reference, summary: o.summary, values: o.fiche_values, workbook: o.workbook?.url || null, folder: o.folder?.url || null, tdr: (o.tdr_files || []).map(f => f.name), confirmation_letter: o.won?.letter?.name || null, team: o.team?.status === 'validated' ? o.team.members : null }).slice(0, 12000) +
      '\n\nLIGNES : ' + JSON.stringify(rows).slice(0, 45000) + '\n\nCONFLITS (missions du cabinet) : ' + JSON.stringify(facts).slice(0, 5000) + '\n\nÉQUIPE : ' + JSON.stringify(team).slice(0, 15000) +
      '\n\nVÉRIFICATIONS PUBLIQUES : ' + (o.phase1.research.web ? o.phase1.research.text.slice(0, 25000) + '\nSOURCES : ' + JSON.stringify(o.phase1.research.sources).slice(0, 5000) : '(indisponibles : ' + (o.phase1.research.error || 'aucune clé') + ')'), maxTokens: 12000 });
    o.phase1.proposals = keepProposals(structure, (parseJsonLoose(r.text) || {}).rows, ['mission-controller']);
    const w = await writeAgentPart(o, structure, o.phase1.proposals, 'mission-controller', d);
    const asks = Object.values(o.phase1.proposals).filter(p => p.for_team).length;
    o.phase1.status = 'ready'; o.phase1.prepared_at = now(); o.phase1.prepared_by = r.provider; o.phase1.written = w;
    o.log = [...(o.log || []), { at: now(), m: 'Mission Controller : Phase 1 préparée et écrite dans le classeur — ' + w.rows + ' ligne(s) remplie(s) (' + w.verified + '/' + w.cells + ' cellules vérifiées), ' + asks + ' question(s) pour l’équipe, ' + (o.phase1.research.web ? o.phase1.research.sources.length + ' source(s)' : 'sans vérification web') + '. Indépendance : chaque personne ; cotation : le Manager ; décision : l’Associé.' }];
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
