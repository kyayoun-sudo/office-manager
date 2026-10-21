import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadScan } from './mapping-scan.js';
import { NOT_ARCHIVED_FILTER } from './mission-status.js';
import { dispatch } from './event-bus.js';

// Opportunity originals stay in place. Transmission is checkpointed in the opportunity
// memory; retries retain verified copies and never overwrite a mission document.
export async function handoffOpportunityDocuments(orgId, opportunity, mission, d = {}) {
  const drive = d.drive || driveAdapter, fetchRows = d.fetchRows || rest;
  const patch = d.patchOpportunity;
  if (!patch) throw new Error('HANDOFF_CHECKPOINT_REQUIRED');
  let handoff = { ...(opportunity.handoff || {}), files: opportunity.handoff?.files || {}, folders: opportunity.handoff?.folders || {} };
  const save = async extra => { handoff = { ...handoff, ...extra, updated_at: new Date().toISOString() }; await patch({ handoff }); };
  // 'copy' (historical, default of this function): the originals stay in the opportunity folder.
  // 'move' (2026-10-17): the documents of the opportunity (Firm Manager's and the Mission Controller's) are
  // MOVED into the mission folder — same file id, same history, no duplicate for the Orpailleur to flag.
  // Nothing is deleted or overwritten; a same-name file in the mission folder still stops the transfer for review.
  const mode = d.mode === 'move' ? 'move' : 'copy';
  const roleOf = id => opportunity.workbook?.id === id ? 'acceptation' : opportunity.tdr_files?.some(f => f.id === id) ? 'tdr' : 'document_opportunite';
  // A moved document is registered twice: the mission's documents (as for a copy) and the shared file index, where
  // « placed_by » tells the other agents — the Orpailleur above all — that it was put there on purpose.
  const registerMoved = async (entry, meta) => {
    const url = meta?.webViewLink || entry.url || null, role = roleOf(entry.source_id);
    await (d.recordMissionDocuments || (await import('./mission-files.js')).recordMissionDocuments)(mission, [{ id: entry.file_id, name: entry.name, url, role, source: 'opportunity:' + opportunity.id, by: 'Mission Controller' }], d);
    try { await (d.recordFiles || (await import('./file-index.js')).recordFiles)([{ id: entry.file_id, name: entry.name, url, parent: entry.to, mission_id: mission.id, doc_type: role, placed_by: 'mission-controller', protected: true }], { drive, folder: d.folder }); } catch { /* the index never blocks the transfer */ }
    entry.registered = true;
  };
  if (!opportunity.folder?.id) { await save({ status: 'review_required', reason: 'Le dossier source de l’opportunité n’est pas identifié.' }); return handoff; }
  const outsideSource = async id => {
    const seen = new Set(); let current = id;
    for (let depth = 0; current && depth < 40; depth++) {
      if (current === opportunity.folder.id) throw new Error('MISSION_DESTINATION_INSIDE_OPPORTUNITY');
      if (seen.has(current)) throw new Error('MISSION_FOLDER_ANCESTRY_INVALID');
      seen.add(current); const meta = await drive.getMeta(current);
      if (!meta) throw new Error('MISSION_FOLDER_ANCESTRY_UNKNOWN');
      current = meta.parents?.[0] || null;
    }
    if (current) throw new Error('MISSION_FOLDER_ANCESTRY_UNKNOWN');
  };
  let destination = handoff.folder_id || (mission.drive_folder_id !== opportunity.folder?.id ? mission.drive_folder_id : null);
  if (!destination) {
    const refs = await (d.documentReferences || (await import('./file-index.js')).documentReferences)(orgId, d);
    const roots = refs.filter(r => r.document_type === 'mission_root' && r.document_role === 'firm_reference' && !r.mission_id && r.file_id);
    if (roots.length !== 1) { await save({ status: 'configuration_required', configuration_href: '/secretariat.html?document_type=mission_root&document_role=firm_reference#ref-card', reason: 'Indiquez dans la configuration le dossier du cabinet où créer les missions.' }); return handoff; }
    const root = await drive.getMeta(roots[0].file_id);
    if (!root || root.trashed || root.mimeType !== FOLDER || root.id === opportunity.folder?.id) throw new Error('MISSION_ROOT_INVALID');
    await outsideSource(root.id);
    const tidy = d.tidy || (await import('./tidy-drive.js')).tidyDrive;
    const name = String(opportunity.folder?.name || opportunity.title || mission.name).replace(/[\\/:*?"<>|]/g, ' ').slice(0, 160);
    const created = await tidy.findOrCreateFolder(root.id, name);
    const owners = await fetchRows(`office_missions?org_id=eq.${q(orgId)}&drive_folder_id=eq.${q(created.id)}&select=id&limit=2`);
    if ((owners || []).some(m => m.id !== mission.id)) throw new Error('MISSION_FOLDER_ALREADY_ASSIGNED');
    destination = created.id;
    await save({ folder_id: destination, status: 'transferring' });
  }
  const folder = await drive.getMeta(destination);
  if (!folder || folder.trashed || folder.mimeType !== FOLDER || destination === opportunity.folder?.id) throw new Error('MISSION_FOLDER_INVALID');
  await outsideSource(destination);
  await fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(mission.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ drive_folder_id: destination }) });
  await save({ folder_id: destination, url: folder.webViewLink || null, status: 'transferring', reason: null, configuration_href: null });
  // Crash recovery (move mode): a file moved but not yet registered is no longer listed in its source folder.
  for (const e of Object.values(handoff.files)) {
    if (!e.moved || e.registered) continue;
    const m = await drive.getMeta(e.file_id).catch(() => null);
    if (m && !m.trashed && (m.parents || []).includes(e.to) && !(m.parents || []).includes(e.from)) { await registerMoved(e, m); await save({}); }
  }
  const pending = handoff.queue?.length ? handoff.queue : [{ source: opportunity.folder.id, destination, after: '' }];
  handoff.queue = pending;
  let processed = 0; const started = Date.now();
  const docs = [];
  while (pending.length) {
    const current = pending[0];
    const children = (await drive.listChildren(current.source)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).filter(c => c.id > (current.after || ''));
    for (const child of children) {
      if (Date.now() - started > 35000 || ++processed > 200) { await save({ status: 'partial' }); return handoff; }
      if (child.mimeType === FOLDER) {
        let id = handoff.folders[child.id];
        if (!id) { id = (await (d.tidy || (await import('./tidy-drive.js')).tidyDrive).findOrCreateFolder(current.destination, child.name)).id; handoff.folders[child.id] = id; await save({}); }
        pending.push({ source: child.id, destination: id, after: '' }); current.after = child.id; await save({}); continue;
      }
      const source = await drive.getMeta(child.id);
      if (!source || source.trashed) throw new Error('OPPORTUNITY_SOURCE_UNAVAILABLE');
      const previous = handoff.files[child.id];
      if ((mode === 'move' && !previous) || previous?.moved) {   // a copy already made earlier keeps the historical copy path
        // Same name already in the mission folder (another file): stop for a person, never overwrite.
        const taken = await drive.findFilesByExactName(child.name, current.destination);
        if (taken.some(c => c.id !== child.id)) { await save({ status: 'review_required', reason: 'Un fichier du même nom existe déjà : ' + child.name }); return handoff; }
        const entry = { file_id: child.id, source_id: child.id, name: child.name, moved: true, from: current.source, to: current.destination, source_version: source.modifiedTime, url: source.webViewLink || null };
        handoff.files[child.id] = entry; await save({});   // the intention is written BEFORE the move
        await (d.moveFile || (async (id, from, to) => (await (d.tidy || (await import('./tidy-drive.js')).tidyDrive).move(id, from, to)))) (child.id, current.source, current.destination);
        const after = await drive.getMeta(child.id);
        if (!after || after.trashed || !(after.parents || []).includes(current.destination) || (after.parents || []).includes(current.source)) throw new Error('MISSION_MOVE_NOT_VERIFIED');
        await registerMoved(entry, after);
        current.after = child.id; await save({}); continue;
      }
      if (previous) {
        const copied = await drive.getMeta(previous.file_id).catch(() => null);
        if (copied && !copied.trashed && previous.source_version === source.modifiedTime && (copied.parents || []).includes(current.destination)) {
          if (!previous.registered) { await (d.recordMissionDocuments || (await import('./mission-files.js')).recordMissionDocuments)(mission, [{ id: copied.id, name: child.name, url: copied.webViewLink || null, role: opportunity.workbook?.id === child.id ? 'acceptation' : opportunity.tdr_files?.some(f => f.id === child.id) ? 'tdr' : 'document_opportunite', source: 'opportunity:' + opportunity.id, by: 'Mission Controller' }], d); previous.registered = true; }
          current.after = child.id; await save({}); continue;
        }
        await save({ status: 'review_required', reason: 'Une source ou une copie a changé : ' + child.name }); return handoff;
      }
      const collisions = await drive.findFilesByExactName(child.name, current.destination);
      if (collisions.length) { await save({ status: 'review_required', reason: 'Un fichier du même nom existe déjà : ' + child.name }); return handoff; }
      const copied = await drive.copyFile(child.id, child.name, current.destination);
      const meta = await drive.getMeta(copied.id);
      if (!meta || !(meta.parents || []).includes(current.destination)) throw new Error('MISSION_COPY_NOT_VERIFIED');
      handoff.files[child.id] = { file_id: copied.id, name: child.name, source_version: source.modifiedTime, url: meta.webViewLink || null };
      await save({});
      const sourceAfter = await drive.getMeta(child.id);
      if (!sourceAfter || sourceAfter.trashed || sourceAfter.modifiedTime !== source.modifiedTime) { await save({ status: 'review_required', reason: 'Le document source a changé pendant la copie : ' + child.name }); return handoff; }
      docs.push({ id: copied.id, name: child.name, url: meta.webViewLink || null, role: opportunity.workbook?.id === child.id ? 'acceptation' : opportunity.tdr_files?.some(f => f.id === child.id) ? 'tdr' : 'document_opportunite', source: 'opportunity:' + opportunity.id, by: 'Mission Controller' });
      await (d.recordMissionDocuments || (await import('./mission-files.js')).recordMissionDocuments)(mission, docs.splice(0), d);
      handoff.files[child.id].registered = true;
      current.after = child.id;
      await save({});
    }
    pending.shift(); await save({});
  }
  await save({ status: 'complete', copied: Object.keys(handoff.files).length, mode, moved: Object.values(handoff.files).filter(e => e.moved).length });
  return handoff;
}

