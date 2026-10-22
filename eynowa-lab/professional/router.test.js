import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfessionalRequest, answerProfessional, PROFESSIONAL_RESPONSE_SCHEMA } from './router.js';

const OHADA_HIT = {
  sourceId: 'OHADA_AUDCIF_SYSCOHADA',
  authority: 'OHADA',
  domain: 'accounting',
  framework: 'SYSCOHADA',
  reference: 'Test reference',
  sourceUrl: 'https://www.ohada.org/',
  content: 'Authorised test passage about accounting treatment.',
};

const ISA_HIT = {
  sourceId: 'IAASB_2026_HANDBOOK',
  authority: 'IAASB',
  domain: 'audit',
  framework: 'ISA',
  reference: 'ISA test reference',
  sourceUrl: 'https://www.iaasb.org/',
  content: 'Authorised test passage about audit risk.',
};

function validModelResult(overrides = {}) {
  return {
    answer: 'Test answer.',
    sources: [],
    confidence: 0.9,
    missing_facts: [],
    contradictions: [],
    requires_validation: false,
    validation_reason: '',
    question_for_professional: '',
    ...overrides,
  };
}

test('Firm Manager defaults to all professional domains', () => {
  const request = buildProfessionalRequest({ application: 'firm_manager', query: 'Review this year-end situation' });
  assert.deepEqual(request.domains, ['accounting', 'audit', 'advisory']);
  assert.equal(request.domain, 'multi');
});

test('Firm Manager may explicitly narrow or combine domains', () => {
  const request = buildProfessionalRequest({
    application: 'firm_manager',
    domains: ['accounting', 'audit'],
    frameworks: ['SYSCOHADA', 'ISA'],
    query: 'Analyse the accounting and audit implications',
  });
  assert.deepEqual(request.domains, ['accounting', 'audit']);
  assert.deepEqual(request.frameworks, ['SYSCOHADA', 'ISA']);
});

test('professional router sends a strict JSON schema to the generation adapter', async () => {
  let receivedSchema = null;
  await answerProfessional(
    { application: 'firm_manager', domain: 'accounting', framework: 'SYSCOHADA', query: 'Analyse this invoice' },
    {
      searchKnowledge: async () => [],
      searchMemory: async () => [],
      generateJson: async ({ schema }) => {
        receivedSchema = schema;
        return validModelResult({ requires_validation: true, validation_reason: 'Test' });
      },
    }
  );
  assert.deepEqual(receivedSchema, PROFESSIONAL_RESPONSE_SCHEMA);
  assert.equal(receivedSchema.additionalProperties, false);
  assert.ok(receivedSchema.required.includes('answer'));
  assert.ok(receivedSchema.required.includes('sources'));
});

test('a registered but unretrieved source cannot be cited as evidence', async () => {
  const result = await answerProfessional(
    { application: 'firm_manager', domain: 'accounting', framework: 'SYSCOHADA', query: 'Post this invoice' },
    {
      searchKnowledge: async () => [],
      searchMemory: async () => [],
      generateJson: async () => validModelResult({
        answer: 'Use an account.',
        sources: [{ sourceId: 'OHADA_AUDCIF_SYSCOHADA', reference: 'Invented reference' }],
        confidence: 0.95,
      }),
    }
  );
  assert.deepEqual(result.sources, []);
  assert.equal(result.requires_validation, true);
  assert.match(result.validation_reason, /source professionnelle vérifiable/i);
});

test('retrieved evidence is accepted and reference is anchored to retrieved chunk', async () => {
  const result = await answerProfessional(
    { application: 'firm_manager', domain: 'accounting', framework: 'SYSCOHADA', query: 'Post this invoice' },
    {
      searchKnowledge: async () => [OHADA_HIT],
      searchMemory: async () => [],
      generateJson: async () => validModelResult({
        answer: 'Proposed accounting treatment.',
        sources: [{ sourceId: 'OHADA_AUDCIF_SYSCOHADA', reference: 'Made-up paragraph' }],
        confidence: 0.95,
      }),
    }
  );
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].reference, 'Test reference');
  assert.equal(result.requires_validation, false);
});

test('Firm Manager combines accounting and audit evidence with one multi-domain retrieval', async () => {
  let calls = 0;
  let receivedDomains = [];
  const result = await answerProfessional(
    {
      application: 'firm_manager',
      domains: ['accounting', 'audit'],
      frameworks: ['SYSCOHADA', 'ISA'],
      query: 'Assess year-end accounting and audit risk',
    },
    {
      searchKnowledge: async ({ domains }) => {
        calls += 1;
        receivedDomains = domains;
        return [OHADA_HIT, ISA_HIT];
      },
      searchMemory: async () => [],
      generateJson: async () => validModelResult({
        answer: 'Combined accounting and audit analysis.',
        sources: [
          { sourceId: 'OHADA_AUDCIF_SYSCOHADA', reference: 'Test reference' },
          { sourceId: 'IAASB_2026_HANDBOOK', reference: 'ISA test reference' },
        ],
        confidence: 0.92,
      }),
    }
  );
  assert.equal(calls, 1);
  assert.deepEqual(receivedDomains, ['accounting', 'audit']);
  assert.deepEqual(result.domains, ['accounting', 'audit']);
  assert.equal(result.sources.length, 2);
  assert.deepEqual(result.knowledge_hits_by_domain, { accounting: 1, audit: 1 });
});
