import { registeredSourceIds, sourcesFor } from './source-registry.js';
import { evaluateValidation } from './validation-gate.js';

const ALLOWED_DOMAINS = new Set(['accounting', 'audit', 'advisory']);

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, max);
}

function requireDomain(domain) {
  const value = clean(domain, 40).toLowerCase();
  if (!ALLOWED_DOMAINS.has(value)) {
    throw new Error('domain must be accounting, audit or advisory');
  }
  return value;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function buildProfessionalRequest(input = {}) {
  const domain = requireDomain(input.domain);
  const request = {
    application: clean(input.application, 120),
    domain,
    task: clean(input.task, 200),
    country: clean(input.country || 'CI', 20).toUpperCase(),
    framework: clean(input.framework, 100),
    professionalId: clean(input.professional_id || input.professionalId || 'default', 160),
    client: clean(input.client, 255),
    query: clean(input.query, 24000),
  };
  if (!request.query) throw new Error('query is required');
  return request;
}

export function buildSystemPrompt({ request, knowledge = [], memory = [] }) {
  const sourceIds = registeredSourceIds({ domain: request.domain, framework: request.framework });
  const sourceRegistry = sourcesFor({ domain: request.domain, framework: request.framework });

  return [
    'You are EYNOWA Lab, a professional assistant for accounting, audit and advisory work.',
    `Current domain: ${request.domain}.`,
    `Calling application: ${request.application || 'unknown'}.`,
    `Task: ${request.task || 'general professional analysis'}.`,
    `Country: ${request.country}. Framework: ${request.framework || 'not specified'}.`,
    '',
    'Rules:',
    '- Never invent a standard, paragraph, legal rule, client fact or prior treatment.',
    '- Professional memory is contextual evidence only; it is never normative authority.',
    '- Use only retrieved knowledge passages and registered source metadata for citations.',
    '- If facts are missing, sources conflict, or the conclusion requires significant professional judgment, set requires_validation=true.',
    '- Ask one precise question when professional validation is needed.',
    '- Return JSON only.',
    '',
    `Registered source ids: ${JSON.stringify(sourceIds)}.`,
    `Registered sources: ${JSON.stringify(sourceRegistry)}.`,
    '',
    `Retrieved professional knowledge: ${JSON.stringify(knowledge).slice(0, 30000)}.`,
    '',
    `Local professional memory: ${JSON.stringify(memory).slice(0, 20000)}.`,
    '',
    'Required response shape:',
    JSON.stringify({
      answer: 'string',
      sources: [{ sourceId: 'registered id', authority: 'string', reference: 'string', sourceUrl: 'string' }],
      confidence: 0.0,
      missing_facts: ['string'],
      contradictions: ['string'],
      requires_validation: false,
      validation_reason: 'string',
      question_for_professional: 'string',
    }),
    '',
    `User request: ${request.query}`,
  ].join('\n');
}

function filterSources(candidateSources, request) {
  const allowedIds = new Set(registeredSourceIds({ domain: request.domain, framework: request.framework }));
  return safeArray(candidateSources)
    .filter((source) => source && allowedIds.has(String(source.sourceId || '')))
    .map((source) => ({
      sourceId: clean(source.sourceId, 120),
      authority: clean(source.authority, 160),
      reference: clean(source.reference, 500),
      sourceUrl: clean(source.sourceUrl, 1000),
    }));
}

export async function answerProfessional(input, adapters = {}) {
  const request = buildProfessionalRequest(input);
  const {
    searchKnowledge = async () => [],
    searchMemory = async () => [],
    generateJson,
  } = adapters;

  if (typeof generateJson !== 'function') {
    throw new Error('generateJson adapter is required');
  }

  const knowledge = await searchKnowledge({
    domain: request.domain,
    framework: request.framework,
    country: request.country,
    query: request.query,
    task: request.task,
    limit: 10,
  });

  const memory = await searchMemory({
    professionalId: request.professionalId,
    domain: request.domain,
    client: request.client,
    query: request.query,
    task: request.task,
    limit: 12,
  });

  const prompt = buildSystemPrompt({ request, knowledge, memory });
  const raw = await generateJson({ prompt, request });
  const result = raw && typeof raw === 'object' ? raw : {};
  const sources = filterSources(result.sources, request);

  const validation = evaluateValidation({
    domain: request.domain,
    task: request.task,
    answer: result.answer,
    sources,
    missingFacts: safeArray(result.missing_facts),
    contradictions: safeArray(result.contradictions),
    confidence: result.confidence,
    modelRequiresValidation: Boolean(result.requires_validation),
    validationReason: clean(result.validation_reason, 2000),
    questionForProfessional: clean(result.question_for_professional, 2000),
  });

  return {
    application: request.application,
    domain: request.domain,
    task: request.task,
    country: request.country,
    framework: request.framework,
    answer: clean(result.answer, 30000),
    sources,
    confidence: validation.confidence,
    requires_validation: validation.requiresValidation,
    validation_reason: validation.reasons.join(' '),
    question_for_professional: validation.questionForProfessional,
    high_judgment: validation.highJudgment,
    knowledge_hits: safeArray(knowledge).length,
    memory_hits: safeArray(memory).length,
  };
}
