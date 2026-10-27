// Historical missions teach the firm's agents; source documents never leave this
// workflow for the central Lab. Existing mission memory and Shadow remain canonical.
import { createHash, randomUUID } from 'node:crypto';
import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { configuredDriveId } from './google-drive.js';
import { memoryFolderId } from './memory-runtime.js';
import { strictMemory } from './mission-shared-memory.js';
import { updateMissionRegister } from './mission-register.js';
import { LAB_FILE, emptyLab, mergeLesson, AGENT_KEYS, invalidateLessonCache } from './shadow.js';
import { canonicalStatus } from './mission-status.js';
import { agentPermissions } from './agent-permissions.js';
import { firstAvailable } from './ai-plus.js';
import { readDocumentWindow, contentRevision } from './document-content.js';
import { recordMissionDocuments } from './mission-files.js';
import { noteMission } from './mission-brief.js';
import { labSemanticMemoryStore, eynowaLabConfigured } from './eynowa-lab-client.js';

export const LEARNING_TARGET = 5;
const FOLDER = 'application/vnd.google-apps.folder', q = encodeURIComponent;
const fail = (s, statusCode = 409) => Object.assign(new Error(s), { statusCode });
const hash = s => createHash('sha256').update(s).digest('hex');
const finished = m => ['closed', 'archived'].includes(canonicalStatus(m.status));
const lead = a => { if (!['owner', 'partner'].includes(a?.role)) throw fail('ROLE_NOT_ALLOWED', 403); };
const json = x => JSON.stringify(x);
const text = (v, max = 600) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const flatten = v => typeof v === 'string' ? v : Array.isArray(v) ? v.map(flatten).join('\n') : v && typeof v === 'object' ? Object.values(v).map(flatten).join('\n') : String(v ?? '');

const INSTRUCTIONS = `Tu étudies une mission TERMINÉE pour comprendre la méthode réellement appliquée, sans modifier ses pièces ni ses conclusions.
Lis les documents par leur contenu, notamment le SOP et le working file rempli ; recherche les liens pièce → traitement → cellule/résultat. Ne suppose pas que tout ancien travail est correct. Distingue méthode observée, erreur possible et règle réutilisable. Les noms ne servent que d'indices.
Une seule réponse JSON : {"inspect":{"file_id":"id","page":1,"sheet":"facultatif","row_from":1,"column_from":1,"offset":0,"cell":"facultatif"}} pour demander une lecture ; ou {"catalog_page":0} pour une autre page de 30 pièces ; ou {"finish":{"summary":"compréhension avec limites", "questions":["à confirmer"],"lessons":[{"agent":"orpailleur|mission-controller|grand-controleur|enhanced-auditor|sika|shadow","rule":"méthode proposée, 400 caractères maximum","evidence":[{"window_id":"id fourni","quote":"citation exacte du passage lu, 240 caractères maximum"}]}]}}.
Demande toutes les pages/plages nécessaires. La lecture d'un extrait n'est pas celle du document entier. Les lecteurs renvoient les limites et continuations. Chaque pièce doit avoir au moins une lecture réussie avant de terminer ; les erreurs doivent être signalées. Une leçon a au moins une preuve effectivement lue. Les leçons restent proposées jusqu'à la validation humaine. Tu n'as aucun outil d'écriture métier.`;

