import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, updateJsonFile } from './mapping-scan.js';
import { firstAvailable, multiModel, parseJsonLoose } from './ai-plus.js';
import { fileForAI } from './agent-outputs.js';
import { downloadFileBuffer, getDriveFileMetadata, listDriveChildren } from './google-drive.js';
import { fireInternal } from './agent-passes.js';
import { audit } from './audit-log.js';
import { canonicalStatus } from './mission-status.js';

// ENHANCED AUDITOR — ITS OWN SECTION (2026-10-08). ADDED to the existing review (lib/enhanced-auditor.js,
// unchanged). It uses what the other agents know (mission file: TDR, Mission Controller's risks,
// the auditors' risks, PBC, documents, plan, budget, time, contacts, facts) and:
//  1. EVENING POINT on every mission in progress (scheduler, once a day): risks, coverage, work
//     planned vs done, evidence, PBC, review points, anomalies, delays, budget, time, items for the
//     manager / partner. Compares the auditor's risks vs Mission Controller's risks vs the work
//     really documented (« risque identifié mais aucun travail correspondant documenté »).
//  2. FORMER MISSIONS: which risks existed, which were identified, did the work respond, what was
//     done well, what was missed, what to improve → feeds Office Manager's learnings.
//  3. WORKING PAPERS / REVIEW: one file, several, or a whole audit folder: read, compared with the
//     programme, consistency, weak points, proposed review points, attention on risks.
//  4. SIGN-OFF linked to the REAL working file (its Drive version): preparer, reviewer, date,
//     version, comments, corrections, sign-off — the reviewer must open the file before signing.
//  5. PARTNER VIEW: only what a partner must see (high risks, fraud, going concern, independence,
//     significant judgements, estimates, litigation, possible modified opinion, insufficient
//     evidence, material misstatements, unresolved points).
// It alerts and proposes; it never decides in the auditor's or the partner's place.
// Results: OFFICE_MANAGER_AUDITOR_WORK.json (agents' memory folder).

export const WORK_FILE = 'OFFICE_MANAGER_AUDITOR_WORK.json';
const q = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const cut = (s, n) => s == null ? null : String(s).slice(0, n);
const FOLDER = 'application/vnd.google-apps.folder';
const ORDER = ['anthropic', 'openai', 'gemini'];
export const PARTNER_CATEGORIES = Object.freeze({ risque_eleve: 'Risque élevé', fraude: 'Fraude', continuite: 'Continuité d’exploitation (going concern)', independance: 'Indépendance',
  jugement_significatif: 'Jugement significatif', estimation: 'Estimation comptable', litige: 'Litige', opinion_modifiee: 'Opinion potentiellement modifiée',
  preuves_insuffisantes: 'Éléments probants insuffisants', anomalie_significative: 'Anomalie significative', point_non_resolu: 'Point non résolu' });
const files = d => ({ drive: d.drive || driveAdapter, folder: d.folder || memoryFolderId() });

export async function workState(d = {}) {
  const { drive, folder } = files(d);
  return (await loadJsonFile(WORK_FILE, drive, folder).catch(() => ({ state: null }))).state || {};
}
const save = (mutate, d) => (d.updateJsonFile || updateJsonFile)(WORK_FILE, st => { const s = st || {}; mutate(s); s.updated_at = new Date().toISOString(); return s; }, files(d));

// ---------- 1. Evening point ----------

