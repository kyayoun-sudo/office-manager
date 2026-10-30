import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { unzipToFolder } from '../lib/zip-pieces.js';

// Review of the swallowed errors (2026-10-30): a lookup « does it already exist? » that fails used to answer « no », and the
// code then CREATED a second one (principle 7: nothing is created twice). Now the step fails honestly and is done again later.

test('a .zip piece: the search for an already extracted file fails → nothing created, the error is said', async () => {
  const zip = new JSZip(); zip.file('releve_decembre.pdf', Buffer.from('%PDF-1.4 relevé'));
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const created = [];
  const drive = {
    getMeta: async id => ({ id, name: 'pieces.zip', parents: ['P'] }),
    downloadBuffer: async () => buffer,
    findFilesByExactName: async () => { throw new Error('DRIVE_503'); },
    createBinary: async f => { created.push(f.name); return { id: 'N' }; }
  };
  await assert.rejects(unzipToFolder({ id: 'Z', name: 'pieces.zip', path: 'X/pieces.zip' }, drive), /DRIVE_503/);
  assert.deepEqual(created, [], 'no second copy created on a failed search');
});

test('the same .zip, search working: the file already there is reused, not created again', async () => {
  const zip = new JSZip(); const content = Buffer.from('%PDF-1.4 relevé'); zip.file('releve_decembre.pdf', content);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const created = [];
  const drive = {
    getMeta: async id => ({ id, name: 'pieces.zip', parents: ['P'] }),
    downloadBuffer: async () => buffer,
    findFilesByExactName: async name => [{ id: 'EXIST', name, size: String(content.length) }],
    createBinary: async f => { created.push(f.name); return { id: 'N' }; }
  };
  const r = await unzipToFolder({ id: 'Z', name: 'pieces.zip', path: 'X/pieces.zip' }, drive);
  assert.deepEqual(created, []);
  assert.equal(r.extracted[0].reused, true);
});
