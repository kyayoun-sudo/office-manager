import { KERNEL_STATUS, runAgentKernel } from './agent-kernel.js';
import { auditorState, auditorStep } from './enhanced-auditor.js';

function outputOk(value) {
  return Boolean(value) && !(value && typeof value === 'object' && value.error);
}

function snapshot(state = {}) {
  return {
    status: state.status || 'none',
    stage: state.stage || null,
    analytical_review: Boolean(state.analytical_review),
    knowledge_processed: Number(state.knowledge?.processed || 0),
    knowledge_total: Number(state.knowledge?.total || 0),
    picture_done: Number(state.picture_done || 0),
    evidence_total: Array.isArray(state.evidence_files) ? state.evidence_files.length : 0,
    risks: Array.isArray(state.risks) ? state.risks.length : 0,
    coverage: Array.isArray(state.coverage) ? state.coverage.length : 0,
    report: outputOk(state.report),
    matrix: outputOk(state.matrix),
    execution_status: state.execution?.status || null
  };
}

function progressed(before, after) {
  const a = snapshot(before), b = snapshot(after);
  return a.status !== b.status || a.stage !== b.stage ||
    b.knowledge_processed > a.knowledge_processed ||
    b.picture_done > a.picture_done ||
    b.risks > a.risks || b.coverage > a.coverage ||
    (!a.report && b.report) || (!a.matrix && b.matrix) ||
    a.execution_status !== b.execution_status;
}

function missingQuestions(state = {}) {
  const missing = Array.isArray(state.missing_documents) ? state.missing_documents : [];
  return missing.length
    ? missing.map(x => String(x)).filter(Boolean).slice(0, 20)
    : ['Les pièces disponibles ne permettent pas de poursuivre la revue.'];
}

/**
 * Kernel adapter for Enhanced Auditor.
 *
 * enhanced-auditor.js remains the domain engine (SOP/WP execution, risks,
 * evidence, coverage and reports). The universal kernel owns continuation and
 * completion semantics. Internal self-dispatch is disabled while the kernel is
 * driving the review, so there is only one lifecycle owner.
 */
export async function runEnhancedAuditorKernel(orgId, req, missionId, d = {}) {
  const stateFn = d.state || auditorState;
  const stepFn = d.step || auditorStep;
  const auditorDeps = d.auditorDeps || {};

  return runAgentKernel({
    orgId,
    missionId,
    agent: 'enhanced-auditor',
    objective: 'Faire avancer la revue Enhanced Auditor de la mission jusqu’à un résultat réellement enregistré et relu, ou s’arrêter explicitement si des pièces ou une décision humaine sont nécessaires.',
    maxCycles: d.maxCycles ?? 20,
    observe: async () => {
      const state = await stateFn(missionId, auditorDeps);
      if (state?.status === 'none') {
        return { blocked: true, reason: 'ENHANCED_AUDITOR_NOT_STARTED', read: { review: state } };
      }
      if (state?.status === 'failed') {
        return { blocked: true, reason: 'ENHANCED_AUDITOR_FAILED', error: state.error || null, read: { review: state } };
      }
      return { read: { review: snapshot(state) }, review: state };
    },
    work: async ({ observation }) => {
      const before = observation?.review || {};
      if (before.status === 'done' || before.status === 'needs_documents') {
        return { understanding: 'La revue est arrivée à un état terminal ; seule la vérification du résultat reste à faire.', done: [], progress: false, proposed: [], refused: [], questions: [] };
      }
      const result = await stepFn(orgId, req, { mission_id: missionId }, {
        ...auditorDeps,
        // Prevent enhanced-auditor.js from starting its own background chain.
        // The universal kernel alone decides whether another cycle is required.
        fire: async () => true
      });
      return {
        understanding: 'Une étape bornée de la revue Enhanced Auditor a été exécutée par son moteur métier existant.',
        done: [{ action: 'enhanced_auditor_stage', result: snapshot(result) }],
        progress: true,
        proposed: [],
        refused: [],
        questions: []
      };
    },
    verify: async ({ observation }) => {
      const before = observation?.review || {};
      const after = await stateFn(missionId, auditorDeps);

      if (after?.status === 'failed') {
        return { blocked: true, reason: 'ENHANCED_AUDITOR_FAILED', error: after.error || null, state: snapshot(after) };
      }

      if (after?.status === 'needs_documents') {
        return {
          human_required: true,
          questions: missingQuestions(after),
          state: snapshot(after),
          reason: 'La revue ne peut pas continuer sans pièces supplémentaires.'
        };
      }

      if (after?.status === 'done') {
        const reportOk = outputOk(after.report);
        const matrixRequired = !after.analytical_review;
        const matrixOk = !matrixRequired || outputOk(after.matrix);
        if (!reportOk || !matrixOk) {
          return {
            blocked: true,
            reason: 'ENHANCED_AUDITOR_OUTPUT_NOT_VERIFIED',
            detail: !reportOk ? 'Le rapport final n’est pas enregistré correctement.' : 'La matrice finale n’est pas enregistrée correctement.',
            state: snapshot(after)
          };
        }
        return {
          verified: true,
          state: snapshot(after),
          reason: 'L’état persistant est terminé et les livrables requis sont présents sans erreur enregistrée.'
        };
      }

      return {
        verified: false,
        progress: progressed(before, after),
        state: snapshot(after),
        reason: after?.stage ? 'La revue doit continuer à l’étape ' + after.stage + '.' : 'La revue n’est pas encore terminée.'
      };
    },
    checkpoint: d.checkpoint || null
  }, d.kernelDeps || {});
}

export { KERNEL_STATUS };
