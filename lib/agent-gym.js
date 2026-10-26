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
import { redact as redactText } from './lesson-memory.js';

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
  // (2026-10-26, Paul : « il ne faut pas qu'il ne puisse pas faire les tests d'audit parce qu'il est seul ») No role, no programme to
  // validate, no second person: the trainer alone makes the agent do each test of the working file, then the review of a filled test.
  { key: 'tests', title: 'Faire les tests d’audit', agent: 'Enhanced Auditor', what: 'faire chaque test du working file : ce qu’il vérifie, les pièces, chaque ligne du tableau, les calculs sur les pièces, une conclusion proposée', per_sheet: true, pick: 'test' },
  { key: 'revue', title: 'Revoir un test rempli', agent: 'Enhanced Auditor', what: 'revoir un test de VOTRE working file rempli comme un manager : points de revue, ce qui manque, ce qui n’est pas prouvé', per_sheet: true, pick: 'test' },
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
  return (await (d.fetchRows || rest)(`office_gym_lessons?org_id=eq.${q(orgId)}${st}&select=id,step,sheet,lesson,proposed,correct,trainer_name,status,decided_by,created_at,context&order=created_at.desc&limit=300`)) || [];
}
export async function decideLesson(orgId, account, body = {}, d = {}) {
  requireLead(orgId, account);
  const status = body.decision === 'validated' ? 'validated' : body.decision === 'rejected' ? 'rejected' : null;
  if (!body.id || !status) throw fail('ID_AND_DECISION_REQUIRED');
  const r = await (d.fetchRows || rest)(`office_gym_lessons?id=eq.${q(body.id)}&org_id=eq.${q(orgId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status, decided_by: account.email || null, decided_at: new Date().toISOString() }) });
  if (!r?.[0]) throw fail('LESSON_NOT_FOUND', 404);
  // A lesson from an old audit, validated: written to the EYNOWA server's memory (the base keeps the list if the server is off).
  if (status === 'validated' && r[0].step === 'archive') {
    const mem = d.lessonMemory || await import('./lesson-memory.js');
    let memory = null, memory_error = null;
    try { memory = await mem.pushLesson(r[0], d); } catch (e) { memory_error = String(e.message || e).slice(0, 160); }
    await (d.fetchRows || rest)(`office_gym_lessons?id=eq.${q(body.id)}`, { method: 'PATCH', body: JSON.stringify({ context: { ...(r[0].context || {}), memory, memory_error } }) }).catch(() => null);
    return { ...r[0], memory, memory_error };
  }
  return r[0];
}

// Lessons given to the agent for a step. In the training: every lesson not refused. In the application: only the VALIDATED ones.
export async function lessonsFor(step, { gym = false, sheet = null, orgId = null } = {}, d = {}) {
  const org = orgId || pilotOrgId(); if (!org) return [];
  const st = gym ? '&status=neq.rejected' : '&status=eq.validated';
  const rows = await (d.fetchRows || rest)(`office_gym_lessons?org_id=eq.${q(org)}&step=eq.${q(step)}${st}${sheet ? '&or=(sheet.is.null,sheet.eq.' + q(sheet) + ')' : ''}&select=lesson,proposed,correct,sheet&order=created_at.desc&limit=40`).catch(() => []);
  const own = (rows || []).map(x => ({ lesson: x.lesson, the_agent_had_proposed: x.proposed || undefined, the_right_answer: x.correct || undefined, sheet: x.sheet || undefined }));
  return [...own, ...(await archiveLessons(org, STEP_AGENT[step], STEPS.find(s => s.key === step)?.what, { gym }, d))];
}
// What the agents learnt from the firm's OLD AUDITS (step « archive »): the server's memory first (the lessons closest to this work),
// else the lessons kept in the base. Validated only in the application; in the training, every lesson not refused.
export const STEP_AGENT = { mission: 'mission-controller', pieces: 'enhanced-auditor', correspondance: 'enhanced-auditor', remplissage: 'enhanced-auditor', tests: 'enhanced-auditor', revue: 'enhanced-auditor' };
export async function archiveLessons(org, agent, topic, { gym = false } = {}, d = {}) {
  if (!agent) return [];
  const mem = d.lessonMemory || await import('./lesson-memory.js');
  if (!gym) { const found = await mem.searchLessons(org, agent, topic, d); if (found?.length) return found.map(x => ({ lesson: x.lesson, from: 'anciens audits du cabinet' })); }
  const st = gym ? '&status=neq.rejected' : '&status=eq.validated';
  const rows = await (d.fetchRows || rest)(`office_gym_lessons?org_id=eq.${q(org)}&step=eq.archive${st}&context->>agent=eq.${q(agent)}&select=lesson,context&order=created_at.desc&limit=15`).catch(() => []);
  return (rows || []).map(x => ({ lesson: x.lesson, from: 'anciens audits du cabinet', theme: x.context?.theme || undefined }));
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
  // The agents' house; a Drive chosen before the house was recorded only knows its memory folder, or its root (2026-10-26: « Le cabinet
  // n'a pas encore choisi son Drive » although it had — the saved choice had a memory folder and no house).
  const g = d.gymHome ? null : await import('./google-connection.js');
  const home = d.gymHome || g.firmHomeId() || g.firmMemoryId() || g.firmDriveId();
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
  if (a === 'archive-read') return archiveRead(org, tr, s, body, d);
  if (a === 'archive-lessons') return archiveList(org, s, d);
  if (a === 'archive-judge') return archiveJudge(org, s, body, d);
  if (a === 'archive-forget') return archiveForget(s, body, d);
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
  else if (step.key === 'tests') proposal = await stepTest(ctx, sheet, body.hint);
  else if (step.key === 'revue') proposal = await stepReview(ctx, sheet, body.hint);
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

// ———— Audit tests: the agent does a test of the working file, alone with the trainer ————
const cellVal = v => { const x = v && typeof v === 'object' ? (v.result ?? v.text ?? (v instanceof Date ? v.toISOString().slice(0, 10) : (v.richText ? v.richText.map(t => t.text).join('') : null))) : v; return x == null || x === '' ? null : typeof x === 'number' ? Math.round(x * 100) / 100 : x instanceof Date ? x.toISOString().slice(0, 10) : String(x).trim(); };
async function loadBook(ctx, file) {
  const ExcelJS = (await import('exceljs')).default;
  const { mapWorkingFile } = await import('./workfile-map.js');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await ctx.drive.downloadBuffer(file.id)));
  return { wb, map: mapWorkingFile(wb) };
}
// What a test sheet IS: title, instructions, the steps written in it, identity fields, its table column by column (role, list), and the
// rows of the table with what is already written in them (keys of the model, or everything for a filled working file).
async function testSheetView(wb, map, name, { values = false } = {}) {
  const s = map.sheets.find(x => x.name === name), ws = wb.getWorksheet(name), t = s?.tables?.[s.main];
  const test = (map.tests || []).find(x => x.sheet === name) || {};
  let steps = []; try { steps = (await import('./step-runner.js')).stepsInSheet(ws).slice(0, 30); } catch { steps = []; }
  const columns = (t?.columns || []).map(c => ({ col: c.col, header: c.header, role: c.role, list: c.list || null }));
  const rows = [];
  if (t) for (let r = t.first_row; r < t.first_row + Math.min(t.capacity, 400); r++) {
    const o = {}; for (const c of columns) { if (!values && !['key', 'fixed'].includes(c.role)) continue; const v = cellVal(ws.getCell(c.col + r).value); if (v != null) o[c.col] = String(v).slice(0, 300); }
    if (Object.keys(o).length) rows.push({ row: r, cells: o });
  }
  const fields = (s?.fields || []).map(f => ({ label: f.label, value: values && f.address ? cellVal(ws.getCell(f.address).value) : undefined }));
  return { sheet: name, code: s?.test_code || test.code || null, title: s?.title || null, instructions: (s?.instructions || []).map(i => i.text), steps: steps.map(x => x.text || x),
    columns, first_row: t?.first_row || null, capacity: t?.capacity || 0, rows, fields, programme: test.programme || null, risks: test.risks || [], pbc: [...(test.pbc_required || []), ...(test.pbc_optional || [])] };
}

const TEST = `Tu es l'Enhanced Auditor d'un cabinet d'audit. Un auditeur t'entraîne : fais CE test de son working file, comme un auditeur le ferait, avec
les pièces de la mission. Tu reçois la feuille du test (titre, consignes, étapes, colonnes du tableau avec leur rôle, lignes déjà prévues
par le modèle), les fiches des pièces et le texte des documents.
1. "understood" : ce que le test vérifie et sur quelle pièce, en deux phrases.
2. "rows" : les lignes du tableau que tu remplis. Une ligne prévue par le modèle garde son numéro ("row") ; sinon "row": null.
   Dans "cells", remplis SEULEMENT les colonnes de rôle "fact" (ce qu'on lit dans les pièces), "free" et "judgment" (ta PROPOSITION :
   une valeur de la liste de la colonne quand elle en a une). Jamais "calc", "result" ni "key" : le fichier les calcule.
   Chaque ligne porte "source" : {"file_id":"…","quote":"passage RECOPIÉ mot pour mot qui prouve la ligne"} ; sans passage : "quote": null.
3. Si le test est un CALCUL sur une table (doublons, hors période, cut-off, montants ronds, plus gros montants, comparaison GL ↔ balance,
   échantillon…), donne "pipeline" avec des opérations prises UNIQUEMENT dans cette liste, et "source_file_id" (la pièce, par son contenu) :
OPS
4. "conclusion" : la conclusion que tu proposes à l'auditeur (jamais définitive) ; "questions" : ce que seules les personnes savent.
N'invente rien : une valeur qu'aucune pièce ne donne reste vide et va dans "questions".
"lessons_from_trainers" = ce que des auditeurs t'ont appris sur cette étape : applique-le.
JSON STRICT : {"understood":"…","rows":[{"row":12,"cells":{"C":"…"},"source":{"file_id":"…","quote":"…|null"}}],"pipeline":[{"op":"…","params":{},"why":"…"}],"source_file_id":"…|null","conclusion":"…","questions":["…"]}`;

async function stepTest(ctx, sheet, hint) {
  const wf = (ctx.s.files || []).find(f => f.role === 'workfile');
  if (!wf) return { empty: 'déposez le working file vierge du cabinet (et dites que c’est le working file)' };
  const { wb, map } = await loadBook(ctx, wf);
  const testSheets = (map.tests || []).map(t => t.sheet);
  if (!sheet) return { sheets: testSheets, empty: testSheets.length ? 'choisissez le test à faire faire' : 'aucune feuille de test trouvée dans ce working file' };
  if (!testSheets.includes(sheet)) throw fail('TEST_SHEET_REQUIRED');
  const view = await testSheetView(wb, map, sheet);
  const fiches = await fichesOf(ctx);
  const docs = await readPieces(ctx);
  const pieces = (ctx.s.files || []).filter(f => f.role === 'piece');
  const tables = pieces.filter(f => isSheet(f.name));
  const ap = await import('./audit-pipeline.js');
  const prompt = TEST.replace('OPS', Object.entries(ap.PIPELINE_OPS).map(([k, v]) => '   - ' + k + ' : ' + v).join('\n'));
  const payload = { lessons_from_trainers: ctx.lessons.map(l => l.lesson), correction_now: hint ? String(hint).slice(0, 800) : null, mission_period: ctx.s.period_label || null, test: view,
    pieces: pieces.map(f => ({ file_id: f.id, name: f.name, fiche: fiches[f.id] ? { family: fiches[f.id].family, what: fiches[f.id].what, line_unit: fiches[f.id].line_unit, columns: (fiches[f.id].columns || []).slice(0, 20) } : null })),
    documents: docs.filter(x => !x.visual && x.text).map(x => ({ file_id: x.id, name: x.name, text: x.text.slice(0, 30000) })) };
  let out = {}, provider = null, aiError = null;
  try {
    const r = await (ctx.d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: prompt, maxTokens: 6000, files: docs.filter(x => x.visual).slice(0, 4).map(x => x.r),
      input: fitJson(payload, 110000, [o => o.documents.forEach(x => { x.text = x.text.slice(0, 10000); }), o => { o.test.rows = o.test.rows.slice(0, 80); }]) });
    provider = r?.provider || null; out = parseJsonLoose(r?.text ?? r) || {};
  } catch (e) { aiError = String(e.message || e).slice(0, 120); }
  // The code keeps only what the agent may write, and checks every passage in the documents.
  const byCol = Object.fromEntries(view.columns.map(c => [c.col, c]));
  const hay = fold(docs.map(x => x.text).join(' '));
  const rows = (Array.isArray(out.rows) ? out.rows : []).slice(0, 300).map(r => {
    const cells = {}, refused = [];
    for (const [col, v] of Object.entries(r?.cells || {})) {
      const c = byCol[String(col).toUpperCase()]; if (!c || v == null || v === '') continue;
      if (!['fact', 'free', 'judgment'].includes(c.role)) { refused.push(c.col + ' (calculé par le fichier)'); continue; }
      if (c.role === 'judgment' && c.list?.length && !c.list.some(o => fold(o) === fold(v))) { refused.push(c.col + ' : « ' + clip(v, 40) + ' » n’est pas dans la liste'); continue; }
      cells[c.col] = clip(v, 300);
    }
    const quote = clip(r?.source?.quote, 400);
    return { row: Number.isInteger(r?.row) ? r.row : null, cells, quote, file: pieces.find(f => f.id === r?.source?.file_id)?.name || null, verified: quote ? hay.includes(fold(quote).slice(0, 80)) : null, refused };
  }).filter(r => Object.keys(r.cells).length);
  // A calculation: run by the CODE on the piece, never by the AI.
  let calc = null;
  if (Array.isArray(out.pipeline) && out.pipeline.length) {
    const ids = tables.map(f => f.id);
    if (!ids.includes(String(out.source_file_id || ''))) calc = { problems: ['la population choisie n’est pas un tableur de la mission'] };
    else {
      const checked = ap.cleanPipeline(out.pipeline, ids, {});
      if (checked.problems.length) calc = { problems: checked.problems };
      else {
        const x = { table: ctx.d.clientTable || (await import('./workfile-table-import.js')).clientTable, drive: ctx.drive, sr: await import('./step-runner.js') };
        try {
          const src = await ap.loadRows(out.source_file_id, null, x);
          const others = {};
          for (const st of checked.steps.filter(st => st.op === 'compare')) others[st.params.with_file_id] = (await ap.loadRows(st.params.with_file_id, null, x).catch(() => ({ rows: [] }))).rows;
          const res = ap.runPipeline(src.rows, { steps: checked.steps }, others);
          calc = { source: src.meta?.name || pieces.find(f => f.id === out.source_file_id)?.name, steps: checked.steps.map(st => st.op + ' ' + JSON.stringify(st.params)), count: res.count,
            columns: (res.columns || []).map(c => ap.COLUMN_LABEL[c] || c), sample: (res.rows || []).slice(0, 15).map(r => (res.columns || []).map(c => r[c] ?? '')), trace: res.trace || [] };
        } catch (e) { calc = { problems: ['calcul impossible : ' + String(e.message || e).slice(0, 100)] }; }
      }
    }
  }
  // Compared with the trainer's own filled working file, when given: the same test sheet, cell by cell on the columns the agent may write.
  let comparison = null;
  const ref = (ctx.s.files || []).find(f => f.role === 'reference');
  if (ref) {
    const { wb: rb } = await loadBook(ctx, ref).catch(() => ({}));
    const rs = rb?.getWorksheet(sheet);
    if (rs && view.first_row) {
      const cols = view.columns.filter(c => ['fact', 'free', 'judgment'].includes(c.role)).map(c => c.col);
      const refRows = [];
      for (let r = view.first_row; r < view.first_row + Math.min(view.capacity || 400, 400); r++) { const o = {}; for (const c of cols) { const v = cellVal(rs.getCell(c + r).value); if (v != null) o[c] = fold(v); } if (Object.keys(o).length) refRows.push({ row: r, o }); }
      const norm = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fold(v)]));
      const used = new Set(); let cellsSame = 0, cellsAll = 0; const examples = [];
      for (const x of refRows) {
        let i = rows.findIndex((m, k) => !used.has(k) && m.row === x.row);
        if (i < 0) i = rows.findIndex((m, k) => !used.has(k) && m.row == null && Object.entries(x.o).some(([c, v]) => norm(m.cells)[c] === v));
        const mine = i >= 0 ? norm(rows[i].cells) : {}; if (i >= 0) used.add(i);
        for (const [c, v] of Object.entries(x.o)) { cellsAll++; if (mine[c] === v) cellsSame++; else if (examples.length < 25) examples.push({ cell: c + x.row, expected: v, got: mine[c] ?? null }); }
      }
      comparison = { with: ref.name, same: cellsSame, missing: cellsAll - cellsSame, extra: rows.length - used.size, examples, score: cellsAll ? Math.round(100 * cellsSame / cellsAll) : null, by: 'cases' };
    }
  }
  const head = Object.fromEntries(view.columns.map(c => [c.col, c.header]));
  return { sheet, sheets: testSheets, by: provider, ai_error: aiError, understood: clip(out.understood, 600), test_title: view.title,
    items: rows.map(r => ({ label: (r.row ? 'ligne ' + r.row : 'nouvelle ligne') + (r.file ? ' — ' + r.file : ''), value: Object.entries(r.cells).map(([c, v]) => (head[c] || c) + (byCol[c]?.role === 'judgment' ? ' (proposé)' : '') + ' = ' + v).join(' · '),
      quote: r.quote, verified: r.quote ? r.verified : undefined, warning: r.refused.length ? 'écarté : ' + r.refused.join(' ; ') : null })),
    calc, columns: calc?.columns || [], sample: calc?.sample || [], conclusion: clip(out.conclusion, 1200), questions: (out.questions || []).slice(0, 15).map(x => clip(x, 300)), comparison,
    empty: !rows.length && !calc && !out.understood ? (aiError ? 'l’IA n’a pas répondu (' + aiError + ')' : 'l’agent n’a rien proposé pour ce test') : undefined };
}

const REVIEW = `Tu es l'Enhanced Auditor et tu fais la REVUE d'un test rempli par un auditeur, comme le ferait son manager. Tu reçois la feuille
(consignes, étapes, colonnes, chaque ligne avec ses valeurs, la conclusion et les cases d'identité), les fiches des pièces et le texte des
documents. Vérifie : le test est-il fait comme ses étapes le demandent ? chaque ligne est-elle prouvée par une pièce ? les jugements
(Oui / Non / conforme…) sont-ils cohérents avec les faits ? la population est-elle complète ? la conclusion est-elle justifiée et
complète ? Signale aussi ce qui est BIEN fait. Ne réécris pas le test ; tu ne signes rien.
"lessons_from_trainers" = ce que des auditeurs t'ont appris sur la revue : applique-le.
JSON STRICT : {"overall":"…","points":[{"where":"ligne 14 / colonne F / conclusion…","issue":"…","severity":"majeur|mineur","requested_action":"…","quote":"passage d'une pièce qui le montre|null"}],"well_done":["…"]}`;

async function stepReview(ctx, sheet, hint) {
  const ref = (ctx.s.files || []).find(f => f.role === 'reference');
  if (!ref) return { empty: 'déposez votre working file rempli (rôle « mon working file rempli ») : l’agent revoit votre travail' };
  const { wb, map } = await loadBook(ctx, ref);
  const testSheets = (map.tests || []).map(t => t.sheet);
  if (!sheet) return { sheets: testSheets, empty: testSheets.length ? 'choisissez le test à faire revoir' : 'aucune feuille de test trouvée dans votre working file' };
  if (!testSheets.includes(sheet)) throw fail('TEST_SHEET_REQUIRED');
  const view = await testSheetView(wb, map, sheet, { values: true });
  if (!view.rows.length) return { sheets: testSheets, empty: 'ce test est vide dans votre working file : rien à revoir' };
  const fiches = await fichesOf(ctx);
  const docs = await readPieces(ctx);
  const payload = { lessons_from_trainers: ctx.lessons.map(l => l.lesson), correction_now: hint ? String(hint).slice(0, 800) : null, test: view,
    pieces: (ctx.s.files || []).filter(f => f.role === 'piece').map(f => ({ name: f.name, family: fiches[f.id]?.family || null, what: fiches[f.id]?.what || null })),
    documents: docs.filter(x => !x.visual && x.text).map(x => ({ name: x.name, text: x.text.slice(0, 20000) })) };
  let out = {}, provider = null, aiError = null;
  try {
    const r = await (ctx.d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: REVIEW, maxTokens: 4000,
      input: fitJson(payload, 100000, [o => o.documents.forEach(x => { x.text = x.text.slice(0, 6000); }), o => { o.test.rows = o.test.rows.slice(0, 120); }]) });
    provider = r?.provider || null; out = parseJsonLoose(r?.text ?? r) || {};
  } catch (e) { aiError = String(e.message || e).slice(0, 120); }
  const hay = fold(docs.map(x => x.text).join(' '));
  const points = (out.points || []).slice(0, 40);
  return { sheet, sheets: testSheets, by: provider, ai_error: aiError, understood: clip(out.overall, 1200),
    items: [...points.map(p => ({ label: (p.severity === 'majeur' ? 'Point majeur' : 'Point mineur') + ' — ' + clip(p.where, 120), value: clip(p.issue, 600), detail: p.requested_action ? ['à faire : ' + clip(p.requested_action, 400)] : [], quote: clip(p.quote, 300), verified: p.quote ? hay.includes(fold(p.quote).slice(0, 80)) : undefined })),
      ...(out.well_done || []).slice(0, 10).map(w => ({ label: 'Bien fait', value: clip(w, 400) }))],
    empty: !points.length && !out.overall ? (aiError ? 'l’IA n’a pas répondu (' + aiError + ')' : 'l’agent n’a rien relevé') : undefined };
}

// ———— An OLD AUDIT of the firm, studied by the agents (Paul, 2026-10-26 : « recevoir les documents d'audits complets de TATY, les lire et
// les comprendre ; ce sont d'anciens audits ; les leçons restent et les documents disparaissent ») ————
// One training = one old audit dossier. The agent reads it ONE FILE PER CALL (the page goes on by itself): what the document is, at which
// stage of the audit it belongs, and what it teaches each agent about how the firm works. Every lesson is cleaned by the code (amounts,
// dates, e-mails, accounts, names) before it is kept. The trainer keeps, corrects or removes each lesson; a partner validates; a
// validated lesson goes to the EYNOWA server's memory and to the agents. Then the trainer may erase the dossier's files.
const ARCHIVE = `Tu es l'équipe d'agents d'un cabinet d'audit : Firm Manager (acceptation, propositions, équipe, lettre de mission), Mission
Controller (déroulé de la mission, étapes, PBC, échéances, revues, clôture), Enhanced Auditor (risques, programme, tests, working papers,
preuves, conclusions), Orpailleur (nature des documents, nommage, rangement du dossier), Sika (honoraires, facturation, encaissements).
Voici UN document d'un ANCIEN AUDIT TERMINÉ du cabinet. Apprends COMMENT LE CABINET TRAVAILLE, pour faire pareil sur les prochaines missions.
1. "document_kind" : ce qu'est le document ; "stage" : l'étape de l'audit où il sert.
2. "lessons" : 1 à 6 leçons, chacune pour UN agent, écrites comme une règle réutilisable sur une autre mission
   (ex. « Le cabinet teste l'éligibilité ligne par ligne contre la convention, avec la pièce justificative de chaque dépense »).
   JAMAIS de nom de client, de personne, de lieu, de projet, ni de montant, de date ou de numéro : seulement la méthode.
3. "names_to_hide" : tous les noms propres du document (client, personnes, projet, lieux, banques), pour que le code les retire.
Un document sans rien d'utile : "lessons": [].
JSON STRICT : {"document_kind":"…","stage":"…","lessons":[{"agent":"firm-manager|mission-controller|enhanced-auditor|orpailleur|sika","theme":"…","lesson":"…"}],"names_to_hide":["…"]}`;

async function archiveRead(org, tr, s, body, d) {
  const files = (s.files || []).filter(f => !f.removed);
  const done = { ...(s.steps?._archive?.read || {}) };
  const f = files.find(x => x.id === body.file_id) || files.find(x => !done[x.id]);
  if (!f) return { done: Object.keys(done).length, total: files.length, finished: true };
  // A .zip (a whole dossier): its files are taken out beside it and studied one by one.
  if (/\.zip$/i.test(f.name)) {
    const drive = d.drive || (await import('./drive-adapter.js')).driveAdapter;
    const z = await (await import('./zip-pieces.js')).unzipToFolder({ id: f.id, name: f.name }, drive).catch(e => ({ extracted: [], error: String(e.message || e).slice(0, 80) }));
    done[f.id] = { at: new Date().toISOString(), kind: 'archive .zip', lessons: 0, name: f.name, extracted: z.extracted.length, error: z.error || null };
    const known = new Set((s.files || []).map(x => x.id));
    const all = [...(s.files || []), ...z.extracted.filter(x => !known.has(x.id)).map(x => ({ id: x.id, name: x.name, role: 'piece', from_zip: f.name, at: new Date().toISOString() }))];
    await saveSession(s, { files: all, steps: { ...s.steps, _archive: { read: done } } }, d);
    return { done: Object.keys(done).length, total: all.filter(x => !x.removed).length, file: f.name, kind: 'archive .zip : ' + z.extracted.length + ' fichier(s) sorti(s)' + (z.error ? ' — ' + z.error : '') };
  }
  let text = '', visual = null;
  try {
    if (isSheet(f.name)) {
      const drive = d.drive || (await import('./drive-adapter.js')).driveAdapter;
      const peek = await (await import('./sheet-understanding.js')).peekDocument({ id: f.id, name: f.name }, drive, { ...d, maxRows: 20000 });
      text = JSON.stringify(peek).slice(0, 60000);
    } else {
      const r = await (d.fileForAI || (async (id, o) => (await import('./agent-outputs.js')).fileForAI(id, o)))(f.id, { maxChars: 60000 });
      text = String(r.text || ''); if (r.visual) visual = r;
    }
  } catch (e) { done[f.id] = { at: new Date().toISOString(), unreadable: String(e.message || e).slice(0, 100), name: f.name }; await saveSession(s, { steps: { ...s.steps, _archive: { read: done } } }, d); return { done: Object.keys(done).length, total: files.length, file: f.name, unreadable: done[f.id].unreadable }; }
  let out = {};
  try {
    const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: ARCHIVE, maxTokens: 2500, files: visual ? [visual] : undefined,
      input: fitJson({ file_name: f.name, lessons_already_learnt: (await archiveLessons(org, 'enhanced-auditor', null, { gym: true }, d)).slice(0, 10).map(x => x.lesson), text }, 70000, [o => { o.text = o.text.slice(0, 25000); }]) });
    out = parseJsonLoose(r?.text ?? r) || {};
  } catch (e) { return { done: Object.keys(done).length, total: files.length, file: f.name, ai_error: String(e.message || e).slice(0, 120) }; }
  const hide = [...(out.names_to_hide || []), ...String(s.title || '').split(/[\s—–-]+/).filter(w => w.length >= 4 && !/^(projet|audit|mission|exercice|rapport)$/i.test(w))];
  const kept = [];
  for (const l of (Array.isArray(out.lessons) ? out.lessons : []).slice(0, 6)) {
    const agent = Object.hasOwn(AGENTS_ALL, l?.agent) ? l.agent : null; if (!agent || !l.lesson) continue;
    const clean = redact(l.lesson, hide); if (clean.text.length < 20) continue;
    kept.push({ org_id: org, step: 'archive', lesson: clean.text.slice(0, 1200), session_id: s.id, trainer_id: tr.id, trainer_name: tr.name,
      context: { agent, theme: redact(clip(l.theme, 80), hide).text, document_kind: redact(clip(out.document_kind, 120), hide).text, stage: clip(out.stage, 80), redacted: clean.removed } });
  }
  if (kept.length) await (d.fetchRows || rest)('office_gym_lessons', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(kept) });
  done[f.id] = { at: new Date().toISOString(), kind: redact(clip(out.document_kind, 120), hide).text, lessons: kept.length, name: f.name };
  await saveSession(s, { steps: { ...s.steps, _archive: { read: done } } }, d);
  return { done: Object.keys(done).length, total: files.length, file: f.name, kind: done[f.id].kind, lessons: kept.length, finished: Object.keys(done).length >= files.length };
}
const AGENTS_ALL = { 'firm-manager': 1, 'mission-controller': 1, 'enhanced-auditor': 1, orpailleur: 1, sika: 1 };
const redact = redactText;
async function archiveList(org, s, d) {
  const rows = (await (d.fetchRows || rest)(`office_gym_lessons?session_id=eq.${q(s.id)}&step=eq.archive&select=id,lesson,status,context,created_at&order=created_at.asc&limit=500`)) || [];
  const read = s.steps?._archive?.read || {};
  return { lessons: rows.map(r => ({ id: r.id, lesson: r.lesson, status: r.status, agent: r.context?.agent, theme: r.context?.theme, document_kind: r.context?.document_kind, kept: Boolean(r.context?.trainer_kept), on_server: Boolean(r.context?.memory?.id) })),
    read: Object.values(read), files: (s.files || []).filter(f => !f.removed).length, removed: (s.files || []).filter(f => f.removed).length };
}
async function archiveJudge(org, s, body, d) {
  const r = (await (d.fetchRows || rest)(`office_gym_lessons?id=eq.${q(body.lesson_id)}&session_id=eq.${q(s.id)}&select=id,lesson,context,status&limit=1`))?.[0];
  if (!r) throw fail('LESSON_NOT_FOUND', 404);
  const v = String(body.verdict || '');
  let patch;
  if (v === 'drop') patch = { status: 'rejected', context: { ...r.context, trainer_dropped: true } };
  else if (v === 'fix') { const t = redact(String(body.text || ''), []).text; if (t.length < 20) throw fail('EXPLANATION_REQUIRED'); patch = { lesson: t.slice(0, 1200), correct: t.slice(0, 1200), proposed: r.lesson, context: { ...r.context, trainer_kept: true, corrected: true } }; }
  else if (v === 'keep') patch = { context: { ...r.context, trainer_kept: true } };
  else throw fail('UNKNOWN_VERDICT');
  await (d.fetchRows || rest)(`office_gym_lessons?id=eq.${q(r.id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  return archiveList(org, s, d);
}
// The dossier's files go to the Drive bin once everything was read (they are copies: the originals stay on the firm's own server).
async function archiveForget(s, body, d) {
  if (String(body.confirm || '').trim().toUpperCase() !== 'EFFACER') throw fail('TYPE_EFFACER_TO_CONFIRM');
  const read = s.steps?._archive?.read || {}, files = s.files || [];
  const left = files.filter(f => !f.removed && !read[f.id]);
  if (left.length) throw fail('ARCHIVE_NOT_ALL_READ', 409, { left: left.map(f => f.name).slice(0, 20) });
  const trash = d.trashFile || (async id => (await import('./tidy-drive.js')).tidyDrive.trashFile(id));
  const out = [];
  for (const f of files) { if (f.removed) { out.push(f); continue; } try { await trash(f.id); out.push({ id: f.id, name: f.name, role: f.role, removed: new Date().toISOString() }); } catch { out.push(f); } }
  return publicSession(await saveSession(s, { files: out }, d));
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
