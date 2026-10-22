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

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function installedModels(baseUrl, timeoutMs = 5000) {
  const data = await fetchJson(`${baseUrl.replace(/\/$/, '')}/api/tags`, timeoutMs);
  return Array.isArray(data?.models)
    ? data.models.map((row) => String(row?.name || row?.model || '')).filter(Boolean)
    : [];
}

async function runtimeProfile(baseUrl, timeoutMs = 5000) {
  const data = await fetchJson(`${baseUrl.replace(/\/$/, '')}/api/ps`, timeoutMs);
  const models = Array.isArray(data?.models) ? data.models : [];
  const loaded = models.map((row) => ({
    name: String(row?.name || row?.model || ''),
    sizeVram: Number(row?.size_vram || 0),
    size: Number(row?.size || 0),
  })).filter((row) => row.name);
  return {
    known: loaded.length > 0,
    cpuOnly: loaded.length > 0 && loaded.every((row) => row.sizeVram === 0),
    loaded,
  };
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
  cpuModel = process.env.EYNOWA_LAB_CPU_MODEL || 'qwen2.5:0.5b-instruct',
  fallbackModel = process.env.EYNOWA_LAB_FALLBACK_MODEL || 'llama3.2:1b',
  timeoutMs = number(process.env.OLLAMA_GENERATION_TIMEOUT_MS, 25000),
  cpuTimeoutMs = number(process.env.OLLAMA_CPU_TIMEOUT_MS, 30000),
  fallbackTimeoutMs = number(process.env.OLLAMA_FALLBACK_TIMEOUT_MS, 30000),
  numPredict = number(process.env.OLLAMA_NUM_PREDICT, 320),
  cpuNumPredict = number(process.env.OLLAMA_CPU_NUM_PREDICT, 220),
  fallbackNumPredict = number(process.env.OLLAMA_FALLBACK_NUM_PREDICT, 180),
  numCtx = number(process.env.OLLAMA_NUM_CTX, 4096),
  cpuNumCtx = number(process.env.OLLAMA_CPU_NUM_CTX, 2048),
  fallbackNumCtx = number(process.env.OLLAMA_FALLBACK_NUM_CTX, 2048),
  allowFallback = String(process.env.EYNOWA_LAB_ALLOW_FALLBACK || 'true').toLowerCase() !== 'false',
} = {}) {
  return async function generateJson({ prompt }) {
    const [models, runtime] = await Promise.all([
      installedModels(baseUrl),
      runtimeProfile(baseUrl),
    ]);

    const cpuCandidate = String(cpuModel || '').trim();
    const fallbackCandidate = String(fallbackModel || '').trim();

    // If Ollama is demonstrably CPU-only, skip the 3B model entirely when a lightweight CPU model is installed.
    if (runtime.cpuOnly && allowFallback) {
      const directCpuModel = [cpuCandidate, fallbackCandidate]
        .find((candidate) => candidate && candidate !== model && modelInstalled(models, candidate));

      if (directCpuModel) {
        const usingPreferredCpuModel = directCpuModel === cpuCandidate;
        const cpuResult = await callOllamaJson({
          baseUrl,
          model: directCpuModel,
          prompt,
          timeoutMs: usingPreferredCpuModel ? cpuTimeoutMs : fallbackTimeoutMs,
          numPredict: usingPreferredCpuModel ? cpuNumPredict : fallbackNumPredict,
          numCtx: usingPreferredCpuModel ? cpuNumCtx : fallbackNumCtx,
        });
        return {
          ...cpuResult.value,
          _eynowa_generation: {
            model: cpuResult.model,
            fallbackUsed: true,
            cpuMode: true,
            primarySkipped: true,
            elapsedMs: cpuResult.elapsedMs,
          },
        };
      }
    }

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
          cpuMode: runtime.cpuOnly,
          primarySkipped: false,
          elapsedMs: primary.elapsedMs,
        },
      };
    } catch (primaryError) {
      if (!allowFallback) throw primaryError;

      const secondary = [cpuCandidate, fallbackCandidate]
        .find((candidate) => candidate && candidate !== model && modelInstalled(models, candidate));
      if (!secondary) {
        const error = new Error(`${primaryError.message}; NO_LIGHTWEIGHT_FALLBACK_MODEL_INSTALLED`);
        error.code = primaryError.code || 'OLLAMA_PRIMARY_FAILED';
        throw error;
      }

      const usingPreferredCpuModel = secondary === cpuCandidate;
      const fallback = await callOllamaJson({
        baseUrl,
        model: secondary,
        prompt,
        timeoutMs: usingPreferredCpuModel ? cpuTimeoutMs : fallbackTimeoutMs,
        numPredict: usingPreferredCpuModel ? cpuNumPredict : fallbackNumPredict,
        numCtx: usingPreferredCpuModel ? cpuNumCtx : fallbackNumCtx,
      });
      return {
        ...fallback.value,
        _eynowa_generation: {
          model: fallback.model,
          fallbackUsed: true,
          cpuMode: runtime.cpuOnly,
          primarySkipped: false,
          elapsedMs: fallback.elapsedMs,
          primaryFailure: primaryError.message,
        },
      };
    }
  };
}
