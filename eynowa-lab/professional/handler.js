import { answerProfessional } from './router.js';
import { createOllamaJsonAdapter } from './ollama-adapter.js';
import { searchProfessionalMemory, rememberProfessionalMemory } from './memory-store.js';
import { searchChromaKnowledge, upsertKnowledgeChunks, chromaHealth } from './chroma-adapter.js';
import { runProfessionalDiagnostics } from './diagnostics.js';
import { buildValidationCard, acceptProfessionalValidation } from './validation-workflow.js';
import { recordProfessionalTelemetry, recordProfessionalFeedback, professionalMetrics } from './telemetry-store.js';

export function createProfessionalHandler({ searchKnowledge, generateJson } = {}) {
  const localGenerateJson = generateJson || createOllamaJsonAdapter();

  return async function handleProfessionalRequest(body = {}) {
    const result = await answerProfessional(body, {
      searchKnowledge: searchKnowledge || searchChromaKnowledge,
      searchMemory: searchProfessionalMemory,
      generateJson: localGenerateJson,
    });

    const enriched = {
      ...result,
      eynowa_lab_role: 'professional_helper',
      decision_authority: 'calling_agent_and_human_professional',
      validation_card: buildValidationCard(result, body),
    };

    try {
      await recordProfessionalTelemetry({ request: body, result: enriched });
    } catch (error) {
      console.error('PROFESSIONAL_TELEMETRY_WRITE_FAILED', error?.message || error);
    }

    return enriched;
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

export async function handleProfessionalValidation(body = {}) {
  const validated = await acceptProfessionalValidation(body);
  try {
    await recordProfessionalFeedback({
      ...body,
      rating: body.action === 'correct' ? 'corrected' : 'accepted',
      corrected_decision: body.corrected_decision || body.decision || '',
    });
  } catch (error) {
    console.error('PROFESSIONAL_VALIDATION_FEEDBACK_FAILED', error?.message || error);
  }
  return validated;
}

export async function handleProfessionalFeedback(body = {}) {
  return recordProfessionalFeedback(body);
}

export async function handleProfessionalMetrics() {
  return professionalMetrics();
}

export async function handleProfessionalKnowledgeImport(body = {}) {
  const chunks = Array.isArray(body.chunks) ? body.chunks : (body.chunk ? [body.chunk] : []);
  if (!chunks.length) throw new Error('KNOWLEDGE_CHUNKS_REQUIRED');
  return upsertKnowledgeChunks(chunks);
}

export async function handleProfessionalHealth() {
  return chromaHealth();
}

export async function handleProfessionalDiagnostics() {
  return runProfessionalDiagnostics();
}
