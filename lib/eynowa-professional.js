import { labProfessionalQuery, labReady } from './eynowa-lab.js';

const ALLOWED_DOMAINS = new Set(['accounting', 'audit', 'advisory']);

function clean(value, max = 12000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeDomains(domains) {
  if (!Array.isArray(domains)) return [];
  return [...new Set(domains
    .map(value => clean(value, 40).toLowerCase())
    .filter(value => ALLOWED_DOMAINS.has(value))
  )];
}

function normalizeFrameworks(frameworks) {
  if (!Array.isArray(frameworks)) return [];
  return [...new Set(frameworks.map(value => clean(value, 100)).filter(Boolean))];
}

export function professionalBrainConfigured(env = process.env) {
  return labReady(env);
}

/**
 * Shared professional helper for every EYNOWA application/agent.
 * It never performs application actions and never replaces the calling agent.
 */
export async function consultProfessionalBrain({
  application = 'office_manager',
  query,
  task = '',
  domains = [],
  frameworks = [],
  country = 'CI',
  client = '',
  professionalId = 'default',
  timeoutMs = 90000
} = {}) {
  const normalizedQuery = clean(query);
  if (!normalizedQuery) throw new Error('EYNOWA_PROFESSIONAL_QUERY_REQUIRED');
  if (!professionalBrainConfigured()) throw new Error('EYNOWA_PROFESSIONAL_BRAIN_NOT_CONFIGURED');

  const payload = {
    application: clean(application, 120) || 'office_manager',
    query: normalizedQuery,
    task: clean(task, 200),
    country: clean(country, 20).toUpperCase() || 'CI',
    client: clean(client, 255),
    professional_id: clean(professionalId, 160) || 'default'
  };

  const normalizedDomains = normalizeDomains(domains);
  const normalizedFrameworks = normalizeFrameworks(frameworks);
  if (normalizedDomains.length) payload.domains = normalizedDomains;
  if (normalizedFrameworks.length) payload.frameworks = normalizedFrameworks;

  const result = await labProfessionalQuery(payload, { timeoutMs });
  return {
    ...result,
    eynowa_lab_role: 'professional_helper',
    decision_authority: 'calling_agent_and_human_professional'
  };
}

export function consultAccountingBrain(input = {}) {
  return consultProfessionalBrain({ ...input, domains: ['accounting'] });
}

export function consultAuditBrain(input = {}) {
  return consultProfessionalBrain({ ...input, domains: ['audit'] });
}

export function consultAdvisoryBrain(input = {}) {
  return consultProfessionalBrain({ ...input, domains: ['advisory'] });
}
