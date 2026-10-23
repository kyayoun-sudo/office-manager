import { randomUUID } from 'node:crypto';
import { rememberProfessionalMemory } from './memory-store.js';

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, max);
}

function first(values = []) {
  return Array.isArray(values) ? values.find(Boolean) : null;
}

export function buildValidationCard(result = {}, request = {}) {
  if (!result?.requires_validation) return null;

  return {
    validation_id: randomUUID(),
    status: 'PENDING_HUMAN_VALIDATION',
    title: 'Validation professionnelle requise',
    application: clean(request.application || result.application, 120),
    professional_id: clean(request.professional_id || request.professionalId || 'default', 160),
    domains: Array.isArray(result.domains) ? result.domains : [],
    topics: Array.isArray(result.topics) ? result.topics : [],
    client: clean(request.client, 255),
    framework: clean(result.framework || first(result.frameworks), 120),
    proposed_conclusion: clean(result.answer, 12000),
    reason: clean(result.validation_reason, 3000),
    question: clean(result.question_for_professional, 2000),
    sources: Array.isArray(result.sources) ? result.sources : [],
    confidence: result.confidence ?? null,
    actions: [
      { id: 'accept', label: 'Valider', memory_effect: 'store_human_validated_decision' },
      { id: 'correct', label: 'Corriger puis valider', memory_effect: 'store_corrected_human_validated_decision' },
      { id: 'request_evidence', label: 'Demander des éléments', memory_effect: 'none' },
      { id: 'reject', label: 'Rejeter', memory_effect: 'none' },
    ],
  };
}

export async function acceptProfessionalValidation(body = {}) {
  if (body.confirmed !== true) throw new Error('EXPLICIT_HUMAN_CONFIRMATION_REQUIRED');
  if (!clean(body.validation_id, 200)) throw new Error('VALIDATION_ID_REQUIRED');

  const domain = clean(body.domain || first(body.domains), 40).toLowerCase();
  const decision = clean(body.decision || body.corrected_decision || body.proposed_conclusion, 12000);
  if (!decision) throw new Error('VALIDATED_DECISION_REQUIRED');

  const memory = await rememberProfessionalMemory({
    professionalId: body.professional_id || body.professionalId || 'default',
    domain,
    client: body.client,
    topic: body.topic || first(body.topics),
    decision,
    reason: body.reason || body.validation_reason || 'Human professional validation',
    framework: body.framework,
    source: 'HUMAN_VALIDATED',
    metadata: {
      validation_id: body.validation_id,
      validated_by: clean(body.validated_by || body.validatedBy, 255),
      originating_application: clean(body.application, 120),
      original_proposal: clean(body.proposed_conclusion, 12000),
      action: clean(body.action || 'accept', 80),
      ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
    },
  });

  return {
    ok: true,
    status: 'HUMAN_VALIDATED',
    validation_id: body.validation_id,
    memory,
  };
}
