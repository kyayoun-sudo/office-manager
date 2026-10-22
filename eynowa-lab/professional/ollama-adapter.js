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

export function createOllamaJsonAdapter({
  baseUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  model = process.env.EYNOWA_LAB_MODEL || process.env.OLLAMA_MODEL || 'qwen2.5:14b',
  timeoutMs = 120000,
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
      const data = await response.json();
      if (!response.ok) {
        throw new Error(`OLLAMA_${response.status}: ${data?.error || JSON.stringify(data)}`);
      }
      return extractJson(data?.message?.content || data?.response || '');
    } finally {
      clearTimeout(timer);
    }
  };
}
