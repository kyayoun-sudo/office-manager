import test from 'node:test';
import assert from 'node:assert/strict';
import { codesInText, foundProgrammes } from '../lib/work-programme.js';

const lib = { sops: [{ file_id: 'S1', procedures: [{ code: 'ACH-01' }, { code: 'ACH-02' }, { code: 'ACH-10' }] }, { file_id: 'S2', procedures: [{ code: 'PRJ-05' }] }] };

test('codes written by hand are recognised: spaces, dashes, zeros, prefixes, lower case', () => {
  const r = codesInText('Tests retenus : ach 01 ; ACH–2 ; C02_ACH-10 ; PRJ.5 ; autre XACH-03 ; ZZ-99', lib);
  assert.deepEqual(r.matched.map(x => x.code).sort(), ['ACH-01', 'ACH-02', 'ACH-10', 'PRJ-05']);
  assert.ok(r.unknown.includes('ZZ-99'));
  assert.deepEqual(codesInText('ACH-100 seulement', lib).matched, []);
});

test('a work programme among the mission documents (read from its content) is offered on the programme page', async () => {
  const docs = [{ id: 'A', name: 'programme.docx', role: 'programme_de_travail' }, { id: 'B', name: 'balance.xlsx', role: 'etat_financier' }];
  assert.deepEqual((await foundProgrammes('M', { missionDocuments: async () => docs })).map(x => x.id), ['A']);
});
