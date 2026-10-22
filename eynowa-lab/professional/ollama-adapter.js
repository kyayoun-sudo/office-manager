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
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error('OLLAMA_INVALID_JSON');
  }
}

function readableError(error, { model, timeoutMs, baseUrl }) {
  const name = String(error?.name || 'Error');
  const message = String(error?.message || error || 'Unknown Ollama error');
  if (name === 'AbortError' || message.toLowerCase().includes('abort')) {
    const wrapped = new Error(`OLLAMA_TIMEOUT after ${timeoutMs}ms using ${model}`);
    wrapped.name = 'OllamaTimeoutError';
    wrapped.cause = error;
    wrapped.stage = 'ollama_generation';
    wrapped.baseUrl = baseUrl;
    return wrapped;
  }
  const wrapped = new Error(`OLLAMA_GENERATION_FAILED: ${message}`);
  wrapped.name = name;
  wrapped.cause = error;
  wrapped.stage = 'ollama_generation';
  wrapped.baseUrl = baseUrl;
  return wrapped;
}

export function createOllamaJsonAdapter({
  baseUrl = process.env.OLLAMA_URL || process.env.OLLAMA_HOST || defaultOllamaUrl(),
  model = process.env.EYNOWA_LAB_MODEL || process.env.OLLAMA_MODEL || 'llama3.2:3b',
  timeoutMs = Number(process.env.EYNOWA_LAB_OLLAMA_TIMEOUT_MS || 180000),
} = {}) {
  return async function generateJson({ prompt }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          messages: [{ role: 'user', content: prompt }],
          options: { temperature: 0 },
        }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`OLLAMA_${response.status}: ${data?.error || JSON.stringify(data)}`);
      }
      return extractJson(data?.message?.content || data?.response || '');
    } catch (error) {
      throw readableError(error, { model, timeoutMs, baseUrl });
    } finally {
      clearTimeout(timer);
    }
  };
}