// MISSION CONTROLLER RECEIVES THE ORPAILLEUR'S EVENTS (architecture §15 « Route A », §34, §57).
//   DOCUMENT_CLASSIFIED  — a file was filed AND verified in Drive: the Mission Controller finds the
//     mission it belongs to (the mission's Drive folder, or one of its parents), attaches it to the
//     mission's documentary memory with its PBC reference and role, and gives it a PBC status.
//     « A received file does not automatically mean a PBC item is complete »: EXACT/COMPONENT/SUPPORT
//     → RECEIVED_REVIEW_REQUIRED, PARTIEL → PARTIAL, no PBC reference → UNMATCHED. The checklist
//     itself is updated by the PBC Service (next brick), never silently here.
//   NEEDS_HUMAN_CLASSIFICATION — a mission document waits for a person's answer: noted as pending.
//   POSSIBLE_DUPLICATE — nothing was created: noted as an open item to review.
// Not sure of the mission → nothing is attached (the event says why; the file stays listed for review).

const q = encodeURIComponent;
const FOLDER = 'application/vnd.google-apps.folder';
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function pbcStatusFor(role, ref) {
  if (!ref) return 'UNMATCHED';
  return String(role || '').toUpperCase() === 'PARTIEL' ? 'PARTIAL' : 'RECEIVED_REVIEW_REQUIRED';
}

