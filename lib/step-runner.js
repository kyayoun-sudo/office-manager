// Universal-kernel facade for the Living Working File.
//
// The complete pre-kernel runner is preserved in step-runner-domain.js. Public helpers
// keep the same names. The two lifecycle actions used by the UI now go through the common
// kernel while preserving the existing human click between PLAN and RUN.

import * as domain from './step-runner-domain.js';
import { planWorkingFileStep, runWorkingFileStep } from './working-file-kernel.js';

export * from './step-runner-domain.js';

export async function planStep(orgId, missionId, code, body = {}, account, d = {}) {
  // Dependency-injected low-level tests keep the raw engine. Real API calls provide no
  // dependency object and therefore enter the common kernel.
  if (d && Object.keys(d).length) {
    return domain.planStep(orgId, missionId, code, body, account, d);
  }
  return planWorkingFileStep(orgId, missionId, code, body, account);
}

export async function runStep(orgId, missionId, code, body = {}, account, d = {}) {
  if (d && Object.keys(d).length) {
    return domain.runStep(orgId, missionId, code, body, account, d);
  }
  return runWorkingFileStep(orgId, missionId, code, body, account);
}
