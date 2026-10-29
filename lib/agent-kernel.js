import { think as defaultThink } from './agent-brain.js';

// Universal execution loop for every operational agent.
// The agent-specific code supplies only:
// - objective: what must be achieved;
// - observe(): the current real-world state relevant to that objective;
// - actions: the actions this agent is allowed to request;
// - verify(): an independent read-back that decides whether the objective is really complete.
//
// The kernel owns the lifecycle:
// OBSERVE -> THINK/ACT -> VERIFY -> REMEMBER/CHECKPOINT -> NEXT.
// A model answer is never enough to mark work verified.

export const KERNEL_STATUS = Object.freeze({
  RUNNING: 'running',
  VERIFIED: 'verified',
  AWAITING_HUMAN: 'awaiting_human',
  BLOCKED: 'blocked'
});

const cut = (value, max = 500) => String(value ?? '').slice(0, max);

function kernelError(reason, detail = null) {
  return { reason, detail: detail ? cut(detail) : null };
}

async function checkpoint(fn, state) {
  if (!fn) return;
  await fn(state);
}

/**
 * Execute one agent objective until it is verified, requires a person, is blocked,
 * or reaches the safety cycle limit.
 *
 * IMPORTANT: think() may execute non-approval actions. Completion is decided only
 * by verify(), which must read back the real system after those actions.
 */
export async function runAgentKernel({
  orgId,
  missionId = null,
  agent,
  objective,
  actions = {},
  observe,
  verify,
  instructions = '',
  ctx = {},
  by = null,
  maxCycles = 8,
  checkpoint: checkpointFn = null
}, deps = {}) {
  const think = deps.think || defaultThink;
  const observeFn = deps.observe || observe;
  const verifyFn = deps.verify || verify;
  const save = deps.checkpoint || checkpointFn;

  if (!agent) throw new Error('AGENT_KERNEL_AGENT_REQUIRED');
  if (!objective) throw new Error('AGENT_KERNEL_OBJECTIVE_REQUIRED');
  if (typeof observeFn !== 'function') throw new Error('AGENT_KERNEL_OBSERVE_REQUIRED');
  if (typeof verifyFn !== 'function') throw new Error('AGENT_KERNEL_VERIFY_REQUIRED');

  const cycleLimit = Math.max(1, Math.min(Number(maxCycles) || 8, 30));
  const trace = [];
  let previous = null;

  for (let cycle = 1; cycle <= cycleLimit; cycle += 1) {
    const observation = await observeFn({
      orgId,
      missionId,
      agent,
      objective,
      cycle,
      previous,
      ctx
    });

    if (observation?.blocked) {
      const result = {
        status: KERNEL_STATUS.BLOCKED,
        agent,
        missionId,
        objective,
        cycle,
        error: kernelError('OBSERVATION_BLOCKED', observation.reason || observation.error),
        trace
      };
      await checkpoint(save, result);
      return result;
    }

    await checkpoint(save, {
      status: KERNEL_STATUS.RUNNING,
      phase: 'observed',
      agent,
      missionId,
      objective,
      cycle
    });

    const brain = await think({
      orgId,
      missionId,
      agent,
      task: objective,
      read: observation?.read ?? observation ?? {},
      actions,
      instructions,
      ctx,
      by
    }, deps.thinkDeps || {});

    const entry = {
      cycle,
      understanding: brain?.understanding || null,
      done: brain?.done || [],
      proposed: brain?.proposed || [],
      refused: brain?.refused || [],
      questions: brain?.questions || [],
      memory_error: brain?.memory_error || null,
      ai_error: brain?.ai_error || null
    };
    trace.push(entry);

    if (brain?.ai_error) {
      const result = {
        status: KERNEL_STATUS.BLOCKED,
        agent,
        missionId,
        objective,
        cycle,
        error: kernelError('AI_UNAVAILABLE', brain.ai_error),
        trace
      };
      await checkpoint(save, result);
      return result;
    }

    // Human approval/questions are explicit stop conditions. Never hide them by
    // calling the objective complete after the model merely proposed something.
    if ((brain?.proposed || []).length || (brain?.questions || []).length) {
      const result = {
        status: KERNEL_STATUS.AWAITING_HUMAN,
        agent,
        missionId,
        objective,
        cycle,
        proposed: brain?.proposed || [],
        questions: brain?.questions || [],
        trace
      };
      await checkpoint(save, result);
      return result;
    }

    // Independent read-back. This must inspect the actual system state after the
    // action(s): Drive, workbook, PBC, Supabase, etc. A textual AI answer is not proof.
    const verification = await verifyFn({
      orgId,
      missionId,
      agent,
      objective,
      cycle,
      observation,
      brain,
      previous,
      ctx
    });

    entry.verification = verification || null;

    if (verification?.human_required) {
      const result = {
        status: KERNEL_STATUS.AWAITING_HUMAN,
        agent,
        missionId,
        objective,
        cycle,
        questions: verification.questions || [],
        trace
      };
      await checkpoint(save, result);
      return result;
    }

    if (verification?.verified === true || verification?.completed === true) {
      const result = {
        status: KERNEL_STATUS.VERIFIED,
        agent,
        missionId,
        objective,
        cycle,
        verification,
        trace
      };
      await checkpoint(save, result);
      return result;
    }

    const progressed = (brain?.done || []).length > 0 || verification?.progress === true;
    if (!progressed) {
      const result = {
        status: KERNEL_STATUS.BLOCKED,
        agent,
        missionId,
        objective,
        cycle,
        error: kernelError('NO_PROGRESS', verification?.reason || 'No executable action and objective not verified'),
        trace
      };
      await checkpoint(save, result);
      return result;
    }

    previous = { observation, brain, verification };
    await checkpoint(save, {
      status: KERNEL_STATUS.RUNNING,
      phase: 'next',
      agent,
      missionId,
      objective,
      cycle,
      verification
    });
  }

  const result = {
    status: KERNEL_STATUS.BLOCKED,
    agent,
    missionId,
    objective,
    cycle: cycleLimit,
    error: kernelError('MAX_CYCLES_REACHED', `Objective still not verified after ${cycleLimit} cycles`),
    trace
  };
  await checkpoint(save, result);
  return result;
}
