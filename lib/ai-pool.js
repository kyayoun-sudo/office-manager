// The agent requests a capability. This pool owns provider health, selection and failover.
// No prompts, documents or credentials are persisted; only cooldowns keyed by tenant + credential/model fingerprint.
import { createHash } from 'node:crypto';
import { currentOrgId } from './firm-context.js';
import { providerConfig } from './ai-providers.js';
const cache = new Map();
const now = d => d.now ? d.now() : Date.now();
const bound = (n, fallback, max) => Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.min(max, Number(n)) : fallback;

// Expose only provider identifiers and classified failure reasons, never the
// provider's raw response, prompts, document content or credentials.
export function describePoolError(error) {
  const base = String(error?.message || error || 'AI_UNAVAILABLE').slice(0, 120);
  const allowed = new Set(['CANCELLED', 'CREDIT_REQUIRED', 'CREDENTIAL_REJECTED', 'PAUSED', 'RATE_LIMITED', 'MODEL_UNAVAILABLE', 'TEMPORARILY_UNAVAILABLE', 'REQUEST_FAILED']);
  const items = [...(Array.isArray(error?.attempts) ? error.attempts : []), ...(Array.isArray(error?.skipped) ? error.skipped : [])]
    .filter(x => /^[a-z0-9-]{1,30}$/.test(x?.provider || '') && allowed.has(x?.reason))
    .map(x => x.provider + ':' + x.reason).slice(0, 12);
  return base + (items.length ? ' | groupe IA : ' + items.join(', ') : '');
}

export function providerFailure(error) {
  const status = Number(error?.status || error?.statusCode || error?.response?.status || String(error?.message || '').match(/(?:_|\b)([45]\d\d)(?:\b|:)/)?.[1]);
  const text = [error?.reason, error?.code, error?.type, error?.error?.code, error?.error?.type, error?.message].join(' ').toLowerCase();
  if (error?.name === 'AbortError' || /pool_cancelled/.test(text)) return { reason: 'CANCELLED', delay: 0 };
  if (status === 402 || /insufficient[_ ]quota|insufficient.*(?:credit|balance)|credit.*(?:balance|exhaust|low)|billing|payment.required|out.of.credit/.test(text)) return { reason: 'CREDIT_REQUIRED', delay: 30 * 60e3 };
  if (status === 401 || status === 403 || /invalid.api.key|authentication/.test(text)) return { reason: 'CREDENTIAL_REJECTED', delay: 10 * 60e3 };
  if (/ai_provider_paused/.test(text)) return { reason: error.reason || 'PAUSED', delay: 0 };
  if (status === 429 || /rate.limit/.test(text)) return { reason: 'RATE_LIMITED', delay: Math.min(10 * 60e3, Math.max(60e3, (Number(error?.retryAfter) || 0) * 1000)) };
  if (status === 404 || /model.*(?:not.found|not.available)/.test(text)) return { reason: 'MODEL_UNAVAILABLE', delay: 10 * 60e3 };
  if (status >= 500 || /timeout|fetch.failed|network|econn/.test(text)) return { reason: 'TEMPORARILY_UNAVAILABLE', delay: 15e3 };
  return { reason: 'REQUEST_FAILED', delay: 0 }; // malformed/oversized input is not a dead provider
}

function identity(provider, d) {
  const env = d.env || process.env, cfg = providerConfig(provider, env);
  const prefix = provider.toUpperCase().replace(/-/g, '_');
  const key = cfg?.apiKey || env[prefix + '_API_KEY'] || env.EYNOWA_BROKER_KEY || '';
  const model = cfg?.model || env[prefix + '_MODEL'] || '';
  const orgId = d.orgId || currentOrgId(env);
  const hash = createHash('sha256').update(JSON.stringify([orgId, provider, key, model, cfg?.baseURL, env[prefix + '_BASE_URL']])).digest('hex').slice(0, 32);
  return { orgId, hash, agent_key: 'ai-health-' + hash };
}

