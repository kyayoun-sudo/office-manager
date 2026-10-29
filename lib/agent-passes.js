// Universal-kernel facade for scheduled/manual agent passes.
//
// The former scheduler is preserved byte-for-byte in agent-passes-legacy.js.
// This facade injects migrated kernel workers through the dependency hooks that
// already existed in the scheduler, so unrelated maintenance keeps its previous
// behaviour and can be rolled back without reconstructing the old file.

import * as legacy from './agent-passes-legacy.js';

export * from './agent-passes-legacy.js';

async function kernelOrpailleurChangesPass(orgId, req) {
  const tidy = await import('./tidy-plan.js');
  const before = await tidy.tidyStatus().catch(() => ({ status: 'none' }));

  // First-ever Drive bootstrap still belongs to the existing mapping engine. It may
  // need to create/read the Drive map before there is a tidy state for the kernel to
  // continue. We deliberately do not start a second loop in parallel on that first run.
  if (before?.status === 'none') {
    return tidy.startChangesPass(orgId, req);
  }

  // A person explicitly stopped the pass: preserve that decision. The kernel will not
  // silently resume it.
  if (before?.status === 'stopped') {
    return {
      started: false,
      reason: 'STOPPED_BY_PERSON',
      stopped_by: before.stopped_by || null,
      stopped_at: before.stopped_at || null,
      done: before.done || 0
    };
  }

  // If a pass is already planning, do not create another one. If it is finished or
  // interrupted, initialise/resume it but suppress tidy-plan's legacy self-dispatch;
  // the kernel owns every continuation from this point.
  let start = null;
  if (before?.status === 'planning') {
    start = {
      started: true,
      resumed: true,
      since: before.since || null,
      files: before.total || before.files?.length || 0,
      reason: 'KERNEL_RESUME_EXISTING_PASS'
    };
  } else {
    start = await tidy.startChangesPass(orgId, req, {
      fire: async () => true
    });
  }

  const state = await tidy.tidyStatus().catch(() => null);
  if (!state || !['planning', 'done'].includes(state.status)) return start;

  const { runOrpailleurKernel, KERNEL_STATUS } = await import('./orpailleur-kernel.js');
  const kernel = await runOrpailleurKernel(orgId, req, {
    continueRun: async () => legacy.fireInternal(req, '/api/orpailleur', { action: 'kernel' })
  });
  const after = await tidy.tidyStatus().catch(() => state);

  // The legacy scheduler records one scheduled slot. "started" here means that the
  // slot was successfully handed to the kernel, not that all document work is already
  // finished. Kernel status remains the source of truth for completion.
  return {
    started: kernel.status !== KERNEL_STATUS.BLOCKED,
    reason: 'KERNEL_' + String(kernel.status || 'unknown').toUpperCase(),
    since: after?.since || start?.since || null,
    files: after?.total || after?.files?.length || start?.files || 0,
    reader_busy: kernel.error?.reason === 'ORPAILLEUR_READER_BUSY',
    kernel_status: kernel.status,
    kernel_cycle: kernel.cycle || null,
    kernel_error: kernel.error || null
  };
}

async function kernelMissionControllerRefresh(orgId) {
  const { runMissionControllerKernel } = await import('./mission-controller-kernel.js');
  const kernel = await runMissionControllerKernel(orgId);
  return {
    kernel_status: kernel.status,
    cycle: kernel.cycle || null,
    verification: kernel.verification || null,
    questions: kernel.questions || [],
    error: kernel.error || null,
    trace: kernel.trace || []
  };
}

async function kernelPeopleUpkeep(orgId, req) {
  // Same people-maintenance work as the preserved scheduler. Only Shadow's own pass is
  // replaced by the kernel adapter; staff sync, HR refresh, questions and cards keep
  // their existing behaviour.
  const out = {};
  try {
    out.staff = await (await import('./people-sync.js')).syncStaffFromUsers(orgId, { force: true });
  } catch (error) {
    out.staff = String(error?.message || error).slice(0, 80);
  }
  try {
    const cap = await import('./capabilities.js');
    const st = await cap.capabilityState();
    if (st.status !== 'reading' && (st.reader_version !== 2 || !st.updated_at || Date.now() - Date.parse(st.updated_at) > 86400000)) {
      out.hr = await cap.startCapabilityRefresh(orgId, req).then(() => 'relu', error => String(error?.message || error).slice(0, 80));
    }
  } catch (error) {
    out.hr = String(error?.message || error).slice(0, 80);
  }
  try {
    out.questions = await (await import('./people-questions.js')).askQuestions(orgId);
  } catch (error) {
    out.questions = String(error?.message || error).slice(0, 80);
  }
  try {
    out.cards = await (await import('./people-cards.js')).autoRefreshCards(orgId);
  } catch (error) {
    out.cards = String(error?.message || error).slice(0, 80);
  }
  try {
    out.shadow = await (await import('./shadow-kernel.js')).runShadowKernel(orgId, {
      passDeps: { req }
    });
  } catch (error) {
    out.shadow = String(error?.message || error).slice(0, 80);
  }
  return out;
}

function withKernelDeps(deps = {}) {
  // Offline/unit tests deliberately inject fetchRows and keep full control of the old
  // dependency graph unless they explicitly request a kernel worker.
  if (deps.fetchRows) return deps;
  return {
    ...deps,
    startChangesPass: deps.startChangesPass ?? kernelOrpailleurChangesPass,
    refreshMissionMemories: deps.refreshMissionMemories ?? kernelMissionControllerRefresh,
    peopleUpkeep: deps.peopleUpkeep ?? kernelPeopleUpkeep
  };
}

export async function runPass(orgId, pass, req, deps = {}) {
  return legacy.runPass(orgId, pass, req, withKernelDeps(deps));
}

export async function startPass(orgId, agent, slot, req, deps = {}) {
  return legacy.startPass(orgId, agent, slot, req, withKernelDeps(deps));
}

export async function tick(orgId, req, deps = {}) {
  return legacy.tick(orgId, req, withKernelDeps(deps));
}

export async function runNow(orgId, req, deps = {}) {
  return legacy.runNow(orgId, req, withKernelDeps(deps));
}

export async function listPasses(orgId, fetchRows) {
  return legacy.listPasses(orgId, fetchRows);
}
