// ENTRAÎNEMENT DES AGENTS (Paul, 2026-10-26 : « je veux juste permettre d'entraîner les agents afin qu'on puisse comprendre » ; « la
// personne y mettra de vraies missions, fera et expliquera à l'agent » ; « elle n'a pas besoin de l'application » ; « entraîner chaque
// process : création de missions, tests d'audit, revue, jusqu'à la fin »).
//
// Un outil À PART de l'application, ouvert par un lien personnel (jeton haché, révocable) que le propriétaire / un associé crée :
//   1. l'entraîneur crée une « mission d'entraînement » et y dépose une VRAIE mission : les pièces, le working file vierge du cabinet, et
//      s'il le veut le working file qu'il a lui-même rempli (la référence) ;
//   2. pour chaque étape du métier, l'AGENT fait le travail d'abord, avec les vrais moteurs de l'application (lecture des pièces, fiche
//      des pièces, comptes du grand livre, remplissage des feuilles par les formules du working file) ;
//   3. l'entraîneur dit « Juste », ou explique ce qui ne va pas et ce qu'il aurait fallu faire ; l'explication devient une LEÇON de cette
//      étape, redonnée tout de suite à l'agent ;
//   4. « Refaire » : l'agent refait l'étape avec ses leçons ; on voit, étape par étape, s'il fait juste du premier coup et s'il progresse ;
//   5. le propriétaire / un associé valide les leçons : une leçon VALIDÉE est donnée aux vrais agents de l'application (fiches des pièces,
//      comptes, remplissage). Une leçon non validée ne sert que dans l'entraînement.
// Rien n'est écrit dans les missions ni dans les working files du cabinet : les fichiers de l'entraînement vivent dans
// <maison des agents>/ENTRAINEMENT_AGENTS/<mission d'entraînement>, que l'Orpailleur ne range jamais.
import { createHash, randomBytes } from 'node:crypto';
import { rest } from './supabase.js';
import { pilotOrgId } from './firm-context.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { fitJson } from './ai-input.js';

const q = v => encodeURIComponent(String(v ?? ''));
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
const fail = (code, status = 400, extra = {}) => Object.assign(new Error(code), { status, statusCode: status, ...extra });
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const isPdf = n => /\.pdf$/i.test(n || ''), isSheet = n => /\.(xlsx|xls|csv)$/i.test(n || '');
export const hashToken = t => createHash('sha256').update(String(t || '')).digest('hex');
const LEADS = ['owner', 'partner'];

// The steps of the audit work, in order. 'tests' and 'revue' come next (not built yet: said on the screen).
export const STEPS = [
  { key: 'mission', title: 'Comprendre la mission', agent: 'Mission Controller', what: 'lire le document fondateur (convention, accord de prêt, contrat, TDR) et faire la fiche de la mission' },
  { key: 'pieces', title: 'Reconnaître les pièces', agent: 'Enhanced Auditor', what: 'dire ce qu’est chaque pièce, ce qu’est une ligne, le sens de chaque colonne' },
  { key: 'correspondance', title: 'Catégories du budget ↔ comptes du grand livre', agent: 'Enhanced Auditor', what: 'trouver le compte du grand livre de chaque catégorie du budget, par le sens' },
  { key: 'remplissage', title: 'Remplir le working file', agent: 'Enhanced Auditor', what: 'remplir chaque feuille de données à partir des pièces', per_sheet: true },
  { key: 'tests', title: 'Exécuter les tests', agent: 'Enhanced Auditor', what: 'préparer chaque test du working file', later: true },
  { key: 'revue', title: 'Revue', agent: 'Enhanced Auditor', what: 'revoir le travail et lever les points', later: true },
];

// ———— Access ————
async function trainerOf(token, d) {
  if (!token || String(token).length < 20) throw fail('GYM_LINK_REQUIRED', 401);
  const rows = await (d.fetchRows || rest)(`office_gym_trainers?token_hash=eq.${hashToken(token)}&active=eq.true&select=id,org_id,name,email&limit=1`).catch(e => { if (/office_gym_/.test(String(e.message))) throw fail('AGENT_GYM_SQL_NOT_INSTALLED', 409); throw e; });
  if (!rows?.[0]) throw fail('GYM_LINK_INVALID', 401);
  return rows[0];
}
function requireLead(orgId, account) { if (orgId !== pilotOrgId() || !LEADS.includes(account?.role)) throw fail('PLATFORM_LEAD_REQUIRED', 403); }

