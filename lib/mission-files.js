import { rest } from './supabase.js';
import { currentOrgId } from './firm-context.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile } from './mapping-scan.js';
import { updateMissionRegister, notifyMissionKnowledge, assertMissionRegisterScope } from './mission-register.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { fileForAI } from './agent-outputs.js';

// A DOCUMENT FOR A MISSION UPDATES THE MISSION (Paul, 2026-10-08: « un fichier qui est pour une
// mission en cours, les agents mettent à jour leurs informations concernant la mission
// directement » — agreed rule: facts updated directly, changes to the mission proposed).
// When a deposited document is recognised as belonging to an active or upcoming mission:
//   DIRECT (a fact): the document is attached to the mission in the agents' memory
//     (OFFICE_MANAGER_MISSION_FILES.json): what it is, summary, key facts, who gave it, when.
//     The mission page, Mission Controller, the Enhanced Auditor and the Grand Contrôleur see it.
//   PROPOSED (changes the mission, « À valider »):
//     - engagement letter / contract with dates → new mission dates (MISSION_UPDATE);
//     - work programme → the team it names, as proposed assignments;
//     - evidence (PBC) → Mission Controller checks it and updates the PBC list;
//     - invoice → Sika updates the billing follow-up.
// Not sure of the mission → nothing is attached: the person who deposited chooses.

const FILE = 'OFFICE_MANAGER_MISSION_FILES.json';
const q = encodeURIComponent;
const isoDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null;

// THE MISSION'S MEMORY LIVES IN THE MISSION'S FOLDER (Paul, 2026-10-25 : « la mémoire de la mission devrait être un fichier ou un
// dossier caché dans le dossier de la mission, que les agents consultent »). <dossier de la mission>/_OFFICE_MANAGER/
// OFFICE_MANAGER_MISSION_MEMORY.json : what each document is, where it is, what every agent did with it. Drive has no truly hidden
// file: the folder is the spec's « _OFFICE_MANAGER » zone (§24), discreet, owned by the firm, ignored by the Orpailleur. The central
// OFFICE_MANAGER_MISSION_FILES.json stays as the index across missions; reading takes the union of both (the newer entry of a
// document wins), so nothing is lost when one of them is missing — and the mission's file follows the mission, not the agents' memory.
export const MISSION_DIR = '_OFFICE_MANAGER', MISSION_MEMORY_FILE = 'OFFICE_MANAGER_MISSION_MEMORY.json';
const newer = (a, b) => (String(a?.at || '') >= String(b?.at || '') ? a : b);
export function mergeDocuments(...lists) {
  const by = new Map();
  for (const list of lists) for (const doc of list || []) if (doc?.id) {
    const old = by.get(doc.id);
    if (!old) { by.set(doc.id, doc); continue; }
    const win = newer(doc, old), lose = win === doc ? old : doc;
    by.set(doc.id, { ...lose, ...Object.fromEntries(Object.entries(win).filter(([, v]) => v != null)),
      uses: [...new Map([...(lose.uses || []), ...(win.uses || [])].map(u => [u.what + '|' + (u.where || ''), u])).values()].slice(-20),
      history: [...new Map([...(lose.history || []), ...(win.history || [])].map(h => [h.at + '|' + h.what, h])).values()].sort((x, y) => String(x.at).localeCompare(String(y.at))).slice(-30) });
  }
  return [...by.values()].sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
}

// The mission's own folder for its memory (found or created once under the mission's Drive folder); null when the mission has no folder.
export async function missionMemoryHome(mission, d = {}) {
  let folder = mission?.drive_folder_id;
  if (folder === undefined && mission?.id) folder = (await (d.fetchRows || rest)(`office_missions?id=eq.${q(mission.id)}${mission.org_id ? '&org_id=eq.' + q(mission.org_id) : ''}&select=drive_folder_id&limit=1`).catch(() => []))?.[0]?.drive_folder_id;
  if (!folder) return null;
  const make = d.findOrCreateFolder || (async (p, n) => (await import('./tidy-drive.js')).tidyDrive.findOrCreateFolder(p, n));
  return (await make(folder, MISSION_DIR))?.id || null;
}

export async function missionDocuments(missionId, d = {}) {
  const { state } = await loadJsonFile(FILE, d.drive || driveAdapter, d.folder || memoryFolderId());
  const central = state?.missions?.[missionId]?.documents || [];
  let own = [];
  try {
    const home = d.missionHome !== undefined ? d.missionHome : await missionMemoryHome({ id: missionId, org_id: d.orgId || null }, d);
    if (home) own = (await loadJsonFile(MISSION_MEMORY_FILE, d.drive || driveAdapter, home)).state?.documents || [];
  } catch { /* the central index still answers */ }
  return mergeDocuments(own, central);
}

