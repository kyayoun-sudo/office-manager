import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, saveJsonFile } from './mapping-scan.js';
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

export async function missionDocuments(missionId, d = {}) {
  const { state } = await loadJsonFile(FILE, d.drive || driveAdapter, d.folder || memoryFolderId());
  return state?.missions?.[missionId]?.documents || [];
}

export async function recordMissionDocuments(mission, docs, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const cur = await loadJsonFile(FILE, drive, folder);
  const st = cur.state || { missions: {} };
  const m = (st.missions[mission.id] ||= { name: mission.name, documents: [] });
  m.name = mission.name;
  for (const doc of docs) {
    m.documents = m.documents.filter(x => x.id !== doc.id);
    m.documents.unshift({ id: doc.id, name: doc.name, path: doc.path, url: doc.url || null, type: doc.type || null, role: doc.role || 'autre',
      period: doc.period || null, summary: doc.summary || null, key_facts: (doc.key_facts || []).slice(0, 12), figures: (doc.figures || []).slice(0, 12),
      issues: doc.issues || [], visual: Boolean(doc.visual), by: doc.by || null, at: new Date().toISOString(), deposit: doc.deposit || null });
  }
  m.documents = m.documents.slice(0, 300);
  m.updated_at = new Date().toISOString();
  st.updated_at = m.updated_at;
  await saveJsonFile(FILE, drive, folder, cur.fileId, st);
  return m.documents.length;
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
      if (['piece_justificative', 'etat_financier'].includes(doc.role)) {
        await propose({ agent_key: 'grand-controleur', action_type: 'MISSION_DOCUMENT_REVIEW', office_mission_id: mission.id, idempotency_key: 'mission-doc:' + doc.id,
          summary: ('Mission Controller : contrôler « ' + doc.name + ' » et mettre à jour la liste PBC de « ' + mission.name + ' »' + tag).slice(0, 500),
          payload: { mission_id: mission.id, file_id: doc.id, file_name: doc.name, web_url: doc.url || null, for_agent: 'mission-controller' },
          evidence: { source: 'dépôt Rangement', summary: doc.summary || null } });
      }
      if (doc.role === 'facture') {
        await propose({ agent_key: 'sika', action_type: 'MISSION_DOCUMENT_REVIEW', office_mission_id: mission.id, idempotency_key: 'mission-invoice:' + doc.id,
          summary: ('Sika : mettre à jour la facturation de « ' + mission.name + ' » avec « ' + doc.name + ' »' + tag).slice(0, 500),
          payload: { mission_id: mission.id, file_id: doc.id, file_name: doc.name, web_url: doc.url || null, for_agent: 'sika' },
          evidence: { source: 'dépôt Rangement', summary: doc.summary || null } });
      }
    }
  }
  return out;
}
