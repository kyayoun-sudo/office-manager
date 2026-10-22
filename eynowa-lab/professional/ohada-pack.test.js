import test from 'node:test';
import assert from 'node:assert/strict';
import { validateKnowledgeChunk } from './knowledge-contract.js';

const BASE = {
  source_id: 'OHADA_AUDCIF_SYSCOHADA',
  domain: 'accounting',
  framework: 'SYSCOHADA',
  authority: 'OHADA',
  reference: 'TEST-ONLY: official source overview metadata',
  version: '2017',
  effective_from: '2018-01-01',
  jurisdiction: 'OHADA',
  country: 'CI',
  source_url: 'https://www.ohada.org/acte-uniforme-relatif-au-droit-comptable-et-a-linformation-financiere-audcif/',
  license_basis: 'TEST_ONLY_NON_NORMATIVE_EYNOWA_AUTHORED_CONTENT',
  content: 'Test-only EYNOWA-authored chunk used to validate the OHADA ingestion pipeline. It is not normative accounting guidance.',
};

test('OHADA chunk requires a documented license basis', () => {
  const input = { ...BASE };
  delete input.license_basis;
  assert.throws(() => validateKnowledgeChunk(input), /LICENSE_BASIS_REQUIRED/);
});

test('OHADA chunk requires authority, source URL and exact reference', () => {
  const noAuthority = { ...BASE, authority: '' };
  const noUrl = { ...BASE, source_url: '' };
  const noReference = { ...BASE, reference: '' };
  assert.throws(() => validateKnowledgeChunk(noAuthority), /AUTHORITY_REQUIRED/);
  assert.throws(() => validateKnowledgeChunk(noUrl), /SOURCE_URL_REQUIRED/);
  assert.throws(() => validateKnowledgeChunk(noReference), /SOURCE_REFERENCE_REQUIRED/);
});

test('valid test-only OHADA chunk is accepted for accounting collection ingestion', () => {
  const chunk = validateKnowledgeChunk(BASE);
  assert.equal(chunk.sourceId, 'OHADA_AUDCIF_SYSCOHADA');
  assert.equal(chunk.domain, 'accounting');
  assert.equal(chunk.framework, 'SYSCOHADA');
  assert.equal(chunk.authority, 'OHADA');
  assert.equal(chunk.licenceBasis, 'TEST_ONLY_NON_NORMATIVE_EYNOWA_AUTHORED_CONTENT');
});
