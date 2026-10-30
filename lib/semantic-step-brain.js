import { directStep as rawDirectStep } from './step-brain.js';
import { enrichMissionSources } from './semantic-mission-sources.js';

/**
 * Enhanced Auditor entry point used by the real Working File runtime.
 *
 * The raw domain engine still owns its deterministic safety checks. This adapter only
 * fixes what the AI is allowed to know before it reasons: a mission document is described
 * by its remembered meaning, not merely by its filename/PBC label.
 */
export async function semanticDirectStep(ctx, d = {}) {
  const sources = await enrichMissionSources(ctx.sources || [], ctx.missionId, {
    ...d,
    orgId: ctx.orgId,
    strictSources: true
  });
  return rawDirectStep({ ...ctx, sources }, d);
}
