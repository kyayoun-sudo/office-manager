import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { runAI } from './ai.js';
import { loadScan, loadJsonFile, saveJsonFile } from './mapping-scan.js';
import { proposeMessage } from './agent-mail.js';
import { getDriveFileMetadata } from './google-drive.js';
import { fireInternal } from './agent-passes.js';

// « Ranger » — last stage of the FIRST SCAN (Paul, 2026-10-07: « l'app lit avec l'IA, comprend où
// vont les choses, déplace ou renomme au bon endroit ; quand c'est ambigu, elle écrit à la personne
// qui a enregistré le fichier pour qu'elle explique »).
// The AI reads the firm's folder structure, what it understood of the firm (missions, clients,
// owner's answers) and the files batch by batch, and decides for each one: in its place / move /
// rename / ask. Moves and renames become proposals in « À valider » (the app does them in the Drive
// only after a manager's approval, lib/action-executor.js FILE_MOVE). « Ask » becomes a message to
// the colleague who last saved the file, also waiting in « À valider ». Progress lives in the
// agents' Drive memory (00_OFFICE_MANAGER).

const STATE = 'OFFICE_MANAGER_TIDY_STATE.json';
const KNOWLEDGE = 'OFFICE_MANAGER_FIRM_KNOWLEDGE.json';
const FOLDER = 'application/vnd.google-apps.folder';
const BATCH = 40;          // files read (content excerpt) per step
const EXCERPT = 1800;
const MAX_FILES = 1500;
const q = encodeURIComponent;

const INSTRUCTIONS = `Tu es l'Orpailleur. Tu ranges le Google Drive d'un cabinet (audit, expertise, conseil).
On te donne : les dossiers existants (id | chemin), des EXEMPLES de dossiers de mission tels que le cabinet les organise, ce que tu sais du cabinet (missions, clients, réponses du propriétaire, règles), et des fichiers avec un EXTRAIT DE LEUR CONTENU.
LIS le contenu : un programme de travail, une lettre de mission, un budget dit de quel client, quelle mission (type, exercice) il s'agit.
Pour CHAQUE fichier, décide :
- "ok" : déjà au bon endroit avec un nom clair ;
- "move" : il va dans un dossier qui existe déjà (to_folder_id = un id de la liste, jamais inventé) ;
- "create_and_move" : le dossier de SA mission n'existe pas encore : crée-le en suivant EXACTEMENT la STRUCTURE DU CABINET donnée plus bas (même ordre des niveaux, mêmes façons d'écrire les noms) — par exemple si le cabinet range TYPE DE MISSION / ANNÉE / CLIENT, un audit 2025 de Nova Distribution va sous le dossier AUDIT existant, dans l'année 2025 (créée si elle manque), puis le dossier Nova Distribution ; create_parent_id = l'id du DERNIER dossier existant de ce chemin, create_names = les niveaux manquants dans l'ordre ; puis range le fichier dedans ;
- "rename" / "move_rename" : le nom ne dit pas ce que c'est (new_name, garde l'extension, selon la façon de nommer du cabinet) ;
- "ask" : même après lecture tu ne peux pas savoir — écris la question pour la personne qui l'a enregistré.
Les documents peuvent être en français OU en anglais (engagement letter, audit programme, working papers, payroll, bank statements, invoices…) : lis-les dans leur langue et range-les de la même façon ; les nouveaux noms suivent la façon de nommer du cabinet (sa langue, ses préfixes) ; une question à un collègue est écrite dans la langue du fichier si le collègue l'a écrit en anglais, sinon en français.
Règles : ne déplace jamais un fichier déjà dans le bon dossier de sa mission ; ne touche pas au dossier mémoire des agents (… AI MANAGER, Atelier mémoire) ; un fichier de mission ne reste pas en vrac : ni à la racine, ni directement dans un dossier de type ou d'année, ni à la racine d'un dossier client s'il appartient à une mission. Respecte la structure existante : ne renomme ni ne supprime aucun dossier du cabinet.
Pour chaque décision, donne confidence : "haute" seulement si le contenu dit clairement le client, la mission et l'année ET que la destination suit la structure ; sinon "moyenne" ou "basse".
Pour chaque fichier, dis aussi ce qu'il EST (pour la recherche du cabinet) : doc_type (ex. grand livre, balance générale, relevé bancaire, lettre de mission, programme de travail, facture, contrat, états financiers, PV…), client, period (exercice ou date) et summary (une phrase), d'après son contenu.
Réponds en JSON STRICT : {"decisions":[{"file_id":"","action":"ok|move|create_and_move|rename|move_rename|ask","confidence":"haute|moyenne|basse","to_folder_id":"","create_parent_id":"","create_names":[""],"new_name":"","reason":"","question":"","doc_type":"","client":"","period":"","summary":""}]}`;

