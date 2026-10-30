import test from 'node:test';
import assert from 'node:assert/strict';

import { enrichMissionSources, semanticSourceLabel } from '../lib/semantic-mission-sources.js';
import { semanticDirectStep } from '../lib/semantic-step-brain.js';

test('mission semantics enrich an existing source without losing its current filename/status', async () => {
  const sources = await enrichMissionSources([
    { file_id: 'doc-1', name: 'IMG_0042.pdf', status: 'received' }
  ], 'mission-1', {
    missionDocuments: async () => [{
      id: 'doc-1',
      name: 'old-name.pdf',
      title: 'Facture fournisseur ABC',
      role: 'piece_recue',
      period: '2026-09',
      summary: 'Facture de maintenance de septembre',
      audit_read: { status: 'EXCERPTS_READ', revision: 'r1' }
    }]
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0].name, 'IMG_0042.pdf');
  assert.equal(sources[0].title, 'Facture fournisseur ABC');
  assert.equal(sources[0].status, 'received');
  assert.equal(sources[0].semantic_memory, true);
  assert.match(semanticSourceLabel(sources[0]), /Facture fournisseur ABC/);
});

test('semantic step passes enriched sources into the versioned memory-first adapter', async () => {
  let received = null;
  const result = await semanticDirectStep({
    orgId: 'org-1',
    missionId: 'mission-1',
    sources: [{ file_id: 'doc-1', name: 'x.pdf' }]
  }, {
    missionDocuments: async () => [{ id: 'doc-1', title: 'Contrat client', summary: 'Contrat signé' }],
    directStepWithMissionMemory: async ctx => {
      received = ctx;
      return { ok: true };
    }
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(received.sources[0].title, 'Contrat client');
  assert.equal(received.sources[0].semantic_memory, true);
});
