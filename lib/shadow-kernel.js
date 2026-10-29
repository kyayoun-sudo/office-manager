import { runAgentKernel, KERNEL_STATUS } from './agent-kernel.js';
import { loadLab, shadowPass } from './shadow.js';

const day = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Shadow adapter for the universal kernel.
 * Shadow stays non-operational: verification is based on its lab memory, never on a client
 * mutation. Its existing shadowPass remains the domain worker.
 */
export async function runShadowKernel(orgId, d = {}) {
  const load = d.loadLab || loadLab;
  const pass = d.shadowPass || shadowPass;
  const now = d.now || new Date();
  const expectedDay = day(now);
  let passResult = null;

  return runAgentKernel({
    orgId,
    agent: 'shadow',
    objective: 'Observer les nouveaux signaux, mettre à jour le laboratoire Shadow et enregistrer le passage sans effectuer d’action opérationnelle sur un client.',
    maxCycles: 1,
    observe: async () => {
      const lab = await load(d.labDeps || {});
      return {
        read: {
          last_run: lab?.last_run || null,
          last_observed_at: lab?.last_observed_at || null,
          lessons: Array.isArray(lab?.lessons) ? lab.lessons.length : 0,
          problems: Array.isArray(lab?.problems) ? lab.problems.length : 0
        },
        lab
      };
    },
    work: async () => {
      passResult = await pass(orgId, { ...(d.passDeps || {}), force: d.force, now });
      if (passResult?.skipped === 'SHADOW_DISABLED') {
        return { blocked: true, reason: 'SHADOW_DISABLED', done: [], proposed: [], refused: [], questions: [] };
      }
      if (passResult?.skipped === 'NO_AI_KEY') {
        return { blocked: true, reason: 'SHADOW_NO_AI_AVAILABLE', done: [], proposed: [], refused: [], questions: [] };
      }
      return {
        understanding: 'Shadow a exécuté son passage de laboratoire sans action opérationnelle sur les missions.',
        done: [{ action: 'shadow_lab_pass', result: passResult }],
        progress: true,
        proposed: [], refused: [], questions: []
      };
    },
    verify: async ({ observation }) => {
      const before = observation?.lab || {};
      const after = await load(d.labDeps || {});

      if (passResult?.skipped === 'ALREADY_TODAY' && after?.last_run === expectedDay) {
        return { verified: true, no_op: true, reason: 'Le passage Shadow du jour était déjà enregistré.', last_run: after.last_run };
      }

      if (after?.last_run === expectedDay && (before?.last_run !== after.last_run || after?.last_observed_at !== before?.last_observed_at)) {
        return {
          verified: true,
          reason: 'Le laboratoire persistant confirme le passage Shadow du jour.',
          last_run: after.last_run,
          last_observed_at: after.last_observed_at || null
        };
      }

      return {
        blocked: true,
        reason: 'SHADOW_PASS_NOT_PERSISTED',
        detail: 'Le worker a répondu mais SHADOW_LAB.json ne confirme pas le passage.'
      };
    },
    checkpoint: d.checkpoint || null
  }, d.kernelDeps || {});
}

export { KERNEL_STATUS };