// The folder and all its parents (from the Drive map), nearest first.
export function ancestorsOf(folderId, items) {
  const byId = new Map((items || []).map(i => [i.id, i]));
  const out = [];
  let cur = folderId;
  for (let i = 0; cur && i < 30 && !out.includes(cur); i++) { out.push(cur); cur = (byId.get(cur)?.parents || [])[0] || null; }
  return out;
}

// The mission a folder belongs to: its own folder (index drive_folder_id) or a parent's; else, when
// the folder's path names exactly one mission (all the words of its client and its year), that one.
export function missionForFolder(folderId, folderPath, missions, items) {
  const chain = ancestorsOf(folderId, items);
  const byFolder = missions.filter(m => m.drive_folder_id && chain.includes(m.drive_folder_id));
  if (byFolder.length) return { mission: byFolder.sort((a, b) => chain.indexOf(a.drive_folder_id) - chain.indexOf(b.drive_folder_id))[0], how: 'dossier de la mission' };
  const path = ' ' + norm(folderPath) + ' ';
  const hits = missions.filter(m => {
    const words = norm(m.client_name || m.name).split(' ').filter(w => w.length > 2 && !['audit', 'mission', 'cac', 'sarl'].includes(w));
    const years = String(m.name || '').match(/(?:19|20)\d\d/g) || [];
    return words.length && words.every(w => path.includes(' ' + w + ' ')) && (!years.length || years.some(y => path.includes(y)));
  });
  return hits.length === 1 ? { mission: hits[0], how: 'chemin du dossier' } : { mission: null, candidates: hits.map(m => m.name).slice(0, 5) };
}

