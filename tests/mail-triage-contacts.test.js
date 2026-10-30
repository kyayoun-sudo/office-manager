import test from 'node:test';
import assert from 'node:assert/strict';
import { triageInbox } from '../lib/mail-triage.js';

// Plan B5 (2026-10-30): the sender of a client e-mail about a mission is proposed as a contact; its role is read by the AI
// (signature, content) in the closed list of roles — it used to be « autre » always. Still a proposal: a manager validates.
const ORG = '11111111-1111-4111-8111-111111111111', MID = '22222222-2222-4222-8222-222222222222';

function fakeDrive() {
  const files = {}; let n = 0;
  return {
    files,
    findFilesByExactName: async (name, parent) => Object.entries(files).filter(([, f]) => f.name === name && f.parent === parent).map(([id, f]) => ({ id, name, modifiedTime: 'v' + f.v })),
    downloadBuffer: async id => Buffer.from(files[id].body),
    getMeta: async id => ({ id, modifiedTime: 'v' + files[id].v }),
    updateBinary: async (id, { buffer }) => { files[id] = { ...files[id], body: buffer.toString('utf8'), v: files[id].v + 1 }; },
    createBinary: async ({ name, parentId, buffer }) => { const id = 'F' + ++n; files[id] = { name, parent: parentId, body: buffer.toString('utf8'), v: 1 }; return { id }; }
  };
}
const message = (id, from, subject, body) => ({ id, threadId: 'T' + id, internalDate: String(Date.parse('2026-11-02T08:00:00Z')),
  payload: { headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }], mimeType: 'text/plain', body: { data: Buffer.from(body).toString('base64url') } }, snippet: body.slice(0, 80) });

test('a client e-mail about a mission: its sender is proposed as a contact with the role the AI read (closed list)', async () => {
  const msgs = { m1: message('m1', 'Awa Koné <awa.kone@client.ci>', 'GL 2025', 'Bonjour, ci-joint le grand livre.\nAwa Koné\nDirectrice financière'),
    m2: message('m2', 'Ibra <ibra@client.ci>', 'Relevés', 'Voici les relevés.') };
  const fetchImpl = async url => {
    const u = String(url);
    if (/\/messages\?/.test(u)) return new Response(JSON.stringify({ messages: [{ id: 'm1' }, { id: 'm2' }] }));
    const id = u.match(/\/messages\/([^/?]+)/)?.[1];
    return new Response(JSON.stringify(msgs[id]));
  };
  const ai = async () => ({ provider: 'mock', text: JSON.stringify({ items: [
    { id: 'm1', needs_action: true, importance: 'moyenne', category: 'pbc', summary: 'GL reçu', mission_id: MID, suggested_action: 'contrôler', sender_role: 'cfo' },
    { id: 'm2', needs_action: true, importance: 'basse', category: 'pbc', summary: 'relevés', mission_id: MID, suggested_action: 'contrôler', sender_role: 'pdg-de-tout' }] }) });
  const drive = fakeDrive();
  const fetchRows = async path => (path.startsWith('office_missions') ? [{ id: MID, name: 'Audit client 2025', mission_code: 'AC25' }] : []);
  const r = await triageInbox(ORG, { token: 't', fetchImpl, ai, drive, folder: 'MEM', fetchRows, getPersona: async () => ({ sender_email: 'cabinet@cab.ci', firm_domains: ['cab.ci'] }) });
  assert.equal(r.triaged, true);
  const data = Object.values(drive.files).find(f => f.name === 'OFFICE_MANAGER_MISSION_DATA.json');
  assert.ok(data, 'the mission data were written');
  const contacts = JSON.parse(data.body).missions[MID].contacts;
  const awa = contacts.find(c => c.email === 'awa.kone@client.ci'), ibra = contacts.find(c => c.email === 'ibra@client.ci');
  assert.equal(awa.role_key, 'cfo');
  assert.equal(awa.status, 'proposé', 'still a proposal');
  assert.equal(ibra.role_key, 'autre', 'a role outside the list is not kept');
});
