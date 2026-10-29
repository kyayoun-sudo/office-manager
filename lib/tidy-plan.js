// Universal-kernel facade for Orpailleur's tidy engine.
//
// The full document-reading/classification engine is preserved in tidy-plan-domain.js.
// Existing routes keep importing this file, but real tidy steps now enter the universal
// kernel. Dependency-injected low-level tests can still call one raw domain batch.

import * as domain from './tidy-plan-domain.js';
import { runOrpailleurKernel } from './orpailleur-kernel.js';

export * from './tidy-plan-domain.js';

function isInjectedDomainCall(d = {}) {
  return Boolean(
    d.raw === true ||
    d.drive || d.fetchRows || d.runAI || d.readText || d.readerLease ||
    d.currentMeta || d.changedSince || d.recordFiles || d.agentSettings ||
    d.askMissing || d.proposeMessage || d.recordDecision || d.kernelBypass === true
  );
}

export async function tidyPlanStep(orgId, req, d = {}) {
  // api/app may pass { noLoop:true } for a manual bounded request; that is still a
  // real application call and must use the kernel. Only explicit dependency-injected
  // domain calls bypass the facade for deterministic low-level tests.
  if (isInjectedDomainCall(d)) {
    return domain.tidyPlanStep(orgId, req, d);
  }
  return runOrpailleurKernel(orgId, req);
}
