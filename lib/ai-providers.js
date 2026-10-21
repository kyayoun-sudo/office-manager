// Server-side provider configuration shared by text calls and the operational Agents SDK.
// Credentials are used only at request time, never returned by status endpoints.
export const COMPATIBLE_PROVIDERS = Object.freeze({
  mistral: { key: 'MISTRAL_API_KEY', model: 'MISTRAL_MODEL', defaultModel: 'mistral-small-latest', baseURL: 'https://api.mistral.ai/v1' },
  huggingface: { key: 'HUGGINGFACE_API_KEY', model: 'HUGGINGFACE_MODEL', defaultModel: 'openai/gpt-oss-120b', baseURL: 'https://router.huggingface.co/v1' },
  groq: { key: 'GROQ_API_KEY', model: 'GROQ_MODEL', defaultModel: 'llama-3.3-70b-versatile', baseURL: 'https://api.groq.com/openai/v1' }
});
import { labReady } from './eynowa-lab.js';
export const SUPPORT_PROVIDERS = ['openrouter', ...Object.keys(COMPATIBLE_PROVIDERS), 'ollama', 'eynowa-lab'];
export function providerConfig(provider, env = process.env) {
  const spec = COMPATIBLE_PROVIDERS[provider];
  if (!spec) return null;
  return { ...spec, apiKey: env[spec.key] || (provider === 'huggingface' ? env.HF_TOKEN : '') || '',
    model: env[spec.model] || (provider === 'huggingface' ? env.HF_MODEL : '') || spec.defaultModel };
}
export function providerShare(provider, env = process.env) {
  const raw = env[provider.toUpperCase().replace(/-/g, '_') + '_SHARE'] ?? (provider === 'groq' ? env.Groq_SHARE : undefined);
  const n = Number(raw);
  return String(raw ?? '').trim() && Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : provider === 'openrouter' ? 45 : 0;
}
export function providerReady(provider, env = process.env) {
  if (provider === 'eynowa-lab') return labReady(env);
  if(provider==='ollama')return /^(true|1|yes|on)$/i.test(env.EYNOWA_TOOL_GATEWAY_ENABLED||'')&&Boolean(env.OLLAMA_MODEL)&&Boolean(env.OLLAMA_BASE_URL||!env.VERCEL);
  if (COMPATIBLE_PROVIDERS[provider]) return Boolean(providerConfig(provider, env).apiKey);
  return provider === 'anthropic' ? Boolean(env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL)
    : provider === 'gemini' ? Boolean(env.GEMINI_API_KEY) : provider === 'openai' ? Boolean(env.OPENAI_API_KEY)
    : provider === 'openrouter' ? Boolean(env.OPENROUTER_API_KEY) : false;
}
export function supportsRequest(provider, args = {}) {
  if(provider==='ollama'||provider==='eynowa-lab')return !args.tools&&!args.webSearch&&!(args.files||[]).length;
  // These default chat models have no guaranteed PDF/vision or native web-search contract.
  return !COMPATIBLE_PROVIDERS[provider] || (!args.webSearch && !(args.files || []).length);
}
export function selectedSupport(env = process.env, random = Math.random, args = {}) {
  const available = SUPPORT_PROVIDERS.filter(p => providerReady(p, env) && supportsRequest(p, args));
  const total = available.reduce((n, p) => n + providerShare(p, env), 0);
  const point = random() * Math.max(100, total);
  let cursor = 0;
  for (const p of available) { cursor += providerShare(p, env); if (point < cursor) return p; }
  return null;
}
export function providerOrder(order, env = process.env, random = Math.random, args = {}) {
  const picked = selectedSupport(env, random, args);
  return [...new Set([...(picked ? [picked] : []), ...order, ...SUPPORT_PROVIDERS])]
    .filter(p => providerReady(p, env) && supportsRequest(p, args));
}
