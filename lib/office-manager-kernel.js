import { runAgentKernel, KERNEL_STATUS } from './agent-kernel.js';
import { runOfficeManager } from './orchestrator.js';
import { getRunToolEvents } from './supabase.js';

const READ_ONLY_TOOL = /^(read_|search_|consult_|locate_|list_|get_|inspect_|find_|preview_|check_)/i;

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function eventVerified(event) {
  const meta = event?.metadata || {};
  return meta.verified === true || meta.work_state === 'verified' || meta.verification_status === 'verified';
}

function operationalTools(result, events) {
  const names = unique([...(result?.toolsUsed || []), ...(events || []).map(e => e?.tool_name)]);
  return names.filter(name => !READ_ONLY_TOOL.test(String(name)));
}

/**
 * Kernel adapter for the root Office Manager / Grand Contrôleur orchestration.
 *
 * A text answer is enough only for an informational/read-only request. If the run used an
 * operational tool, the run is verified only when the tool event carries explicit verification
 * evidence. Otherwise the kernel stops safely instead of confusing "agent answered" with
 * "work completed".
 */
export async function runOfficeManagerKernel(input, d = {}) {
  const orgId = input?.orgId || null;
  const runId = input?.runId || null;
  const run = d.runOfficeManager || runOfficeManager;
  const loadEvents = d.getRunToolEvents || getRunToolEvents;
  let result = null;

  const kernel = await runAgentKernel({
    orgId,
    agent: input?.requestedAgent === 'auto' || !input?.requestedAgent ? 'grand-controleur' : input.requestedAgent,
    objective: String(input?.message || '').trim() || 'Traiter la demande Firm Manager',
    maxCycles: 1,
    observe: async () => ({
      read: {
        run_id: runId,
        tool_events_before: runId && orgId ? await loadEvents(orgId, runId).catch(() => []) : []
      }
    }),
    work: async () => {
      result = await run(input);
      return {
        understanding: 'Firm Manager a traité la demande avec son orchestrateur et ses spécialistes/outils.',
        done: [{ action: 'office_manager_orchestration', result: { provider: result?.provider, toolsUsed: result?.toolsUsed || [], lastAgent: result?.lastAgent || null } }],
        progress: true,
        proposed: [], refused: [], questions: []
      };
    },
    verify: async () => {
      if (!result?.text || !String(result.text).trim()) {
        return { blocked: true, reason: 'OFFICE_MANAGER_EMPTY_RESULT' };
      }

      const events = runId && orgId ? await loadEvents(orgId, runId).catch(() => []) : [];
      const unfinished = events.filter(e => e?.phase && !['completed', 'verified'].includes(String(e.phase).toLowerCase()));
      if (unfinished.length) {
        return {
          blocked: true,
          reason: 'OFFICE_MANAGER_TOOL_EVENTS_INCOMPLETE',
          detail: unfinished.map(e => e.tool_name).filter(Boolean).join(', ')
        };
      }

      const operational = operationalTools(result, events);
      if (!operational.length) {
        return {
          verified: true,
          mode: 'informational',
          tools: unique([...(result.toolsUsed || []), ...events.map(e => e?.tool_name)]),
          reason: 'La demande est informative ou utilise uniquement des outils de lecture ; une réponse non vide a été produite.'
        };
      }

      const unverified = operational.filter(name => {
        const matching = events.filter(e => e?.tool_name === name);
        return !matching.length || !matching.every(eventVerified);
      });

      if (unverified.length) {
        return {
          human_required: true,
          questions: unverified.map(name => `Vérifier l’effet réel de l’action ${name} avant de considérer le travail terminé.`),
          operational_tools: operational,
          reason: 'Firm Manager a utilisé un outil opérationnel sans preuve explicite de vérification.'
        };
      }

      return {
        verified: true,
        mode: 'operational',
        operational_tools: operational,
        reason: 'Chaque outil opérationnel utilisé porte une preuve explicite de vérification.'
      };
    },
    checkpoint: d.checkpoint || null
  }, d.kernelDeps || {});

  return { ...kernel, result };
}

export { KERNEL_STATUS };
