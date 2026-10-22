import { existsSync } from 'node:fs';

const RUNNING_IN_DOCKER = existsSync('/.dockerenv');

function defaultOllamaUrl() {
  return RUNNING_IN_DOCKER ? 'http://host.docker.internal:11434' : 'http://127.0.0.1:11434';
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('OLLAMA_EMPTY_RESPONSE');
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error('OLLAMA_INVALID_JSON');
  }
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function createOllamaJsonAdapter({
  baseUrl = process.env.OLLAMA_URL || process.env.OLLAMA_HOST || defaultOllamaUrl(),
  model = process.env.EYNOWA_LAB_MODEL || process.env.OLLAMA_MODEL || 'llama3.2:3b',
  timeoutMs = number(process.env.OLLAMA_GENERATION_TIMEOUT_MS, 90000),
  numPredict = number(process.env.OLLAMA_NUM_PREDICT, 900),
  numCtx = number(process.env.OLLAMA_NUM_CTX, 8192),
} = {}) {
  return async function generateJson({ prompt }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          keep_alive: '15m',
          messages: [{ role: 'user', content: prompt }],
          options: {
            temperature: 0,
            num_predict: numPredict,
            num_ctx: numCtx,
          },
        }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`OLLAMA_${response.status}: ${data?.error || response.statusText}`);
      return extractJson(data?.message?.content || data?.response || '');
    } catch (error) {
      if (error?.name === 'AbortError' || Number(error?.code) === 20) {
        throw new Error(`OLLAMA_TIMEOUT after ${Date.now() - startedAt}ms; model=${model}; timeout=${timeoutMs}ms`);
      }
      throw new Error(`OLLAMA_GENERATION_FAILED: ${error?.message || String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  };
}