function parseJson(text) {
  const t = String(text || ''); const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('TIDY_PLAN_UNREADABLE');
  return JSON.parse(t.slice(a, b + 1));
}

// How the firm organises its missions, read from its own tree (2026-10-08: « Nova Distribution devait
// aller dans AUDIT, l'année en question, et sous l'année créer Nova — respecter la structure »).
// Year folders tell the order: TYPE / ANNÉE / CLIENT (year between) or CLIENT / ANNÉE (year below).
const YEAR_RE = /^(?:fy|ex(?:ercice)?|année|annee|year)?[\s_\-]*((?:19|20)\d\d)$/i;
export function firmStructure(items) {
  const folders = (items || []).filter(i => i.mimeType === FOLDER && !/00_OFFICE_MANAGER|AI MANAGER|atelier/i.test(i.path || ''));
  const byId = new Map(folders.map(f => [f.id, f]));
  const kids = new Map();
  for (const f of folders) for (const p of f.parents || []) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(f); }
  const typeYearClient = [], clientYear = [];
  for (const y of folders.filter(f => YEAR_RE.test(String(f.name).trim()))) {
    const parent = byId.get((y.parents || [])[0]);
    const under = (kids.get(y.id) || []).filter(c => !YEAR_RE.test(c.name));
    if (parent && under.length >= 1 && (kids.get(parent.id) || []).filter(c => YEAR_RE.test(c.name)).length >= 1) {
      // Several years side by side under a parent that holds clients below them: TYPE / ANNÉE / CLIENT.
      if (under.length >= 2 || /audit|cac|commissariat|expertise|conseil|revue|mission|due|fiscal|social|juridique/i.test(parent.name)) typeYearClient.push(y.path + '/' + under[0].name);
      else clientYear.push(y.path);
    } else if (parent) clientYear.push(y.path);
  }
  const pattern = typeYearClient.length >= clientYear.length && typeYearClient.length ? 'TYPE DE MISSION / ANNÉE / CLIENT / (sous-dossiers de la mission)'
    : clientYear.length ? 'CLIENT / ANNÉE (ou mission-année) / (sous-dossiers de la mission)' : null;
  return { pattern, examples: (pattern && pattern.startsWith('TYPE') ? typeYearClient : clientYear).slice(0, 12) };
}

// Files worth looking at first: loose files near the top, « à revoir » / inbox folders, unclear names.
// seen: what the Orpailleur already decided ({ fileId: modifiedTime }) — not looked at again unless modified.
export function tidyCandidates(items, seen = {}) {
  const files = (items || []).filter(i => i.mimeType !== FOLDER && !/00_OFFICE_MANAGER|OFFICE_MANAGER_|AI MANAGER|atelier m/i.test(i.path || i.name || ''))
    .filter(i => !seen[i.id] || (i.modifiedTime && String(i.modifiedTime) > String(seen[i.id])));
  const score = i => {
    const p = i.path || '', depth = p.split('/').length;
    let s = Math.max(0, 6 - depth);
    if (/(a[_ ]?revoir|à revoir|inbox|divers|scan|téléchargement|download|nouveau dossier|sans titre|untitled|temp)/i.test(p)) s += 5;
    if (/^(scan|img|doc|document|copie|copy|untitled|sans titre)[\s_\-]*\d*/i.test(i.name || '')) s += 4;
    return s;
  };
  return files.map(i => ({ i, s: score(i) })).sort((a, b) => b.s - a.s).slice(0, MAX_FILES).map(x => x.i);
}

