import { answerProfessional } from './router.js';
import { createOllamaJsonAdapter } from './ollama-adapter.js';
import { searchProfessionalMemory, rememberProfessionalMemory } from './memory-store.js';
import { searchChromaKnowledge, upsertKnowledgeChunks, chromaHealth } from './chroma-adapter.js';

export function createProfessionalHandler({ searchKnowledge, generateJson } = {}) {
  const localGenerateJson = generateJson || createOllamaJsonAdapter();

  return async function handleProfessionalRequest(body = {}) {
    return answerProfessional(body, {
      searchKnowledge: searchKnowledge || searchChromaKnowledge,
      searchMemory: searchProfessionalMemory,
      generateJson: localGenerateJson,
    });
  };
}

export async function handleProfessionalMemory(body = {}) {
  return rememberProfessionalMemory({
    professionalId: body.professional_id || body.professionalId,
    domain: body.domain,
    client: body.client,
    topic: body.topic,
    decision: body.decision,
    reason: body.reason,
    framework: body.framework,
    source: body.source || 'HUMAN_VALIDATED',
    metadata: body.metadata,
  });
}

export async function handleProfessionalKnowledgeImport(body = {}) {
  const chunks = Array.isArray(body.chunks) ? body.chunks : (body.chunk ? [body.chunk] : []);
  if (!chunks.length) throw new Error('KNOWLEDGE_CHUNKS_REQUIRED');
  return upsertKnowledgeChunks(chunks);
}

export async function handleProfessionalHealth() {
  return chromaHealth();
}
