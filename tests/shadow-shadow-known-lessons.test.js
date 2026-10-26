import test from 'node:test';
import assert from 'node:assert/strict';
import { knownLessonsForDistil } from '../lib/shadow.js';

test('le contexte de diagnostic inclut la règle et la catégorie des leçons connues', () => {
  const lesson = {
    id: 'L-existing',
    agent: 'shadow',
    category: 'true_diagnosis',
    lesson: 'Comparer une proposition aux leçons existantes.',
    rule: 'Rattache la proposition à la leçon existante si elle couvre déjà le même contrôle.'
  };

  assert.deepEqual(knownLessonsForDistil([lesson]), [lesson]);
});

test('le contexte de diagnostic conserve la limite de 80 leçons', () => {
  const lessons = Array.from({ length: 81 }, (_, i) => ({
    id: `L-${i}`,
    agent: 'shadow',
    category: 'test',
    lesson: `leçon ${i}`,
    rule: `règle ${i}`
  }));

  const known = knownLessonsForDistil(lessons);
  assert.equal(known.length, 80);
  assert.equal(known[0].id, 'L-1');
  assert.equal(known.at(-1).id, 'L-80');
});