export async function tidyStatus(d = {}) {
  const { state } = await loadJsonFile(STATE, d.drive || driveAdapter, d.folder || memoryFolderId());
  return state || { status: 'none' };
}

// Work started and not finished is FINISHED first (« il s'est arrêté en route »), never redone.
const unfinished = s => s && ['planning', 'failed'].includes(s.status) && (s.total == null || (s.done || 0) < (s.mode === 'changes' ? (s.files || []).length : s.total || Infinity));

export async function startTidyPlan(orgId, req, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const { fileId, state: prev } = await loadJsonFile(STATE, drive, folder);
  if (unfinished(prev) && (prev.done || 0) > 0) {
    await saveJsonFile(STATE, drive, folder, fileId, { ...prev, status: 'planning', error: null, resumed_at: new Date().toISOString() });
    await (d.fire || fireInternal)(req, '/api/app?route=tidy-plan-step', {});
    return { started: true, resumed: true, done: prev.done, total: prev.total || null };
  }
  await saveJsonFile(STATE, drive, folder, fileId, { status: 'planning', mode: 'first-scan', started_at: new Date().toISOString(), last_pass_at: prev?.last_pass_at || null, seen: prev?.seen || {}, done: 0, moves: 0, renames: 0, questions: 0, ok: 0, auto: 0 });
  await (d.fire || fireInternal)(req, '/api/app?route=tidy-plan-step', {});
  return { started: true };
}

// A pass of the Orpailleur (08:00, 12:00, 20:00 or « Lancer maintenant »). It looks at the date of
// its last pass (kept in its Drive memory) and controls only the files created, uploaded or
// modified in the Drive since then: same reading and decisions as the first scan. The date moves
// forward only when the pass is finished, so nothing is missed if a pass stops half-way.
export async function startChangesPass(orgId, req, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const { fileId, state: prev } = await loadJsonFile(STATE, drive, folder);
  if (prev?.status === 'planning' && Date.now() - Date.parse(prev.updated_at || prev.started_at || 0) < 20 * 60 * 1000) {
    return { started: false, reason: prev.mode === 'changes' ? 'PASS_ALREADY_RUNNING' : 'FIRST_SCAN_RUNNING', since: prev.since || null };
  }
  // Stopped half-way (time-out, error): it continues where it stopped instead of starting again.
  if (unfinished(prev) && (prev.done || 0) > 0) {
    await saveJsonFile(STATE, drive, folder, fileId, { ...prev, status: 'planning', error: null, resumed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    await (d.fire || fireInternal)(req, '/api/app?route=tidy-plan-step', {});
    return { started: true, resumed: true, since: prev.since || null, files: (prev.files || []).length };
  }
  const { state: scan } = await loadScan(drive, folder);
  const since = prev?.last_pass_at || scan?.finished_at || prev?.finished_at || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const passStarted = new Date().toISOString();
  const changed = await (d.changedSince || drive.changedSince)(since, { limit: MAX_FILES });
  // Where each file is: the folders known from the Drive map.
  const paths = new Map((scan?.items || []).filter(i => i.mimeType === FOLDER).map(i => [i.id, i.path]));
  const files = changed.filter(f => f.mimeType !== FOLDER && !/^OFFICE_MANAGER_/.test(f.name || '') && !(f.parents || []).includes(folder))
    .map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents || [], webViewLink: f.webViewLink || null,
      modifiedTime: f.modifiedTime, createdTime: f.createdTime, by: f.lastModifyingUser?.emailAddress || null,
      path: (paths.get((f.parents || [])[0]) || '(dossier hors carte)') + '/' + f.name }))
    .filter(f => !/00_OFFICE_MANAGER|TATY_AI|AI MANAGER|atelier m/i.test(f.path))
    // Already decided and not modified since: not looked at again.
    .filter(f => !(prev?.seen || {})[f.id] || String(f.modifiedTime || '') > String(prev.seen[f.id]));
  const st = { status: files.length ? 'planning' : 'done', mode: 'changes', since, started_at: passStarted, pass_started_at: passStarted, seen: prev?.seen || {},
    last_pass_at: files.length ? since : passStarted, files, total: files.length, done: 0, moves: 0, renames: 0, questions: 0, ok: 0, auto: 0 };
  if (!files.length) st.finished_at = passStarted;
  await saveJsonFile(STATE, drive, folder, fileId, st);
  if (files.length) await (d.fire || fireInternal)(req, '/api/app?route=tidy-plan-step', {});
  return { started: Boolean(files.length), since, files: files.length };
}

