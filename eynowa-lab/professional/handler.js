import { answerProfessional } from './router.js';
import { createOllamaJsonAdapter } from './ollama-adapter.js';
import { searchProfessionalMemory, rememberProfessionalMemory } from './memory-store.js';

export function createProfessionalHandler({ searchKnowledge, generateJson } = {}) {
  const localGenerateJson = generateJson || createOllamaJsonAdapter();

  return async function handleProfessionalRequest(body = {}) {
    const result = await answerProfessional(body, {
      searchKnowledge: searchKnowledge || (async () => []),
      searchMemory: searchProfessionalMemory,
      generateJson: localGenerateJson,
    });

    return result;
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
