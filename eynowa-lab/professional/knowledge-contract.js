import { registeredSourceIds } from './source-registry.js';

const DOMAINS = new Set(['accounting', 'audit', 'advisory']);

function text(value, max = 20000) {
  return String(value || '').trim().slice(0, max);
}

export function validateKnowledgeChunk(input = {}) {
  const domain = text(input.domain, 40).toLowerCase();
  if (!DOMAINS.has(domain)) throw new Error('INVALID_KNOWLEDGE_DOMAIN');

  const sourceId = text(input.source_id || input.sourceId, 160);
  const allowed = new Set(registeredSourceIds({ domain, framework: input.framework }));
  if (!sourceId || !allowed.has(sourceId)) throw new Error('UNREGISTERED_PROFESSIONAL_SOURCE');

  const licenceBasis = text(input.license_basis || input.licence_basis || input.licenseBasis, 500);
  if (!licenceBasis) throw new Error('LICENSE_BASIS_REQUIRED');

  const content = text(input.content, 50000);
  if (!content) throw new Error('KNOWLEDGE_CONTENT_REQUIRED');

  return {
    id: text(input.id, 200) || undefined,
    domain,
    framework: text(input.framework, 120),
    sourceId,
    authority: text(input.authority, 200),
    title: text(input.title, 500),
    reference: text(input.reference, 500),
    version: text(input.version, 120),
    effectiveFrom: text(input.effective_from || input.effectiveFrom, 40),
    effectiveTo: text(input.effective_to || input.effectiveTo, 40),
    jurisdiction: text(input.jurisdiction, 120),
    country: text(input.country, 40).toUpperCase(),
    language: text(input.language || 'en', 20).toLowerCase(),
    sourceUrl: text(input.source_url || input.sourceUrl, 1200),
    licenceBasis,
    content,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
  };
}

export function collectionForDomain(domain) {
  const value = text(domain, 40).toLowerCase();
  if (!DOMAINS.has(value)) throw new Error('INVALID_KNOWLEDGE_DOMAIN');
  return `eynowa_${value}`;
}
