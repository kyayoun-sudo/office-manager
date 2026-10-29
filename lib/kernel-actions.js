// Shared action semantics used by the universal agent heart.
// Kept separate from agent-kernel.js so the lifecycle kernel can call the brain
// without creating agent-brain -> agent-kernel -> agent-brain circular imports.

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
