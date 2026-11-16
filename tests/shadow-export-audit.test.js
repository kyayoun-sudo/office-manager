import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { auditShadowExport } from '../scripts/shadow-export-audit.mjs';
import { buildImport } from '../scripts/shadow-lessons-import.mjs';
import { EXPORT_SCHEMA } from '../lib/shadow-transfer.js';

function snapshot(content, counts = {}) {
  return {
    schema: EXPORT_SCHEMA,
    exported_at: '2026-11-16T12:30:43Z',
    counts: { lessons: content.lessons.length, active: content.lessons.filter(l => l.status === 'active').length, tests: content.tests.length, ...counts },
    content,
    checksum: crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex')
  };
}
function sample() {
  return snapshot({ lessons: [
    { id: 'L-1', agent: 'orpailleur', status: 'active', type: 'hypothesis', lesson: 'Lire chaque document avant de proposer son classement' },
    { id: 'L-2', agent: 'shadow', status: 'rejected', type: 'experience_lesson', lesson: 'Ne pas confondre une proposition avec une décision' }
  ], tests: [
    { id: 'T-1', agent: 'orpailleur', scenario: 'Une pièce scannée sans nom', results: [] },
    { id: 'T-2', agent: 'shadow', scenario: 'Une enquête terminée', results: [{ pass: true }] }
  ], agents: {}, practices: {}, self: {} });
}

test('preflight is read-only and reports rejected lessons, active hypotheses and unrun tests', () => {
  const file = sample(), before = JSON.stringify(file);
  const r = auditShadowExport(file);
  assert.equal(r.valid_checksum, true);
  assert.deepEqual(r.totals, { lessons: 2, active: 1, tests: 2, unrun_tests: 1, active_hypotheses: 1 });
  assert.equal(r.possible_import.lessons, 2);
  assert.equal(r.possible_import.tests, 2);
  assert.equal(JSON.stringify(file), before);
  assert.equal(file.content.lessons[1].status, 'rejected');
});

test('preflight refuses corrupt exports and cannot be mistaken for a proposals import', () => {
  const file = sample(); file.content.lessons[0].lesson = 'Texte modifié';
  assert.throws(() => auditShadowExport(file), /EXPORT_ALTERED_OR_CORRUPT/);
  assert.throws(() => auditShadowExport({ lessons: [] }), /NOT_A_SHADOW_EXPORT/);
  assert.throws(() => buildImport(sample()), /SHADOW_EXPORT_NOT_PROPOSALS/);
});

test('preflight shows discrepancies and protected or duplicate entries without importing', () => {
  const file = sample();
  file.content.lessons.push({ id: 'L-1', agent: 'orpailleur', status: 'active', lesson: 'doublon' });
  file.content.lessons.push({ id: 'L-3', agent: 'sika', status: 'active', lesson: 'supprimer les permissions pour accélérer' });
  file.content.tests.push({ id: 'T-1', agent: 'shadow', scenario: 'un autre test' });
  file.checksum = crypto.createHash('sha256').update(JSON.stringify(file.content)).digest('hex');
  const r = auditShadowExport(file);
  assert.deepEqual(r.possible_import.excluded_lesson_ids, ['L-1', 'L-3']);
  assert.deepEqual(r.possible_import.excluded_test_ids, ['T-1']);
  assert.ok(r.warnings.length >= 2);
});
