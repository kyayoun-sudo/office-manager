// Which agent is speaking, and for which mission, during one request (2026-11-02).
// Set once by the route (« Ma procédure » = the Enhanced Auditor) so that EVERY AI call of that request receives the firm's
// validated lessons (lib/agent-learning-context.js), without each module having to name its agent. A module that names its
// agent (agentKey) keeps its own choice.
import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

export function asAgent({ agent, missionId = null } = {}, fn) {
  return store.run({ agent: agent || null, missionId: missionId || null }, fn);
}

export function currentAgent() {
  return store.getStore() || null;
}

// Which agent speaks for each screen (2026-11-02): every AI call of the request then receives that agent's validated lessons
// (asAgent → callModel in lib/ai-plus.js), for the mission named by the request. A module that names its own agent keeps its choice.
// Routes not listed (accounts, settings, search…) make no agent speak. /api/agent adds the lessons itself.
export const AGENT_OF_ROUTE = Object.freeze({
  ...Object.fromEntries(['procedure', 'workfile', 'workfile-kpi', 'ai-memory', 'analytical-review', 'auditor', 'auditor-step', 'auditor-work',
    'auditor-evening-step', 'auditor-wp-step', 'signoff'].map(r => [r, 'enhanced-auditor'])),
  ...Object.fromEntries(['work-programme', 'mission-quick', 'mission-quick-step', 'pbc', 'mission-archive', 'mission-write', 'mission-fact',
    'mission-file', 'mission-client-contacts', 'mission-contacts', 'dossier', 'dossier-followup', 'workflow', 'engagement', 'engagement-step',
    'mission-dedupe', 'mission-view', 'deposit', 'deposit-step', 'plan-integrate'].map(r => [r, 'mission-controller'])),
  ...Object.fromEntries(['opportunities', 'opportunity-step', 'opportunity-team-step', 'opportunity-kyc-step', 'opportunity-quotation-step',
    'opportunity-commercial-step', 'opportunity-handoff-step', 'tenders', 'tender-step', 'secretariat', 'submissions', 'submissions-step',
    'capabilities', 'capabilities-step', 'cockpit', 'team-recommendation', 'people-brief', 'firm-learn', 'external-specialists',
    'management-card'].map(r => [r, 'grand-controleur'])),
  ...Object.fromEntries(['tidy', 'tidy-plan-step', 'mapping-scan', 'mapping-step', 'drop'].map(r => [r, 'orpailleur'])),
  'sika-expenses': 'sika',
  ...Object.fromEntries(['shadow', 'shadow-code-step', 'shadow-investigate-step', 'shadow-survey', 'training', 'training-step'].map(r => [r, 'shadow']))
});

export function agentOfRoute(route, missionId) {
  const agent = AGENT_OF_ROUTE[String(route || '')];
  const id = String(missionId || '');
  return agent ? { agent, missionId: /^[0-9a-f-]{36}$/i.test(id) ? id : null } : null;
}
