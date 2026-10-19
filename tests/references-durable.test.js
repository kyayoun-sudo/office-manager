import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmDocumentReference, documentReferences } from '../lib/file-index.js';

test('a firm reference given once survives a lost memory folder: it is also kept in the firm settings', async () => {
  let settings = {}; const files = new Map(); let n = 0;
  const fetchRows = async (path, o = {}) => { if (o.method === 'POST') { settings = JSON.parse(o.body)[0].settings; return []; } return [{ settings }]; };
  const drive = {
    getMeta: async id => ({ id, name: 'MODELE MISSION', mimeType: 'application/vnd.google-apps.folder', parents: ['P'], modifiedTime: 't' }),
    findFilesByExactName: async (name, parent) => [...files].filter(([, f]) => f.name === name && f.parent === parent).map(([id]) => ({ id })),
    downloadBuffer: async id => Buffer.from(files.get(id).body),
    createBinary: async ({ name, parentId, buffer }) => { const id = 'F' + (++n); files.set(id, { name, parent: parentId, body: buffer.toString() }); return { id }; },
    updateBinary: async (id, { buffer }) => { files.get(id).body = buffer.toString(); }
  };
  await confirmDocumentReference('org', { document_type: 'mission_structure', document_role: 'template', file_id: 'TPL' }, { email: 'p@x', role: 'owner' }, { drive, folder: 'MEM1', fetchRows, emit: async () => ({}) });
  // The memory folder changed: the index there is empty, the reference is still known.
  const refs = await documentReferences('org', { drive, folder: 'MEM2', fetchRows });
  assert.deepEqual(refs.map(r => [r.document_type, r.file_id]), [['mission_structure', 'TPL']]);
});