export async function handleMissionEvents(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  let ctx = null;
  const context = async () => ctx || (ctx = {
    missions: await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&' + NOT_ARCHIVED_FILTER + '&select=id,name,client_name,drive_folder_id,status&limit=500').catch(() => []) || [],
    items: ((await (d.loadScan || loadScan)(drive, folder).catch(() => ({ state: null }))).state?.items || []).filter(i => i.mimeType === FOLDER)
  });
  const remember = d.writeAgentMemory || (await import('./agent-memory.js')).writeAgentMemory;
  const record = d.recordMissionDocuments || (await import('./mission-files.js')).recordMissionDocuments;
  const setEngagement = (id, missionId) => fetchRows('office_events?org_id=eq.' + q(orgId) + '&id=eq.' + q(id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ engagement_id: missionId }) }).catch(() => null);

  return dispatch(orgId, 'mission-controller', {
    async EVIDENCE_ATTACHED(ev) {
      const { missions } = await context();
      const mission = missions.find(m => m.id === ev.engagement_id);
      if (!mission) return { ignore: 'mission non identifiée — pièce conservée sans déplacement' };
      const p = ev.small_payload || {};
      await record(mission, [{ id: ev.object_id, name: p.name, url: 'https://drive.google.com/file/d/' + encodeURIComponent(ev.object_id) + '/view', role: 'preuve',
        source: 'procedure:' + p.procedure + ':' + p.sample, event_id: ev.id, pbc_status: 'RECEIVED_REVIEW_REQUIRED',
        key_facts: ['Cycle ' + (p.cycle || ''), 'Procédure ' + (p.procedure || ''), 'Élément ' + (p.sample || '')], by: 'enhanced-auditor' }], d);
      return 'Pièce rattachée au registre partagé de la mission ; aucun déplacement ni PBC déclarée complète.';
    },
    async SPECIALIST_FOLLOWUP_RECORDED(ev) {
      await remember('mission-controller', m => {
        const ref = 'specialist-event:' + ev.id;
        if (!(m.open_items || []).some(x => x.ref === ref))
          m.open_items = [...(m.open_items || []), { ref, label: 'Suivi spécialiste enregistré — dossier ' + ev.object_id + ', étape ' + (ev.small_payload?.stage || 'à consulter') + '. Déclaration humaine ; consulter le dossier avant toute action.', since: ev.occurred_at }];
        return m;
      }, d);
      return 'Référence de suivi spécialiste ajoutée aux points ouverts du Mission Controller.';
    },

    async DOCUMENT_CLASSIFIED(ev) {
      const p = ev.small_payload || {};
      const { missions, items } = await context();
      const found = ev.engagement_id ? { mission: missions.find(m => m.id === ev.engagement_id), how: 'indiqué' } : missionForFolder(p.folder_id, p.folder_path, missions, items);
      if (!found.mission) {
        await remember('mission-controller', m => { m.open_items = [...(m.open_items || []), { ref: 'file:' + ev.object_id, label: 'Document classé sans mission identifiée : « ' + (p.name || ev.object_id) + ' » (' + (p.folder_path || '') + ')' + (found.candidates?.length ? ' — candidates : ' + found.candidates.join(', ') : ''), since: ev.occurred_at }]; return m; }, d).catch(() => null);
        return { ignore: 'mission non identifiée' + (found.candidates?.length ? ' (plusieurs possibles : ' + found.candidates.join(', ') + ')' : '') + ' — noté pour revue' };
      }
      const status = pbcStatusFor(p.pbc_role, p.pbc_ref);
      await record(found.mission, [{ id: ev.object_id, name: p.name, path: p.folder_path ? p.folder_path + '/' + p.name : null, url: p.url || null, type: p.doc_type || null,
        role: p.pbc_ref ? 'piece_pbc' : 'autre', period: p.period || null, summary: p.summary || null, by: 'Orpailleur', source: 'orpailleur', event_id: ev.id,
        pbc_ref: p.pbc_ref || null, pbc_role: p.pbc_role || null, pbc_status: status, read_method: p.read_method || null, confidence: p.confidence || null }], { drive, folder });
      await setEngagement(ev.id, found.mission.id);
      await (d.reconcileReceivedDocuments || (await import('./pbc-loop.js')).reconcileReceivedDocuments)(orgId,found.mission.id,d);
      return 'rattaché à « ' + found.mission.name + ' » (' + found.how + ')' + (p.pbc_ref ? ', ' + p.pbc_ref + ' → ' + status : ', sans référence PBC');
    },
    async NEEDS_HUMAN_CLASSIFICATION(ev) {
      const p = ev.small_payload || {};
      await remember('mission-controller', m => { m.pending = [...(m.pending || []).filter(x => x.ref !== 'file:' + ev.object_id), { ref: 'file:' + ev.object_id, label: 'Document en attente d’une réponse (Orpailleur) : « ' + (p.name || '') + ' » — manque : ' + (p.missing || '?'), waiting_for: p.asked || 'une personne du cabinet' }]; return m; }, d);
      return 'noté en attente (question à ' + (p.asked || '?') + ')';
    },
    async POSSIBLE_DUPLICATE(ev) {
      const p = ev.small_payload || {};
      await remember('mission-controller', m => { m.open_items = [...(m.open_items || []).filter(x => x.ref !== 'dup:' + ev.object_id), { ref: 'dup:' + ev.object_id, label: 'POSSIBLE DUPLICATE — REVIEW REQUIRED : « ' + (p.name || '') + ' » — ' + (p.why || ''), since: ev.occurred_at }]; return m; }, d);
      return 'doublon possible noté pour revue';
    },
    // The Manager validated the work programme (2026-10-19, Paul : « j'ai mis le programme de travail, rien n'a été fait ») :
    // the Mission Controller prepares the cycle Working Papers itself (never overwritten; the same code as the button) and
    // notes who prepares what. The page used to do it only if it stayed open; the event alone did nothing.
    async WORK_PROGRAMME_VALIDATED(ev) {
      const missionId = ev.engagement_id;
      if (!missionId) return { ignore: 'mission non indiquée' };
      const prog = (await fetchRows('office_work_programmes?org_id=eq.' + q(orgId) + '&office_mission_id=eq.' + q(missionId) + '&status=eq.validated&select=id,version,cycles&order=version.desc&limit=1').catch(() => []))?.[0];
      if (!prog) return { ignore: 'programme validé introuvable (remplacé depuis ?)' };
      const prepare = d.prepareCycleWorkpapers || (await import('./cycle-workpapers.js')).prepareCycleWorkpapers;
      const r = await prepare(orgId, missionId, { email: null, display_name: 'Mission Controller (IA)', role: 'agent' }, d);
      const wps = r?.workpapers || [];
      const who = new Map();
      for (const c of prog.cycles || []) for (const x of (c.procedures || []).filter(x => x.active)) { const k = x.preparer || c.preparer || 'à désigner'; who.set(k, (who.get(k) || 0) + 1); }
      const ready = wps.filter(w => w.file_id).length, waiting = wps.filter(w => !w.file_id);
      await remember('mission-controller', m => {
        const ref = 'programme:' + prog.id;
        m.open_items = [...(m.open_items || []).filter(x => x.ref !== ref), { ref, label: 'Programme v' + prog.version + ' validé : ' + ready + ' Working Paper(s) prêt(s)' +
          (waiting.length ? ', ' + waiting.length + ' en attente (' + waiting.map(w => w.cycle_code + ' ' + (w.status || '')).join(', ') + ')' : '') +
          ' ; tests à préparer — ' + [...who].map(([k, n]) => k + ' : ' + n).join(', '), since: ev.occurred_at }];
        return m;
      }, d).catch(() => null);
      return ready + ' Working Paper(s) prêt(s)' + (waiting.length ? ', ' + waiting.length + ' en attente' : '') + ' ; ' + [...who].map(([k, n]) => n + ' test(s) pour ' + k).join(', ');
    },
    // Firm Manager → Mission Controller (2026-10-10): the client confirmed the firm is retained; the
    // KYC and the independence are done in the opportunity's workbook before the mission starts.
    async OPPORTUNITY_WON(ev) {
      const r = await (d.onOpportunityWon || (await import('./opportunities.js')).onOpportunityWon)(orgId, ev, d);
      if (r && r.ignore) return r;
      const p = ev.small_payload || {};
      await remember('mission-controller', m => { m.pending = [...(m.pending || []).filter(x => x.ref !== 'opportunity:' + ev.object_id), { ref: 'opportunity:' + ev.object_id, label: 'Faire le KYC et l’indépendance : « ' + (p.title || '') + ' » (classeur d’acceptation, Phase 1)', waiting_for: 'l’équipe de la mission (questions dans Opportunités)' }]; return m; }, d).catch(() => null);
      return r;
    }
  }, d);
}
