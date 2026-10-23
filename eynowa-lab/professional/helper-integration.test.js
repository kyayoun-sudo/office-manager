import test from 'node:test';
import assert from 'node:assert/strict';
import { buildValidationCard, acceptProfessionalValidation } from './validation-workflow.js';
import { rememberProfessionalMemory } from './memory-store.js';
import {
  inferEynowaLabDomains,
  inferEynowaLabFrameworks,
  shouldConsultEynowaLab
} from '../../eynowa-lab-client.js';

test('Lab helper domain inference detects métier scope without replacing the agent', () => {
  assert.deepEqual(
    inferEynowaLabDomains('Analyse IFRS du revenu et les risques audit ISA puis la due diligence'),
    ['accounting', 'audit', 'advisory']
  );
});

test('Lab helper framework inference remains explicit and deterministic', () => {
  const frameworks = inferEynowaLabFrameworks('IFRS, ISA, IESBA et IVS pour cette acquisition');
  assert.ok(frameworks.includes('IFRS'));
  assert.ok(frameworks.includes('ISA'));
  assert.ok(frameworks.includes('IESBA Code'));
  assert.ok(frameworks.includes('IVS'));
});

test('Lab helper may always be explicitly disabled or forced', () => {
  assert.equal(shouldConsultEynowaLab({ message: 'audit ISA', mode: 'off' }), false);
  assert.equal(shouldConsultEynowaLab({ message: 'simple document lookup', mode: 'on' }), true);
});

test('validation card is absent when professional validation is not required', () => {
  assert.equal(buildValidationCard({ requires_validation: false }, {}), null);
});

test('validation card preserves helper role data and human actions', () => {
  const card = buildValidationCard({
    requires_validation: true,
    domains: ['accounting', 'audit'],
    topics: ['provisions_and_contingencies', 'estimates'],
    answer: 'Proposed conclusion',
    validation_reason: 'Judgment required',
    question_for_professional: 'Validate assumptions',
    sources: [],
    confidence: 0.7,
  }, {
    application: 'firm_manager',
    professional_id: 'professional-test',
    client: 'Client A',
  });

  assert.equal(card.status, 'PENDING_HUMAN_VALIDATION');
  assert.equal(card.professional_id, 'professional-test');
  assert.deepEqual(card.domains, ['accounting', 'audit']);
  assert.deepEqual(card.actions.map((row) => row.id), ['accept','correct','request_evidence','reject']);
});

test('professional validation cannot persist without explicit human confirmation', async () => {
  await assert.rejects(
    () => acceptProfessionalValidation({
      validation_id: 'validation-test',
      domains: ['accounting'],
      proposed_conclusion: 'Test conclusion',
      confirmed: false,
    }),
    /EXPLICIT_HUMAN_CONFIRMATION_REQUIRED/
  );
});

test('model or agent output cannot be persisted directly as professional memory', async () => {
  await assert.rejects(
    () => rememberProfessionalMemory({
      professionalId: 'test',
      domain: 'audit',
      decision: 'Unvalidated model decision',
      source: 'MODEL_GENERATED',
    }),
    /ONLY_HUMAN_VALIDATED_MEMORY_IS_PERSISTED/
  );
});