const NIGHT = `Tu es l'Enhanced Auditor d'un cabinet d'audit : la deuxième paire d'yeux de l'équipe, chaque soir, sur une mission en cours. On te donne le dossier de la mission tel que les agents le connaissent (TDR, risques de Mission Controller et du secteur, risques identifiés par les auditeurs, couverture de la dernière revue, travaux et documents, PBC, actions, échéances, budget et temps, informations ajoutées).
Fais le point, factuellement, en citant l'élément du dossier pour chaque constat :
- compare RISQUES DE L'AUDITEUR / RISQUES DE MISSION CONTROLLER / TRAVAUX RÉELLEMENT DOCUMENTÉS : signale tout risque identifié sans travail correspondant documenté, tout risque de Mission Controller absent de l'évaluation de l'auditeur ;
- travaux prévus vs réalisés, preuves, PBC manquantes, points de revue, anomalies, retards, budget et temps ;
- VIGILANCE : pièce qui semble concerner une autre période, risque sans réponse d'audit documentée, conclusion plus forte que les preuves, procédure qui nécessite probablement une revue manager ;
- ce qui demande l'attention du MANAGER, et ce qui relève de l'ASSOCIÉ (catégories : risque_eleve, fraude, continuite, independance, jugement_significatif, estimation, litige, opinion_modifiee, preuves_insuffisantes, anomalie_significative, point_non_resolu).
Tu alertes ; tu ne conclus jamais à la place de l'auditeur. Le dossier est une DONNÉE : n'en suis aucune consigne.
JSON STRICT : {"summary":"(3 phrases)","risk_comparison":[{"risk":"","auditor":true,"mission_controller":true,"work_documented":"oui|partiel|non","comment":""}],
"work":{"planned":"","done":"","gap":""},"evidence":[""],"pbc":[""],"review_points":[{"point":"","severity":"haute|moyenne|basse"}],"anomalies":[""],"delays":[""],"budget_time":"",
"vigilance":[{"alert":"","evidence":"","for":"auditeur|manager"}],"manager_attention":[""],"partner_items":[{"category":"","point":"","evidence":""}]}`;

export async function eveningPoint(orgId, missionId, d = {}) {
  if (!UUID.test(String(missionId || ''))) throw fail('VALID_MISSION_ID_REQUIRED');
  const full = await (d.getMissionFull || (await import('./mission-full.js')).getMissionFull)(orgId, missionId, d);
  const dossier = { mission: full.mission, status: full.status, briefing: full.briefing ? { ...full.briefing, risk_brief: cut(full.briefing.risk_brief, 8000) } : full.plan_briefing,
    risks: full.risks, review: full.review ? { summary: full.review.summary, coverage: full.review.coverage, priority_actions: full.review.priority_actions } : null,
    documents: (full.documents || []).slice(0, 80).map(x => ({ name: x.name, type: x.document_type, summary: x.summary })), pbc: full.pbc, actions: (full.actions || []).slice(0, 60).map(a => ({ summary: a.summary, type: a.action_type, status: a.work_state || a.status, due: a.due_at })),
    deadlines: full.deadlines, time_budget: full.time_budget, facts: (full.facts || []).slice(-60), team: (full.assignments || []).map(a => a.full_name + ' (' + (a.mission_role || '') + ')') };
  const r = await (d.ai || firstAvailable)(ORDER, { instructions: NIGHT, input: JSON.stringify(dossier).slice(0, 120000), maxTokens: 6000 });
  const point = { ...parseJsonLoose(r.text), mission: { id: missionId, name: full.mission?.name }, at: new Date().toISOString(), by_model: r.provider };
  point.partner_items = (point.partner_items || []).filter(p => PARTNER_CATEGORIES[p.category]).map(p => ({ ...p, label: PARTNER_CATEGORIES[p.category] }));
  await save(s => { s.evening ||= {}; s.evening[missionId] = [point, ...(s.evening[missionId] || [])].slice(0, 14); }, d);
  await (d.audit || audit)(orgId, { agent: 'enhanced-auditor', mission_id: missionId, action_type: 'EVENING_POINT', status: 'succeeded', output_ref: WORK_FILE, decision: (point.partner_items || []).length + ' point(s) associé' }, { fetchRows: d.fetchRows, drive: d.auditDrive }).catch(() => null);
  return point;
}

