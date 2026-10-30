// Universal-kernel facade for the Living Working File.
//
// The complete pre-kernel runner is preserved in step-runner-domain.js. Public helpers
// keep the same names. The two lifecycle actions used by the UI now go through the common
// kernel while preserving the existing human click between PLAN and RUN.

import * as domain from './step-runner-domain.js';
import { planWorkingFileStep, runWorkingFileStep } from './working-file-kernel.js';
import { semanticDirectStep } from './semantic-step-brain.js';
import { enrichMissionSources } from './semantic-mission-sources.js';

export * from './step-runner-domain.js';

// External consumers (Working File understanding, exhaustive document review, UI source list)
// receive the same catalogue enriched with the mission's semantic memory. A PBC/file name is
// only a hint; the remembered meaning of the document travels with the same file_id.
export async function stepSources(orgId, missionId, d = {}) {
  const base = await domain.stepSources(orgId, missionId, d);
  return enrichMissionSources(base, missionId, { ...d, orgId, strictSources: d.strictSources === true });
}

export async function planStep(orgId, missionId, code, body = {}, account, d = {}) {
  // Dependency-injected low-level tests keep the raw engine. Real API calls provide no
  // dependency object and therefore enter the common kernel.
  if (d && Object.keys(d).length) {
    return domain.planStep(orgId, missionId, code, body, account, d);
  }
  return planWorkingFileStep(orgId, missionId, code, body, account, {
    domainDeps: { directStep: semanticDirectStep }
  });
}

export async function runStep(orgId, missionId, code, body = {}, account, d = {}) {
  if (d && Object.keys(d).length) {
    return domain.runStep(orgId, missionId, code, body, account, d);
  }
  return runWorkingFileStep(orgId, missionId, code, body, account);
}
