import { driveAdapter } from './drive-adapter.js';
import { contentName, preciseTitle, NAMING_RULE } from './document-naming.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, saveJsonFile } from './mapping-scan.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { fileForAI, saveReport } from './agent-outputs.js';
import { fireInternal } from './agent-passes.js';
import { startEngagementPrep } from './engagement-prep.js';
import { startAuditorReview } from './enhanced-auditor.js';
import { engagementMissions } from './engagement-prep.js';
import { linkToMissions, applyMissionUpdates } from './mission-files.js';

// DEPOSITS FOR THE AGENTS' UNDERSTANDING (Paul, 2026-10-08: « dans Rangement, il faut pouvoir
// déposer des dossiers, des fichiers, pas seulement pour le rangement : pour la compréhension de
// l'Enhanced Auditor, du Grand Contrôleur et de tous. Ils doivent pouvoir analyser et ranger
// comme c'était prévu avant »).
// Files and whole folders dropped on the Rangement page are filed as before (lib/drop-box.js:
// named, placed, in « À valider »). In addition, every document is READ and UNDERSTOOD by the AI
// (pictures and scans included): what it is, client, mission, period, key facts. That
// understanding is kept in the agents' Drive memory (OFFICE_MANAGER_DEPOSITS.json), so every agent
// can use it (tool get_deposited_documents). Then, as chosen by the person:
//   - Grand Contrôleur: answers the question asked about the documents (report in the Drive);
//   - Mission Controller: prepares the engagement from them (TDR…);
//   - Enhanced Auditor: reviews them — each document sorted by its role (auditor's risk
//     assessment, working paper, evidence) from what the AI understood;
//   - or simply understood, for everyone.

const FILE = 'OFFICE_MANAGER_DEPOSITS.json';
const BATCH = 4;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
// 'pieces' (2026-10-19): pieces received on a known mission — read, attached to it, and a TDR / contract / engagement
// letter among them goes to the Mission Controller, who prepares the mission from it (as « Préparer une mission »).
const PURPOSES = ['understand', 'controller', 'mission', 'auditor', 'pieces'];
// What a mission is prepared from: terms of reference, contract, engagement letter, or a project's financing agreement.
export const ENGAGEMENT_ROLES = ['tdr', 'contrat', 'lettre_de_mission', 'convention'];

