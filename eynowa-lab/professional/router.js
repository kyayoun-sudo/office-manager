import { sourcesFor } from './source-registry.js';
import { evaluateValidation } from './validation-gate.js';
import { detectTopicsForRequest } from './topic-router.js';

const ALL_DOMAINS = Object.freeze(['accounting', 'audit', 'advisory']);
const ALLOWED_DOMAINS = new Set(ALL_DOMAINS);

export const PROFESSIONAL_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    answer: { type: 'string' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourceId: { type: 'string' },
          reference: { type: 'string' },
        },
        required: ['sourceId', 'reference'],
        additionalProperties: false,
      },
    },
    confidence: { type: 'number' },
    missing_facts: { type: 'array', items: { type: 'string' } },
    contradictions: { type: 'array', items: { type: 'string' } },
    requires_validation: { type: 'boolean' },
    validation_reason: { type: 'string' },
    question_for_professional: { type: 'string' },
  },
  required: [
    'answer',
    'sources',
    'confidence',
    'missing_facts',
    'contradictions',
    'requires_validation',
    'validation_reason',
    'question_for_professional',
  ],
  additionalProperties: false,
});

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, max);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normaliseDomain(value) {
  const domain = clean(value, 40).toLowerCase();
  if (!ALLOWED_DOMAINS.has(domain)) throw new Error('domain must be accounting, audit or advisory');
  return domain;
}