async function load(org, d) {
  const r = await (d.readState || strictMemory)(LAB_FILE, d.folder || memoryFolderId(), d.drive || driveAdapter);
  const st = r.state || emptyLab();
  if (st.completed_learning?.org_id && st.completed_learning.org_id !== org) throw fail('LEARNING_SCOPE_MISMATCH', 403);
  return st;
}
async function mutate(org, fn, d) {
  let result;
  await (d.updateState || updateMissionRegister)(LAB_FILE, st => {
    st ||= emptyLab();
    const learning = (st.completed_learning ||= { org_id: org, samples: [] });
    if (learning.org_id !== org) throw fail('LEARNING_SCOPE_MISMATCH', 403);
    result = fn(learning, st); return st;
  }, { orgId: org, drive: d.drive || driveAdapter, folder: d.folder || memoryFolderId(), fetchRows: d.fetchRows });
  return result;
}
async function mission(org, id, d) {
  const m = (await (d.fetchRows || rest)(`office_missions?org_id=eq.${q(org)}&id=eq.${q(id)}&select=id,name,status,drive_folder_id&limit=1`))?.[0];
  if (!m || !finished(m)) throw fail('COMPLETED_MISSION_REQUIRED');
  return m;
}
// Verify ancestry, not a client-supplied Drive id or a folder name.
async function inDrive(id, d) {
  const root = await (d.root || configuredDriveId)();
  if (!root || id === root) throw fail('MISSION_SUBFOLDER_REQUIRED');
  const drive = d.drive || driveAdapter, seen = new Set(); let current = id;
  for (let depth = 0; depth < 100 && current && !seen.has(current); depth++) {
    if (current === root) return;
    seen.add(current); const m = await drive.getMeta(current);
    if (!m || m.trashed || m.mimeType !== FOLDER) break;
    if (m.driveId === root || m.parents?.includes(root)) return;
    current = m.parents?.[0];
  }
  throw fail('FOLDER_OUTSIDE_FIRM_DRIVE', 403);
}
async function unchanged(s, d) {
  const drive = d.drive || driveAdapter;
  for (const [id, receipt] of Object.entries(s.receipts || {})) {
    if (!receipt.revision || contentRevision(await drive.getMeta(id)) !== receipt.revision) throw fail('LEARNING_SOURCE_CHANGED_RESTART');
  }
}
function viewSample(s) {
  return { id: s.id, name: s.name, mission_id: s.mission_id, status: s.status, seq: s.seq, documents: s.documents.length,
    read: Object.keys(s.receipts).length, folders_left: s.folders.length, result: s.result || null,
    errors: s.errors || [], memory_saved: s.memory_saved || false, share: s.share ? { status: s.share.status, text: s.share.text, error: s.share.error || null } : null };
}
export async function completedLearningView(org, account, d = {}) {
  lead(account);
  const st = await load(org, d), samples = st.completed_learning?.samples || [];
  return { target: LEARNING_TARGET, validated: samples.filter(s => s.status === 'validated').length, samples: samples.map(viewSample),
    lab_connected: (d.labReady || eynowaLabConfigured)(), memories: { central: 'Mémoire propre à chaque agent du cabinet', mission: 'Mémoire unique de mission partagée par les agents autorisés' } };
}

