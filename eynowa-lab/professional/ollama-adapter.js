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

async function installedModels(baseUrl, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { signal: controller.signal });
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    return Array.isArray(data?.models)
      ? data.models.map((row) => String(row?.name || row?.model || '')).filter(Boolean)
      : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function modelInstalled(models, wanted) {
  const target = String(wanted || '').trim();
  if (!target) return false;
  return models.some((name) => name === target || name.startsWith(`${target}:`) || target.startsWith(`${name}:`));
}

async function callOllamaJson({ baseUrl, model, prompt, timeoutMs, numPredict, numCtx }) {
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
        keep_alive: '30m',
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
    return {
      value: extractJson(data?.message?.content || data?.response || ''),
      model,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error?.name === 'AbortError' || Number(error?.code) === 20) {
      const timeout = new Error(`OLLAMA_TIMEOUT after ${Date.now() - startedAt}ms; model=${model}; timeout=${timeoutMs}ms`);
      timeout.code = 'OLLAMA_TIMEOUT';
      throw timeout;
    }
    throw new Error(`OLLAMA_GENERATION_FAILED: model=${model}; ${error?.message || String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

export function createOllamaJsonAdapter({
  baseUrl = process.env.OLLAMA_URL || process.env.OLLAMA_HOST || defaultOllamaUrl(),
  model = process.env.EYNOWA_LAB_MODEL || process.env.OLLAMA_MODEL || 'llama3.2:3b',
  fallbackModel = process.env.EYNOWA_LAB_FALLBACK_MODEL || 'llama3.2:1b',
  timeoutMs = number(process.env.OLLAMA_GENERATION_TIMEOUT_MS, 60000),
  fallbackTimeoutMs = number(process.env.OLLAMA_FALLBACK_TIMEOUT_MS, 35000),
  numPredict = number(process.env.OLLAMA_NUM_PREDICT, 420),
  fallbackNumPredict = number(process.env.OLLAMA_FALLBACK_NUM_PREDICT, 260),
  numCtx = number(process.env.OLLAMA_NUM_CTX, 4096),
  fallbackNumCtx = number(process.env.OLLAMA_FALLBACK_NUM_CTX, 3072),
  allowFallback = String(process.env.EYNOWA_LAB_ALLOW_FALLBACK || 'true').toLowerCase() !== 'false',
} = {}) {
  return async function generateJson({ prompt }) {
    try {
      const primary = await callOllamaJson({
        baseUrl,
        model,
        prompt,
        timeoutMs,
        numPredict,
        numCtx,
      });
      return {
        ...primary.value,
        _eynowa_generation: {
          model: primary.model,
          fallbackUsed: false,
          elapsedMs: primary.elapsedMs,
        },
      };
    } catch (primaryError) {
      const fallbackCandidate = String(fallbackModel || '').trim();
      if (!allowFallback || !fallbackCandidate || fallbackCandidate === model) throw primaryError;

      const models = await installedModels(baseUrl);
      if (!modelInstalled(models, fallbackCandidate)) {
        const error = new Error(`${primaryError.message}; FALLBACK_MODEL_NOT_INSTALLED: ${fallbackCandidate}`);
        error.code = primaryError.code || 'OLLAMA_PRIMARY_FAILED';
        throw error;
      }

      const fallback = await callOllamaJson({
        baseUrl,
        model: fallbackCandidate,
        prompt,
        timeoutMs: fallbackTimeoutMs,
        numPredict: fallbackNumPredict,
        numCtx: fallbackNumCtx,
      });
      return {
        ...fallback.value,
        _eynowa_generation: {
          model: fallback.model,
          fallbackUsed: true,
          elapsedMs: fallback.elapsedMs,
          primaryFailure: primaryError.message,
        },
      };
    }
  };
}