async function healthIO(call) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(call), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('HEALTH_STORE_TIMEOUT')), 800); })]); }
  finally { clearTimeout(timer); }
}
async function storage(d) {
  if (d.healthStore) return d.healthStore;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { rest } = await import('./supabase.js');
  return {
    get: async id => (await rest(`office_agent_checkpoints?org_id=eq.${encodeURIComponent(id.orgId)}&agent_key=eq.${id.agent_key}&select=report&limit=1`))?.[0]?.report || null,
    set: async (id, report) => rest('office_agent_checkpoints?on_conflict=org_id,agent_key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ org_id: id.orgId, agent_key: id.agent_key, status: report.until > now(d) ? 'PAUSED' : 'AVAILABLE', report, updated_at: new Date(now(d)).toISOString() }]) })
  };
}

export async function providerHealth(provider, d = {}) {
  const id = identity(provider, d), old = cache.get(id.hash);
  if (old && old.loaded_until > now(d)) return old;
  let saved = null;
  if (id.orgId) try { saved = await healthIO(async () => (await storage(d))?.get(id)); } catch { d.onHealthError?.('HEALTH_READ_FAILED'); }
  const value = { until: 0, reason: null, last_success: 0, ...saved, busy: old?.busy || 0, loaded_until: now(d) + 15000 };
  cache.set(id.hash, value); return value;
}

async function record(provider, error, d) {
  const id = identity(provider, d), state = await providerHealth(provider, d);
  const failure = error ? providerFailure(error) : null;
  if (failure?.reason === 'CANCELLED') return;
  if (error && !failure.delay) return;
  const wasPaused = state.until > 0;
  const saveSuccess = !error && (!state.last_success || now(d) - state.last_success > 60000);
  Object.assign(state, { until: error ? now(d) + failure.delay : 0, reason: failure?.reason || null, last_success: error ? state.last_success : now(d), loaded_until: now(d) + 15000 });
  if (id.orgId && (error || wasPaused || saveSuccess)) {
    try { await healthIO(async () => (await storage(d))?.set(id, { until: state.until, reason: state.reason, last_success: state.last_success })); }
    catch { d.onHealthError?.('HEALTH_WRITE_FAILED'); }
  }
}

// Applies health tracking to direct calls too, including personal credentials (isolated by fingerprint).
export async function trackedProviderCall(provider, run, d = {}) {
  const state = await providerHealth(provider, d);
  if (state.until > now(d) && !d.probe) throw Object.assign(new Error('AI_PROVIDER_PAUSED'), { retryAt: state.until, reason: state.reason });
  state.busy++;
  try { const result = await run(); await record(provider, null, d); return result; }
  catch (e) { await record(provider, e, d); throw e; }
  finally { state.busy = Math.max(0, state.busy - 1); }
}

// Start one eligible provider; hedge a slow inference, max two in flight. An error immediately frees its slot.
// Only inference is raced: model output goes to the agent once, and tools are never replayed here.
export async function dispatchPool(providers, run, d = {}) {
  const unique = [...new Set(providers)];
  const statuses = await Promise.all(unique.map(async provider => ({ provider, health: await providerHealth(provider, d) })));
  const eligible = statuses.filter(x => x.health.until <= now(d)).sort((a, b) => a.health.busy - b.health.busy || Number(Boolean(b.health.last_success)) - Number(Boolean(a.health.last_success)));
  const skipped = statuses.filter(x => x.health.until > now(d)).map(x => ({ provider: x.provider, reason: x.health.reason, retryAt: x.health.until }));
  if (!eligible.length) throw Object.assign(new Error('NO_AI_PROVIDER_AVAILABLE'), { skipped });
  const hedgeMs = bound(d.hedgeMs ?? d.env?.AI_POOL_HEDGE_MS ?? process.env.AI_POOL_HEDGE_MS, 700, 5000);
  const deadlineMs = bound(d.deadlineMs, 90000, 120000);
  return new Promise((resolve, reject) => {
    let next = 0, active = 0, settled = false, hedge, deadline;
    const controllers = new Set(), attempts = [];
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(hedge); clearTimeout(deadline);
      for (const c of controllers) c.abort(new DOMException('POOL_CANCELLED', 'AbortError'));
      d.signal?.removeEventListener('abort', cancelled);
      if (error) { error.attempts = attempts; error.skipped = skipped; reject(error); } else resolve(value);
    };
    const cancelled = () => finish(d.signal.reason || new DOMException('Aborted', 'AbortError'));
    const launch = () => {
      if (settled || active >= 2 || next >= eligible.length) return;
      const provider = eligible[next++].provider, controller = new AbortController(); controllers.add(controller); active++;
      trackedProviderCall(provider, () => run(provider, controller.signal), d).then(value => {
        if (!settled) { controllers.delete(controller); finish(null, value); }
      }, error => {
        if (settled) return;
        controllers.delete(controller); active--; attempts.push({ provider, reason: providerFailure(error).reason });
        if (next < eligible.length) launch();
        else if (!active) finish(error);
      });
      clearTimeout(hedge);
      if (next < eligible.length && active < 2) hedge = setTimeout(launch, hedgeMs);
    };
    if (d.signal?.aborted) return cancelled();
    d.signal?.addEventListener('abort', cancelled, { once: true });
    deadline = setTimeout(() => finish(Object.assign(new Error('AI_POOL_DEADLINE'), { statusCode: 504 })), deadlineMs);
    launch();
  });
}

export function resetPoolHealth() { cache.clear(); }

export async function poolStatus(providers, d = {}) {
  return Object.fromEntries(await Promise.all(providers.map(async provider => {
    const h = await providerHealth(provider, d);
    return [provider, { state: h.until > now(d) ? 'paused' : h.last_success ? 'recently_available' : 'not_yet_verified',
      reason: h.until > now(d) ? h.reason : null, retry_at: h.until > now(d) ? new Date(h.until).toISOString() : null,
      last_success: h.last_success ? new Date(h.last_success).toISOString() : null }];
  })));
}
