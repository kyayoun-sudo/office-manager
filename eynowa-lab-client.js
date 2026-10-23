function baseUrl() {
  return String(process.env.EYNOWA_LAB_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
}

function apiKey() {
  return process.env.EYNOWA_LAB_API_KEY || '';
}

function normalise(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ');
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(normalise(term)));
}

const ACCOUNTING_TERMS = [
  'comptabilite','comptable','syscohada','audcif','sycebnl','ifrs','ias','ifric',
  'fnp','gr/ir','provision','immobilisation','amortissement','stock','inventaire',
  'creance','fournisseur','client','revenu','chiffre d affaires','cloture','cut off',
  'tresorerie','rapprochement bancaire','devise','impot','tva','paie','emprunt',
  'etats financiers','consolidation','business combination','lease'
];

const AUDIT_TERMS = [
  'audit','isa','isqm','iesba','independance','materialite','risque significatif',
  'fraude','walkthrough','controle interne','element probant','echantillonnage',
  'circularisation','confirmation externe','going concern','continuite exploitation',
  'opinion','rapport audit','working paper','pbc','programme de travail','assurance'
];

const ADVISORY_TERMS = [
  'advisory','conseil','due diligence','valorisation','valuation','ivs','dcf','m&a',
  'acquisition','cession','budget','forecast','rolling forecast','bfr','working capital',
  'kpi','tableau de bord','business case','scenario','stress test','esg','ifrs s1',
  'ifrs s2','issb','transformation finance'
];

export function inferEynowaLabDomains(message = '') {
  const text = normalise(message);
  const domains = [];
  if (hasAny(text, ACCOUNTING_TERMS)) domains.push('accounting');
  if (hasAny(text, AUDIT_TERMS)) domains.push('audit');
  if (hasAny(text, ADVISORY_TERMS)) domains.push('advisory');
  return domains;
}

export function inferEynowaLabFrameworks(message = '') {
  const text = normalise(message);
  const frameworks = [];
  const checks = [
    ['SYSCOHADA','syscohada'], ['AUDCIF','audcif'], ['SYCEBNL','sycebnl'],
    ['IFRS','ifrs'], ['ISA','isa'], ['ISQM','isqm'], ['IESBA Code','iesba'],
    ['ISSA 5000','issa 5000'], ['IVS','ivs'], ['IFRS S1','ifrs s1'], ['IFRS S2','ifrs s2']
  ];
  for (const [framework, needle] of checks) if (text.includes(needle)) frameworks.push(framework);
  return frameworks;
}

export function shouldConsultEynowaLab({ message = '', mode = 'auto' } = {}) {
  const selected = normalise(mode || 'auto').trim();
  if (['off','false','disabled','never'].includes(selected)) return false;
  if (['on','true','force','always'].includes(selected)) return true;
  if (!eyn owaLabConfiguredSafe()) return false;
  return inferEynowaLabDomains(message).length > 0;
}

function eynowaLabConfiguredSafe() {
  return Boolean(apiKey());
}

async function request(path, { method = 'POST', body } = {}) {
  const key = apiKey();
  if (!key) throw new Error('EYNOWA_LAB_API_KEY_MISSING');

  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || `EYNOWA_LAB_HTTP_${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function consultEynowaLab({
  application = 'firm_manager',
  query,
  task = '',
  domains,
  frameworks = [],
  country = 'CI',
  professionalId = 'default',
  client = '',
} = {}) {
  if (!String(query || '').trim()) throw new Error('EYNOWA_LAB_QUERY_REQUIRED');
  return request('/v1/professional/query', {
    body: {
      application,
      query,
      task,
      domains,
      frameworks,
      country,
      professional_id: professionalId,
      client,
    },
  });
}

export async function validateEynowaLabConclusion(body = {}) {
  return request('/v1/professional/validation/accept', { body });
}

export async function sendEynowaLabFeedback(body = {}) {
  return request('/v1/professional/feedback', { body });
}

export async function getEynowaLabMetrics() {
  return request('/v1/professional/metrics', { method: 'GET' });
}

export function eynowaLabConfigured() {
  return eynowaLabConfiguredSafe();
}