// ———— The owner / partners: links, lessons, progress ————
export async function createTrainer(orgId, account, body = {}, d = {}) {
  requireLead(orgId, account);
  const name = clip(String(body.name || '').trim(), 120); if (!name) throw fail('NAME_REQUIRED');
  const token = randomBytes(24).toString('base64url');
  const r = await (d.fetchRows || rest)('office_gym_trainers', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ org_id: orgId, name, email: clip(body.email, 254), token_hash: hashToken(token), created_by: account.email || null }]) });
  return { trainer: { id: r?.[0]?.id, name }, link_path: '/entrainement-agents.html#' + token };   // the token is shown ONCE (only its hash is kept)
}
export async function listTrainers(orgId, account, d = {}) {
  requireLead(orgId, account);
  return (await (d.fetchRows || rest)(`office_gym_trainers?org_id=eq.${q(orgId)}&select=id,name,email,active,created_at&order=created_at.desc`)) || [];
}
export async function revokeTrainer(orgId, account, body = {}, d = {}) {
  requireLead(orgId, account);
  await (d.fetchRows || rest)(`office_gym_trainers?id=eq.${q(body.id)}&org_id=eq.${q(orgId)}`, { method: 'PATCH', body: JSON.stringify({ active: false }) });
  return { revoked: true };
}
export async function listLessons(orgId, account, query = {}, d = {}) {
  requireLead(orgId, account);
  const st = ['proposed', 'validated', 'rejected'].includes(query.status) ? '&status=eq.' + query.status : '';
  return (await (d.fetchRows || rest)(`office_gym_lessons?org_id=eq.${q(orgId)}${st}&select=id,step,sheet,lesson,proposed,correct,trainer_name,status,decided_by,created_at&order=created_at.desc&limit=300`)) || [];
}
export async function decideLesson(orgId, account, body = {}, d = {}) {
  requireLead(orgId, account);
  const status = body.decision === 'validated' ? 'validated' : body.decision === 'rejected' ? 'rejected' : null;
  if (!body.id || !status) throw fail('ID_AND_DECISION_REQUIRED');
  const r = await (d.fetchRows || rest)(`office_gym_lessons?id=eq.${q(body.id)}&org_id=eq.${q(orgId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status, decided_by: account.email || null, decided_at: new Date().toISOString() }) });
  if (!r?.[0]) throw fail('LESSON_NOT_FOUND', 404);
  return r[0];
}

// Lessons given to the agent for a step. In the training: every lesson not refused. In the application: only the VALIDATED ones.
export async function lessonsFor(step, { gym = false, sheet = null, orgId = null } = {}, d = {}) {
  const org = orgId || pilotOrgId(); if (!org) return [];
  const st = gym ? '&status=neq.rejected' : '&status=eq.validated';
  const rows = await (d.fetchRows || rest)(`office_gym_lessons?org_id=eq.${q(org)}&step=eq.${q(step)}${st}${sheet ? '&or=(sheet.is.null,sheet.eq.' + q(sheet) + ')' : ''}&select=lesson,proposed,correct,sheet&order=created_at.desc&limit=40`).catch(() => []);
  return (rows || []).map(x => ({ lesson: x.lesson, the_agent_had_proposed: x.proposed || undefined, the_right_answer: x.correct || undefined, sheet: x.sheet || undefined }));
}

// Progress, step by step: in how many trainings the agent was right at the FIRST attempt, and how many attempts it took.
export function progressOf(sessions) {
  const by = {};
  for (const s of sessions) for (const [k, v] of Object.entries(s.steps || {})) {
    const step = k.split(':')[0], a = v.attempts || []; if (!a.some(x => x.verdict)) continue;
    const x = (by[step] ||= { step, trainings: 0, right_first: 0, attempts_to_right: [] });
    x.trainings++; if (a[0]?.verdict === 'juste') x.right_first++;
    const i = a.findIndex(y => y.verdict === 'juste'); if (i >= 0) x.attempts_to_right.push(i + 1);
  }
  return STEPS.map(s => by[s.key] ? { ...by[s.key], title: s.title, right_first_rate: Math.round(100 * by[s.key].right_first / by[s.key].trainings), avg_attempts: by[s.key].attempts_to_right.length ? +(by[s.key].attempts_to_right.reduce((a, b) => a + b, 0) / by[s.key].attempts_to_right.length).toFixed(1) : null } : null).filter(Boolean);
}
export async function overview(orgId, account, d = {}) {
  requireLead(orgId, account);
  const sessions = (await (d.fetchRows || rest)(`office_gym_sessions?org_id=eq.${q(orgId)}&select=id,title,trainer_id,steps,updated_at&order=updated_at.desc&limit=200`)) || [];
  return { progress: progressOf(sessions), trainings: sessions.length };
}

// ———— The trainer (through the link) ————
const sessionCols = 'id,title,folder_id,period_label,files,steps,created_at,updated_at';
async function sessionOf(tr, id, d) {
  const r = await (d.fetchRows || rest)(`office_gym_sessions?id=eq.${q(id)}&trainer_id=eq.${q(tr.id)}&select=${sessionCols}&limit=1`);
  if (!r?.[0]) throw fail('TRAINING_NOT_FOUND', 404);
  return r[0];
}
async function saveSession(s, patch, d) {
  const r = await (d.fetchRows || rest)(`office_gym_sessions?id=eq.${q(s.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
  return r?.[0] || { ...s, ...patch };
}
const publicSession = s => ({ id: s.id, title: s.title, period_label: s.period_label, files: s.files || [], steps: s.steps || {}, updated_at: s.updated_at });

async function gymRoot(d) {
  const home = d.gymHome || (await import('./google-connection.js')).firmHomeId();
  if (!home) throw fail('FIRM_DRIVE_NOT_CHOSEN', 409);
  const make = d.findOrCreateFolder || (async (p, n) => (await import('./tidy-drive.js')).tidyDrive.findOrCreateFolder(p, n));
  return (await make(home, 'ENTRAINEMENT_AGENTS'))?.id;
}

export async function gym(orgId, req, body = {}, d = {}) {
  const tr = await trainerOf(body.token || req?.headers?.['x-gym-token'], d);
  const org = tr.org_id;
  const a = String(body.action || 'me');
  if (a === 'me') {
    const sessions = (await (d.fetchRows || rest)(`office_gym_sessions?trainer_id=eq.${q(tr.id)}&select=${sessionCols}&order=updated_at.desc&limit=50`)) || [];
    return { trainer: { name: tr.name }, steps: STEPS, trainings: sessions.map(publicSession), progress: progressOf(sessions) };
  }
  if (a === 'create') {
    const title = clip(String(body.title || '').trim(), 160); if (!title) throw fail('TITLE_REQUIRED');
    const root = await gymRoot(d);
    const make = d.findOrCreateFolder || (async (p, n) => (await import('./tidy-drive.js')).tidyDrive.findOrCreateFolder(p, n));
    const folder = (await make(root, (tr.name + ' — ' + title).replace(/[\\/]/g, ' ').slice(0, 120) + ' — ' + Date.now().toString(36)))?.id;
    const r = await (d.fetchRows || rest)('office_gym_sessions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ org_id: org, trainer_id: tr.id, title, folder_id: folder, period_label: clip(body.period_label, 60) }]) });
    return publicSession(r[0]);
  }
  const s = await sessionOf(tr, String(body.training_id || ''), d);
  if (a === 'view') return { training: publicSession(s), steps: STEPS };
  if (a === 'upload') return uploadSmall(s, body, d);
  if (a === 'upload-start') return uploadStart(s, body, req, d);
  if (a === 'upload-done') return uploadDone(s, body, d);
  if (a === 'file-role') {
    const files = (s.files || []).map(f => (f.id === body.file_id ? { ...f, role: ['piece', 'workfile', 'reference'].includes(body.role) ? body.role : f.role } : f));
    return publicSession(await saveSession(s, { files }, d));
  }
  if (a === 'period') return publicSession(await saveSession(s, { period_label: clip(body.period_label, 60) }, d));
  if (a === 'run') return runStep(org, tr, s, body, d);
  if (a === 'verdict') return verdict(org, tr, s, body, d);
  throw fail('UNKNOWN_ACTION');
}

// ———— Files ————
const roleOfName = n => (isSheet(n) && /working|wp|nl-t|workfile|work file|feuille de travail/i.test(n) ? 'workfile' : 'piece');
async function uploadSmall(s, body, d) {
  const buf = Buffer.from(String(body.base64 || ''), 'base64');
  if (!buf.length) throw fail('FILE_EMPTY'); if (buf.length > 3 * 1024 * 1024) throw fail('FILE_TOO_LARGE_FOR_DIRECT');
  const name = clip(String(body.name || 'piece').replace(/[\\/]/g, ' '), 180);
  const create = d.createBinary || (async a => (await import('./google-drive.js')).createBinaryFile(a));
  const f = await create({ name: Date.now().toString(36) + '_' + name, parentId: s.folder_id, buffer: buf, mimeType: clip(body.mime, 120) || 'application/octet-stream' });
  return addFile(s, { id: f.id, name, role: ['piece', 'workfile', 'reference'].includes(body.role) ? body.role : roleOfName(name) }, d);
}
async function uploadStart(s, body, req, d) {
  const size = Number(body.size) || 0; if (size <= 0) throw fail('FILE_EMPTY'); if (size > 100 * 1024 * 1024) throw fail('FILE_TOO_LARGE');
  const g = d.google || await import('./google-drive.js');
  const token = await g.googleAccessToken();
  const origin = String(req?.headers?.origin || (req?.headers?.host ? 'https://' + req.headers.host : '')).slice(0, 200);
  const name = Date.now().toString(36) + '_' + clip(String(body.name || 'piece').replace(/[\\/]/g, ' '), 180);
  const r = await (d.fetchImpl || fetch)('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': clip(body.mime, 120) || 'application/octet-stream', 'X-Upload-Content-Length': String(size), ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ name, parents: [s.folder_id] }) });
  const url = r.headers?.get?.('location'); if (!r.ok || !url) throw fail('UPLOAD_SESSION_REFUSED_' + r.status, 502);
  return { upload_url: url };
}
async function uploadDone(s, body, d) {
  const drive = d.drive || (await import('./drive-adapter.js')).driveAdapter;
  const meta = await drive.getMeta(String(body.file_id || '')).catch(() => null);
  if (!meta || meta.trashed || !(meta.parents || []).includes(s.folder_id)) throw fail('FILE_NOT_IN_TRAINING', 409);
  const name = String(meta.name || '').replace(/^[a-z0-9]+_/, '');
  return addFile(s, { id: meta.id || body.file_id, name, role: ['piece', 'workfile', 'reference'].includes(body.role) ? body.role : roleOfName(name) }, d);
}
async function addFile(s, f, d) {
  const files = [...(s.files || []).filter(x => x.id !== f.id), { ...f, at: new Date().toISOString() }];
  return publicSession(await saveSession(s, { files }, d));
}

// ———— The agent does a step ————
async function runStep(org, tr, s, body, d) {
  const step = STEPS.find(x => x.key === body.step); if (!step) throw fail('UNKNOWN_STEP');
  if (step.later) throw fail('STEP_NOT_BUILT_YET', 409);
  const sheet = step.per_sheet ? clip(body.sheet, 80) : null;
  const key = step.key + (sheet ? ':' + sheet : '');
  const lessons = await (d.lessonsFor || lessonsFor)(step.key, { gym: true, sheet, orgId: org }, d);
  const drive = d.drive || (await import('./drive-adapter.js')).driveAdapter;
  const ctx = { s, drive, lessons, d, org };
  let proposal;
  if (step.key === 'mission') proposal = await stepMission(ctx);
  else if (step.key === 'pieces') proposal = await stepPieces(ctx);
  else if (step.key === 'correspondance') proposal = await stepAccounts(ctx);
  else proposal = await stepFill(ctx, sheet, body.hint);
  const prev = s.steps?.[key] || { attempts: [] };
  const attempts = [...(prev.attempts || []), { at: new Date().toISOString(), proposal, lessons_used: lessons.length }].slice(-12);
  const steps = { ...(s.steps || {}), [key]: { attempts } };
  // the fiches of the pieces are kept: the next steps use them
  if (step.key === 'pieces' && proposal.fiches) steps._fiches = { at: new Date().toISOString(), fiches: proposal.fiches };
  const saved = await saveSession(s, { steps }, d);
  return { training: publicSession(saved), step: key, attempt: attempts.length, proposal };
}

async function readPieces(ctx, max = 8) {
  const read = ctx.d.fileForAI || (async (id, o) => (await import('./agent-outputs.js')).fileForAI(id, o));
  const out = [];
  for (const f of (ctx.s.files || []).filter(x => x.role === 'piece').slice(0, max)) {
    try { const r = await read(f.id, { maxChars: 30000 }); out.push({ id: f.id, name: f.name, text: String(r.text || ''), visual: Boolean(r.visual), r }); } catch { out.push({ id: f.id, name: f.name, text: '', unreadable: true }); }
  }
  return out;
}

const MISSION = `Tu es le Mission Controller d'un cabinet d'audit. Voici les pièces d'une mission. Trouve le DOCUMENT FONDATEUR (convention ou accord de
financement, accord de prêt ou de don, contrat, termes de référence, lettre de mission) et fais la FICHE DE LA MISSION à partir de lui.
Chaque fait important porte "quote" = le passage RECOPIÉ mot pour mot du document qui le prouve ; un fait sans passage : "quote": null.
N'invente rien. Ce que les documents ne disent pas va dans "questions".
"lessons_from_trainers" = ce que des auditeurs t'ont appris sur cette étape : applique-le.
JSON STRICT : {"founding_document":{"file_id":"…","why":"…"},"facts":[{"label":"client|entité auditée|type de mission|bailleur|projet|période|montant|devise|date de clôture|autre","value":"…","quote":"…|null"}],"categories":[{"name":"…","ceiling":"…|null","quote":"…|null"}],"obligations":[{"what":"…","quote":"…|null"}],"expected_pieces":["…"],"questions":["…"]}`;
async function stepMission(ctx) {
  const docs = await readPieces(ctx);
  if (!docs.length) return { empty: 'aucune pièce déposée' };
  const payload = { lessons_from_trainers: ctx.lessons, documents: docs.filter(x => !x.visual).map(x => ({ file_id: x.id, name: x.name, text: x.text.slice(0, 30000) })), scans: docs.filter(x => x.visual).map(x => x.name) };
  const r = await (ctx.d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: MISSION, input: fitJson(payload, 110000, [o => o.documents.forEach(x => { x.text = x.text.slice(0, 12000); })]), files: docs.filter(x => x.visual).slice(0, 4).map(x => x.r), maxTokens: 5000 });
  const out = parseJsonLoose(r?.text ?? r) || {};
  const hay = fold(docs.map(x => x.text).join(' '));
  const verified = x => (x?.quote ? hay.includes(fold(x.quote).slice(0, 80)) : false);
  const doc = docs.find(x => x.id === out.founding_document?.file_id);
  return { by: r?.provider || 'ia', founding_document: doc ? { name: doc.name, why: clip(out.founding_document.why, 300) } : null,
    items: [...(out.facts || []).map(f => ({ label: clip(f.label, 60), value: clip(f.value, 300), quote: clip(f.quote, 300), verified: verified(f) })),
      ...(out.categories || []).map(c => ({ label: 'catégorie', value: clip(c.name, 160) + (c.ceiling ? ' — plafond ' + clip(c.ceiling, 60) : ''), quote: clip(c.quote, 300), verified: verified(c) })),
      ...(out.obligations || []).map(o => ({ label: 'obligation', value: clip(o.what, 300), quote: clip(o.quote, 300), verified: verified(o) }))],
    expected_pieces: (out.expected_pieces || []).slice(0, 30).map(x => clip(x, 160)), questions: (out.questions || []).slice(0, 20).map(x => clip(x, 300)) };
}

