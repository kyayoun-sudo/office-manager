// « MON IA » — a person connects their own AI (Paul, 2026-10-10: « connecter son IA personnelle fait
// partie de ce qu'on offre ; ça booste les réponses, ça répond même quand il n'y a plus de tokens, et ça
// diminue nos tokens ; mais les gens doivent savoir que s'ils connectent leur IA, ce n'est pas de notre
// faute s'ils envoient leurs données chez ce fournisseur : on doit les prévenir »).
//
//  - Each person may connect their own key (Claude, ChatGPT or Gemini). It is kept ENCRYPTED (same
//    AES-GCM sealing as the firm's Google token), never sent back to the browser (only its last 4
//    characters), and used ONLY for that person's own requests in the application.
//  - Before connecting, the person reads and accepts a warning (versioned; who, when, which version
//    recorded): what they submit goes to that provider under the provider's terms; neither the firm
//    nor Office Manager is responsible for what the provider does with it.
//  - Their requests try their AI first; if it fails (quota, key refused, outage) the firm's AI answers
//    as before. The firm's own AI connection is unchanged.
//  - Background work (agents' passes, long chained steps) keeps using the firm's AI.
//  - The partners can switch personal AIs off for the whole firm and see who connected one.

import { AsyncLocalStorage } from 'node:async_hooks';
import { rest } from './supabase.js';

