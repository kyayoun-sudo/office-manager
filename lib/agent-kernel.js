// The single bounded execution heart shared by Firm Manager agents.
// It owns execution semantics; agent-specific modules provide observations,
// decisions, tools and business postconditions.
//
// Serverless rule: one invocation may execute one bounded kernel step. Long
// jobs persist `state` / `next` and call the kernel again in a later request.

const cut = (value, max = 300) => String(value ?? '').slice(0, max);

export const KERNEL_WORK_STATE = Object.freeze({
  PROPOSED: 'proposed',
  EXECUTED_UNVERIFIED: 'executed_unverified',
  VERIFIED: 'verified',
  BLOCKED: 'blocked',
  REFUSED: 'refused'
});

export function actionCatalog(actions = {}) {
  return Object.entries(actions).map(([name, action]) => ({
    action: name,
    does: action?.describe || '',
    needs_a_person_first: Boolean(action?.approval)
  }));
}

export function normalizeVerification(value) {
  if (value === true) return { verified: true, evidence: null };
  if (value === false || value == null) return { verified: false, evidence: value ?? null };
  if (typeof value === 'object') {
    return {
      verified: value.verified === true || value.ok === true,
      evidence: value
    };
  }
  return { verified: false, evidence: value };
}

export async function authorizeKernelOrder(order, actions = {}, ctx = {}) {
  const name = String(order?.action || '');
  const action = actions[name];
  const why = cut(order?.why, 300) || null;
  if (!action) {
    return {
      ok: false,
      work_state: KERNEL_WORK_STATE.REFUSED,
      action: name,
      params: order?.params || {},
      why,
      refused: 'action inconnue pour cet agent'
    };
  }

  let params = order?.params && typeof order.params === 'object' ? order.params : {};
  if (typeof action.check === 'function') {
    let checked;
    try {
      checked = await action.check(params, ctx);
    } catch (error) {
      checked = { ok: false, why: cut(error?.message || error, 160) };
    }
    if (!checked?.ok) {
      return {
        ok: false,
        work_state: KERNEL_WORK_STATE.REFUSED,
        action: name,
        params,
        why,
        refused: checked?.why || 'paramètres refusés par le code'
      };
    }
    if (checked.params) params = checked.params;
  }

  if (action.approval) {
    return {
      ok: false,
      approval_required: true,
      work_state: KERNEL_WORK_STATE.PROPOSED,
      action: name,
      params,
      why
    };
  }

  return { ok: true, action: name, implementation: action, params, why };
}

export async function executeKernelOrder(authorized, ctx = {}) {
  const action = authorized?.implementation;
  if (!authorized?.ok || !action) throw new Error('KERNEL_ORDER_NOT_AUTHORIZED');

  let result;
  try {
    result = await action.run(authorized.params, ctx);
  } catch (error) {
    return {
      action: authorized.action,
      params: authorized.params,
      why: authorized.why,
      work_state: KERNEL_WORK_STATE.REFUSED,
      refused: 'échec à l’exécution : ' + cut(error?.message || error, 160)
    };
  }

  if (typeof action.verify !== 'function') {
    return {
      action: authorized.action,
      params: authorized.params,
      why: authorized.why,
      result,
      work_state: KERNEL_WORK_STATE.EXECUTED_UNVERIFIED,
      verification: null
    };
  }

  try {
    const checked = normalizeVerification(await action.verify(authorized.params, result, ctx));
    return {
      action: authorized.action,
      params: authorized.params,
      why: authorized.why,
      result,
      work_state: checked.verified ? KERNEL_WORK_STATE.VERIFIED : KERNEL_WORK_STATE.EXECUTED_UNVERIFIED,
      verification: checked.evidence
    };
  } catch (error) {
    return {
      action: authorized.action,
      params: authorized.params,
      why: authorized.why,
      result,
      work_state: KERNEL_WORK_STATE.EXECUTED_UNVERIFIED,
      verification: { ok: false, error: cut(error?.message || error, 200) }
    };
  }
}

export async function executeKernelOrders({ orders = [], actions = {}, ctx = {}, maxOrders = 30 } = {}) {
  const done = [], proposed = [], refused = [];
  for (const order of (Array.isArray(orders) ? orders : []).slice(0, maxOrders)) {
    const authorized = await authorizeKernelOrder(order, actions, ctx);
    if (authorized.approval_required) {
      proposed.push({
        action: authorized.action,
        params: authorized.params,
        why: authorized.why,
        work_state: authorized.work_state
      });
      continue;
    }
    if (!authorized.ok) {
      refused.push({
        action: authorized.action,
        params: authorized.params,
        why: authorized.why,
        refused: authorized.refused,
        work_state: authorized.work_state
      });
      continue;
    }
    const executed = await executeKernelOrder(authorized, ctx);
    if (executed.work_state === KERNEL_WORK_STATE.REFUSED) refused.push(executed);
    else done.push(executed);
  }
  return { done, proposed, refused };
}

// Generic one-step heart. It deliberately does not contain an AI provider:
// the agent supplies `decide`, so Orpailleur can reuse its filing intelligence,
// Enhanced Auditor its audit intelligence, etc., without creating a second brain.
export async function runKernelStep({
  agent,
  objective,
  state = null,
  observe,
  remember,
  decide,
  actions = {},
  ctx = {},
  record,
  next,
  maxOrders = 30
} = {}) {
  if (!agent) throw new Error('KERNEL_AGENT_REQUIRED');
  if (typeof decide !== 'function') throw new Error('KERNEL_DECIDER_REQUIRED');

  const observed = typeof observe === 'function' ? await observe({ agent, objective, state, ctx }) : {};
  const memory = typeof remember === 'function' ? await remember({ agent, objective, state, observed, ctx }) : null;
  const decision = await decide({
    agent,
    objective,
    state,
    observed,
    memory,
    actions: actionCatalog(actions),
    ctx
  }) || {};

  const execution = await executeKernelOrders({
    orders: decision.orders,
    actions,
    ctx,
    maxOrders
  });

  const snapshot = {
    agent,
    objective,
    state,
    observed,
    memory,
    decision,
    ...execution
  };

  if (typeof record === 'function') await record(snapshot);

  const continuation = typeof next === 'function'
    ? await next(snapshot)
    : null;

  // No implicit business success. `verified` requires the agent-specific NEXT
  // function to prove the objective/postcondition, not merely a successful call.
  const status = continuation?.status || (
    decision.blocked === true || execution.proposed.length || execution.refused.length
      ? 'blocked'
      : execution.done.some(item => item.work_state !== KERNEL_WORK_STATE.VERIFIED)
        ? 'partial'
        : decision.complete === true && execution.done.length === 0
          ? 'partial'
          : 'partial'
  );

  return {
    ...snapshot,
    status,
    next: continuation?.next ?? continuation ?? null
  };
}