async function stepPieces(ctx) {
  const { peekDocument } = await import('./sheet-understanding.js');
  const { profilePieces } = await import('./piece-profile.js');
  const files = (ctx.s.files || []).filter(x => x.role === 'piece' && (isSheet(x.name) || isPdf(x.name)));
  if (!files.length) return { empty: 'aucun tableur ni PDF parmi les pièces' };
  const fiches = {};
  for (let i = 0; i < files.length; i += 4) {
    const batch = files.slice(i, i + 4);
    for (const f of batch) f.content = await peekDocument({ id: f.id, name: f.name }, ctx.drive, { ...ctx.d, maxRows: 200000 }).catch(e => ({ unreadable: String(e.message || e).slice(0, 80) }));
    Object.assign(fiches, await profilePieces(batch, { ...ctx.d, trainerLessons: ctx.lessons }));
  }
  return { fiches, items: files.map(f => { const p = fiches[f.id]; return p ? { label: f.name, value: p.family + ' — ' + (p.what || ''), detail: [p.line_unit ? 'une ligne = ' + p.line_unit : null, p.key?.contains ? 'clé : ' + p.key.contains : null, ...(p.columns || []).filter(c => c.meaning).slice(0, 12).map(c => '« ' + c.heading + ' » = ' + c.meaning)].filter(Boolean), warning: p.code_doubt || p.doubt || null } : { label: f.name, value: 'non décrite', warning: f.content?.unreadable || 'l’IA n’a rien dit de cette pièce' }; }) };
}