export const NOTICE_VERSION = '2026-10-10';
export const NOTICE = [
  'En connectant votre propre IA (Claude, ChatGPT ou Gemini), les questions, les textes et les documents que vous lui faites traiter depuis Office Manager sont envoyés au fournisseur de cette IA, sous vos propres conditions d’utilisation avec lui.',
  'Ni le cabinet ni Office Manager ne contrôlent ce que ce fournisseur fait de ces données (conservation, entraînement de ses modèles, localisation) et ils n’en sont pas responsables.',
  'Vérifiez avant de la connecter que vos obligations de confidentialité et les contrats des clients le permettent. Ne l’utilisez pas pour des informations que vous n’avez pas le droit de confier à ce fournisseur.',
  'Votre clé est gardée chiffrée et ne sert qu’à vos propres demandes. Vous pouvez la débrancher à tout moment ; si votre IA ne répond pas, celle du cabinet prend le relais.'
].join('\n\n');
export const PROVIDERS = Object.freeze({ anthropic: 'Claude (Anthropic)', openai: 'ChatGPT (OpenAI)', gemini: 'Gemini (Google)' });
// Default model: the one the firm already uses for that provider, else a current general model.
const defaultModel = (p, env = process.env) => ({ anthropic: env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', openai: env.OPENAI_MODEL || 'gpt-4.1', gemini: env.GEMINI_MODEL || 'gemini-2.5-pro' })[p];

const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const q = encodeURIComponent;
const store = new AsyncLocalStorage();
const missingTable = e => /office_user_ai_keys|office_firm_settings|relation|PGRST205|42P01/i.test(String(e?.message || e));

// ---- Who is asking (set by the router for requests made with a personal session) ----
export function runAs(orgId, account, fn) {
  if (!orgId || !account?.auth_user_id) return fn();
  return store.run({ orgId, account, keys: null }, fn);
}
export const currentAccount = () => store.getStore()?.account || null;

async function sealer() { const g = await import('./google-connection.js'); return { seal: g.encryptToken, open: g.decryptToken }; }

async function firmAllows(orgId, fetchRows = rest) {
  const rows = await fetchRows('office_firm_settings?org_id=eq.' + q(orgId) + '&select=settings&limit=1').catch(() => null);
  const s = rows?.[0]?.settings || {};
  return s.personal_ai_allowed !== false;
}

// The person's keys, decrypted only inside the server and only when an AI call needs them.
async function myKeys(d = {}) {
  const ctx = store.getStore();
  if (!ctx) return [];
  if (ctx.keys) return ctx.keys;
  const fetchRows = d.fetchRows || rest;
  ctx.keys = [];
  try {
    if (!(await firmAllows(ctx.orgId, fetchRows))) return ctx.keys;
    const rows = await fetchRows('office_user_ai_keys?org_id=eq.' + q(ctx.orgId) + '&auth_user_id=eq.' + q(ctx.account.auth_user_id) + '&active=eq.true&notice_version=eq.' + q(NOTICE_VERSION) + '&select=provider,key_enc,model&order=updated_at.desc&limit=3') || [];
    const { open } = await (d.sealer || sealer)();
    for (const r of rows) { try { ctx.keys.push({ provider: r.provider, key: open(r.key_enc), model: r.model || defaultModel(r.provider, d.env) }); } catch { /* unreadable: skipped */ } }
  } catch { /* table not installed: the firm's AI only */ }
  return ctx.keys;
}

// The environment a provider call needs, with the person's key instead of the firm's.
export function personalEnv(k, env = process.env) {
  if (k.provider === 'anthropic') return { ...env, ANTHROPIC_API_KEY: k.key, ANTHROPIC_MODEL: k.model };
  if (k.provider === 'openai') return { ...env, OPENAI_API_KEY: k.key, OPENAI_MODEL: k.model };
  return { ...env, GEMINI_API_KEY: k.key, GEMINI_MODEL: k.model };
}

// Called first by the provider loop (lib/ai-plus.js firstAvailable): the person's own AI, in the
// order the caller asked for; null when there is none or when it did not answer (then the firm's AI).
export async function tryPersonal(order, args, call, d = {}) {
  const ctx = store.getStore();
  if (!ctx || d.firmOnly) return null;
  const keys = await myKeys(d);
  if (!keys.length) return null;
  const sorted = [...keys].sort((a, b) => (order.indexOf(a.provider) + 1 || 9) - (order.indexOf(b.provider) + 1 || 9));
  for (const k of sorted) {
    try {
      const r = await call({ ...args, provider: k.provider }, { ...d, env: personalEnv(k, d.env || process.env) });
      note(ctx, k.provider, null, d);
      return { ...r, via: 'personal' };
    } catch (e) { note(ctx, k.provider, String(e.message || e).slice(0, 200), d); }
  }
  return null;
}
function note(ctx, provider, error, d) {
  (d.fetchRows || rest)('office_user_ai_keys?org_id=eq.' + q(ctx.orgId) + '&auth_user_id=eq.' + q(ctx.account.auth_user_id) + '&provider=eq.' + q(provider), {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(error ? { last_error: error, last_error_at: new Date().toISOString() } : { last_used_at: new Date().toISOString(), last_error: null })
  }).catch(() => null);
}

// ---- The person's own page (« Mon IA ») ----
export async function myAIView(orgId, account, d = {}) {
  const fetchRows = d.fetchRows || rest;
  let rows = [], installed = true;
  try { rows = await fetchRows('office_user_ai_keys?org_id=eq.' + q(orgId) + '&auth_user_id=eq.' + q(account.auth_user_id) + '&select=provider,key_hint,model,active,notice_version,notice_accepted_at,last_used_at,last_error,last_error_at,updated_at&order=provider.asc') || []; }
  catch (e) { if (missingTable(e)) installed = false; else throw e; }
  return { notice: NOTICE, notice_version: NOTICE_VERSION, providers: PROVIDERS, default_models: { anthropic: defaultModel('anthropic', d.env), openai: defaultModel('openai', d.env), gemini: defaultModel('gemini', d.env) }, firm_allows: await firmAllows(orgId, fetchRows), installed,
    // Only what the page needs — never the sealed key, even if a wider row came back.
    keys: rows.map(r => ({ provider: r.provider, key_hint: r.key_hint || null, model: r.model || null, active: Boolean(r.active), notice_version: r.notice_version, notice_accepted_at: r.notice_accepted_at || null,
      last_used_at: r.last_used_at || null, last_error: r.last_error || null, updated_at: r.updated_at || null, notice_current: r.notice_version === NOTICE_VERSION })) };
}

// The key is checked by listing the models it can use (no text generated: a « tiny answer » test failed
// with recent models that need more output room, 2026-10-10 « Mon IA passe pas »). The chosen model must
// be one of them; without a choice, the firm's model if this key has it, else a current one it has.
const MODEL_LISTS = {
  anthropic: key => ['https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }],
  openai: key => ['https://api.openai.com/v1/models', { Authorization: 'Bearer ' + key }],
  gemini: key => ['https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': key }]
};
const PREFERRED = { anthropic: /claude-(opus|sonnet)/, openai: /^gpt-(5|4\.1|4o)(?!.*(audio|realtime|transcribe|tts|search|image|mini-tts))/, gemini: /gemini-[\d.]+-(pro|flash)$/ };
export async function availableModels(provider, key, d = {}) {
  const [url, headers] = MODEL_LISTS[provider](key);
  const r = await (d.fetchImpl || fetch)(url, { headers, signal: AbortSignal.timeout(20000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(provider.toUpperCase() + '_' + r.status + ': ' + String(data?.error?.message || data?.error?.type || 'clé refusée').slice(0, 160));
  const ids = (data.data || data.models || []).map(m => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean);
  return provider === 'gemini' ? ids.filter((id, i) => (data.models?.[i]?.supportedGenerationMethods || ['generateContent']).includes('generateContent')) : ids;
}
export function pickModel(provider, wanted, firmModel, ids) {
  if (!ids.length) return wanted || firmModel;
  if (wanted) return ids.includes(wanted) ? wanted : null;
  if (firmModel && ids.includes(firmModel)) return firmModel;
  const good = ids.filter(id => PREFERRED[provider].test(id)).sort().reverse();
  return good[0] || ids[0];
}

export async function connectMyAI(orgId, account, body = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const provider = String(body.provider || '');
  if (!PROVIDERS[provider]) throw fail('UNKNOWN_PROVIDER');
  if (body.accept_notice !== true || body.notice_version !== NOTICE_VERSION) throw fail('NOTICE_NOT_ACCEPTED', 409);
  if (!(await firmAllows(orgId, fetchRows))) throw fail('PERSONAL_AI_DISABLED_BY_FIRM', 403);
  const key = String(body.key || '').trim();
  if (key.length < 20 || key.length > 400 || /\s/.test(key)) throw fail('KEY_INVALID');
  const wanted = String(body.model || '').trim().slice(0, 80);
  if (wanted && !/^[\w.:-]+$/.test(wanted)) throw fail('MODEL_INVALID');
  let ids;
  try { ids = await (d.availableModels || availableModels)(provider, key, d); } catch (e) { throw fail('KEY_REFUSED_BY_PROVIDER: ' + String(e.message || e).slice(0, 160), 422); }
  const model = pickModel(provider, wanted, defaultModel(provider, d.env), ids);
  if (!model) throw fail('MODEL_NOT_AVAILABLE: ' + ids.filter(id => PREFERRED[provider].test(id)).slice(0, 6).join(', '), 422);
  const { seal } = await (d.sealer || sealer)();
  const now = new Date().toISOString();
  try {
    await fetchRows('office_user_ai_keys?on_conflict=org_id,auth_user_id,provider', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ org_id: orgId, auth_user_id: account.auth_user_id, email: account.email || null, provider, key_enc: seal(key), key_hint: '…' + key.slice(-4), model, active: true,
        notice_version: NOTICE_VERSION, notice_accepted_at: now, notice_accepted_by: account.display_name || account.email || null, last_error: null, updated_at: now }]) });
  } catch (e) { if (missingTable(e)) throw fail('PERSONAL_AI_SQL_NOT_INSTALLED', 409); throw e; }
  await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: 'user', action_type: 'PERSONAL_AI_CONNECTED', source_ref: 'user:' + account.auth_user_id, decision: (account.display_name || account.email) + ' a connecté son IA ' + PROVIDERS[provider] + ' et accepté l’avertissement ' + NOTICE_VERSION, status: 'done' }).catch(() => null);
  return { connected: true, provider, key_hint: '…' + key.slice(-4), model };
}

