import { directStepWithMissionMemory } from './working-file-memory-brain.js';
import { enrichMissionSources } from './semantic-mission-sources.js';

/**
 * Enhanced Auditor entry point used by the real Working File runtime.
 *
 * Mission semantics are injected before planning, then the memory-first adapter reuses
 * versioned audit_read receipts. This keeps both guarantees at once:
 *   - the AI understands what a document means, not just its filename/PBC label;
 *   - unchanged documents are not sent through the AI reading loop again.
 */
export async function semanticDirectStep(ctx, d = {}) {
  const sources = await enrichMissionSources(ctx.sources || [], ctx.missionId, {
    ...d,
    orgId: ctx.orgId,
    strictSources: true
  });
  const direct = d.directStepWithMissionMemory || directStepWithMissionMemory;
  return direct({ ...ctx, sources }, d);
}