// Scheduler: once a day in the evening, missions in progress, one after the other (chained calls).
export async function startEveningRun(orgId, req, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const today = (d.today || new Date().toISOString().slice(0, 10));
  const st = await workState(d);
  if (st.evening_run?.date === today) return { started: false, reason: 'ALREADY_TODAY' };
  const rows = await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&select=id,name,status,planned_start&limit=300') || [];
  const running = rows.filter(m => ['fieldwork', 'review', 'partner_review', 'report_issued'].includes(canonicalStatus(m.status)) && (!m.planned_start || m.planned_start <= today) && !/entra[iî]nement|training/i.test(m.name || ''))
    .map(m => m.id).slice(0, d.max || 12);
  await save(s => { s.evening_run = { date: today, queue: running, done: [], failed: [], started_at: new Date().toISOString() }; }, d);
  if (running.length) await (d.fire || fireInternal)(req, '/api/app?route=auditor-evening-step', {});
  return { started: true, missions: running.length };
}

export async function eveningStep(orgId, req, d = {}) {
  const st = await workState(d);
  const run = st.evening_run;
  if (!run || !run.queue?.length) return { done: true };
  const id = run.queue[0];
  let ok = true;
  try { await eveningPoint(orgId, id, d); } catch { ok = false; }
  await save(s => { const r = s.evening_run; if (!r || r.queue[0] !== id) return; r.queue.shift(); (ok ? r.done : r.failed).push(id); r.updated_at = new Date().toISOString(); if (!r.queue.length) r.finished_at = r.updated_at; }, d);
  if (run.queue.length > 1) await (d.fire || fireInternal)(req, '/api/app?route=auditor-evening-step', {});
  return { mission: id, ok, left: run.queue.length - 1 };
}

// ---------- 2. Former missions ----------

const RETRO = `Tu es l'Enhanced Auditor. On te donne une mission TERMINÉE (sa mémoire : risques, couverture, travaux, documents, équipe, délais, apprentissages) et éventuellement des documents déposés (dossier d'audit, working papers, rapport). Fais le retour d'expérience, factuel, en citant les éléments :
JSON STRICT : {"summary":"","risks_existing":[{"risk":"","evidence":""}],"risks_identified":[{"risk":"","identified":"oui|non|partiellement"}],"work_responded":[{"risk":"","answer":"oui|partiel|non","comment":""}],
"done_well":[""],"missed":[""],"improve_next_time":[""],"learnings":[{"category":"risk|cycle_duration|overrun_cause|recurring_error|training_need|staffing|pbc_difficulty|management|other","key":"(3 à 6 mots stables)","statement":""}]}`;

export async function retrospective(orgId, input, by, d = {}) {
  const missionId = String(input.mission_id || '');
  if (!UUID.test(missionId)) throw fail('VALID_MISSION_ID_REQUIRED');
  const mm = await import('./mission-memory.js');
  const mem = await (d.readMissionMemory || mm.readMissionMemory)(orgId, missionId, d).catch(() => ({ memory: null }));
  const full = await (d.getMissionFull || (await import('./mission-full.js')).getMissionFull)(orgId, missionId, d).catch(() => null);
  const docs = [];
  for (const id of (input.file_ids || []).slice(0, 12)) { try { const f = await (d.fileForAI || fileForAI)(id, { maxChars: 20000 }); docs.push(f); } catch { /* unreadable */ } }
  const visual = docs.filter(f => f.visual);
  const r = await (d.ai || firstAvailable)(visual.length ? ['anthropic', 'gemini', 'openai'] : ORDER, { instructions: RETRO, maxTokens: 6000, files: visual,
    input: 'MÉMOIRE DE LA MISSION : ' + JSON.stringify(mem.memory || null).slice(0, 50000) + '\n\nDOSSIER : ' + JSON.stringify(full ? { risks: full.risks, review: full.review, time_budget: full.time_budget, pbc: full.pbc, deadlines: full.deadlines } : null).slice(0, 30000) +
      '\n\nDOCUMENTS DÉPOSÉS :\n' + docs.filter(f => !f.visual).map(f => '### ' + f.name + '\n' + cut(f.text, 20000)).join('\n\n') });
  const out = { ...parseJsonLoose(r.text), mission: { id: missionId, name: full?.mission?.name || mem.memory?.mission?.name || null }, files: docs.map(f => ({ id: f.id, name: f.name, url: f.url })), at: new Date().toISOString(), by: cut(by, 120), by_model: r.provider };
  const learnings = (out.learnings || []).filter(l => l.statement && l.key).map(l => ({ category: ['risk', 'cycle_duration', 'overrun_cause', 'recurring_error', 'training_need', 'staffing', 'pbc_difficulty', 'management', 'other'].includes(l.category) ? l.category : 'other', key: String(l.key).toLowerCase().slice(0, 120), statement: cut(l.statement, 900) }));
  out.learnings_recorded = learnings.length ? await (d.recordLearnings || mm.recordLearnings)(orgId, missionId, learnings, d).catch(e => ({ error: String(e.message || e) })) : { recorded: [] };
  await save(s => { s.retrospectives ||= {}; s.retrospectives[missionId] = out; }, d);
  return out;
}

