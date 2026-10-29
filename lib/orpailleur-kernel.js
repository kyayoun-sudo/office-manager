import { KERNEL_STATUS, runAgentKernel } from './agent-kernel.js';
import { tidyPlanStep, tidyStatus } from './tidy-plan.js';

const OPEN_QUESTION_STATES = new Set(['open']);

function openQuestions(state) {
  return Object.values(state?.asked || {})
    .filter(item => OPEN_QUESTION_STATES.has(String(item?.status || '').toLowerCase()))
    .map(item => item?.question || item?.missing || 'Information de classement à confirmer')
    .filter(Boolean)
    .slice(0, 20);
}

function counters(state) {
  return {
    status: state?.status || 'none',
    done: Number(state?.done || 0),
    total: Number(state?.total || 0),
    moves: Number(state?.moves || 0),
    renames: Number(state?.renames || 0),
    questions: Number(state?.questions || 0),
    ok: Number(state?.ok || 0)
  };
}

function progressed(before, after) {
  const a = counters(before), b = counters(after);
  return b.done > a.done || b.moves > a.moves || b.renames > a.renames || b.questions > a.questions || b.ok > a.ok || a.status !== b.status;
}

/**
 * Kernel adapter for the existing Orpailleur filing engine.
 *
 * tidy-plan remains the domain engine that reads documents and decides their filing.
 * The universal kernel owns the lifecycle: observe current state, run one bounded batch,
 * read the state back, continue until verified / human required / blocked.
 */
export async function runOrpailleurKernel(orgId, req, d = {}) {
  const statusFn = d.status || tidyStatus;
  const stepFn = d.step || tidyPlanStep;
  const tidyDeps = d.tidyDeps || {};
  const continueRun = d.continueRun || (async () => {
    const { fireInternal } = await import('./agent-passes.js');
    return fireInternal(req, '/api/orpailleur', { action: 'kernel' });
  });

  return runAgentKernel({
    orgId,
    agent: 'orpailleur',
    objective: 'Traiter le passage de rangement courant jusqu’à ce que chaque fichier détecté soit décidé, que toute question humaine nécessaire soit explicitement en attente, ou que le passage soit réellement terminé.',
    // A Drive can contain hundreds of documents. One invocation stays bounded; when
    // progress remains, onCycleLimit persists the state and schedules the next kernel run.
    maxCycles: d.maxCycles ?? 4,
    observe: async () => {
      const state = await statusFn(tidyDeps);
      if (['failed', 'incomplete'].includes(state?.status)) {
        return { blocked: true, reason: 'ORPAILLEUR_PASS_' + String(state.status).toUpperCase(), read: { tidy: state } };
      }
      if (state?.status === 'stopped') {
        return {
          blocked: true,
          reason: 'ORPAILLEUR_STOPPED_BY_PERSON',
          read: { tidy: state }
        };
      }
      if (state?.status === 'none') {
        return { blocked: true, reason: 'ORPAILLEUR_PASS_NOT_STARTED', read: { tidy: state } };
      }
      return { read: { tidy: state }, tidy: state };
    },
    // One bounded unit only. noLoop prevents tidy-plan from launching its own continuation;
    // the kernel is now responsible for the continuation decision.
    work: async ({ observation }) => {
      const before = observation?.tidy || observation?.read?.tidy || {};
      if (before.status === 'done') {
        return { understanding: 'Le passage est déjà terminé ; seule la vérification finale reste à faire.', done: [], progress: false };
      }
      const result = await stepFn(orgId, req, { ...tidyDeps, oneBatch: true, noLoop: true });
      if (result?.status === 'reader_busy') {
        return { blocked: true, reason: 'ORPAILLEUR_READER_BUSY', detail: 'Le lecteur Drive exclusif est occupé par un autre passage.' };
      }
      return {
        understanding: 'Un lot Orpailleur a été traité par le moteur documentaire existant.',
        done: [{ action: 'orpailleur_tidy_batch', result }],
        progress: true,
        proposed: [],
        refused: [],
        questions: []
      };
    },
    verify: async ({ observation }) => {
      const before = observation?.tidy || observation?.read?.tidy || {};
      const after = await statusFn(tidyDeps);
      const questions = openQuestions(after);

      if (['failed', 'incomplete'].includes(after?.status)) {
        return { blocked: true, reason: 'ORPAILLEUR_PASS_' + String(after.status).toUpperCase(), state: counters(after) };
      }

      if (after?.status === 'stopped') {
        return {
          human_required: true,
          questions: ['Le rangement a été arrêté par une personne. Une reprise humaine explicite est nécessaire.'],
          state: counters(after),
          reason: 'ORPAILLEUR_STOPPED_BY_PERSON'
        };
      }

      if (questions.length) {
        return {
          human_required: true,
          questions,
          state: counters(after),
          reason: 'Des fichiers ne peuvent pas être classés sans une information humaine ciblée.'
        };
      }

      if (after?.status === 'done') {
        return {
          verified: true,
          state: counters(after),
          reason: 'Le moteur Orpailleur a relu son état persistant et le passage est terminé sans question ouverte.'
        };
      }

      return {
        verified: false,
        progress: progressed(before, after),
        state: counters(after),
        reason: after?.status === 'planning' ? 'Des fichiers restent à traiter.' : 'Le passage n’est pas encore vérifié comme terminé.'
      };
    },
    onCycleLimit: async () => {
      const state = await statusFn(tidyDeps);
      const questions = openQuestions(state);
      if (questions.length || state?.status !== 'planning') return { continue: false, state: counters(state) };
      const scheduled = await continueRun();
      if (scheduled === false) throw new Error('ORPAILLEUR_KERNEL_CONTINUATION_NOT_SCHEDULED');
      return {
        continue: true,
        scheduled: true,
        state: counters(state),
        reason: 'Le passage reste en cours ; la prochaine invocation du même kernel a été programmée.'
      };
    },
    checkpoint: d.checkpoint || null
  }, d.kernelDeps || {});
}

export { KERNEL_STATUS };
