import { sourcesFor } from './source-registry.js';
import { evaluateValidation } from './validation-gate.js';

const ALL_DOMAINS = Object.freeze(['accounting', 'audit', 'advisory']);
const ALLOWED_DOMAINS = new Set(ALL_DOMAINS);

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, max);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normaliseDomain(value) {
  const domain = clean(value, 40).toLowerCase();
  if (!ALLOWED_DOMAINS.has(domain)) {
    throw new Error('domain must be accounting, audit or advisory');
  }
  return domain;
}

function resolveDomains(input = {}) {
  if (Array.isArray(input.domains) && input.domains.length) {
    return unique(input.domains.map(normaliseDomain));
  }

  const legacyDomain = clean(input.domain, 40).toLowerCase();
  if (legacyDomain === 'all' || legacyDomain === '*') return [...ALL_DOMAINS];
  if (legacyDomain) return [normaliseDomain(legacyDomain)];

  const application = clean(input.application, 120).toLowerCase().replace(/[-\s]+/g, '_');
  if (application === 'firm_manager' || application === 'office_manager') {
    return [...ALL_DOMAINS];
  }

  throw new Error('domains (or legacy domain) is required');
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveFrameworks(input = {}) {
  const values = Array.isArray(input.frameworks)
    ? input.frameworks
    : (input.framework ? [input.framework] : []);
  return unique(values.map((value) => clean(value, 100)).filter(Boolean));
}

function sourceRegistryForRequest(request) {
  const rows = [];
  for (const domain of request.domains) {
    const matchingFrameworks = request.frameworks.filter((framework) =>
      sourcesFor({ domain, framework }).length > 0
    );
    if (matchingFrameworks.length) {
      for (const framework of matchingFrameworks) rows.push(...sourcesFor({ domain, framework }));
    } else {
      rows.push(...sourcesFor({ domain }));
    }
  }
  return [...new Map(rows.map((source) => [source.sourceId, source])).values()];
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
    query: clean(input.query, 24000),
  };
  if (!request.query) throw new Error('query is required');
  return request;
}

export function buildSystemPrompt({ request, knowledge = [], memory = [] }) {
  const sourceRegistry = sourceRegistryForRequest(request);
  const sourceIds = sourceRegistry.map((source) => source.sourceId);

  return [
    'You are EYNOWA Lab, the shared professional intelligence layer for a professional-services firm.',
    `Active professional domains: ${request.domains.join(', ')}.`,
    `Calling application: ${request.application || 'unknown'}.`,
    'The calling application does not define or limit your professional capabilities; the requested domains and task do.',
    `Task: ${request.task || 'general professional analysis'}.`,
    `Country: ${request.country}. Framework hints: ${request.frameworks.join(', ') || 'not specified'}.`,
    '',
    'Rules:',
    '- You may combine accounting, audit and advisory reasoning when the request spans several domains.',
    '- Keep normative authorities separate by domain and framework; do not treat one framework as authority for another domain.',
    '- Never invent a standard, paragraph, legal rule, client fact or prior treatment.',
    '- Professional memory is contextual evidence only; it is never normative authority.',
    '- Cite only passages that appear in Retrieved professional knowledge below. A registered source that was not retrieved is not evidence.',
    '- If facts are missing, sources conflict, or the conclusion requires significant professional judgment, set requires_validation=true.',
    '- Ask one precise question when professional validation is needed.',
    '- Return JSON only.',
    '',
    `Registered source ids: ${JSON.stringify(sourceIds)}.`,
    `Registered sources: ${JSON.stringify(sourceRegistry)}.`,
    '',
    `Retrieved professional knowledge: ${JSON.stringify(knowledge).slice(0, 40000)}.`,
    '',
    `Local professional memory: ${JSON.stringify(memory).slice(0, 25000)}.`,
    '',
    'Required response shape:',
    JSON.stringify({
      answer: 'string',
      sources: [{ sourceId: 'retrieved registered id', authority: 'string', reference: 'retrieved reference', sourceUrl: 'string', domain: 'accounting|audit|advisory' }],
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

  return safeArray(candidateSources)
    .map((source) => {
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
      };
    })
    .filter(Boolean);
}

async function retrieveKnowledge(searchKnowledge, request) {
  const groups = await Promise.all(request.domains.map(async (domain) => {
    const relevantFrameworks = request.frameworks.filter((framework) =>
      sourcesFor({ domain, framework }).length > 0
    );
    return searchKnowledge({
      domain,
      frameworks: relevantFrameworks,
      framework: relevantFrameworks.length === 1 ? relevantFrameworks[0] : '',
      country: request.country,
      query: request.query,
      task: request.task,
      limit: 10,
    });
  }));
  return groups.flatMap(safeArray);
}

async function retrieveMemory(searchMemory, request) {
  const groups = await Promise.all(request.domains.map((domain) =>
    searchMemory({
      professionalId: request.professionalId,
      domain,
      client: request.client,
      query: request.query,
      task: request.task,
      limit: 12,
    })
  ));
  return groups.flatMap(safeArray);
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

  const [knowledge, memory] = await Promise.all([
    retrieveKnowledge(searchKnowledge, request),
    retrieveMemory(searchMemory, request),
  ]);

  const prompt = buildSystemPrompt({ request, knowledge, memory });
  const raw = await generateJson({ prompt, request });
  const result = raw && typeof raw === 'object' ? raw : {};
  const sources = filterSources(result.sources, request, knowledge);

  const validation = evaluateValidation({
    domains: request.domains,
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
    domains: request.domains,
    domain: request.domain,
    task: request.task,
    country: request.country,
    frameworks: request.frameworks,
    framework: request.framework,
    answer: clean(result.answer, 30000),
    sources,
    confidence: validation.confidence,
    requires_validation: validation.requiresValidation,
    validation_reason: validation.reasons.join(' '),
    question_for_professional: validation.questionForProfessional,
    high_judgment: validation.highJudgment,
    high_judgment_domains: validation.highJudgmentDomains,
    knowledge_hits: safeArray(knowledge).length,
    memory_hits: safeArray(memory).length,
  };
}
