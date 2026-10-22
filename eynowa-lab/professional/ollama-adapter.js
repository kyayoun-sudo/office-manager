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
  } catch (firstError) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const sliced = raw.slice(start, end + 1);
      try { return JSON.parse(sliced); } catch {}
    }
    const error = new Error(`OLLAMA_INVALID_JSON: ${firstError?.message || 'parse failure'}`);
    error.code = 'OLLAMA_INVALID_JSON';
    error.raw = raw.slice(0, 6000);
    throw error;
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

async function ollamaChat({ baseUrl, model, prompt, timeoutMs, numPredict, numCtx, schema }) {
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
        format: schema && typeof schema === 'object' ? schema : 'json',
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
      raw: String(data?.message?.content || data?.response || ''),
      model,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error?.name === 'AbortError' || Number(error?.code) === 20) {
      const timeout = new Error(`OLLAMA_TIMEOUT after ${Date.now() - startedAt}ms; model=${model}; timeout=${timeoutMs}ms`);
      timeout.code = 'OLLAMA_TIMEOUT';
      throw timeout;
    }
    if (error?.code === 'OLLAMA_INVALID_JSON') throw error;
    throw new Error(`OLLAMA_GENERATION_FAILED: model=${model}; ${error?.message || String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function callOllamaJson({ baseUrl, model, prompt, timeoutMs, numPredict, numCtx, schema }) {
  const first = await ollamaChat({ baseUrl, model, prompt, timeoutMs, numPredict, numCtx, schema });
  try {
    return {
      value: extractJson(first.raw),
      model,
      elapsedMs: first.elapsedMs,
      repaired: false,
    };
  } catch (parseError) {
    if (parseError?.code !== 'OLLAMA_INVALID_JSON') throw parseError;

    // Small local models occasionally emit malformed JSON despite structured mode.
    // Retry once with a short repair prompt instead of failing the professional request.
    const repairPrompt = [
      'Repair the following malformed JSON.',
      'Return JSON only. Preserve the semantic content. Do not add commentary.',
      schema ? `The JSON must match this schema: ${JSON.stringify(schema)}` : '',
      `Malformed JSON: ${String(parseError.raw || first.raw).slice(0, 6000)}`,
    ].filter(Boolean).join('\n');

    const repair = await ollamaChat({
      baseUrl,
      model,
      prompt: repairPrompt,
      timeoutMs: Math.max(12000, Math.min(timeoutMs, 30000)),
      numPredict: Math.max(numPredict, 420),
      numCtx,
      schema,
    });

    return {
      value: extractJson(repair.raw),
      model,
      elapsedMs: first.elapsedMs + repair.elapsedMs,
      repaired: true,
    };
  }
}

export function createOllamaJsonAdapter({
  baseUrl = process.env.OLLAMA_URL || process.env.OLLAMA_HOST || defaultOllamaUrl(),
  model = process.env.EYNOWA_LAB_MODEL || process.env.OLLAMA_MODEL || 'llama3.2:3b',
  cpuModel = process.env.EYNOWA_LAB_CPU_MODEL || 'qwen2.5:0.5b-instruct',
  fallbackModel = process.env.EYNOWA_LAB_FALLBACK_MODEL || 'llama3.2:1b',
  timeoutMs = number(process.env.OLLAMA_GENERATION_TIMEOUT_MS, 25000),
  cpuTimeoutMs = number(process.env.OLLAMA_CPU_TIMEOUT_MS, 45000),
  fallbackTimeoutMs = number(process.env.OLLAMA_FALLBACK_TIMEOUT_MS, 35000),
  numPredict = number(process.env.OLLAMA_NUM_PREDICT, 520),
  cpuNumPredict = number(process.env.OLLAMA_CPU_NUM_PREDICT, 520),
  fallbackNumPredict = number(process.env.OLLAMA_FALLBACK_NUM_PREDICT, 420),
  numCtx = number(process.env.OLLAMA_NUM_CTX, 4096),
  cpuNumCtx = number(process.env.OLLAMA_CPU_NUM_CTX, 3072),
  fallbackNumCtx = number(process.env.OLLAMA_FALLBACK_NUM_CTX, 3072),
  allowFallback = String(process.env.EYNOWA_LAB_ALLOW_FALLBACK || 'true').toLowerCase() !== 'false',
} = {}) {
  return async function generateJson({ prompt, schema }) {
    const [models, runtime] = await Promise.all([
      installedModels(baseUrl),
      runtimeProfile(baseUrl),
    ]);

    const cpuCandidate = String(cpuModel || '').trim();
    const fallbackCandidate = String(fallbackModel || '').trim();

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
          schema,
        });
        return {
          ...cpuResult.value,
          _eynowa_generation: {
            model: cpuResult.model,
            fallbackUsed: true,
            cpuMode: true,
            primarySkipped: true,
            repairedJson: Boolean(cpuResult.repaired),
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
        schema,
      });
      return {
        ...primary.value,
        _eynowa_generation: {
          model: primary.model,
          fallbackUsed: false,
          cpuMode: runtime.cpuOnly,
          primarySkipped: false,
          repairedJson: Boolean(primary.repaired),
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
        schema,
      });
      return {
        ...fallback.value,
        _eynowa_generation: {
          model: fallback.model,
          fallbackUsed: true,
          cpuMode: runtime.cpuOnly,
          primarySkipped: false,
          repairedJson: Boolean(fallback.repaired),
          elapsedMs: fallback.elapsedMs,
          primaryFailure: primaryError.message,
        },
      };
    }
  };
}