// A received piece renamed from what the AI READ: TYPE_CLIENT_PERIOD.ext (ASCII, no overwrite — another file with the name in
// the folder = _2, _3…). Same file id (links and registers stay valid). A piece the AI could not read keeps its name.
const slug = (x, n = 40) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase().slice(0, n);
const ROLE_LABEL = { tdr: 'TDR', contrat: 'CONTRAT', lettre_de_mission: 'LETTRE_DE_MISSION', convention: 'CONVENTION', etat_financier: 'ETATS_FINANCIERS', facture: 'FACTURE', correspondance: 'COURRIER', programme_de_travail: 'PROGRAMME_DE_TRAVAIL', piece_justificative: 'PIECE' };
// The name of a received piece comes from what was READ, the same rule for every agent (lib/document-naming.js): a precise title,
// never a generic word alone (« Tableau »); not precise enough = name kept.
export function pieceName(u, missionClient = '') {
  return contentName(u, { client: missionClient, original: u.name });
}
export async function renamePieces(orgId, st, d = {}) {
  const drive = d.tidyDrive || (await import('./tidy-drive.js')).tidyDrive;
  const mission = (await (d.engagementMissions || engagementMissions)(orgId, d).catch(() => [])).find(m => m.id === st.mission_id) || { id: st.mission_id, name: '' };
  const done = [], kept = [], unidentified = [];
  for (const u of st.understood || []) {
    const wanted = pieceName(u, mission.client_name || '');
    if (!wanted) { kept.push(u.name); unidentified.push(u.name); continue; }
    if (wanted === u.name) { kept.push(u.name); continue; }
    const meta = await drive.getFile(u.id).catch(() => null);
    const parent = meta?.parents?.[0];
    if (!meta || meta.trashed || !parent) { kept.push(u.name); continue; }
    // A path Excel can open on Windows (< 260 characters): shortened if the folder is deep (lib/path-budget.js).
    const fitted = drive.getFile ? (await (await import('./path-budget.js')).fitName(wanted, parent, { getMeta: id => drive.getFile(id) }).catch(() => null))?.name || wanted : wanted;
    let name = fitted;
    for (let i = 2; i < 10 && await drive.nameTaken(parent, name, u.id); i++) name = fitted.replace(/(\.[a-z0-9]+)?$/, '_' + i + '$1');
    try { await drive.move(u.id, parent, null, name); } catch { kept.push(u.name); continue; }
    done.push({ id: u.id, from: u.name, to: name });
    u.name = name; u.path = String(u.path || '').replace(/[^/]*$/, name);
  }
  if (done.length) {
    await (d.recordFiles || (await import('./file-index.js')).recordFiles)(done.map(x => ({ id: x.id, name: x.to, mission_id: st.mission_id, doc_type: 'piece_recue', placed_by: 'mission-controller', protected: true })), d).catch(() => null);
    const mf = await import('./mission-files.js');
    await (d.recordMissionDocuments || mf.recordMissionDocuments)(mission, st.understood.filter(u => done.some(x => x.id === u.id)).map(u => { const x = done.find(y => y.id === u.id);
      return { ...u, by: st.by || null, title: preciseTitle(u), location: String(u.path || '').replace(/\/[^/]*$/, '') || 'PIECES_RECUES', event: { agent: 'mission-controller', what: 'lu, compris et renommé', detail: '« ' + x.from + ' » → « ' + x.to + ' »', by: st.by || null } }; }), d).catch(() => null);
    await (d.audit || (await import('./audit-log.js')).audit)(orgId, { agent: 'mission-controller', mission_id: st.mission_id, action_type: 'PIECES_RENAMED', status: 'succeeded',
      decision: done.map(x => '« ' + x.from + ' » → « ' + x.to + ' »').join(' ; ').slice(0, 900) }).catch(() => null);
  }
  return { done, kept: kept.length, unidentified };
}

const UNDERSTAND = `Tu es Office Manager AI (Grand Contrôleur et ses agents) dans un cabinet d'audit, d'expertise et de conseil. Une personne a déposé des documents (parfois un dossier entier : le chemin dit où chaque fichier était rangé). Lis chacun (texte, scan ou image, en français ou en anglais) et dis ce que c'est, fidèlement, sans rien inventer. ${NAMING_RULE} « convention » = convention / accord de financement d'un projet ou d'un bailleur. « type » = le libellé précis de ce qu'est le document (ex. « Tableau budgétaire PTBA », « Balance générale », « Convention de financement », « Relevé bancaire »), « client » = l'entité concernée, « period » = l'exercice ou la date (ex. « 2025 », « 2025-12 »).
JSON STRICT : {"documents":[{"file_id":"","type":"","role":"tdr|contrat|lettre_de_mission|convention|programme_de_travail|evaluation_des_risques|feuille_de_travail|piece_justificative|etat_financier|correspondance|cv|rh|facture|autre","client":"","mission":"","period":"","summary":"","key_facts":[""],"figures":[{"label":"","value":""}],"issues":[""],"language":"fr|en|autre"}]}`;

const ANSWER = `Tu es le Grand Contrôleur (Office Manager) d'un cabinet d'audit. Une personne a déposé des documents et te pose une question. Réponds à partir de ce qui a été lu dans les documents (cite le nom du fichier pour chaque fait), en professionnel : réponse directe d'abord, puis l'analyse utile, les points d'attention et les prochaines étapes. Si les documents ne permettent pas de répondre, dis ce qui manque.`;

