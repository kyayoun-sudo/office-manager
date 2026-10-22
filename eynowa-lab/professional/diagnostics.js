import { chromaHealth, embedTexts, searchChromaKnowledge } from './chroma-adapter.js';
import { createOllamaJsonAdapter } from './ollama-adapter.js';

async function runStep(name, fn) {
  const startedAt = Date.now();
  try {
    const value = await fn();
    return { name, ok: true, ms: Date.now() - startedAt, value };
  } catch (error) {
    return {
      name,
      ok: false,
      ms: Date.now() - startedAt,
      error: String(error?.message || error || 'UNKNOWN_ERROR'),
      error_name: String(error?.name || 'Error'),
      error_code: error?.code == null ? null : String(error.code),
    };
  }
}

export async function runProfessionalDiagnostics() {
  const steps = [];

  steps.push(await runStep('chroma_health', async () => {
    const health = await chromaHealth();
    return { host: health.host, port: health.port, embeddingModel: health.embeddingModel };
  }));

  steps.push(await runStep('ollama_embedding', async () => {
    const vectors = await embedTexts(['EYNOWA diagnostic embedding'], { timeoutMs: 20000 });
    return { vectors: vectors.length, dimensions: vectors?.[0]?.length || 0 };
  }));

  steps.push(await runStep('chroma_retrieval', async () => {
    const hits = await searchChromaKnowledge({
      domains: ['accounting'],
      frameworks: ['SYSCOHADA'],
      query: 'AUDCIF SYSCOHADA diagnostic',
      limit: 1,
    });
    return { hits: hits.length, first_source: hits?.[0]?.sourceId || null };
  }));

  steps.push(await runStep('ollama_generation', async () => {
    const generateJson = createOllamaJsonAdapter({ timeoutMs: 45000, numPredict: 48, numCtx: 2048 });
    const result = await generateJson({
      prompt: 'Return JSON only with exactly this semantic content: {"ok":true,"service":"eynowa-lab"}.',
    });
    return result;
  }));

  return {
    ok: steps.every((step) => step.ok),
    steps,
    failed_steps: steps.filter((step) => !step.ok).map((step) => step.name),
  };
}