async function fichesOf(ctx) {
  const f = ctx.s.steps?._fiches?.fiches; if (f && Object.keys(f).length) return f;
  const p = await stepPieces(ctx); return p.fiches || {};
}
async function stepAccounts(ctx) {
  const fiches = await fichesOf(ctx);
  const files = ctx.s.files || [];
  const gl = files.find(f => fiches[f.id]?.family === 'grand_livre_general') || files.find(f => /^grand_livre/.test(fiches[f.id]?.family || '') && fiches[f.id]?.family !== 'grand_livre_auxiliaire');
  const budget = files.find(f => fiches[f.id]?.family === 'budget_previsionnel') || files.find(f => /budget|execution_budgetaire/.test(fiches[f.id]?.family || ''));
  if (!gl || !budget) return { empty: 'il faut un grand livre général et un budget reconnus à l’étape « Reconnaître les pièces »' + (!gl ? ' (grand livre manquant)' : '') + (!budget ? ' (budget manquant)' : '') };
  const { clientTable } = await import('./workfile-table-import.js');
  const { tableStructure } = await import('./table-structure.js');
  const { columnRole } = await import('./client-table-understanding.js');
  const { aiAccountMap } = await import('./sheet-understanding.js');
  const gt = await clientTable(gl.id, ctx.drive), gh = (gt.rows[gt.header_row] || []).map(String), body = gt.rows.slice(gt.header_row + 1);
  const ac = gh.findIndex(h => columnRole(h) === 'account'), lc = [gh.findIndex(h => /intitule du compte|libelle du compte/.test(fold(h))), gh.findIndex(h => columnRole(h) === 'description')].filter(i => i >= 0);
  if (ac < 0) return { empty: 'aucune colonne de comptes lue dans « ' + gl.name + ' »' };
  const glMap = { map: new Map(), numbers: new Set(), titles: new Map(), counts: new Map() };
  for (const r of body) { const n = String(r[ac] ?? '').trim(); if (!/^\d{3,12}$/.test(n)) continue; glMap.numbers.add(n); glMap.counts.set(n, (glMap.counts.get(n) || 0) + 1); for (const i of lc) { const v = String(r[i] ?? '').trim(); if (v) { if (!glMap.titles.has(n)) glMap.titles.set(n, v.slice(0, 80)); const k = fold(v); if (k && !glMap.map.has(k)) glMap.map.set(k, n); } } }
  const bt = await clientTable(budget.id, ctx.drive), bh = (bt.rows[bt.header_row] || []).map(v => String(v ?? '')), brows = bt.rows.slice(bt.header_row + 1);
  const st = tableStructure(bh, brows);
  const labels = st.categories.length ? st.categories.map(c => c.label) : brows.map(r => r[st.label_index >= 0 ? st.label_index : 0]).filter(v => typeof v === 'string' && v.trim()).slice(0, 200);
  const m = await aiAccountMap(labels, glMap, { ...ctx.d, trainerLessons: ctx.lessons });
  return { gl: gl.name, budget: budget.name, by: m?.provider || null, items: (m?.list || labels.map(l => ({ label: l, number: null, why: 'l’IA n’a pas répondu' }))).map(x => ({ label: x.label, value: x.number ? x.number + ' — ' + (glMap.titles.get(x.number) || '') : 'aucun compte', detail: [x.why, ...(x.others || []).map(o => 'aussi ' + o + ' — ' + (glMap.titles.get(o) || ''))].filter(Boolean) })) };
}