export async function tidyPlanStep(orgId, req, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId(), fetchRows = d.fetchRows || rest;
  const cur = await loadJsonFile(STATE, drive, folder);
  const st = cur.state;
  if (!st || st.status !== 'planning') return st || { status: 'none' };
  const { state: scan } = await loadScan(drive, folder);
  const items = [...(scan?.items || []), ...(st.mode === 'changes' ? st.files || [] : [])];
  // The list is fixed when the work starts (st.list), so a resumed pass continues the same list.
  if (st.mode !== 'changes' && !st.list) { st.list = tidyCandidates(scan?.items || [], st.seen || {}).map(i => i.id); st.total = st.list.length; }
  const scanById = new Map((scan?.items || []).map(i => [i.id, i]));
  const all = st.mode === 'changes' ? (st.files || []) : st.list.map(id => scanById.get(id)).filter(Boolean);
  const source = st.mode === 'changes' ? 'passage depuis le ' + String(st.since || '').slice(0, 16).replace('T', ' ') : 'premier scan';
  const batch = all.slice(st.done, st.done + BATCH);
  const save = async s => { const c = await loadJsonFile(STATE, drive, folder); await saveJsonFile(STATE, drive, folder, c.fileId, s); };
  const finish = () => { st.status = 'done'; st.finished_at = new Date().toISOString(); st.last_pass_at = st.pass_started_at || st.started_at; };
  if (!batch.length) { finish(); await save(st); return st; }
  const { state: k } = await loadJsonFile(KNOWLEDGE, drive, folder);
  const folders = items.filter(i => i.mimeType === FOLDER && !/00_OFFICE_MANAGER/.test(i.path || '')).slice(0, 1500).map(f => f.id + ' | ' + f.path).join('\n');
  const context = k ? 'MISSIONS : ' + JSON.stringify((k.missions || []).map(m => [m.name || m.client, m.type, m.year, m.source])).slice(0, 12000) +
    '\nCLIENTS : ' + (k.clients || []).map(c => c.name).join(', ').slice(0, 4000) +
    '\nRÉPONSES DU PROPRIÉTAIRE : ' + JSON.stringify(k.answers || []).slice(0, 4000) : '';
  // How the firm organises a mission folder: the existing mission folders and their sub-folders.
  const missionRoots = items.filter(i => i.mimeType === FOLDER && /CLIENTS?[_ ]?ET[_ ]?MISSIONS|MISSIONS?|AUDIT|EXPERTISE|CONSEIL|(19|20)\d\d/i.test(i.path || '')).slice(0, 300).map(f => f.path).join('\n');
  const structure = firmStructure(scan?.items || []);
  // The AI reads each file (excerpt of its content), not only its name.
  const read = d.readText || ((id, o) => drive.readText(id, o));
  const lines = [];
  const excerpts = new Map();
  for (const f of batch) {
    let ex = '';
    try { const t = await read(f.id, { maxChars: EXCERPT }); ex = String(t?.text ?? t ?? '').replace(/\s+/g, ' ').slice(0, EXCERPT); } catch { ex = '(illisible)'; }
    excerpts.set(f.id, ex);
    lines.push('### ' + f.id + ' | ' + f.path + '\n' + ex);
  }
  const input = (structure.pattern ? 'STRUCTURE DU CABINET (lue dans son Drive, à respecter) : ' + structure.pattern + '\nExemples réels : ' + structure.examples.join(' ; ') + '\n\n' : '') +
    'DOSSIERS (id | chemin) :\n' + folders + '\n\nEXEMPLES DE DOSSIERS DE MISSION DU CABINET :\n' + missionRoots +
    '\n\nCE QUE TU SAIS DU CABINET :\n' + context + '\n\nFICHIERS À DÉCIDER (id | chemin, puis extrait du contenu) :\n' + lines.join('\n\n');
  let plan = null, lastError = null;
  for (const provider of ['auto', 'openai', 'anthropic']) {
    try { plan = parseJson((await (d.runAI || runAI)({ agentKey: 'orpailleur', instructions: INSTRUCTIONS, input: input.slice(0, 150000), provider, maxTokens: 16000 })).text); break; }
    catch (e) { lastError = e; }
  }
  if (!plan) { st.status = 'failed'; st.error = String(lastError?.message || lastError).slice(0, 200); await save(st); return st; }
  const byId = new Map(items.map(i => [i.id, i]));
  const now = new Date().toISOString();
  // What each file IS, kept for the search (added 2026-10-08; never blocks the filing).
  await (d.recordFiles || (await import('./file-index.js')).recordFiles)(batch.map(f => {
    const x = (plan.decisions || []).find(y => y.file_id === f.id) || {};
    return { id: f.id, name: f.name, path: f.path, url: f.webViewLink || null, parent: (f.parents || [])[0] || null, doc_type: x.doc_type, client: x.client, period: x.period, summary: x.summary,
      excerpt: excerpts.get(f.id) === '(illisible)' ? null : excerpts.get(f.id) };
  }), { drive, folder }).catch(() => null);
  const propose = d.proposeMessage || proposeMessage, meta = d.getMeta || getDriveFileMetadata;
  // « Rangement automatique » (owner's switch, on by default; 2026-10-08: « les agents n'agissent
  // pas vraiment »): a SURE decision is carried out at once — recorded as a decision of the
  // Orpailleur (journal, audit, reversible); anything less than sure stays in « À valider ».
  const settings = await (d.agentSettings || (async () => (await import('./agent-persona.js')).agentSettings(orgId)))().catch(() => ({ auto_filing: false }));
  const autoFile = async (action, x) => {
    if (!action?.id || !settings.auto_filing || x.confidence !== 'haute') return;
    try {
      const r = await (d.recordDecision || (await import('./action-decisions.js')).recordDecision)(orgId,
        { action_id: action.id, decision: 'approve', decided_by: 'Orpailleur (rangement automatique)', note: 'Décision sûre : ' + String(x.reason || '').slice(0, 300) });
      if (r?.executed) st.auto = (st.auto || 0) + 1;
    } catch { /* stays in « À valider » */ }
  };
  st.seen = st.seen || {};
  for (const f of batch) st.seen[f.id] = f.modifiedTime || now;
  for (const x of plan.decisions || []) {
    const f = byId.get(x.file_id); if (!f) continue;
    if (x.action === 'ok') { st.ok++; continue; }
    if (x.action === 'ask') {
      // The colleague who last saved the file explains it (message waiting in « À valider »).
      try {
        const m = await meta(f.id);
        const who = String(m?.lastModifyingUser?.emailAddress || m?.owners?.[0]?.emailAddress || '').toLowerCase();
        if (who) {
          await propose(orgId, { recipients: [who], source: 'agent', requested_by: 'Orpailleur (' + source + ')',
            subject: 'Question sur un fichier : ' + f.name,
            body: 'Bonjour,\n\nEn rangeant le Drive, je ne sais pas où classer « ' + f.name + ' » (' + f.path + ').\n' + (x.question || 'Peux-tu me dire à quelle mission ou à quel usage il correspond ?') +
              (f.webViewLink ? '\n\nLe fichier : ' + f.webViewLink : '') + '\n\nMerci !' });
          st.questions++;
        }
      } catch { /* external saver or no address: stays for the owner */ }
      continue;
    }
    // The mission's folder does not exist yet: created on approval, following the firm's structure.
    if (x.action === 'create_and_move') {
      const parent = byId.get(x.create_parent_id);
      const names = (Array.isArray(x.create_names) ? x.create_names : []).map(n => String(n || '').replace(/[\\/]/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 4);
      if (parent && parent.mimeType === FOLDER && names.length) {
        const newName = x.new_name && x.new_name !== f.name ? String(x.new_name).slice(0, 250) : null;
        const target = parent.path + '/' + names.join('/');
        const summary = 'Créer « ' + target + ' » et y ranger « ' + f.name + ' »' + (newName ? ' sous le nom « ' + newName + ' »' : '') + ' — ' + String(x.reason || '').slice(0, 200);
        const queued = await fetchRows('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
          body: JSON.stringify([{ org_id: orgId, agent_key: 'orpailleur', action_type: 'FILE_MOVE', status: 'proposed', work_state: 'requested', requested_at: now,
            idempotency_key: 'file-move:' + f.id + ':new:' + target.slice(-80) + ':' + (newName || ''), summary: summary.slice(0, 500),
            payload: { file_id: f.id, file_name: f.name, from_parent: (f.parents || [])[0] || null, to_parent: null, to_name: target, new_name: newName, web_url: f.webViewLink || null,
              create: { parent_id: parent.id, names } },
            evidence: { reason: String(x.reason || '').slice(0, 500), source, confidence: x.confidence || null } }]) }).catch(() => null);
        st.moves++; st.created = (st.created || 0) + 1; if (newName) st.renames++;
        await autoFile(queued?.[0], x);
      }
      continue;
    }
    const dest = x.to_folder_id && byId.get(x.to_folder_id);
    const move = (x.action === 'move' || x.action === 'move_rename') && dest && dest.mimeType === FOLDER && !(f.parents || []).includes(dest.id);
    const newName = (x.action === 'rename' || x.action === 'move_rename') && x.new_name && x.new_name !== f.name ? String(x.new_name).slice(0, 250) : null;
    if (!move && !newName) continue;
    const summary = (move ? 'Ranger « ' + f.name + ' » dans « ' + dest.path + ' »' : 'Renommer « ' + f.name + ' »') + (newName ? (move ? ' et le renommer « ' : ' en « ') + newName + ' »' : '') + ' — ' + String(x.reason || '').slice(0, 200);
    const queued = await fetchRows('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify([{ org_id: orgId, agent_key: 'orpailleur', action_type: 'FILE_MOVE', status: 'proposed', work_state: 'requested', requested_at: now,
        idempotency_key: 'file-move:' + f.id + ':' + (move ? dest.id : '') + ':' + (newName || ''), summary: summary.slice(0, 500),
        payload: { file_id: f.id, file_name: f.name, from_parent: (f.parents || [])[0] || null, to_parent: move ? dest.id : null, to_name: move ? dest.path : null, new_name: newName, web_url: f.webViewLink || null },
        evidence: { reason: String(x.reason || '').slice(0, 500), source, confidence: x.confidence || null } }]) }).catch(() => null);
    if (move) st.moves++; if (newName) st.renames++;
    await autoFile(queued?.[0], x);
  }
  st.done += batch.length; st.total = all.length; st.updated_at = new Date().toISOString();
  if (st.done >= all.length) finish();
  await save(st);
  if (st.status === 'planning') await (d.fire || fireInternal)(req, '/api/app?route=tidy-plan-step', {});
  return st;
}

// The owner answers the Orpailleur's questions; the answers are kept in its Drive memory and
// used by the next reading and tidy-up.
export async function answerQuestion(body = {}, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const { fileId, state } = await loadJsonFile(KNOWLEDGE, drive, folder);
  if (!state) throw Object.assign(new Error('NOTHING_TO_ANSWER'), { statusCode: 409 });
  const question = String(body.question || '').slice(0, 500), answer = String(body.answer || '').trim().slice(0, 2000);
  if (!answer) throw Object.assign(new Error('ANSWER_REQUIRED'), { statusCode: 400 });
  state.answers = [...(state.answers || []).filter(a => a.question !== question), { question, answer, by: String(body.by || '').slice(0, 120) || null, at: new Date().toISOString() }];
  await saveJsonFile(KNOWLEDGE, drive, folder, fileId, state);
  return { saved: true, answers: state.answers };
}
