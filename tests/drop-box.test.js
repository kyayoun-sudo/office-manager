import test from 'node:test';
import assert from 'node:assert/strict';
import { dropFile } from '../lib/drop-box.js';
import { loadPeoplePolicy, savePeoplePolicy, peoplePolicyContext } from '../lib/people-policy.js';

const F = 'application/vnd.google-apps.folder';
function fakeDrive(extra = []) {
  const store = new Map(extra.map((f, i) => ['e' + i, f])); let n = 0;
  return {
    store,
    findFilesByExactName: async (name) => [...store.entries()].filter(([, f]) => f.name === name).map(([id]) => ({ id })),
    downloadBuffer: async id => store.get(id).buffer,
    getMeta: async id => ({ id, modifiedTime: 't' }),
    createBinary: async ({ name, buffer }) => { const id = 'n' + (++n); store.set(id, { name, buffer }); return { id, webViewLink: 'https://drive/' + id }; },
    updateBinary: async (id, { buffer }) => { store.get(id).buffer = buffer; },
    readText: async () => ({ text: 'Relevé bancaire SGBCI septembre 2026 — Ivoire Logistique' }),
    listChildren: async () => []
  };
}
const scan = { name: 'OFFICE_MANAGER_SCAN_STATE.json', buffer: Buffer.from(JSON.stringify({ items: [{ id: 'D1', name: 'PBC', mimeType: F, path: '/Clients/Ivoire Logistique/CAC 2026/PBC' }] })) };

test('dropped document: stored in A_RANGER, named and placed by the AI, move waits in « À valider », sending also waits', async () => {
  const drive = fakeDrive([scan]); const actions = [], messages = [];
  const r = await dropFile('org', { name: 'scan001.pdf', mime: 'application/pdf', base64: Buffer.from('%PDF').toString('base64'), wish: 'PBC Ivoire', send_to: 'Yao@taty.info' },
    { display_name: 'Awa' }, { drive, folder: 'MEM', createFolder: async () => ({ id: 'DROP' }),
      runAI: async () => ({ text: '{"new_name":"PBC_ReleveBancaire_SGBCI_2026-09.pdf","to_folder_id":"D1","reason":"relevé bancaire, pièce PBC"}' }),
      fetchRows: async (p, o = {}) => { if (o.method === 'POST') actions.push(JSON.parse(o.body)[0]); return []; },
      proposeMessage: async (org, m) => { messages.push(m); return { id: 'm' }; } });
  assert.equal(r.proposed_name, 'PBC_ReleveBancaire_SGBCI_2026-09.pdf'); assert.equal(r.destination, '/Clients/Ivoire Logistique/CAC 2026/PBC');
  assert.equal(actions[0].action_type, 'FILE_MOVE'); assert.equal(actions[0].status, 'proposed'); assert.equal(actions[0].payload.to_parent, 'D1');
  assert.deepEqual(messages[0].recipients, ['yao@taty.info']); assert.match(messages[0].body, /https:\/\/drive\//);
  await assert.rejects(dropFile('org', { name: 'x.pdf', base64: Buffer.alloc(4 * 1024 * 1024).toString('base64') }, null, { drive, folder: 'MEM' }), /FILE_TOO_LARGE/);
});

test('people-management policy: kept in the Drive memory; the app rules always prevail', async () => {
  const drive = fakeDrive();
  assert.equal((await loadPeoplePolicy({ drive, folder: 'MEM' })).text, '');
  await savePeoplePolicy({ text: '# TATY people policy\nYannick — concise' }, { drive, folder: 'MEM' });
  assert.match((await loadPeoplePolicy({ drive, folder: 'MEM' })).text, /Yannick/);
  const c = peoplePolicyContext('x');
  assert.ok(c.hard_rules_always_prevail.R011);
});