async function loadAll(d) { return (d.loadJsonFile || loadJsonFile)(FILE, d.drive || driveAdapter, d.folder || memoryFolderId()); }
async function saveOne(id, st, d) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const cur = await loadAll(d);
  const all = cur.state || { deposits: {} };
  st.updated_at = new Date().toISOString();
  all.deposits[id] = st;
  // Kept for everyone's understanding: the 200 most recent deposits.
  const ids = Object.keys(all.deposits).sort((a, b) => String(all.deposits[b].started_at).localeCompare(String(all.deposits[a].started_at)));
  for (const old of ids.slice(200)) delete all.deposits[old];
  await (d.saveJsonFile || saveJsonFile)(FILE, drive, folder, cur.fileId, all);
  return st;
}
export async function depositState(id, d = {}) { return (await loadAll(d)).state?.deposits?.[id] || { status: 'none' }; }
export async function listDeposits(d = {}) {
  const all = (await loadAll(d)).state?.deposits || {};
  return Object.entries(all).map(([id, x]) => ({ id, label: x.label, purpose: x.purpose, status: x.status, by: x.by, started_at: x.started_at, files: (x.files || []).length,
    mission: x.mission_id || null, documents: (x.understood || []).map(u => ({ name: u.name, path: u.path, url: u.url, type: u.type, role: u.role, client: u.client, mission: u.mission, period: u.period, summary: u.summary })), report: x.report || null }))
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
}

export async function startDepositAnalysis(orgId, req, body = {}, d = {}) {
  const purpose = PURPOSES.includes(body.purpose) ? body.purpose : 'understand';
  const files = (Array.isArray(body.files) ? body.files : []).filter(f => f && f.id).slice(0, 150)
    .map(f => ({ id: String(f.id), name: String(f.name || '').slice(0, 200), path: String(f.path || f.name || '').slice(0, 400), url: f.url || null }));
  if (!files.length) throw fail('FILES_REQUIRED');
  if (['mission', 'auditor', 'pieces'].includes(purpose) && !body.mission_id) throw fail('VALID_MISSION_ID_REQUIRED');
  const id = 'dep-' + Date.now().toString(36);
  const st = { status: 'running', stage: 'read', purpose, label: String(body.label || files[0].path.split('/')[0] || 'Dépôt').slice(0, 120), files, done: 0, understood: [],
    mission_id: body.mission_id || null, question: String(body.question || '').slice(0, 3000), by: body.by || null, started_at: new Date().toISOString(), log: [] };
  await saveOne(id, st, d);
  await (d.fire || fireInternal)(req, '/api/app?route=deposit-step', { id });
  return { started: true, id };
}

