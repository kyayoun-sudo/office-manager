import { KERNEL_STATUS, runAgentKernel } from './agent-kernel.js';
import * as domain from './step-runner-domain.js';

const HUMAN_CONFIRMATION = new Set([
  'PROPOSAL_CONFIRMATION_REQUIRED',
  'HUMAN_CONFIRMATION_REQUIRED'
]);

const errorCode = error => String(error?.message || error || 'WORKING_FILE_ERROR');

function planQuestions(plan = {}) {
  const out = [];
  for (const value of Array.isArray(plan.missing) ? plan.missing : []) if (value) out.push(String(value));
  for (const value of Array.isArray(plan.questions) ? plan.questions : []) if (value) out.push(String(value));
  if (!plan.ready && !out.length) out.push('Le plan de cette étape est incomplet : compléter les informations nécessaires avant exécution.');
  return [...new Set(out)].slice(0, 30);
}

/**
 * Prepare one Working File step through the universal kernel.
 *
 * This deliberately preserves the existing human boundary: preparing a valid plan does
 * NOT execute it. The kernel records that a human click/confirmation is the next required
 * event. That is professional judgement / explicit approval, not an agent failure.
 */
export async function planWorkingFileStep(orgId, missionId, code, body = {}, account, d = {}) {
  const planFn = d.planStep || domain.planStep;
  let plan = null;
  let workError = null;

  const kernel = await runAgentKernel({
    orgId,
    missionId,
    agent: 'enhanced-auditor',
    objective: `Préparer l'étape ${body?.step || '?'} du Working File ${code} sans l'exécuter avant la validation humaine prévue.`,
    maxCycles: 1,
    observe: async () => ({
      read: { mission_id: missionId, procedure: code, step: body?.step || null, phase: 'plan' }
    }),
    work: async () => {
      try {
        plan = await planFn(orgId, missionId, code, body, account, d.domainDeps || {});
      } catch (error) {
        workError = error;
        throw error;
      }
      return {
        understanding: 'Enhanced Auditor a préparé un plan borné pour cette étape du Working File ; aucune écriture métier n’est exécutée à ce stade.',
        done: [{ action: 'working_file_step_plan', result: { operation: plan?.operation || null, ready: Boolean(plan?.ready), step: plan?.step?.n || body?.step || null } }],
        progress: true,
        proposed: [], refused: [], questions: []
      };
    },
    verify: async () => {
      // An exhaustive document reader can legitimately return a persistent background
      // checkpoint. The planning request itself succeeded; execution still has not occurred.
      if (plan?.pending === true || plan?.status === 'reading') {
        return {
          verified: true,
          phase: 'planning_background',
          reason: 'La lecture documentaire de préparation est enregistrée et peut continuer ; aucune exécution du Working File n’a été déclarée.'
        };
      }

      const questions = planQuestions(plan || {});
      if (!plan?.ready) {
        return {
          human_required: true,
          questions,
          reason: 'Le plan n’est pas exécutable sans information ou choix supplémentaire.'
        };
      }

      return {
        human_required: true,
        questions: [
          ...questions,
          'Plan prêt : confirmer explicitement « Exécuter » pour autoriser le code à écrire le résultat dans le Working File.'
        ].slice(0, 30),
        plan_ready: true,
        reason: 'Le plan est prêt mais la frontière humaine plan → exécution est volontairement conservée.'
      };
    }
  }, d.kernelDeps || {});

  if (workError) throw workError;
  return {
    ...(plan || {}),
    kernel_status: kernel.status,
    kernel_questions: kernel.questions || [],
    kernel_verification: kernel.verification || null
  };
}

/**
 * Execute a previously prepared Working File plan through deterministic code, then rely
 * on the domain engine's existing read-back proof (result.verified) before the kernel can
 * return VERIFIED.
 */
export async function runWorkingFileStep(orgId, missionId, code, body = {}, account, d = {}) {
  const runFn = d.runStep || domain.runStep;
  let execution = null;
  let workError = null;
  let humanCode = null;

  const kernel = await runAgentKernel({
    orgId,
    missionId,
    agent: 'enhanced-auditor',
    objective: `Exécuter et vérifier l'étape du Working File ${code} explicitement confirmée par l'utilisateur.`,
    maxCycles: 1,
    observe: async () => ({
      read: { mission_id: missionId, procedure: code, phase: 'run', plan_operation: body?.plan?.operation || null }
    }),
    work: async () => {
      try {
        execution = await runFn(orgId, missionId, code, body, account, d.domainDeps || {});
      } catch (error) {
        workError = error;
        const codeValue = errorCode(error);
        if (HUMAN_CONFIRMATION.has(codeValue)) {
          humanCode = codeValue;
          return {
            human_required: true,
            understanding: 'Le code refuse l’écriture tant que la confirmation humaine requise n’est pas fournie.',
            done: [], progress: false, proposed: [], refused: [],
            questions: [codeValue === 'PROPOSAL_CONFIRMATION_REQUIRED'
              ? 'Confirmer les propositions préparées avant leur écriture dans le Working File.'
              : 'Une confirmation humaine du Working File est requise avant de poursuivre.']
          };
        }
        throw error;
      }

      return {
        understanding: 'Le code déterministe a exécuté le plan confirmé et a relu le Working File.',
        done: [{ action: 'working_file_step_run', result: { sheet: execution?.sheet || null, verified: execution?.verified === true, operation: execution?.operation || body?.plan?.operation || null } }],
        progress: true,
        proposed: [], refused: [], questions: []
      };
    },
    verify: async () => {
      if (execution?.verified === true) {
        return {
          verified: true,
          sheet: execution.sheet || null,
          reason: 'Le moteur Working File a relu le fichier écrit et confirme le résultat.'
        };
      }
      return {
        blocked: true,
        reason: 'WORKING_FILE_WRITE_NOT_VERIFIED',
        detail: 'Le code a fini son exécution mais la relecture du fichier ne confirme pas le résultat.'
      };
    }
  }, d.kernelDeps || {});

  // Preserve the public API's previous confirmation-error semantics for the UI.
  if (humanCode && workError) throw workError;
  if (workError) throw workError;

  return {
    ...(execution || {}),
    kernel_status: kernel.status,
    kernel_verification: kernel.verification || null,
    kernel_error: kernel.error || null
  };
}

export { KERNEL_STATUS };