function resolveDomains(input = {}) {
  if (Array.isArray(input.domains) && input.domains.length) return unique(input.domains.map(normaliseDomain));
  const legacyDomain = clean(input.domain, 40).toLowerCase();
  if (legacyDomain === 'all' || legacyDomain === '*') return [...ALL_DOMAINS];
  if (legacyDomain) return [normaliseDomain(legacyDomain)];
  const application = clean(input.application, 120).toLowerCase().replace(/[-\s]+/g, '_');
  if (application === 'firm_manager' || application === 'office_manager') return [...ALL_DOMAINS];
  throw new Error('domains (or legacy domain) is required');
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveFrameworks(input = {}) {
  const values = Array.isArray(input.frameworks) ? input.frameworks : (input.framework ? [input.framework] : []);
  return unique(values.map((value) => clean(value, 100)).filter(Boolean));
}

function sourceRegistryForRequest(request) {
  const rows = [];
  for (const domain of request.domains) {
    const matchingFrameworks = request.frameworks.filter((framework) => sourcesFor({ domain, framework }).length > 0);
    if (matchingFrameworks.length) {
      for (const framework of matchingFrameworks) rows.push(...sourcesFor({ domain, framework }));
    } else {
      rows.push(...sourcesFor({ domain }));
    }
  }
  return [...new Map(rows.map((source) => [source.sourceId, source])).values()];
}

function compactKnowledgeForPrompt(knowledge) {
  return safeArray(knowledge).slice(0, 8).map((hit) => ({
    id: clean(hit?.id, 200),
    domain: clean(hit?.domain, 40),
    framework: clean(hit?.framework, 100),
    sourceId: clean(hit?.sourceId, 160),
    authority: clean(hit?.authority, 160),
    reference: clean(hit?.reference, 400),
    sourceUrl: clean(hit?.sourceUrl, 700),
    topic: clean(hit?.topic, 120),
    subtopic: clean(hit?.subtopic, 120),
    sourceKind: clean(hit?.sourceKind, 100),
    normativeText: Boolean(hit?.normativeText),
    requiresNormativeFollowup: Boolean(hit?.requiresNormativeFollowup),
    content: clean(hit?.content, 1600),
  }));
}

function compactMemoryForPrompt(memory) {
  return safeArray(memory).slice(0, 8).map((row) => ({
    domain: clean(row?.domain, 40),
    client: clean(row?.client, 160),
    topic: clean(row?.topic, 120),
    decision: clean(row?.decision, 800),
    reason: clean(row?.reason, 700),
    framework: clean(row?.framework, 100),
    source: clean(row?.source, 100),
  }));
}

export function buildProfessionalRequest(input = {}) {
  const domains = resolveDomains(input);
  const frameworks = resolveFrameworks(input);
  const request = {
    application: clean(input.application, 120),
    domains,
    domain: domains.length === 1 ? domains[0] : 'multi',
    task: clean(input.task, 200),
    country: clean(input.country || 'CI', 20).toUpperCase(),
    frameworks,
    framework: frameworks.length === 1 ? frameworks[0] : '',
    professionalId: clean(input.professional_id || input.professionalId || 'default', 160),
    client: clean(input.client, 255),
    query: clean(input.query, 12000),
  };
  if (!request.query) throw new Error('query is required');
  request.topics = detectTopicsForRequest(request);
  return request;
}

export function buildSystemPrompt({ request, knowledge = [], memory = [] }) {
  const sourceRegistry = sourceRegistryForRequest(request);
  const compactRegistry = sourceRegistry.map((source) => ({
    sourceId: source.sourceId,
    domain: source.domain,
    authority: source.authority,
    authorityRole: source.authorityRole,
    frameworks: source.frameworks,
  }));
  const compactKnowledge = compactKnowledgeForPrompt(knowledge);
  const compactMemory = compactMemoryForPrompt(memory);

  return [
    'You are EYNOWA Lab, the shared professional intelligence layer for a professional-services firm.',
    `Active professional domains: ${request.domains.join(', ')}.`,
    `Detected business topics: ${request.topics.join(', ') || 'none'}.`,
    `Calling application: ${request.application || 'unknown'}.`,
    `Task: ${request.task || 'general professional analysis'}.`,
    `Country: ${request.country}. Framework hints: ${request.frameworks.join(', ') || 'not specified'}.`,
    '',
    'Rules:',
    '- Combine accounting, audit and advisory reasoning when requested.',
    '- Keep authorities separate by domain and framework.',
    '- Never invent a standard, paragraph, legal rule, client fact or prior treatment.',
    '- Professional memory is contextual evidence only, never normative authority.',
    '- EYNOWA methodology guides procedures and anomaly detection but is not normative accounting authority.',
    '- Cite only retrieved professional knowledge.',
    '- Public metadata/paraphrases are context, not detailed normative authority.',
    '- requiresNormativeFollowup=true means professional validation is mandatory before an operational accounting conclusion.',
    '- If facts are missing, sources conflict, only methodology supports the accounting conclusion, or judgment is significant, set requires_validation=true.',
    '- Ask one precise validation question when needed.',
    '- Keep answer concise enough to fit the structured response budget.',
    '- Return JSON only and respect the provided JSON schema exactly.',
    '',
    `Registered professional sources: ${JSON.stringify(compactRegistry)}.`,
    `Retrieved professional knowledge: ${JSON.stringify(compactKnowledge)}.`,
    `Local professional memory: ${JSON.stringify(compactMemory)}.`,
    '',
    `Required JSON schema: ${JSON.stringify(PROFESSIONAL_RESPONSE_SCHEMA)}.`,
    `User request: ${request.query}`,
  ].join('\n');
}

function filterSources(candidateSources, request, knowledge) {
  const registered = new Map(sourceRegistryForRequest(request).map((source) => [source.sourceId, source]));
  const retrievedBySource = new Map();
  for (const hit of safeArray(knowledge)) {
    const sourceId = String(hit?.sourceId || '');
    if (!sourceId || !registered.has(sourceId)) continue;
    const rows = retrievedBySource.get(sourceId) || [];
    rows.push(hit);
    retrievedBySource.set(sourceId, rows);
  }
  return safeArray(candidateSources).map((source) => {
    const sourceId = String(source?.sourceId || '');
    const hits = retrievedBySource.get(sourceId) || [];
    if (!hits.length) return null;
    const registryRow = registered.get(sourceId);
    const requestedReference = clean(source?.reference, 500);
    const exactHit = hits.find((hit) => requestedReference && clean(hit.reference, 500) === requestedReference);
    const evidence = exactHit || hits[0];
    return {
      sourceId,
      authority: clean(evidence.authority || registryRow?.authority, 160),
      reference: clean(evidence.reference, 500),
      sourceUrl: clean(evidence.sourceUrl || registryRow?.sourceUrl, 1000),
      domain: clean(evidence.domain || registryRow?.domain, 40),
      topic: clean(evidence.topic, 120),
      supportRole: clean(registryRow?.authorityRole || 'professional_source', 80),
    };
  }).filter(Boolean);
}

async function retrieveKnowledge(searchKnowledge, request) {
  return safeArray(await searchKnowledge({
    domains: request.domains,
    frameworks: request.frameworks,
    framework: request.framework,
    topics: request.topics,
    country: request.country,
    query: request.query,
    task: request.task,
    limit: request.domains.length > 1 ? 8 : 6,
  }));
}

async function retrieveMemory(searchMemory, request) {
  const groups = await Promise.all(request.domains.map((domain) => searchMemory({
    professionalId: request.professionalId,
    domain,
    client: request.client,
    query: request.query,
    task: request.task,
    limit: 4,
  })));
  return groups.flatMap(safeArray).slice(0, 8);
}

export async function answerProfessional(input, adapters = {}) {
  const totalStarted = Date.now();
  const request = buildProfessionalRequest(input);
  const { searchKnowledge = async () => [], searchMemory = async () => [], generateJson } = adapters;
  if (typeof generateJson !== 'function') throw new Error('generateJson adapter is required');

  const retrievalStarted = Date.now();
  const [knowledge, memory] = await Promise.all([
    retrieveKnowledge(searchKnowledge, request),
    retrieveMemory(searchMemory, request),
  ]);
  const retrievalMs = Date.now() - retrievalStarted;

  const prompt = buildSystemPrompt({ request, knowledge, memory });
  const generationStarted = Date.now();
  const raw = await generateJson({ prompt, request, schema: PROFESSIONAL_RESPONSE_SCHEMA });
  const generationMs = Date.now() - generationStarted;
  const result = raw && typeof raw === 'object' ? raw : {};
  const generationMeta = result?._eynowa_generation && typeof result._eynowa_generation === 'object'
    ? result._eynowa_generation
    : {};
  const fallbackUsed = Boolean(generationMeta.fallbackUsed);
  const repairedJson = Boolean(generationMeta.repairedJson);
  const sources = filterSources(result.sources, request, knowledge);
  const normativeFollowupHits = safeArray(knowledge).filter((hit) => hit?.requiresNormativeFollowup);
  const fallbackReason = fallbackUsed
    ? `Le modèle local de secours ${clean(generationMeta.model, 120) || 'fallback'} a été utilisé après indisponibilité ou lenteur du modèle principal ; validation professionnelle obligatoire.`
    : '';
  const repairReason = repairedJson
    ? 'La sortie JSON du modèle local a nécessité une réparation automatique ; validation professionnelle obligatoire.'
    : '';

  const validation = evaluateValidation({
    domains: request.domains,
    task: request.task,
    answer: result.answer,
    sources,
    missingFacts: safeArray(result.missing_facts),
    contradictions: safeArray(result.contradictions),
    confidence: result.confidence,
    modelRequiresValidation: Boolean(result.requires_validation) || normativeFollowupHits.length > 0 || fallbackUsed || repairedJson,
    validationReason: clean(
      result.validation_reason ||
      repairReason ||
      fallbackReason ||
      (normativeFollowupHits.length ? 'Le contexte public récupéré exige une vérification sur le corpus normatif autorisé avant conclusion opérationnelle.' : ''),
      2000
    ),
    questionForProfessional: clean(result.question_for_professional, 2000),
  });

  return {
    application: request.application,
    domains: request.domains,
    domain: request.domain,
    task: request.task,
    country: request.country,
    frameworks: request.frameworks,
    framework: request.framework,
    topics: request.topics,
    answer: clean(result.answer, 12000),
    sources,
    confidence: validation.confidence,
    requires_validation: validation.requiresValidation,
    validation_reason: validation.reasons.join(' '),
    question_for_professional: validation.questionForProfessional,
    high_judgment: validation.highJudgment,
    high_judgment_domains: validation.highJudgmentDomains,
    knowledge_hits: safeArray(knowledge).length,
    knowledge_hits_by_domain: Object.fromEntries(request.domains.map((domain) => [domain, safeArray(knowledge).filter((hit) => hit?.domain === domain).length])),
    normative_followup_hits: normativeFollowupHits.length,
    memory_hits: safeArray(memory).length,
    generation_model: clean(generationMeta.model, 120),
    generation_fallback: fallbackUsed,
    generation_json_repaired: repairedJson,
    prompt_chars: prompt.length,
    timings_ms: {
      retrieval: retrievalMs,
      generation: generationMs,
      total: Date.now() - totalStarted,
    },
  };
}