export async function depositStep(orgId, req, body = {}, d = {}) {
  const id = String(body.id || '');
  const st = await depositState(id, d);
  if (st.status !== 'running') return st;
  const say = m => st.log.push({ at: new Date().toISOString(), m });
  const next = async () => { await saveOne(id, st, d); await (d.fire || fireInternal)(req, '/api/app?route=deposit-step', { id }); return st; };
  const ai = d.ai || firstAvailable, read = d.fileForAI || fileForAI;
  try {
    if (st.stage === 'read') {
      // (2026-10-25) The .zip archives deposited are opened first: each file inside becomes a piece read like the others.
      if (!st.zips_expanded && st.files.some(f => /\.zip$/i.test(f.name || ''))) {
        const { expandZips } = await import('./zip-pieces.js');
        const r = await expandZips(st.files, d.drive || (await import('./drive-adapter.js')).driveAdapter);
        st.files = r.files.slice(0, 300); st.zips_expanded = true;
        for (const n of r.notes) say(n.error ? 'Archive ' + n.zip + ' : ' + n.error : 'Archive ' + n.zip + ' ouverte : ' + n.extracted + ' fichier(s).');
        await saveOne(id, st, d);
      }
      // As many batches as the time allows in ONE invocation (2026-10-08: « 136 documents, il en a
      // compris 4 » — one batch per call was too fragile when the chain of calls broke). Progress is
      // saved after each batch: a stop never loses what was read.
      const t0 = Date.now(), budget = d.budgetMs ?? 200000;
      while (st.done < st.files.length && Date.now() - t0 < budget) {
      const batch = st.files.slice(st.done, st.done + BATCH);
      const docs = [];
      for (const f of batch) { try { docs.push({ ...f, ...(await read(f.id, { maxChars: 20000 })) }); } catch { say('Illisible : ' + f.path); } }
      if (docs.length) {
        const visual = docs.filter(x => x.visual);
        const input = docs.map(x => '### ' + x.id + ' | ' + x.path + '\n' + (x.visual ? '(image ou scan joint)' : String(x.text || '').slice(0, 20000))).join('\n\n');
        try {
          const r = await ai(visual.length ? ['gemini', 'anthropic', 'openai'] : ['anthropic', 'openai', 'gemini'], { instructions: UNDERSTAND, input, files: visual, maxTokens: 6000 });
          const out = parseJsonLoose(r.text).documents || [];
          for (const x of docs) {
            const u = out.find(o => o.file_id === x.id) || {};
            st.understood.push({ id: x.id, name: x.name, path: x.path, url: x.url || null, visual: Boolean(x.visual), read_by: r.provider, ...u, file_id: undefined });
          }
        } catch (e) { say('Lecture IA impossible pour ' + docs.length + ' document(s) : ' + String(e.message || e).slice(0, 80)); }
      }
      st.done += batch.length;
      await saveOne(id, st, d);
      }
      if (st.done < st.files.length) return next();
      say(st.understood.length + ' document(s) lu(s) et compris, gardés dans la mémoire des agents.');
      st.stage = 'missions';
      return next();
    }
    // A document for a mission in progress (or about to start) updates that mission: facts
    // directly, changes proposed in « À valider » (lib/mission-files.js).
    if (st.stage === 'missions') {
      try {
        const missions = await (d.engagementMissions || engagementMissions)(orgId, d);
        const pool = st.mission_id ? missions.filter(m => m.id === st.mission_id) : missions;
        // A mission chosen by the person: every document belongs to it.
        const links = st.mission_id && pool.length ? st.understood.map(u => ({ file_id: u.id, mission_id: st.mission_id, confidence: 'haute', dates: {} })) : null;
        const r = await (d.linkToMissions || linkToMissions)(orgId, st.understood, pool.length ? pool : missions, { ...d, links: links || d.links });
        const u = await (d.applyMissionUpdates || applyMissionUpdates)(orgId, r.linked, { by: st.by, deposit: id }, d);
        st.missions_updated = [...new Map(r.linked.map(x => [x.mission.id, { id: x.mission.id, name: x.mission.name }])).values()];
        st.to_attach = r.to_attach;
        st.mission_proposals = u.proposals;
        if (u.attached) say(u.attached + ' document(s) rattaché(s) à ' + st.missions_updated.map(m => '« ' + m.name + ' »').join(', ') + ' : informations de la mission mises à jour' + (u.proposals.length || u.team_proposed ? ', ' + (u.proposals.length + (u.team_proposed ? 1 : 0)) + ' changement(s) proposé(s) dans « À valider »' : '') + '.');
        if (r.to_attach.length) say(r.to_attach.length + ' document(s) sans mission certaine : choisissez la mission ci-dessous, ou laissez-les hors mission.');
      } catch (e) { say('Rattachement aux missions impossible : ' + String(e.message || e).slice(0, 100)); }
      st.stage = st.purpose === 'understand' ? 'done' : 'route';
      if (st.stage === 'done') { st.status = 'done'; st.finished_at = new Date().toISOString(); await saveOne(id, st, d); return st; }
      return next();
    }
    if(st.stage==='mission-filing') {
      try {
        const r=await (d.prepareMissionFiling || (await import('./mission-filing.js')).prepareMissionFiling)(orgId,st.mission_id,st.filing_remaining || [],{...d,filingLimit:1});
        st.filing_results=[...(st.filing_results || []),...(r.files || [])];st.filing_remaining=r.remaining_ids || [];
        st.filing={...r,files:st.filing_results};
        if(st.filing_remaining.length)return next();
      } catch(e) {st.filing={status:'pending',error:String(e.message).slice(0,160),files:st.filing_results || []};}
      st.filing_complete=true;st.stage='route';return next();
    }
    if (st.stage === 'route') {
      // (2026-10-24, Paul : « il doit bien identifier et renommer les pièces qu'il reçoit ») Renamed from what was READ, before any
      // filing proposal: same file, same folder, never over another file (renamePieces). Once per deposit.
      if (st.purpose === 'pieces' && !st.renaming_done) {
        st.renaming_done = true;
        try {
          const rn = await (d.renamePieces || renamePieces)(orgId, st, d);
          st.renamed = rn.done;
          if (rn.done.length) say(rn.done.length + ' pièce(s) renommée(s) d’après leur contenu : ' + rn.done.slice(0, 6).map(x => '« ' + x.from + ' » → « ' + x.to + ' »').join(' ; ') + '.');
          if (rn.unidentified?.length) say(rn.unidentified.length + ' pièce(s) gardent leur nom : leur contenu n’a pas été identifié assez précisément pour les nommer (' + rn.unidentified.slice(0, 4).join(', ') + ').');
        } catch (e) { say('Renommage impossible : ' + String(e.message || e).slice(0, 100)); }
      }
      if(st.purpose==='pieces' && !st.filing_complete) {st.stage='mission-filing';st.filing_remaining=st.understood.map(u=>u.id);return next();}
      if (st.purpose === 'controller') {
        const visual = [];
        for (const u of st.understood.filter(x => x.visual).slice(0, 6)) { try { visual.push(await read(u.id)); } catch { /* skipped */ } }
        const r = await ai(visual.length ? ['anthropic', 'gemini', 'openai'] : ['anthropic', 'openai', 'gemini'], { instructions: ANSWER, files: visual, maxTokens: 6000,
          input: 'QUESTION : ' + (st.question || 'Analyse ces documents : ce qu’ils sont, ce qu’ils disent d’important, les points d’attention.') + '\n\nCE QUI A ÉTÉ LU :\n' + JSON.stringify(st.understood.map(u => ({ file: u.path, type: u.type, role: u.role, client: u.client, mission: u.mission, period: u.period, summary: u.summary, key_facts: u.key_facts, figures: u.figures, issues: u.issues }))).slice(0, 120000) });
        st.answer = { text: r.text, by: r.provider };
        st.report = await (d.saveReport || saveReport)('deposits', 'Analyse du dépôt « ' + st.label + ' » (Grand Contrôleur)', r.text, d).catch(e => ({ error: String(e.message || e).slice(0, 200) }));
        say('Le Grand Contrôleur a répondu ; analyse enregistrée dans le Drive.');
      }
      if (st.purpose === 'mission') {
        const order = ['tdr', 'contrat', 'lettre_de_mission'];
        const tdr = st.understood.filter(u => order.includes(u.role)).map(u => u.id);
        await (d.startEngagementPrep || startEngagementPrep)(orgId, req, { mission_id: st.mission_id, tdr_file_ids: (tdr.length ? tdr : st.understood.map(u => u.id)).slice(0, 6), notes: st.question, requested_by: st.by }, d);
        st.handed_to = { page: '/preparation.html?mission_id=' + encodeURIComponent(st.mission_id), agent: 'Mission Controller' };
        say('Transmis à Mission Controller : préparation de l’engagement lancée.');
      }
      if (st.purpose === 'pieces') {
        // Named from what was READ (2026-10-19, Paul : « il les a mis dans pièces reçues, il devrait les renommer »).
        st.pbc = await (d.reconcileReceivedDocuments || (await import('./pbc-loop.js')).reconcileReceivedDocuments)(orgId,st.mission_id,d).catch(e=>({status:'pending',error:String(e.message).slice(0,160)}));
        say('PBC : '+st.pbc.status+(st.pbc.found ? ' ; '+st.pbc.found.length+' pièce(s) proposée(s) à confirmer.':''));

        say('Classement documentaire : '+st.filing.status+'. Seuls les déplacements vérifiés sont considérés comme réalisés.');
        if(st.filing.error)say(st.filing.error);
        // Read from the CONTENT (role found by the AI), never from the file name. A project's financing agreement is its terms of reference.
        const tdr = st.understood.filter(u => ENGAGEMENT_ROLES.includes(u.role)).map(u => u.id);
        if (tdr.length) {
          await (d.startEngagementPrep || startEngagementPrep)(orgId, req, { mission_id: st.mission_id, tdr_file_ids: tdr.slice(0, 6), notes: st.question, requested_by: st.by }, d);
          st.handed_to = { page: '/preparation.html?mission_id=' + encodeURIComponent(st.mission_id), agent: 'Mission Controller' };
          say(tdr.length + ' TDR / contrat / lettre de mission reconnu(s) : le Mission Controller prépare la mission (briefing, risques du secteur, équipe, plan).');
        } else say('Aucun TDR, contrat, convention ni lettre de mission parmi ces pièces : elles sont rattachées à la mission. Dans « Préparer une mission », vous pouvez partir des pièces reçues.');
        say('Les working files utilisent uniquement les modèles du cabinet ; aucun classeur générique ne les remplace.');
      }
      if (st.purpose === 'auditor') {
        const by = role => st.understood.filter(u => role.includes(u.role)).map(u => u.id);
        const risk = by(['evaluation_des_risques']), evidence = by(['piece_justificative', 'facture', 'etat_financier']).concat(st.understood.filter(u => u.visual && !['evaluation_des_risques', 'feuille_de_travail', 'programme_de_travail'].includes(u.role)).map(u => u.id));
        const work = st.understood.map(u => u.id).filter(x => !risk.includes(x) && !evidence.includes(x));
        await (d.startAuditorReview || startAuditorReview)(orgId, req, { mission_id: st.mission_id, auditor_risk_files: risk, work_files: work, evidence_files: [...new Set(evidence)], focus: st.question, requested_by: st.by }, d);
        st.handed_to = { page: '/auditeur.html', agent: 'Enhanced Auditor', split: { risk: risk.length, work: work.length, evidence: new Set(evidence).size } };
        say('Transmis à l’Enhanced Auditor : ' + risk.length + ' évaluation(s) des risques, ' + work.length + ' fichier(s) de travail, ' + new Set(evidence).size + ' pièce(s).');
      }
      st.status = 'done'; st.stage = 'done'; st.finished_at = new Date().toISOString();
      await saveOne(id, st, d);
      return st;
    }
  } catch (e) {
    st.status = 'failed'; st.error = String(e.message || e).slice(0, 300); say('Arrêt : ' + st.error);
    await saveOne(id, st, d);
  }
  return st;
}

