import { rest } from './supabase.js';
import { emit, dispatch } from './event-bus.js';

// MISSION_STARTED (2026-10-17, Paul): once the Mission Controller has created the mission and put its documents
// in the mission folder, EVERY other agent is told that the mission has started. One event per agent (an event
// has a single consumer); each agent receives its own and writes its OWN memory — the single-writer rule of
// lib/agent-memory.js is kept, nobody writes for another agent. The event carries references only (mission id,
// folder id, a count), never document content.
//   'grand-controleur' = Firm Manager (name of its memory file), the Mission Controller is the sender.
export const MISSION_START_CONSUMERS = Object.freeze(['grand-controleur', 'enhanced-auditor', 'orpailleur', 'sika']);

const cut = (s, n = 200) => s == null ? null : String(s).slice(0, n);

const NOTE = {
  orpailleur: m => 'Mission « ' + m.name + ' » démarrée : ses documents ont été placés dans son dossier par le Mission Controller. Ne pas les reclasser ; les renommer seulement si le nom ne dit pas ce que c’est.',
  'enhanced-auditor': m => 'Mission « ' + m.name + ' » démarrée : dossier de mission prêt ; le programme de travail et les working papers viendront du Mission Controller.',
  'grand-controleur': m => 'Mission « ' + m.name + ' » démarrée : suivre la charge de l’équipe et les alertes de la mission.',
  sika: m => 'Mission « ' + m.name + ' » démarrée : honoraires, jalons de facturation et échéances à suivre pour cette mission.'
};

export async function announceMissionStarted(orgId, mission, info = {}, d = {}) {
  if (!orgId || !mission?.id) return { announced: 0, error: 'MISSION_REQUIRED' };
  const emitFn = d.emit || emit;
  const payload = { name: cut(mission.name, 160), folder_id: info.folder_id || mission.drive_folder_id || null, opportunity_id: info.opportunity_id || null,
    documents: Number.isFinite(info.documents) ? info.documents : null, mode: info.mode || null };
  const out = { announced: 0, recorded: [], errors: [] };
  for (const consumer of MISSION_START_CONSUMERS) {
    // The same mission announced twice (a retry) is recorded once per agent: idempotency key.
    const r = await emitFn(orgId, { type: 'MISSION_STARTED', agent: 'mission-controller', consumer, engagement_id: mission.id, object_type: 'mission', object_id: mission.id,
      source: 'mission-controller:handoff', idempotency_key: 'MISSION_STARTED:' + mission.id + ':' + consumer, payload }, { fetchRows: d.fetchRows || rest }).catch(e => ({ error: cut(e.message || e) }));
    if (r?.error) out.errors.push(consumer + ': ' + r.error); else { out.announced++; out.recorded.push(consumer); }
  }
  return out;
}

// What one agent does with the news: it notes it in its own memory (and nothing else).
export async function handleMissionStartedFor(agent, orgId, d = {}) {
  const remember = d.writeAgentMemory || (await import('./agent-memory.js')).writeAgentMemory;
  return dispatch(orgId, agent, {
    async MISSION_STARTED(ev) {
      const p = ev.small_payload || {};
      const mission = { id: ev.engagement_id || ev.object_id, name: p.name || ev.object_id };
      await remember(agent, m => {
        const started = (m.started_missions || []).filter(x => x.id !== mission.id);
        started.push({ id: mission.id, name: cut(mission.name, 160), folder_id: p.folder_id || null, since: ev.occurred_at });
        m.started_missions = started.slice(-40);
        if (!(m.active_missions || []).some(x => x.id === mission.id)) m.active_missions = [...(m.active_missions || []), { id: mission.id, name: cut(mission.name, 160), status: 'started' }];
        const at = ev.occurred_at || new Date().toISOString();
        if (!(m.next_pass_notes || []).some(x => x.ref === 'mission-started:' + mission.id)) m.next_pass_notes = [...(m.next_pass_notes || []), { at, ref: 'mission-started:' + mission.id, note: (NOTE[agent] || NOTE.sika)(mission) }];
        return m;
      }, { ...d, orgId });
      return 'mission « ' + cut(mission.name, 80) + ' » notée dans la mémoire de ' + agent;
    }
  }, d);
}

// Called by the scheduler tick, next to the Mission Controller's own events.
export async function handleMissionStartEvents(orgId, d = {}) {
  const out = {};
  for (const agent of MISSION_START_CONSUMERS) {
    try { out[agent] = await handleMissionStartedFor(agent, orgId, d); } catch (e) { out[agent] = { error: cut(e.message || e) }; }
  }
  return out;
}