async function stepFill(ctx, sheet, hint) {
  const wf = (ctx.s.files || []).find(f => f.role === 'workfile');
  if (!wf) return { empty: 'déposez le working file vierge du cabinet (et dites que c’est le working file)' };
  const ExcelJS = (await import('exceljs')).default;
  const { mapWorkingFile } = await import('./workfile-map.js');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await ctx.drive.downloadBuffer(wf.id)));
  const map = mapWorkingFile(wb);
  const dataSheets = map.sheets.filter(x => x.role === 'data').map(x => x.name);
  if (!sheet) return { sheets: dataSheets, empty: dataSheets.length ? 'choisissez la feuille à remplir' : 'aucune feuille de données trouvée dans ce working file' };
  if (!dataSheets.includes(sheet)) throw fail('DATA_SHEET_REQUIRED');
  const fiches = await fichesOf(ctx);
  const pieces = (ctx.s.files || []).filter(f => f.role === 'piece');
  const memory = pieces.map(f => ({ id: f.id, name: f.name, read: true, uses: [], profile: fiches[f.id] || null }));
  const view = { editable: true, card: { steps: [] }, workpaper: { file_id: wf.id }, work: { status: 'in_progress', walkthrough: [] }, line: { code: 'ENTRAINEMENT' }, mission: { period_label: ctx.s.period_label || null } };
  const say = [hint ? String(hint).slice(0, 600) : null, ctx.lessons.length ? 'Leçons des auditeurs pour cette étape : ' + ctx.lessons.map(l => l.lesson).join(' | ').slice(0, 1500) : null].filter(Boolean).join(' — ');
  const { sheetPlan } = await import('./sheet-understanding.js');
  const P = await sheetPlan(ctx.org, 'gym', 'ENTRAINEMENT', { sheet, ...(say ? { hint: say } : {}) }, { email: 'entrainement' },
    { ...ctx.d, trainerLessons: [], view: async () => view, missionMemory: async () => memory, sources: async () => memory.map(m => ({ file_id: m.id, name: m.name })), save: async () => null, profiles: false, recipeFor: async () => null, drive: ctx.drive });
  // Compared with the trainer's OWN working file, when given: cell by cell.
  const ref = (ctx.s.files || []).find(f => f.role === 'reference');
  let comparison = null;
  if (ref) {
    const rb = new ExcelJS.Workbook(); await rb.xlsx.load(Buffer.from(await ctx.drive.downloadBuffer(ref.id)));
    const rs = rb.getWorksheet(sheet);
    if (rs) {
      const val = v => { const x = v && typeof v === 'object' ? (v.result ?? v.text ?? (v instanceof Date ? v.toISOString().slice(0, 10) : null)) : v; return x == null || x === '' ? null : typeof x === 'number' ? Math.round(x * 100) / 100 : x instanceof Date ? x.toISOString().slice(0, 10) : fold(x); };
      // Compared LINE by LINE, whatever the order (the agent may list the entries in another order than the trainer): a line of the
      // trainer's sheet is « found » when a line of the agent has the same values in the columns the trainer filled on that line.
      const cols = (P.understanding?.columns || []).map(c => c.col);
      const first = P.understanding?.first_row || 1;
      const agentRows = new Map(); for (const c of P.cells) { const r = +c.address.match(/\d+$/)[0], col = c.address.replace(/\d+$/, ''); (agentRows.get(r) || agentRows.set(r, {}).get(r))[col] = val(c.value); }
      const mineRows = [...agentRows.values()];
      const refRows = [];
      for (let r = first; r <= Math.min(rs.rowCount, first + 5000); r++) { const o = {}; for (const c of cols) { const v = val(rs.getCell(c + r).value); if (v != null) o[c] = v; } if (Object.keys(o).length) refRows.push({ row: r, o }); }
      const used = new Set(); let same = 0; const missingRows = [];
      for (const x of refRows) {
        const i = mineRows.findIndex((m, k) => !used.has(k) && Object.entries(x.o).every(([c, v]) => String(m[c] ?? '') === String(v)));
        if (i >= 0) { used.add(i); same++; } else missingRows.push(x);
      }
      const diff = 0, missing = missingRows.length, extra = mineRows.length - used.size;
      const examples = missingRows.slice(0, 20).map(x => ({ cell: 'ligne ' + x.row, expected: Object.entries(x.o).map(([c, v]) => c + '=' + v).join(' · '), got: null }));
      comparison = { with: ref.name, same, different: diff, missing, extra, examples, score: refRows.length ? Math.round(100 * same / refRows.length) : null, by: 'lignes' };
    }
  }
  return { sheet, sheets: dataSheets, by: P.ai, ai_error: P.ai_error || null, rows: P.preview?.rows || 0, summary: P.summary || null,
    items: P.plan.map(p => ({ label: p.col + ' — ' + p.header, value: p.compute ? 'calcul ' + p.compute : p.document_id ? '« ' + (p.heading || '?') + ' » de ' + p.document : 'vide', detail: [p.why].filter(Boolean), warning: p.status !== 'sure' && p.document_id ? 'à confirmer' : null })),
    sample: (P.preview?.sample || []).slice(0, 8), columns: P.preview?.columns || [], doubts: P.doubts || [], comparison };
}

