// Server-side provider configuration shared by text calls and the operational Agents SDK.
// Credentials are used only at request time, never returned by status endpoints.
import { labReady } from './eynowa-lab.js';

// Defaults when Vercel names no model (providers' docs, 2026-10-25): gemini-2.5-pro is refused to new Google
// projects (Google keeps it for past users only); OpenAI has one default for answers and agents alike.
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
export const OPENAI_DEFAULT_MODEL = 'gpt-6-luna';

export const COMPATIBLE_PROVIDERS = Object.freeze({
  mistral: { key: 'MISTRAL_API_KEY', model: 'MISTRAL_MODEL', defaultModel: 'mistral-small-latest', baseURL: 'https://api.mistral.ai/v1' },
  huggingface: { key: 'HUGGINGFACE_API_KEY', model: 'HUGGINGFACE_MODEL', defaultModel: 'openai/gpt-oss-120b', baseURL: 'https://router.huggingface.co/v1' },
  // llama-3.3-70b-versatile was retired by Groq on 2026-08-16.
  groq: { key: 'GROQ_API_KEY', model: 'GROQ_MODEL', defaultModel: 'openai/gpt-oss-120b', baseURL: 'https://api.groq.com/openai/v1' },
  // xAI current public flagship model. Use an explicit valid model ID rather than a generic "latest" slug.
  xai: { key: 'XAI_API_KEY', model: 'XAI_MODEL', defaultModel: 'grok-4.7', baseURL: 'https://api.x.ai/v1' },
  // Kimi (Moonshot AI), OpenAI-compatible (Paul, 2026-11-04: « je veux utiliser que ces 3 IA : Anthropic, ChatGPT, Kimi »).
  // kimi-k2.6 is the general model listed by Moonshot and the AI gateways; KIMI_MODEL (e.g. kimi-k3) overrides it.
  kimi: { key: 'KIMI_API_KEY', model: 'KIMI_MODEL', defaultModel: 'kimi-k2.6', baseURL: 'https://api.moonshot.ai/v1' }
});

// One shared catalog for every Office Manager agent. The order is deterministic so a request does
// not randomly start on a different paid provider from one execution to the next. OpenAI is first
// because it is the primary configured execution path; every other configured AI remains fallback.
export const PRIMARY_PROVIDERS = ['openai', 'anthropic', 'gemini'];
export const SUPPORT_PROVIDERS = ['openrouter', ...Object.keys(COMPATIBLE_PROVIDERS), 'ollama', 'eynowa-lab'];
export const ALL_PROVIDERS = ['openai', 'anthropic', 'gemini', 'openrouter', ...Object.keys(COMPATIBLE_PROVIDERS), 'ollama', 'eynowa-lab'];

export function providerConfig(provider, env = process.env) {
  const spec = COMPATIBLE_PROVIDERS[provider];
  if (!spec) return null;
  return {
    ...spec,
    apiKey: env[spec.key] || (provider === 'huggingface' ? env.HF_TOKEN : provider === 'kimi' ? env.MOONSHOT_API_KEY : '') || '',
    model: env[spec.model] || (provider === 'huggingface' ? env.HF_MODEL : '') || spec.defaultModel
  };
}

// Kept for diagnostics/backward compatibility only. Runtime selection uses deterministic
// failover rather than percentage shares.
const DEFAULT_SHARES = Object.freeze({
  openrouter: 45,
  mistral: 10,
  huggingface: 10,
  groq: 10,
  xai: 0,
  'eynowa-lab': 20,
  ollama: 0
});

export function providerShare(provider, env = process.env) {
  const generated = provider.toUpperCase().replace(/-/g, '_') + '_SHARE';
  const aliases = provider === 'groq' ? [env.GROQ_SHARE, env.Groq_SHARE]
    : provider === 'eynowa-lab' ? [env.EYNOWA_SHARE, env.EYNOWA_LAB_SHARE]
      : [env[generated]];
  const raw = aliases.find(v => String(v ?? '').trim() !== '');
  const n = Number(raw);
  if (raw !== undefined && Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  return DEFAULT_SHARES[provider] ?? 0;
}

// The AIs this installation may use (Paul, 2026-11-04). OFFICE_MANAGER_AI_PROVIDERS=anthropic,openai,kimi: every other AI is
// never called, even with its key still in Vercel. Empty = every AI whose key is set (as before). « chatgpt », « claude »,
// « moonshot » are accepted for openai, anthropic, kimi.
const PROVIDER_ALIASES = { chatgpt: 'openai', gpt: 'openai', claude: 'anthropic', moonshot: 'kimi', grok: 'xai' };
export function allowedProviders(env = process.env) {
  const raw = String(env.OFFICE_MANAGER_AI_PROVIDERS || '').trim();
  if (!raw) return null;
  return new Set(raw.split(/[\s,;]+/).filter(Boolean).map(p => { const k = p.toLowerCase(); return PROVIDER_ALIASES[k] || k; }));
}
export function providerAllowed(provider, env = process.env) {
  const allowed = allowedProviders(env);
  return !allowed || allowed.has(provider);
}

export function providerReady(provider, env = process.env) {
  if (!providerAllowed(provider, env)) return false;
  if (provider === 'eynowa-lab') return labReady(env);
  if (provider === 'ollama') return /^(true|1|yes|on)$/i.test(env.EYNOWA_TOOL_GATEWAY_ENABLED || '') && Boolean(env.OLLAMA_MODEL) && Boolean(env.OLLAMA_BASE_URL || !env.VERCEL);
  if (COMPATIBLE_PROVIDERS[provider]) return Boolean(providerConfig(provider, env).apiKey);
  return provider === 'anthropic' ? Boolean(env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL)
    : provider === 'gemini' ? Boolean(env.GEMINI_API_KEY)
      : provider === 'openai' ? Boolean(env.OPENAI_API_KEY)
        : provider === 'openrouter' ? Boolean(env.OPENROUTER_API_KEY)
          : false;
}

export function supportsRequest(provider, args = {}) {
  if (provider === 'ollama' || provider === 'eynowa-lab') return !args.tools && !args.webSearch && !(args.files || []).length;
  if (!COMPATIBLE_PROVIDERS[provider]) return true;
  // The OpenAI-compatible chat providers below are text/tool capable. Native file reading is
  // not guaranteed by their configured chat model, so keep files on the providers that support it.
  if ((args.files || []).length) return false;
  // xAI/Grok supports native server-side web_search through the Responses API. Other compatible
  // chat providers can still analyse sources after discovery, but are not asked to browse natively.
  if (args.webSearch) return provider === 'xai';
  return true;
}

export function selectedSupport(env = process.env, random = Math.random, args = {}) {
  const available = SUPPORT_PROVIDERS.filter(p => providerReady(p, env) && supportsRequest(p, args));
  if (!available.length) return null;
  return available[Math.floor(random() * available.length)] || available[0];
}

export function providerOrder(order, env = process.env, _random = Math.random, args = {}) {
  // Explicit caller preferences are honoured first; otherwise use the primary cloud order.
  // The rest of the catalog remains deterministic fallback. No random rotation.
  const preferred = Array.isArray(order) && order.length ? order : PRIMARY_PROVIDERS;
  return [...new Set([...preferred, ...ALL_PROVIDERS])]
    .filter(p => providerReady(p, env) && supportsRequest(p, args));
}
