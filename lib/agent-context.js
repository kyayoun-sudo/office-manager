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