// ———— The trainer's verdict: right, or what was wrong and what should have been done (a LESSON) ————
async function verdict(org, tr, s, body, d) {
  const key = String(body.step || ''), step = STEPS.find(x => x.key === key.split(':')[0]);
  if (!step) throw fail('UNKNOWN_STEP');
  const cur = s.steps?.[key]; if (!cur?.attempts?.length) throw fail('RUN_THE_STEP_FIRST', 409);
  const v = body.verdict === 'juste' ? 'juste' : 'faux';
  const explanation = clip(String(body.explanation || '').trim(), 3000), correct = clip(String(body.correct || '').trim(), 3000);
  if (v === 'faux' && !explanation) throw fail('EXPLANATION_REQUIRED');
  const attempts = cur.attempts.slice(); attempts[attempts.length - 1] = { ...attempts.at(-1), verdict: v, explanation, correct, judged_at: new Date().toISOString() };
  const saved = await saveSession(s, { steps: { ...s.steps, [key]: { attempts } } }, d);
  let lesson = null;
  if (v === 'faux') {
    const p = attempts.at(-1).proposal || {};
    const proposedText = (p.items || []).slice(0, 30).map(x => x.label + ' : ' + x.value).join(' ; ').slice(0, 2500);
    const r = await (d.fetchRows || rest)('office_gym_lessons', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ org_id: org, step: step.key, sheet: key.split(':')[1] || null, lesson: explanation, proposed: proposedText || null, correct: correct || null, session_id: s.id, trainer_id: tr.id, trainer_name: tr.name, context: { title: s.title } }]) });
    lesson = r?.[0] ? { id: r[0].id } : null;
  }
  return { training: publicSession(saved), lesson };
}
