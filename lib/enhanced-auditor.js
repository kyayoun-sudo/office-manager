// Universal-kernel facade for Enhanced Auditor.
//
// The complete pre-kernel business engine is preserved in enhanced-auditor-domain.js.
// Existing imports keep the same public API, but the real application auditor-step route
// now enters the universal kernel. Direct dependency-injected calls keep access to one raw
// domain step so existing low-level tests remain deterministic.

import * as domain from './enhanced-auditor-domain.js';
import { runEnhancedAuditorKernel } from './enhanced-auditor-kernel.js';

export * from './enhanced-auditor-domain.js';

export function auditorStepRoute(d = {}) {
  return d && Object.keys(d).length ? 'domain' : 'kernel';
}

export async function auditorStep(orgId, req, body = {}, d = {}) {
  // Test/domain callers that explicitly inject dependencies are asking for one raw
  // bounded stage. The production API route passes no dependency object and therefore
  // always uses the kernel lifecycle.
  if (auditorStepRoute(d) === 'domain') {
    return domain.auditorStep(orgId, req, body, d);
  }

  const missionId = String(body?.mission_id || '').trim();
  if (!missionId) throw Object.assign(new Error('MISSION_ID_REQUIRED'), { statusCode: 400 });
  return runEnhancedAuditorKernel(orgId, req, missionId);
}