export async function completedLearningAction(org, account, body = {}, d = {}) {
  lead(account);
  if (!(await (d.permissions || agentPermissions)(org, d.fetchRows))?.granted) throw fail('AGENTS_NOT_AUTHORIZED', 403);
  const drive = d.drive || driveAdapter, fetchRows = d.fetchRows || rest;
  if (body.action === 'add') {
    if (body.completed !== true) throw fail('COMPLETED_CONFIRMATION_REQUIRED', 400);
    const folder = text(body.folder_id, 180);
    if (!/^[\w-]+$/.test(folder)) throw fail('INVALID_FOLDER_ID', 400);
    const existing = (await load(org, d)).completed_learning?.samples || [];
    const again = existing.find(s => s.folder_id === folder);
    if (again) return viewSample(again);
    if (existing.length >= LEARNING_TARGET) throw fail('FIVE_MISSIONS_ALREADY_SELECTED');
    await inDrive(folder, d);
    const meta = await drive.getMeta(folder), name = text(body.name, 160) || meta.name;
    // A historical folder becomes a closed mission, never a new live engagement.
    let matches = await fetchRows(`office_missions?org_id=eq.${q(org)}&drive_folder_id=eq.${q(folder)}&select=id,name,status,drive_folder_id&limit=2`);
    if (matches.length > 1) throw fail('MISSION_FOLDER_AMBIGUOUS');
    let m = matches[0];
    if (m && !finished(m)) throw fail('COMPLETED_MISSION_REQUIRED');
    if (!m) {
      const h = hash(org + '|completed-learning|' + folder);
      const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
      await fetchRows('office_missions?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: json({ id, org_id: org, name, status: 'closed', drive_folder_id: folder }) });
      m = await mission(org, id, d);
    }
    return mutate(org, l => {
      const old = l.samples.find(s => s.mission_id === m.id); if (old) return viewSample(old);
      if (l.samples.length >= LEARNING_TARGET) throw fail('FIVE_MISSIONS_ALREADY_SELECTED');
      const s = { id: randomUUID(), mission_id: m.id, folder_id: folder, name, seq: 0, status: 'cataloguing', folders: [folder], visited: [],
        documents: [], receipts: {}, windows: [], errors: [], page: 0, created_by: account.email, completed_attested_at: new Date().toISOString() };
      l.samples.push(s); return viewSample(s);
    }, d);
  }
  const state = await load(org, d), sample = state.completed_learning?.samples.find(s => s.id === body.id);
  if (!sample) throw fail('LEARNING_SAMPLE_NOT_FOUND', 404);
  const s = structuredClone(sample), m = await mission(org, s.mission_id, d);
  if (m.drive_folder_id !== s.folder_id) throw fail('LEARNING_FOLDER_CHANGED');
  await inDrive(s.folder_id, d);
  if (body.seq !== s.seq) throw fail('LEARNING_STALE_REFRESH');
  const save = () => mutate(org, l => {
    const n = l.samples.findIndex(x => x.id === s.id);
    if (n < 0 || l.samples[n].seq !== sample.seq) throw fail('LEARNING_STALE_REFRESH');
    s.seq++; l.samples[n] = s; return viewSample(s);
  }, d);
  if (body.action === 'restart') {
    if (s.status === 'validated') throw fail('VALIDATED_LEARNING_IMMUTABLE');
    Object.assign(s, { status: 'cataloguing', folders: [s.folder_id], visited: [], documents: [], receipts: {}, windows: [], errors: [], page: 0, pending: null, result: null });
    return save();
  }
  if (body.action === 'step') {
    if (!['cataloguing', 'reading'].includes(s.status)) return viewSample(s);
    await unchanged(s, d);
    if (s.folders.length) {
      const folder = s.folders[0];
      await inDrive(folder, d);
      const children = await drive.listChildren(folder);
      for (const child of children) {
        if (child.trashed || child.parents?.length && !child.parents.includes(folder)) continue;
        if (child.mimeType === FOLDER) {
          if (!s.visited.includes(child.id) && !s.folders.includes(child.id) && !['_OFFICE_MANAGER', '00_OFFICE_MANAGER'].includes(child.name)) s.folders.push(child.id);
        } else if (!s.documents.some(doc => doc.id === child.id)) s.documents.push({ id: child.id, name: child.name, mimeType: child.mimeType });
      }
      if (s.documents.length > 5000 || s.visited.length > 2000) throw fail('LEARNING_FOLDER_TOO_LARGE');
      s.folders.shift(); s.visited.push(folder); if (!s.folders.length) s.status = 'reading';
      return save();
    }
    if (s.pending) {
      const request = s.pending, doc = s.documents.find(x => x.id === request.file_id);
      if (!doc) throw fail('PIECE_NOT_IN_MISSION', 403);
      try {
        const r = await (d.readWindow || readDocumentWindow)(doc, drive, request);
        if (!r.revision || r.window?.error) throw fail(r.window?.error || 'SOURCE_VERSION_REQUIRED');
        const window = { window_id: randomUUID(), file_id: doc.id, revision: r.revision, request, window: r.window };
        s.windows.push(window); s.windows = s.windows.slice(-12);
        s.receipts[doc.id] = { revision: r.revision, coverage: 'partial', last_window_id: window.window_id };
        s.errors = s.errors.filter(e => e.file_id !== doc.id);
      } catch (e) { s.errors = [...s.errors.filter(x => x.file_id !== doc.id), { file_id: doc.id, error: String(e.message).slice(0, 120) }]; }
      s.pending = null; return save();
    }
    const r = await (d.ai || firstAvailable)(null, { instructions: INSTRUCTIONS, input: json({ task: 'Apprendre la méthode de cette mission terminée',
      mission: { name: s.name, status: m.status }, catalog_page: s.page, catalog_total: s.documents.length,
      catalog: s.documents.slice(s.page * 30, s.page * 30 + 30), receipts: s.receipts, windows: s.windows,
      errors: s.errors, prior_questions: s.questions || [] }), maxTokens: 6000 });
    let answer; try { const t = r.text; answer = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { throw fail('LEARNING_AI_INVALID_JSON'); }
    if (Number.isInteger(answer.catalog_page) && answer.catalog_page >= 0 && answer.catalog_page < Math.max(1, Math.ceil(s.documents.length / 30))) s.page = answer.catalog_page;
    else if (answer.inspect) {
      const a = answer.inspect;
      if (!s.documents.some(x => x.id === a.file_id)) throw fail('PIECE_NOT_IN_MISSION', 403);
      for (const key of ['page', 'row_from', 'column_from', 'offset']) if (a[key] !== undefined && (!Number.isInteger(a[key]) || a[key] < (key === 'offset' ? 0 : 1))) throw fail('DOCUMENT_RANGE_INVALID', 400);
      s.pending = Object.fromEntries(['file_id', 'page', 'sheet', 'row_from', 'column_from', 'offset', 'cell'].filter(k => a[k] !== undefined).map(k => [k, a[k]]));
    } else if (answer.finish) {
      // No filename gate and no unseen source accepted as learned.
      const unread = s.documents.find(x => !s.receipts[x.id]);
      if (unread) { s.questions = ['Lecture encore nécessaire : ' + unread.id]; s.pending = { file_id: unread.id }; return save(); }
      if (!s.documents.length) throw fail('NO_DOCUMENTS_IN_SAMPLE');
      const finish = answer.finish;
      if (!text(finish.summary, 1800)) throw fail('LEARNING_SUMMARY_REQUIRED');
      const lessons = (Array.isArray(finish.lessons) ? finish.lessons : []).slice(0, 24).map(l => {
        if (!AGENT_KEYS.includes(l.agent) || !text(l.rule, 400) || !Array.isArray(l.evidence) || !l.evidence.length) throw fail('LEARNING_EVIDENCE_REQUIRED');
        const evidence = l.evidence.slice(0, 6).map(e => {
          const w = s.windows.find(x => x.window_id === e.window_id), quote = text(e.quote, 240);
          if (!w || !quote || !flatten(w.window).includes(quote)) throw fail('LEARNING_EVIDENCE_NOT_FOUND');
          return { file_id: w.file_id, revision: w.revision, quote, request: w.request };
        });
        return { agent: l.agent, rule: text(l.rule, 400), evidence };
      });
      s.result = { summary: text(finish.summary, 1800), questions: (Array.isArray(finish.questions) ? finish.questions : []).map(x => text(x)).slice(0, 20), lessons, coverage: 'Passages lus ; couverture documentaire partielle, voir les coordonnées des preuves.' };
      s.status = 'review'; s.windows = []; s.provider = r.provider;
    } else throw fail('LEARNING_AI_INVALID_INSTRUCTION');
    return save();
  }
  if (body.action === 'validate') {
    if (s.status === 'validated') return viewSample(s);
    if (s.status !== 'review' || body.confirm !== true) throw fail('LEARNING_REVIEW_REQUIRED');
    await unchanged(s, d);
    // Shared mission knowledge is written through the existing canonical services.
    await (d.recordDocuments || recordMissionDocuments)({ ...m, org_id: org }, s.documents.map(doc => ({ ...doc,
      uses: [{ what: 'apprentissage : ' + s.result.lessons.filter(l => l.evidence.some(e => e.file_id === doc.id)).map(l => l.rule).join('; ').slice(0, 600), where: 'completed-learning:' + s.id }],
      event: { agent: 'shadow', what: 'apprentissage de mission terminée validé', detail: 'Passages lus, couverture partielle ; version ' + s.receipts[doc.id].revision, by: account.email } })), { ...d, orgId: org });
    await (d.noteMission || noteMission)(org, m.id, { agent: 'shadow', kind: 'fait', text: s.result.summary, source: 'completed-learning:' + s.id, by: account.email }, { ...d, orgId: org });
    const approved = await mutate(org, (l, lab) => {
      const cur = l.samples.find(x => x.id === s.id); if (cur.seq !== s.seq) throw fail('LEARNING_STALE_REFRESH');
      if (cur.status === 'validated') return viewSample(cur);
      for (const lesson of s.result.lessons) {
        const r = mergeLesson(lab, { agent: lesson.agent, lesson: lesson.rule, rule: lesson.rule, category: 'missions terminées', type: 'experience_lesson',
          mission_id: body.cabinet_method === true ? null : m.id, source: 'completed-learning:' + s.id, evidence: lesson.evidence.map(e => e.file_id + ':' + e.revision), confidence: 'moyenne', match_exact: true });
        if (!r) throw fail('LEARNING_PROTECTED_LESSON_REQUIRES_REVIEW');
        Object.assign(r.lesson, { status: 'active', needs_owner: false, validated_by: account.email, validated_at: new Date().toISOString() });
      }
      Object.assign(cur, { status: 'validated', memory_saved: true, validated_by: account.email, cabinet_method: body.cabinet_method === true, seq: cur.seq + 1 });
      return viewSample(cur);
    }, d);
    invalidateLessonCache();
    return approved;
  }
  if (body.action === 'prepare-share') {
    if (s.status !== 'validated' || body.non_confidential !== true) throw fail('LEARNING_SHARE_REVIEW_REQUIRED');
    const lessonText = text(body.text, 6000);
    if (lessonText.length < 30 || /https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{5,}\b/i.test(lessonText)) throw fail('GENERIC_LESSON_TEXT_REQUIRED', 400);
    s.share = { id: s.share?.id || randomUUID(), text: lessonText, status: 'prepared', approved_by: account.email, at: new Date().toISOString() };
    return save();
  }
  if (body.action === 'send-share') {
    if (s.status !== 'validated' || !s.share || !['prepared', 'failed', 'sent'].includes(s.share.status) || body.confirm !== true) throw fail('LEARNING_SHARE_REVIEW_REQUIRED');
    if (s.share.status === 'sent') return viewSample(s);
    // Explicit allowlist: no org, mission, source ids, quotations, amounts or document metadata.
    const payload = { id: 'lesson-' + s.share.id + '-' + hash(s.share.text).slice(0, 12), collection: 'firm_manager_candidate_lessons',
      text: s.share.text, metadata: { schema: 'firm-manager.generic-lesson/1', status: 'candidate', purpose: 'central_review' } };
    try {
      const result = await (d.sendLesson || labSemanticMemoryStore)(payload);
      if (result?.stored !== true || result.id !== payload.id) throw fail('LAB_STORAGE_NOT_CONFIRMED');
      s.share.status = 'sent'; s.share.error = null;
    } catch (e) { s.share.status = 'failed'; s.share.error = String(e.message).slice(0, 160); }
    return save();
  }
  throw fail('UNKNOWN_LEARNING_ACTION', 400);
}
