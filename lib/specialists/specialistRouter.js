import { AGENTS, callSpecialist } from './specialistService.js';

// Server-owned identity: create this at an internal agent's composition root, never from AI arguments.
// Intentionally not inserted into existing agent toolsets in v1: current agent behavior stays intact.
export function specialistRouter({ orgId, agentKey, actor }, dependencies = {}) {
  if (!AGENTS.includes(agentKey)) throw new Error('SPECIALIST_AGENT_INVALID');
  return Object.freeze({ call: request => callSpecialist(orgId,agentKey,request,actor,dependencies) });
}
