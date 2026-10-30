// Universal-kernel facade for the Living Working File.
//
// The complete pre-kernel runner is preserved in step-runner-domain.js. Public helpers
// keep the same names. The two lifecycle actions used by the UI now go through the common
// kernel while preserving the existing human click between PLAN and RUN.

import * as domain from './step-runner-domain.js';
import { planWorkingFileStep, runWorkingFileStep } from './working-file-kernel.js';
import { semanticDirectStep } from './semantic-step-brain.js';
import { enrichMissionSources, semanticSourceLabel } from './semantic-mission-sources.js';

export * from './step-runner-domain.js';

// External consumers receive the same catalogue enriched with the mission's semantic
// memory. A PBC/file name is only a hint; remembered meaning travels with the file_id.
export async function stepSources(orgId, missionId, d = {}) {
  const base = await domain.stepSources(orgId, missionId, d);
  return enrichMissionSources(base, missionId, { ...d, orgId, strictSources: d.strictSources === true });
}

// Show meaning first in the Working File UI while preserving the real filename for traceability.
export async function stepsView(orgId, missionId, code, account, d = {}) {
  const view = await domain.stepsView(orgId, missionId, code, account, d);
  const sources = await enrichMissionSources(view.sources || [], missionId, { ...d, orgId, strictSources: d.strictSources === true });
  return {
    ...view,
    sources: sources.map(source => ({
      ...source,
      file_name: source.name || null,
      display_name: semanticSourceLabel(source),
      name: semanticSourceLabel(source)
    }))
  };
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