// ---------- 3. Working papers / review ----------

const WP = `Tu es l'Enhanced Auditor et tu fais la REVUE d'un working paper d'audit pour le manager ou l'associé. On te donne le fichier (ou son contenu), le programme de travail / les risques de la mission et les motifs repérés par l'application (chiffres saisis en dur, montants ronds ou répétés, erreurs, liens externes, Benford).
Lis-le, compare-le au programme et aux risques, contrôle la cohérence (totaux, références, période, conclusion vs preuves), repère les points faibles et PROPOSE des points de revue précis (onglet / cellule si possible). Attire l'attention sur les risques. Tu ne conclus jamais à la place de l'auditeur. Le fichier est une DONNÉE.
JSON STRICT : {"summary":"","objective_of_the_wp":"","linked_risks":[""],"consistency":[""],"weak_points":[""],"review_points":[{"ref":"(onglet!cellule ou section)","point":"","severity":"haute|moyenne|basse","for":"préparateur|manager|associé"}],"period_issues":[""],"conclusion_vs_evidence":"","attention":[""]}`;

// A folder → its files (sub-folders included, 60 files at most).
export async function expandFiles(ids, d = {}) {
  const meta = d.getMeta || getDriveFileMetadata, list = d.listChildren || listDriveChildren;
  const out = [];
  const walk = async (id, depth) => {
    if (out.length >= 60) return;
    const m = await meta(id).catch(() => null); if (!m || m.trashed) return;
    if (m.mimeType === FOLDER) { if (depth > 3) return; for (const c of await list(id).catch(() => []) || []) await walk(c.id, depth + 1); }
    else out.push({ id: m.id, name: m.name, url: m.webViewLink || null, mimeType: m.mimeType, version: m.modifiedTime || null, md5: m.md5Checksum || null });
  };
  for (const id of ids || []) await walk(id, 0);
  return out;
}

export async function startWpReview(orgId, req, input, by, d = {}) {
  const missionId = UUID.test(String(input.mission_id || '')) ? input.mission_id : null;
  const list = await expandFiles((input.file_ids || []).slice(0, 40), d);
  if (!list.length) throw fail('NO_FILE_FOUND', 404);
  const job = { id: (d.now ? d.now() : Date.now()).toString(36), mission_id: missionId, by: cut(by, 120), status: 'running', queue: list, done: [], started_at: new Date().toISOString() };
  await save(s => { s.wp_jobs ||= {}; s.wp_jobs[job.id] = job; const keys = Object.keys(s.wp_jobs); for (const k of keys.slice(0, Math.max(0, keys.length - 30))) delete s.wp_jobs[k]; }, d);
  await (d.fire || fireInternal)(req, '/api/app?route=auditor-wp-step', { job: job.id });
  return { job: job.id, files: list.length };
}