// The person chooses the mission of a document the agents were not sure about.
export async function attachDeposit(orgId, body = {}, d = {}) {
  const id = String(body.id || ''), fileId = String(body.file_id || ''), missionId = String(body.mission_id || '');
  const st = await depositState(id, d);
  if (st.status === 'none') throw fail('DEPOSIT_NOT_FOUND', 404);
  const doc = (st.understood || []).find(u => u.id === fileId);
  if (!doc) throw fail('FILE_NOT_IN_DEPOSIT', 404);
  const missions = await (d.engagementMissions || engagementMissions)(orgId, d);
  if (!missions.some(m => m.id === missionId)) throw fail('MISSION_NOT_ACTIVE_OR_UPCOMING', 409);
  const r = await (d.linkToMissions || linkToMissions)(orgId, [doc], missions, { ...d, links: [{ file_id: fileId, mission_id: missionId, confidence: 'haute', dates: {} }] });
  const u = await (d.applyMissionUpdates || applyMissionUpdates)(orgId, r.linked, { by: body.by || st.by, deposit: id }, d);
  st.to_attach = (st.to_attach || []).filter(x => x.id !== fileId);
  const m = missions.find(x => x.id === missionId);
  st.missions_updated = [...new Map([...(st.missions_updated || []), { id: m.id, name: m.name }].map(x => [x.id, x])).values()];
  st.mission_proposals = [...(st.mission_proposals || []), ...u.proposals];
  st.log.push({ at: new Date().toISOString(), m: '« ' + doc.name + ' » rattaché à « ' + m.name + ' » par ' + (body.by || 'un utilisateur') + '.' });
  await saveOne(id, st, d);
  return { attached: true, mission: m.name, proposals: u.proposals.length };
}
