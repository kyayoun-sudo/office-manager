import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMORY_LAYER,
  assertCentralMemoryPayload,
  canCopyBetweenMemoryLayers,
  prepareCentralLesson
} from '../lib/memory-layers.js';

const activeLesson = {
  id: 'L-test',
  agent: 'orpailleur',
  category: 'classement',
  type: 'experience_lesson',
  status: 'active',
  validated_by: 'owner',
  confidence: 'haute',
  occurrences: 3,
  rule: 'local rule',
  evidence: ['decision:private'],
  situation: 'private client situation'
};

test('central lesson contains only generalized approved fields', () => {
  const payload = prepareCentralLesson({
    lesson: activeLesson,
    generalizedRule: 'Classer un document selon sa fonction établie par son contenu avant son apparence.',
    approvedBy: 'owner',
    approvalId: 'CENTRAL-APPROVAL-1',
    approvedAt: '2026-10-29T22:00:00.000Z'
  });
  assert.equal(payload.layer, MEMORY_LAYER.CENTRAL);
  assert.equal(payload.rule, 'Classer un document selon sa fonction établie par son contenu avant son apparence.');
  assert.equal('evidence' in payload, false);
  assert.equal('situation' in payload, false);
  assert.equal('mission_id' in payload, false);
  assert.equal(assertCentralMemoryPayload(payload), true);
});

test('mission-scoped learning cannot be sent to central memory', () => {
  assert.throws(() => prepareCentralLesson({
    lesson: { ...activeLesson, mission_id: 'MISSION-PRIVATE' },
    generalizedRule: 'Règle généralisée suffisamment longue pour être valide.',
    approvedBy: 'owner',
    approvalId: 'A-1'
  }), /MISSION_SCOPED_LESSON_NOT_SHAREABLE/);
});

test('firm approval alone is not central-sharing approval', () => {
  assert.throws(() => prepareCentralLesson({
    lesson: activeLesson,
    generalizedRule: 'Règle généralisée suffisamment longue pour être valide.'
  }), /CENTRAL_SHARE_APPROVAL_REQUIRED/);
});

test('email and url are rejected from generalized central rules', () => {
  assert.throws(() => prepareCentralLesson({
    lesson: activeLesson,
    generalizedRule: 'Toujours contacter client@example.com avant de continuer cette procédure.',
    approvedBy: 'owner',
    approvalId: 'A-2'
  }), /GENERALIZED_RULE_NOT_SANITIZED/);
  assert.throws(() => prepareCentralLesson({
    lesson: activeLesson,
    generalizedRule: 'Toujours utiliser https://example.com/client pour cette procédure.',
    approvedBy: 'owner',
    approvalId: 'A-3'
  }), /GENERALIZED_RULE_NOT_SANITIZED/);
});

test('raw memory is never copied directly into central memory', () => {
  assert.equal(canCopyBetweenMemoryLayers(MEMORY_LAYER.MISSION, MEMORY_LAYER.CENTRAL), false);
  assert.equal(canCopyBetweenMemoryLayers(MEMORY_LAYER.FIRM, MEMORY_LAYER.CENTRAL), false);
  assert.equal(canCopyBetweenMemoryLayers(MEMORY_LAYER.MISSION, MEMORY_LAYER.FIRM), false);
  assert.equal(canCopyBetweenMemoryLayers(MEMORY_LAYER.FIRM, MEMORY_LAYER.FIRM), true);
});

test('central payload validator rejects raw document fields', () => {
  const payload = prepareCentralLesson({
    lesson: activeLesson,
    generalizedRule: 'Classer un document selon sa fonction établie par son contenu avant son apparence.',
    approvedBy: 'owner',
    approvalId: 'A-4'
  });
  assert.throws(() => assertCentralMemoryPayload({ ...payload, file_id: 'private-file' }), /CENTRAL_MEMORY_RAW_FIELD_FORBIDDEN/);
});