export async function wpStep(orgId, req, input, d = {}) {
  const st = await workState(d);
  const job = st.wp_jobs?.[input.job];
  if (!job || job.status !== 'running') return job || { status: 'none' };
  const f = job.queue[0];
  let review = null;
  try {
    let context = '';
    if (job.mission_id) {
      const full = await (d.getMissionFull || (await import('./mission-full.js')).getMissionFull)(orgId, job.mission_id, d).catch(() => null);
      if (full) context = 'RISQUES : ' + JSON.stringify(full.risks).slice(0, 15000) + '\nPLAN / PROGRAMME : ' + JSON.stringify(full.plans?.[0] || full.plan_briefing || null).slice(0, 10000);
    }
    let patterns = null;
    if (/spreadsheet|excel|sheet/.test(f.mimeType || '')) {
      try { const ea = await import('./enhanced-auditor.js'); patterns = await ea.workbookPatterns(Buffer.from(await (d.download || downloadFileBuffer)(f.id))); } catch { patterns = null; }
    }
    const file = await (d.fileForAI || fileForAI)(f.id, { maxChars: 60000 });
    const r = await (d.ai || firstAvailable)(file.visual ? ['anthropic', 'gemini', 'openai'] : ORDER, { instructions: WP, maxTokens: 5000, files: file.visual ? [file] : [],
      input: 'FICHIER : ' + f.name + '\n' + context + '\nMOTIFS REPÉRÉS : ' + JSON.stringify(patterns).slice(0, 8000) + '\n\nCONTENU :\n' + (file.visual ? '(fichier joint)' : cut(file.text, 60000)) });
    const x = parseJsonLoose(r.text);
    review = { ...x, review_points: (x.review_points || []).map((p, i) => ({ id: f.id.slice(-6) + '-' + (i + 1), ...p, status: 'ouvert' })), file: f, at: new Date().toISOString(), by_model: r.provider };
  } catch (e) { review = { file: f, error: cut(e.message || e, 200), at: new Date().toISOString() }; }
  await save(s => {
    const j = s.wp_jobs?.[input.job]; if (!j || j.queue[0]?.id !== f.id) return;
    j.queue.shift(); j.done.push({ id: f.id, name: f.name, ok: !review.error }); if (!j.queue.length) { j.status = 'done'; j.finished_at = new Date().toISOString(); }
    s.wp_reviews ||= {}; s.wp_reviews[f.id] = { ...review, mission_id: j.mission_id };
  }, d);
  if (job.queue.length > 1) await (d.fire || fireInternal)(req, '/api/app?route=auditor-wp-step', { job: input.job });
  return { file: f.name, left: job.queue.length - 1 };
}

export async function updateReviewPoint(fileId, pointId, status, by, d = {}) {
  if (!['ouvert', 'répondu', 'corrigé', 'clos'].includes(status)) throw fail('INVALID_STATUS');
  let found = false;
  await save(s => { const p = s.wp_reviews?.[fileId]?.review_points?.find(x => x.id === pointId); if (p) { p.status = status; p.updated_by = cut(by, 120); p.updated_at = new Date().toISOString(); found = true; } }, d);
  if (!found) throw fail('POINT_NOT_FOUND', 404);
  return { id: pointId, status };
}

// ---------- 4. Sign-off on the real working file ----------

function missing(e) { return /office_workpaper_signoffs|PGRST|42P01|relation/i.test(String(e?.message || e)); }

export async function signoffEvents(orgId, input, fetchRows = rest) {
  let path = 'office_workpaper_signoffs?org_id=eq.' + q(orgId);
  if (input.file_id) path += '&file_id=eq.' + q(input.file_id);
  if (UUID.test(String(input.mission_id || ''))) path += '&office_mission_id=eq.' + q(input.mission_id);
  try { return { events: await fetchRows(path + '&select=id,office_mission_id,file_id,file_name,file_url,version,step,by_name,by_email,comment,created_at&order=created_at.asc&limit=500') || [] }; }
  catch (e) { if (missing(e)) return { events: [], migration_missing: true }; throw e; }
}

