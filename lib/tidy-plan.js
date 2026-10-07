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
- "create_and_move" : le dossier de SA mission n'existe pas encore : crée-le en suivant EXACTEMENT la structure et les noms des dossiers de mission existants du cabinet (create_parent_id = l'id du dossier existant sous lequel créer, ex. 01_CLIENTS_ET_MISSIONS ; create_names = les niveaux à créer dans l'ordre, ex. ["Nova Distribution","CAC_2026","01_PROGRAMME"]) puis range le fichier dedans ;
- "rename" / "move_rename" : le nom ne dit pas ce que c'est (new_name, garde l'extension, selon la façon de nommer du cabinet) ;
- "ask" : même après lecture tu ne peux pas savoir — écris la question pour la personne qui l'a enregistré.
Les documents peuvent être en français OU en anglais (engagement letter, audit programme, working papers, payroll, bank statements, invoices…) : lis-les dans leur langue et range-les de la même façon ; les nouveaux noms suivent la façon de nommer du cabinet (sa langue, ses préfixes) ; une question à un collègue est écrite dans la langue du fichier si le collègue l'a écrit en anglais, sinon en français.
Règles : ne déplace jamais un fichier déjà dans le bon dossier de sa mission ; ne touche pas au dossier mémoire des agents ; un fichier de mission ne reste pas en vrac à la racine d'un dossier client ou de 01_CLIENTS_ET_MISSIONS.
Réponds en JSON STRICT : {"decisions":[{"file_id":"","action":"ok|move|create_and_move|rename|move_rename|ask","to_folder_id":"","create_parent_id":"","create_names":[""],"new_name":"","reason":"","question":""}]}`;

function parseJson(text) {
  const t = String(text || ''); const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('TIDY_PLAN_UNREADABLE');
  return JSON.parse(t.slice(a, b + 1));
}

// Files worth looking at first: loose files near the top, « à revoir » / inbox folders, unclear names.
export function tidyCandidates(items) {
  const files = (items || []).filter(i => i.mimeType !== FOLDER && !/00_OFFICE_MANAGER|OFFICE_MANAGER_/.test(i.path || i.name || ''));
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

export async function startTidyPlan(orgId, req, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const { fileId, state: prev } = await loadJsonFile(STATE, drive, folder);
  await saveJsonFile(STATE, drive, folder, fileId, { status: 'planning', mode: 'first-scan', started_at: new Date().toISOString(), last_pass_at: prev?.last_pass_at || null, done: 0, moves: 0, renames: 0, questions: 0, ok: 0 });
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
    .filter(f => !/00_OFFICE_MANAGER|TATY_AI/i.test(f.path));
  const st = { status: files.length ? 'planning' : 'done', mode: 'changes', since, started_at: passStarted, pass_started_at: passStarted,
    last_pass_at: files.length ? since : passStarted, files, total: files.length, done: 0, moves: 0, renames: 0, questions: 0, ok: 0 };
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
  const all = st.mode === 'changes' ? (st.files || []) : tidyCandidates(scan?.items || []);
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
  const missionRoots = items.filter(i => i.mimeType === FOLDER && /CLIENTS?[_ ]?ET[_ ]?MISSIONS|MISSIONS?/i.test(i.path || '')).slice(0, 300).map(f => f.path).join('\n');
  // The AI reads each file (excerpt of its content), not only its name.
  const read = d.readText || ((id, o) => drive.readText(id, o));
  const lines = [];
  for (const f of batch) {
    let ex = '';
    try { const t = await read(f.id, { maxChars: EXCERPT }); ex = String(t?.text ?? t ?? '').replace(/\s+/g, ' ').slice(0, EXCERPT); } catch { ex = '(illisible)'; }
    lines.push('### ' + f.id + ' | ' + f.path + '\n' + ex);
  }
  const input = 'DOSSIERS (id | chemin) :\n' + folders + '\n\nEXEMPLES DE DOSSIERS DE MISSION DU CABINET :\n' + missionRoots +
    '\n\nCE QUE TU SAIS DU CABINET :\n' + context + '\n\nFICHIERS À DÉCIDER (id | chemin, puis extrait du contenu) :\n' + lines.join('\n\n');
  let plan = null, lastError = null;
  for (const provider of ['auto', 'openai', 'anthropic']) {
    try { plan = parseJson((await (d.runAI || runAI)({ agentKey: 'orpailleur', instructions: INSTRUCTIONS, input: input.slice(0, 150000), provider, maxTokens: 16000 })).text); break; }
    catch (e) { lastError = e; }
  }
  if (!plan) { st.status = 'failed'; st.error = String(lastError?.message || lastError).slice(0, 200); await save(st); return st; }
  const byId = new Map(items.map(i => [i.id, i]));
  const now = new Date().toISOString();
  const propose = d.proposeMessage || proposeMessage, meta = d.getMeta || getDriveFileMetadata;
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
        await fetchRows('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify([{ org_id: orgId, agent_key: 'orpailleur', action_type: 'FILE_MOVE', status: 'proposed', work_state: 'requested', requested_at: now,
            idempotency_key: 'file-move:' + f.id + ':new:' + target.slice(-80) + ':' + (newName || ''), summary: summary.slice(0, 500),
            payload: { file_id: f.id, file_name: f.name, from_parent: (f.parents || [])[0] || null, to_parent: null, to_name: target, new_name: newName, web_url: f.webViewLink || null,
              create: { parent_id: parent.id, names } },
            evidence: { reason: String(x.reason || '').slice(0, 500), source } }]) }).catch(() => null);
        st.moves++; st.created = (st.created || 0) + 1; if (newName) st.renames++;
      }
      continue;
    }
    const dest = x.to_folder_id && byId.get(x.to_folder_id);
    const move = (x.action === 'move' || x.action === 'move_rename') && dest && dest.mimeType === FOLDER && !(f.parents || []).includes(dest.id);
    const newName = (x.action === 'rename' || x.action === 'move_rename') && x.new_name && x.new_name !== f.name ? String(x.new_name).slice(0, 250) : null;
    if (!move && !newName) continue;
    const summary = (move ? 'Ranger « ' + f.name + ' » dans « ' + dest.path + ' »' : 'Renommer « ' + f.name + ' »') + (newName ? (move ? ' et le renommer « ' : ' en « ') + newName + ' »' : '') + ' — ' + String(x.reason || '').slice(0, 200);
    await fetchRows('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify([{ org_id: orgId, agent_key: 'orpailleur', action_type: 'FILE_MOVE', status: 'proposed', work_state: 'requested', requested_at: now,
        idempotency_key: 'file-move:' + f.id + ':' + (move ? dest.id : '') + ':' + (newName || ''), summary: summary.slice(0, 500),
        payload: { file_id: f.id, file_name: f.name, from_parent: (f.parents || [])[0] || null, to_parent: move ? dest.id : null, to_name: move ? dest.path : null, new_name: newName, web_url: f.webViewLink || null },
        evidence: { reason: String(x.reason || '').slice(0, 500), source } }]) }).catch(() => null);
    if (move) st.moves++; if (newName) st.renames++;
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