export async function recordMissionDocuments(mission, docs, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  await assertMissionRegisterScope(d.orgId || mission.org_id || currentOrgId(),mission.id,d);
  const result=await (d.updateJsonFile || updateMissionRegister)(FILE, previous => {
  const st = previous || { missions: {} };
  const m = (st.missions[mission.id] ||= { name: mission.name, documents: [] });
  m.name = mission.name;
  for (const doc of docs) {
    const old=m.documents.find(x=>x.id===doc.id) || {};
    m.documents = m.documents.filter(x => x.id !== doc.id);
    m.documents.unshift({ ...old, id: doc.id, name: doc.name ?? old.name, path: doc.path ?? old.path, url: doc.url ?? old.url ?? null, type: doc.type ?? old.type ?? null, role: ['piece_recue','piece_pbc','preuve','autre'].includes(doc.role) && old.role && !['piece_recue','piece_pbc','preuve','autre'].includes(old.role) ? old.role : (doc.role || old.role || 'autre'),
      read_status:doc.read_status ?? old.read_status ?? null, classification_quote:doc.classification_quote ?? old.classification_quote ?? null, period: doc.period ?? old.period ?? null, summary: doc.summary ?? old.summary ?? null, key_facts: (doc.key_facts ?? old.key_facts ?? []).slice(0,12), figures: (doc.figures ?? old.figures ?? []).slice(0,12),
      issues: doc.issues ?? old.issues ?? [], visual: Boolean(doc.visual ?? old.visual), by: doc.by ?? old.by ?? null, at: new Date().toISOString(), deposit: doc.deposit || null,
      // From the Orpailleur's classification (event bus, 2026-10-09): PBC reference and role, and the
      // PBC status the Mission Controller gives it (received ≠ complete: always to review first).
      ...(doc.pbc_ref || doc.pbc_role || doc.pbc_status ? { pbc_ref: doc.pbc_ref || old.pbc_ref || null, pbc_role: doc.pbc_role || old.pbc_role || null, pbc_status:doc.pbc_status==='UNMATCHED' && old.pbc_ref ? old.pbc_status : (doc.pbc_status || old.pbc_status || null) } : {}),
      ...(doc.source ? { source: doc.source, event_id: doc.event_id || null, read_method: doc.read_method || null, confidence: doc.confidence || null } : {}),
      // (2026-10-25, Paul : « une mémoire unique dans la mission, que tous les agents remplissent, pour comprendre ce qui a été rangé »)
      // Where the file is now, what it is, and what every agent did with it (read, renamed, filed, imported, used as evidence…).
      title: doc.title ?? old.title ?? null, profile: doc.profile ?? old.profile ?? null, location: doc.location ?? old.location ?? null, folder_id: doc.folder_id ?? old.folder_id ?? null,
      uses: [...new Map([...(old.uses || []), ...(doc.uses || [])].map(u => [u.what + '|' + (u.where || ''), u])).values()].slice(-20),
      history: [...(old.history || []), ...(doc.event ? [{ at: new Date().toISOString(), agent: doc.event.agent || null, what: doc.event.what, detail: String(doc.event.detail || '').slice(0, 300), by: doc.event.by || null }] : [])].slice(-30) });
  }
  // Keep the complete mission inventory; readers track coverage explicitly.
  m.updated_at = new Date().toISOString();
  st.updated_at = m.updated_at;
  return st;
  },{drive,folder,orgId:d.orgId || mission.org_id || currentOrgId(),fetchRows:d.fetchRows,acquireLease:d.acquireLease});
  // The same entries written in the mission's own folder (merged with what is already there: nothing lost, newest wins).
  let own = null;
  try {
    const home = d.missionHome !== undefined ? d.missionHome : await missionMemoryHome({ ...mission, org_id: d.orgId || mission.org_id || null }, d);
    if (home) own = await (d.updateJsonFile || updateMissionRegister)(MISSION_MEMORY_FILE, previous => ({ mission_id: mission.id, name: mission.name,
      documents: mergeDocuments(result.state.missions[mission.id].documents, previous?.documents || []), updated_at: new Date().toISOString() }),
      {drive,folder:home,orgId:d.orgId || mission.org_id || currentOrgId(),fetchRows:d.fetchRows,acquireLease:d.acquireLease});
  } catch { /* written again at the next event; the central index keeps the entry */ }
  await notifyMissionKnowledge(d.orgId || mission.org_id || currentOrgId(),mission.id,{agent:'mission-controller',action:'MISSION_DOCUMENTS_UPDATED',source:own?.fileId || result.fileId,input:docs.map(x=>({id:x.id,role:x.role,period:x.period,source:x.source}))},d);
  return result.state.missions[mission.id].documents.length;
}

