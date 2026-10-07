import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCandidates, learnFirm, applyKnowledge } from '../lib/firm-learning.js';

function fakeDrive(scan) {
  const files = new Map([['s', { name: 'OFFICE_MANAGER_SCAN_STATE.json', buffer: Buffer.from(JSON.stringify(scan)) }]]); let n = 0;
  return {
    findFilesByExactName: async (name) => [...files.entries()].filter(([, f]) => f.name === name).map(([id]) => ({ id })),
    downloadBuffer: async id => files.get(id).buffer,
    getMeta: async id => ({ id, modifiedTime: 't' }),
    createBinary: async ({ name, buffer }) => { const id = 'k' + (++n); files.set(id, { name, buffer }); return { id }; },
    updateBinary: async (id, { buffer }) => { files.get(id).buffer = buffer; },
    readText: async (id) => ({ text: id === 'team' ? 'Équipe : Awa Koné, associée, awa@cab.ci ; Yao Kouassi, senior' : 'Lettre de mission CAC Ivoire Logistique 2026' })
  };
}
const items = [
  { id: 'F', name: 'Clients', mimeType: 'application/vnd.google-apps.folder', path: '/Mon Drive/Clients' },
  { id: 'team', name: 'Organigramme équipe.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', path: '/Mon Drive/RH/Organigramme équipe.docx', modifiedTime: new Date().toISOString() },
  { id: 'lm', name: 'Lettre de mission.pdf', mimeType: 'application/pdf', path: '/Mon Drive/Clients/Ivoire Logistique/Lettre de mission.pdf' },
  { id: 'img', name: 'photo équipe.jpg', mimeType: 'image/jpeg', path: '/Mon Drive/photo équipe.jpg' }
];

test('the Orpailleur picks the documents that describe the firm (not images, not unrelated files)', () => {
  const p = pickCandidates(items).map(i => i.id);
  assert.deepEqual(p.sort(), ['lm', 'team']);
});

test('learn the firm from the Drive, then save only the ticked team members and missions', async () => {
  const drive = fakeDrive({ items }); let sentInput = '';
  const runAI = async ({ input }) => { sentInput = input; return { text: JSON.stringify({ firm: { name: 'Cabinet Koné' },
    team: [{ full_name: 'Awa Koné', role_title: 'Associée', email: 'awa@cab.ci', source: '/RH' }, { full_name: 'Yao Kouassi', role_title: 'Senior', source: '/RH' }],
    clients: [{ name: 'Ivoire Logistique' }], missions: [{ name: 'CAC Ivoire Logistique 2026', client: 'Ivoire Logistique', status: 'active' }], questions: ['Yao est-il encore au cabinet ?'] }) }; };
  const k = await learnFirm('org', { drive, folder: 'MEM', runAI });
  assert.equal(k.status, 'proposed'); assert.equal(k.team.length, 2);
  assert.match(sentInput, /Awa Koné/); assert.match(sentInput, /\/Mon Drive\/Clients/);
  const posts = [];
  const fetchRows = async (path, o = {}) => { if (o.method === 'POST') posts.push([path, JSON.parse(o.body)]); return []; };
  const r = await applyKnowledge('org', { team: [0], missions: [0] }, { drive, folder: 'MEM', fetchRows });
  assert.deepEqual(r, { saved_team: 1, saved_missions: 1 });
  assert.equal(posts[0][1][0].full_name, 'Awa Koné'); assert.equal(posts[1][1][0].name, 'CAC Ivoire Logistique 2026');
});
