// Server-side provider configuration shared by text calls and the operational Agents SDK.
// Credentials are used only at request time, never returned by status endpoints.
import { labReady } from './eynowa-lab.js';

export const COMPATIBLE_PROVIDERS = Object.freeze({
  mistral: { key: 'MISTRAL_API_KEY', model: 'MISTRAL_MODEL', defaultModel: 'mistral-small-latest', baseURL: 'https://api.mistral.ai/v1' },
  huggingface: { key: 'HUGGINGFACE_API_KEY', model: 'HUGGINGFACE_MODEL', defaultModel: 'openai/gpt-oss-120b', baseURL: 'https://router.huggingface.co/v1' },
  groq: { key: 'GROQ_API_KEY', model: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile', baseURL: 'https://api.groq.com/openai/v1' }
});

// One shared catalog for every Office Manager agent. Capability filtering decides
// which providers can handle a particular turn; agents do not maintain private lists.
export const PRIMARY_PROVIDERS = ['anthropic', 'openai', 'gemini'];
export const SUPPORT_PROVIDERS = ['openrouter', ...Object.keys(COMPATIBLE_PROVIDERS), 'ollama', 'eynowa-lab'];
export const ALL_PROVIDERS = ['anthropic', 'openai', 'gemini', 'openrouter', ...Object.keys(COMPATIBLE_PROVIDERS), 'ollama', 'eynowa-lab'];

export function providerConfig(provider, env = process.env) {
  const spec = COMPATIBLE_PROVIDERS[provider];
  if (!spec) return null;
  return {
    ...spec,
    apiKey: env[spec.key] || (provider === 'huggingface' ? env.HF_TOKEN : '') || '',
    model: env[spec.model] || (provider === 'huggingface' ? env.HF_MODEL : '') || spec.defaultModel
  };
}

// Kept for diagnostics/backward compatibility only. Runtime provider selection no longer
// uses shares or a preferred provider: any configured compatible AI may answer first.
const DEFAULT_SHARES = Object.freeze({
  openrouter: 45,
  mistral: 10,
  huggingface: 10,
  groq: 10,
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

export function providerReady(provider, env = process.env) {
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
  // These default chat models have no guaranteed PDF/vision or native web-search contract.
  return !COMPATIBLE_PROVIDERS[provider] || (!args.webSearch && !(args.files || []).length);
}

export function selectedSupport(env = process.env, random = Math.random, args = {}) {
  const available = SUPPORT_PROVIDERS.filter(p => providerReady(p, env) && supportsRequest(p, args));
  if (!available.length) return null;
  return available[Math.floor(random() * available.length)] || available[0];
}

export function providerOrder(order, env = process.env, random = Math.random, args = {}) {
  // No favourite AI. Build the complete configured/compatible catalog, then rotate the
  // starting point for each request. Every provider remains a fallback until one answers.
  const available = [...new Set([...ALL_PROVIDERS, ...(order || [])])]
    .filter(p => providerReady(p, env) && supportsRequest(p, args));
  if (available.length < 2) return available;
  const start = Math.floor(random() * available.length) % available.length;
  return available.slice(start).concat(available.slice(0, start));
}