const MATCH = `Tu es Mission Controller. Des documents viennent d'être déposés. Rattache chacun à UNE mission en cours ou à venir de la liste, seulement si tu es sûr (client ET objet concordent). Si deux missions sont possibles, ou aucune, ne rattache pas : donne les candidates.
Pour une lettre de mission ou un contrat, relève les dates de début et de fin seulement si elles sont écrites dans les faits fournis (AAAA-MM-JJ).
JSON STRICT : {"links":[{"file_id":"","mission_id":"","confidence":"haute|moyenne|basse","candidates":[""],"why":"","dates":{"start":"","end":""}}]}`;

const TEAM = `Tu es Mission Controller. Lis ce programme de travail (ou planning) et relève l'équipe qu'il nomme : personne, rôle sur la mission, dates. Uniquement ce qui est écrit.
JSON STRICT : {"team":[{"person":"","role":"","start":"","end":""}]}`;

// Links documents to missions (AI), or applies a link chosen by the person (« attach »).
export async function linkToMissions(orgId, docs, missions, d = {}) {
  const ai = d.ai || firstAvailable;
  let links = d.links || null;
  if (!links) {
    if (!missions.length || !docs.length) return { linked: [], to_attach: docs.map(x => ({ id: x.id, name: x.name, path: x.path, candidates: [] })) };
    const r = await ai(['anthropic', 'openai', 'gemini'], { instructions: MATCH, maxTokens: 4000,
      input: 'MISSIONS : ' + JSON.stringify(missions.map(m => ({ id: m.id, name: m.name, code: m.mission_code, start: m.planned_start, end: m.planned_end }))) +
        '\n\nDOCUMENTS : ' + JSON.stringify(docs.map(x => ({ file_id: x.id, path: x.path, type: x.type, role: x.role, client: x.client, mission: x.mission, period: x.period, summary: x.summary, key_facts: x.key_facts }))).slice(0, 80000) });
    links = parseJsonLoose(r.text).links || [];
  }
  const byId = new Map(missions.map(m => [m.id, m]));
  const linked = [], toAttach = [];
  for (const doc of docs) {
    const l = links.find(x => x.file_id === doc.id) || {};
    const mission = l.confidence === 'haute' && byId.get(l.mission_id);
    if (mission) linked.push({ doc, mission, dates: l.dates || {} });
    else toAttach.push({ id: doc.id, name: doc.name, path: doc.path, why: l.why || null, candidates: (l.candidates || []).map(id => byId.get(id)).filter(Boolean).map(m => ({ id: m.id, name: m.name })) });
  }
  return { linked, to_attach: toAttach };
}

