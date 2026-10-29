import { runAgentKernel, KERNEL_STATUS } from './agent-kernel.js';
import { loadAgentMemory } from './agent-memory.js';
import { missionControllerPass } from './agent-passes.js';

function missionControllerState(memory) {
  const m = memory?.memory || memory || {};
  return {
    status: m.status || 'unknown',
    last_attempted_at: m.last_attempted_at || null,
    last_successful_at: m.last_successful_at || null,
    last_error: m.last_error || null,
    retry_count: Number(m.retry_count || 0),
    pending: Array.isArray(m.pending) ? m.pending : [],
    checkpoint: m.checkpoint || null
  };
}

function changed(before, after) {
  return before?.last_attempted_at !== after?.last_attempted_at ||
    before?.last_successful_at !== after?.last_successful_at ||
    before?.status !== after?.status ||
    before?.pending?.length !== after?.pending?.length;
}

/**
 * Mission Controller adapter for the universal kernel.
 *
 * The existing missionControllerPass remains the domain worker. It refreshes mission
 * memories, status proposals and orphan assignments. The kernel owns the lifecycle:
 * observe persisted agent memory -> run one pass -> reload persisted memory -> decide
 * verified / awaiting human / blocked.
 */
export async function runMissionControllerKernel(orgId, d = {}) {
  const load = d.loadAgentMemory || loadAgentMemory;
  const pass = d.pass || missionControllerPass;

  return runAgentKernel({
    orgId,
    agent: 'mission-controller',
    objective: 'Mettre à jour les mémoires des missions, leurs statuts et affectations, puis vérifier que le passage Mission Controller a réellement été enregistré.',
    maxCycles: d.maxCycles ?? 2,
    observe: async () => {
      const raw = await load('mission-controller').catch(error => ({ error: String(error?.message || error) }));
      if (raw?.error) return { blocked: true, reason: 'MISSION_CONTROLLER_MEMORY_UNREADABLE', read: { error: raw.error } };
      const state = missionControllerState(raw);
      return { read: { mission_controller: state }, state };
    },
    work: async ({ observation }) => {
      const before = observation?.state || observation?.read?.mission_controller || {};
      const result = await pass(orgId);
      const failed = Array.isArray(result?.missions) ? result.missions.filter(x => x?.status === 'failed') : [];
      return {
        understanding: 'Le passage Mission Controller a rafraîchi les mémoires de mission et les contrôles associés.',
        done: [{ action: 'mission_controller_pass', result }],
        progress: true,
        before,
        result,
        blocked: Boolean(result?.missions?.length && failed.length === result.missions.length),
        reason: failed.length && failed.length === result?.missions?.length ? 'MISSION_CONTROLLER_ALL_MISSIONS_FAILED' : null,
        proposed: [], refused: [], questions: []
      };
    },
    verify: async ({ observation }) => {
      const before = observation?.state || observation?.read?.mission_controller || {};
      const raw = await load('mission-controller').catch(error => ({ error: String(error?.message || error) }));
      if (raw?.error) return { blocked: true, reason: 'MISSION_CONTROLLER_MEMORY_UNREADABLE', error: raw.error };
      const after = missionControllerState(raw);

      if (after.status === 'failed') {
        return { blocked: true, reason: 'MISSION_CONTROLLER_PASS_FAILED', error: after.last_error, state: after };
      }

      if (after.pending.length) {
        return {
          human_required: true,
          questions: after.pending.map(x => x?.label || x?.waiting_for || 'Information de mission à confirmer').filter(Boolean).slice(0, 20),
          state: after,
          reason: 'Le Mission Controller a terminé son traitement automatique mais certaines missions exigent une confirmation humaine.'
        };
      }

      if (after.status === 'idle' && after.last_successful_at && changed(before, after)) {
        return {
          verified: true,
          state: after,
          reason: 'Le passage est enregistré comme réussi dans la mémoire persistante du Mission Controller.'
        };
      }

      return {
        verified: false,
        progress: changed(before, after),
        state: after,
        reason: 'Le résultat du passage n’est pas encore prouvé par la mémoire persistante du Mission Controller.'
      };
    },
    checkpoint: d.checkpoint || null
  }, d.kernelDeps || {});
}

export { KERNEL_STATUS };