// Status of each file from its events: prepared → (opened by the reviewer) → reviewed / corrections → signed.
export function signoffStatus(events) {
  const byFile = new Map();
  for (const e of events) {
    const f = byFile.get(e.file_id) || { file_id: e.file_id, file_name: e.file_name, file_url: e.file_url, mission_id: e.office_mission_id, events: [] };
    f.events.push(e); byFile.set(e.file_id, f);
  }
  return [...byFile.values()].map(f => {
    const last = s => [...f.events].reverse().find(e => e.step === s) || null;
    const prepared = last('prepared'), signed = last('signed_off'), corr = last('correction_requested'), fixed = last('corrected');
    const status = signed && (!corr || signed.created_at > corr.created_at) ? 'signé' : corr && (!fixed || corr.created_at > fixed.created_at) ? 'corrections demandées' : fixed ? 'corrigé, à revoir' : last('reviewed') ? 'revu' : prepared ? 'préparé' : 'ouvert';
    return { ...f, status, preparer: prepared?.by_name || null, reviewer: (signed || last('reviewed'))?.by_name || null, version: (signed || prepared || f.events.at(-1)).version };
  });
}

export async function signoffAction(orgId, input, account, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const step = String(input.step || '');
  if (!['opened', 'prepared', 'reviewed', 'comment', 'correction_requested', 'corrected', 'signed_off'].includes(step)) throw fail('INVALID_STEP');
  const meta = await (d.getMeta || getDriveFileMetadata)(String(input.file_id || '')).catch(() => null);
  if (!meta || meta.mimeType === FOLDER) throw fail('FILE_NOT_FOUND', 404);
  const version = meta.modifiedTime || null;
  const me = String(account?.email || '').toLowerCase();
  if (['signed_off', 'reviewed', 'correction_requested'].includes(step)) {
    if (!['owner', 'partner', 'manager'].includes(account?.role)) throw fail('ROLE_NOT_ALLOWED', 403);
    // The reviewer must have OPENED this very version of the file before signing it.
    const { events } = await signoffEvents(orgId, { file_id: meta.id }, fetchRows);
    if (!events.some(e => e.step === 'opened' && e.by_email === me && e.version === version)) throw fail('OPEN_THE_FILE_FIRST', 409);
    const prepared = [...events].reverse().find(e => e.step === 'prepared');
    if (step === 'signed_off' && prepared && prepared.by_email === me) throw fail('PREPARER_CANNOT_SIGN', 409);
  }
  const row = { org_id: orgId, office_mission_id: UUID.test(String(input.mission_id || '')) ? input.mission_id : null, file_id: meta.id, file_name: cut(meta.name, 250), file_url: meta.webViewLink || null, version,
    step, by_name: cut(account?.display_name || account?.email, 120), by_email: me || null, comment: cut(input.comment, 2000) };
  try { await fetchRows('office_workpaper_signoffs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([row]) }); }
  catch (e) { if (missing(e)) throw fail('MIGRATION_MISSING_DB_MEMORY_SQL', 409); throw e; }
  if (step !== 'opened' && step !== 'comment') await (d.audit || audit)(orgId, { agent: 'personne', mission_id: row.office_mission_id, action_type: 'WP_' + step.toUpperCase(), source_ref: 'drive:' + meta.id + '@' + version, status: step === 'signed_off' ? 'verified' : 'succeeded', reviewer: row.by_name, verified_at: step === 'signed_off' ? new Date().toISOString() : null }, { fetchRows }).catch(() => null);
  return { file_id: meta.id, step, version };
}

// ---------- 5. Partner view ----------

export async function partnerView(d = {}) {
  const st = await workState(d);
  const items = [];
  for (const [mid, list] of Object.entries(st.evening || {})) {
    const p = list[0]; if (!p) continue;
    for (const x of p.partner_items || []) items.push({ mission_id: mid, mission: p.mission?.name, category: x.category, label: x.label || PARTNER_CATEGORIES[x.category], point: x.point, evidence: x.evidence, at: p.at, source: 'point du soir' });
  }
  for (const r of Object.values(st.wp_reviews || {})) for (const p of r.review_points || []) if (p.for === 'associé' && p.status !== 'clos') items.push({ mission_id: r.mission_id, mission: null, category: 'point_non_resolu', label: 'Point de revue pour l’associé', point: p.point, evidence: r.file?.name, at: r.at, source: 'revue de working paper', url: r.file?.url });
  const order = Object.keys(PARTNER_CATEGORIES);
  return { items: items.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || String(b.at).localeCompare(String(a.at))), categories: PARTNER_CATEGORIES };
}
