import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichMissionSources, semanticProjection } from '../lib/semantic-mission-sources.js';

test('PBC catalogue entry is enriched by mission meaning instead of hiding it', async () => {
  const base = [{
    file_id: 'file-1',
    name: 'lettre avis.pdf',
    document: 'PBC-PRJ-01',
    status: 'received'
  }];

  const result = await enrichMissionSources(base, 'mission-1', {
    missionDocuments: async () => [{
      id: 'file-1',
      name: 'nom-memoire.pdf',
      role: 'avis_non_objection',
      summary: 'Lettre de la BAD donnant un avis de non-objection et approuvant le PTBA 2023.',
      key_facts: ['PTBA 2023 approuvé', 'Avis de non-objection'],
      classification_quote: 'Nous donnons notre avis de non-objection au PTBA 2023.',
      pbc_ref: 'PBC-PRJ-01',
      pbc_status: 'RECEIVED'
    }]
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].file_id, 'file-1');
  assert.equal(result[0].name, 'lettre avis.pdf'); // current inventory name remains a hint
  assert.equal(result[0].status, 'received');
  assert.equal(result[0].role, 'avis_non_objection');
  assert.match(result[0].summary, /PTBA 2023/);
  assert.deepEqual(result[0].key_facts, ['PTBA 2023 approuvé', 'Avis de non-objection']);
  assert.equal(result[0].pbc_ref, 'PBC-PRJ-01');
  assert.equal(result[0].semantic_memory, true);
});

test('misleading filename cannot erase the remembered semantic identity of a piece', async () => {
  const result = await enrichMissionSources([
    { file_id: 'file-2', name: 'grand_livre.xlsx', document: 'GL', status: 'mission' }
  ], 'mission-1', {
    missionDocuments: async () => [{
      id: 'file-2',
      name: 'grand_livre.xlsx',
      role: 'lettre_avis_non_objection',
      title: 'Avis de non-objection PTBA',
      summary: 'Le contenu est une lettre du bailleur approuvant le budget/PTBA, pas un grand livre.',
      classification_quote: 'Avis de non-objection'
    }]
  });

  assert.equal(result[0].name, 'grand_livre.xlsx');
  assert.equal(result[0].role, 'lettre_avis_non_objection');
  assert.equal(result[0].title, 'Avis de non-objection PTBA');
  assert.match(result[0].summary, /pas un grand livre/);
});

test('mission-only remembered documents join the Working File catalogue', async () => {
  const result = await enrichMissionSources([], 'mission-1', {
    missionDocuments: async () => [{
      id: 'file-3',
      name: 'piece-mal-rangee.pdf',
      role: 'preuve_budget',
      summary: 'Budget approuvé par le bailleur.'
    }]
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].file_id, 'file-3');
  assert.equal(result[0].role, 'preuve_budget');
  assert.equal(result[0].status, 'mission');
});

test('strict Working File source loading fails visibly when semantic memory cannot be read', async () => {
  await assert.rejects(
    () => enrichMissionSources([{ file_id: 'file-1', name: 'x.pdf' }], 'mission-1', {
      strictSources: true,
      missionDocuments: async () => { throw new Error('drive unavailable'); }
    }),
    error => error?.message === 'MISSION_SEMANTIC_MEMORY_UNAVAILABLE' && error?.statusCode === 503
  );
});

test('semantic projection keeps meaning fields while bounding payload size', () => {
  const projected = semanticProjection({
    id: 'file-4',
    summary: 'A'.repeat(5000),
    key_facts: Array.from({ length: 30 }, (_, i) => `fact-${i}`),
    figures: Array.from({ length: 30 }, (_, i) => ({ value: i })),
    role: 'preuve'
  });

  assert.equal(projected.summary.length, 1800);
  assert.equal(projected.key_facts.length, 12);
  assert.equal(projected.figures.length, 12);
});