// Facts recorded directly; changes to the mission proposed in « À valider ».
export async function applyMissionUpdates(orgId, linked, ctx = {}, d = {}) {
  const fetchRows = d.fetchRows || rest, ai = d.ai || firstAvailable;
  const now = new Date().toISOString();
  const out = { attached: 0, proposals: [], team_proposed: 0 };
  const byMission = new Map();
  for (const x of linked) { if (!byMission.has(x.mission.id)) byMission.set(x.mission.id, { mission: x.mission, items: [] }); byMission.get(x.mission.id).items.push(x); }
  const propose = async (row) => {
    await fetchRows('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify([{ org_id: orgId, status: 'proposed', work_state: 'requested', requested_at: now, ...row }]) });
    out.proposals.push(row.summary);
  };
  for (const { mission, items } of byMission.values()) {
    out.attached += items.length;
    await (d.recordMissionDocuments || recordMissionDocuments)(mission, items.map(x => ({ ...x.doc, by: ctx.by || null, deposit: ctx.deposit || null })), d);
    for (const { doc, dates } of items) {
      const tag = ' (déposé' + (ctx.by ? ' par ' + ctx.by : '') + ')';
      if (['lettre_de_mission', 'contrat'].includes(doc.role)) {
        const start = isoDate(dates.start), end = isoDate(dates.end);
        if ((start && start !== mission.planned_start) || (end && end !== mission.planned_end)) {
          await propose({ agent_key: 'grand-controleur', action_type: 'MISSION_UPDATE', office_mission_id: mission.id, idempotency_key: 'mission-update:' + mission.id + ':' + doc.id,
            summary: ('Mettre à jour les dates de « ' + mission.name + ' » : ' + (start || mission.planned_start || '?') + ' → ' + (end || mission.planned_end || '?') + ', d’après « ' + doc.name + ' »' + tag).slice(0, 500),
            payload: { mission_id: mission.id, planned_start: start || null, planned_end: end || null, file_id: doc.id, file_name: doc.name, web_url: doc.url || null },
            evidence: { source: 'dépôt Rangement', document: doc.name, previous: { planned_start: mission.planned_start || null, planned_end: mission.planned_end || null } } });
        }
      }
      // The client's people named in an engagement letter, contract or organisation chart → proposed contacts (2026-10-08).
      if (['lettre_de_mission', 'contrat', 'organigramme', 'tdr'].includes(doc.role) && !d.skipContacts) {
        try {
          const f = await (d.fileForAI || fileForAI)(doc.id, { maxChars: 30000 });
          const txt = f.visual ? [doc.summary, ...(doc.key_facts || [])].filter(Boolean).join('\n') : f.text;
          await (d.contactsFromText || (await import('./mission-data.js')).contactsFromText)(orgId, mission.id, txt, 'document « ' + doc.name + ' »', { by: 'Mission Controller (dépôt)' });
        } catch { /* contacts read later */ }
      }
      if (doc.role === 'programme_de_travail' && out.team_proposed < 40) {
        try {
          const f = await (d.fileForAI || fileForAI)(doc.id, { maxChars: 40000 });
          const r = await ai(f.visual ? ['anthropic', 'gemini', 'openai'] : ['anthropic', 'openai', 'gemini'], { instructions: TEAM, input: f.visual ? 'Programme joint : ' + doc.name : String(f.text || '').slice(0, 40000), files: f.visual ? [f] : [], maxTokens: 3000 });
          const team = parseJsonLoose(r.text).team || [];
          const staff = await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&active=eq.true&select=id,full_name&limit=300') || [];
          const already = new Set((await fetchRows('office_mission_assignments?org_id=eq.' + q(orgId) + '&office_mission_id=eq.' + q(mission.id) + '&select=staff_profile_id') || []).map(a => a.staff_profile_id));
          const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
          for (const t of team) {
            const s = staff.find(x => norm(x.full_name) === norm(t.person)) || staff.find(x => norm(t.person).length > 3 && norm(x.full_name).includes(norm(t.person)));
            const start = isoDate(t.start) || mission.planned_start, end = isoDate(t.end) || mission.planned_end;
            if (!s || already.has(s.id) || !start || !end || end < start) continue;
            already.add(s.id);
            await fetchRows('office_mission_assignments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ org_id: orgId, office_mission_id: mission.id, staff_profile_id: s.id,
              mission_role: String(t.role || 'membre').slice(0, 80), planned_start: start, planned_end: end, allocation_pct: 100, status: 'proposed',
              responsibility_scope: ('Lu dans le programme déposé « ' + doc.name + ' »').slice(0, 300) }]) }).then(() => { out.team_proposed++; }, () => null);
          }
        } catch { /* the programme stays attached; the team is read later by Mission Controller */ }
      }
      // No « contrôler ce document » proposal any more (Paul, 2026-10-25: validated, it became a team task): the piece is read, renamed,
      // filed and kept in the mission's memory; the working file's needs find it there, a person confirms the link. An invoice is noted
      // for Sika in the same memory.
      if (doc.role === 'facture') await noteMissionEvent(orgId, mission.id, doc.id, { agent: 'mission-controller', what: 'facture reçue', detail: 'pour Sika (facturation de la mission)', uses: [{ what: 'facturation', where: 'sika' }] }, d).catch(() => null);
    }
  }
  return out;
}

// One event in the mission's memory, from any agent: the file's current name / place / identity, and what was done.
export async function noteMissionEvent(orgId, missionId, fileId, { agent, what, detail, by, name, location, folder_id, title, type, period, summary, uses } = {}, d = {}) {
  if (!missionId || !fileId) return null;
  const m = (await (d.fetchRows || rest)(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}&select=id,name&limit=1`).catch(() => []))?.[0] || { id: missionId, name: null };
  const doc = { id: fileId, event: { agent, what, detail, by } };
  for (const [k, v] of Object.entries({ name, location, folder_id, title, type, period, summary, uses })) if (v != null) doc[k] = v;
  return recordMissionDocuments({ ...m, org_id: orgId }, [doc], { ...d, orgId }).catch(() => null);
}

// The mission's memory as people and agents read it: each file, what it is, where it is, its last events.
export async function missionMemory(missionId, d = {}) {
  const docs = await missionDocuments(missionId, d).catch(() => []);
  return docs.map(x => ({ id: x.id, name: x.name, url: x.url || null, title: x.title || x.type || null, type: x.type || null, period: x.period || null, summary: x.summary || null,
    location: x.location || x.path || null, role: x.role || null, pbc_ref: x.pbc_ref || null, uses: x.uses || [], history: (x.history || []).slice(-5), read: Boolean(x.type || x.summary || x.profile), profile: x.profile || null }));
}
