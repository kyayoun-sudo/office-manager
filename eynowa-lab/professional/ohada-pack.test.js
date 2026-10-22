import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const STARTER_URL = new URL('./packs/ohada/public-starter-pack.json', import.meta.url);

async function loadStarterPack() {
  return JSON.parse(await readFile(STARTER_URL, 'utf8'));
}

test('OHADA chunk requires a documented license basis', () => {
  const input = { ...BASE };
  delete input.license_basis;
  assert.throws(() => validateKnowledgeChunk(input), /LICENSE_BASIS_REQUIRED/);
});

test('OHADA chunk requires authority, source URL and exact reference', () => {
  assert.throws(() => validateKnowledgeChunk({ ...BASE, authority: '' }), /AUTHORITY_REQUIRED/);
  assert.throws(() => validateKnowledgeChunk({ ...BASE, source_url: '' }), /SOURCE_URL_REQUIRED/);
  assert.throws(() => validateKnowledgeChunk({ ...BASE, reference: '' }), /SOURCE_REFERENCE_REQUIRED/);
});

test('valid test-only OHADA chunk is accepted for accounting collection ingestion', () => {
  const chunk = validateKnowledgeChunk(BASE);
  assert.equal(chunk.sourceId, 'OHADA_AUDCIF_SYSCOHADA');
  assert.equal(chunk.domain, 'accounting');
  assert.equal(chunk.framework, 'SYSCOHADA');
  assert.equal(chunk.authority, 'OHADA');
});

test('public OHADA starter pack is valid and non-normative', async () => {
  const chunks = await loadStarterPack();
  assert.ok(Array.isArray(chunks));
  assert.ok(chunks.length >= 10);
  for (const input of chunks) {
    const chunk = validateKnowledgeChunk(input);
    assert.equal(chunk.domain, 'accounting');
    assert.equal(chunk.authority, 'OHADA');
    assert.equal(chunk.jurisdiction, 'OHADA');
    assert.ok(['OHADA_AUDCIF_SYSCOHADA', 'OHADA_SYCEBNL'].includes(chunk.sourceId));
    assert.ok(chunk.sourceUrl.startsWith('https://www.ohada.org/'));
    assert.match(chunk.licenceBasis, /PARAPHRASE/i);
    assert.equal(Boolean(chunk.metadata?.normative_text), false);
  }
});

test('public OHADA starter pack covers AUDCIF, SYSCOHADA and SYCEBNL', async () => {
  const chunks = await loadStarterPack();
  const frameworks = new Set(chunks.map((chunk) => chunk.framework));
  assert.ok(frameworks.has('AUDCIF'));
  assert.ok(frameworks.has('SYSCOHADA'));
  assert.ok(frameworks.has('SYCEBNL'));
  assert.ok(chunks.filter((chunk) => chunk.metadata?.requires_normative_followup).length >= 3);
});