// Disconnecting erases the key (it is the person's secret, not a business record); the trace stays in the audit log.
export async function disconnectMyAI(orgId, account, body = {}, d = {}) {
  const provider = String(body.provider || '');
  if (!PROVIDERS[provider]) throw fail('UNKNOWN_PROVIDER');
  await (d.fetchRows || rest)('office_user_ai_keys?org_id=eq.' + q(orgId) + '&auth_user_id=eq.' + q(account.auth_user_id) + '&provider=eq.' + q(provider), {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false, key_enc: null, updated_at: new Date().toISOString() }) });
  await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: 'user', action_type: 'PERSONAL_AI_DISCONNECTED', source_ref: 'user:' + account.auth_user_id, decision: (account.display_name || account.email) + ' a débranché son IA ' + PROVIDERS[provider], status: 'done' }).catch(() => null);
  return { disconnected: true, provider };
}

// ---- Partners: who connected a personal AI; switch for the whole firm ----
export async function personalAIOverview(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  let rows = [];
  try { rows = await fetchRows('office_user_ai_keys?org_id=eq.' + q(orgId) + '&active=eq.true&select=email,provider,model,notice_version,notice_accepted_at,notice_accepted_by,last_used_at&order=notice_accepted_at.desc&limit=500') || []; } catch { rows = []; }
  return { allowed: await firmAllows(orgId, fetchRows), connected: rows };
}
export async function setPersonalAIAllowed(orgId, allowed, by, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const rows = await fetchRows('office_firm_settings?org_id=eq.' + q(orgId) + '&select=settings&limit=1').catch(() => null);
  const settings = { ...(rows?.[0]?.settings || {}), personal_ai_allowed: Boolean(allowed) };
  try {
    await fetchRows('office_firm_settings?on_conflict=org_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ org_id: orgId, settings, updated_by: by || null, updated_at: new Date().toISOString() }]) });
  } catch (e) { if (missingTable(e)) throw fail('PERSONAL_AI_SQL_NOT_INSTALLED', 409); throw e; }
  return { allowed: settings.personal_ai_allowed };
}
