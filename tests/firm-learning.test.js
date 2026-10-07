import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCandidates, pickCvs, learnFirm } from '../lib/firm-learning.js';

function fakeDrive(scan) {
  const files = new Map([['s', { name: 'OFFICE_MANAGER_SCAN_STATE.json', buffer: Buffer.from(JSON.stringify(scan)) }]]); let n = 0;
  return {
    files,
    findFilesByExactName: async (name) => [...files.entries()].filter(([, f]) => f.name === name).map(([id]) => ({ id })),
    downloadBuffer: async id => files.get(id).buffer,
    getMeta: async id => ({ id, modifiedTime: 't' }),
    createBinary: async ({ name, buffer }) => { const id = 'k' + (++n); files.set(id, { name, buffer }); return { id }; },
    updateBinary: async (id, { buffer }) => { files.get(id).buffer = buffer; },
    readText: async (id) => ({ text: id === 'team' ? 'Awa Koné, associée, awa@cab.ci ; Yao Kouassi, senior' : id === 'cv1' ? 'CV Yao Kouassi — 6 ans, IFRS, SYSCOHADA' : 'Lettre de mission CAC Ivoire Logistique 2026' })
  };
}
const SHEET = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const items = [
  { id: 'F', name: 'Clients', mimeType: 'application/vnd.google-apps.folder', path: '/TATY share drive/Clients' },
  { id: 'team', name: 'Liste.xlsx', mimeType: SHEET, path: '/TATY share drive/Equipe HR CV/Liste.xlsx', modifiedTime: new Date().toISOString() },
  { id: 'cv1', name: 'CV Yao.pdf', mimeType: 'application/pdf', path: '/TATY share drive/Equipe HR CV/CV Yao.pdf' },
  { id: 'lm', name: 'Lettre de mission.pdf', mimeType: 'application/pdf', path: '/TATY share drive/Clients/Ivoire Logistique/Lettre de mission.pdf' },
  { id: 'img', name: 'photo équipe.jpg', mimeType: 'image/jpeg', path: '/photo équipe.jpg' }
];

test('the team spreadsheet of an HR / CV folder comes first; images are never picked; CVs are read too', () => {
  const p = pickCandidates(items);
  assert.equal(p[0].id, 'team');
  assert.ok(!p.some(i => i.id === 'img'));
  assert.deepEqual(pickCvs(items, [p[0]]).map(i => i.id), ['cv1']);
});

test('first scan understanding: team with CV profile, audit missions with their team, straight into the application', async () => {
  const drive = fakeDrive({ items }); let sentInput = '';
  const runAI = async ({ input }) => { sentInput = input; return { text: JSON.stringify({ firm: { name: 'TATY' },
    team: [{ full_name: 'Awa Koné', role_title: 'Associée', email: 'awa@cab.ci', source: '/TATY share drive/Equipe HR CV/Liste.xlsx' },
      { full_name: 'Yao Kouassi', role_title: 'Senior', grade_title: 'Senior 2', skills: ['IFRS', 'SYSCOHADA'], source: '/TATY share drive/Equipe HR CV/CV Yao.pdf' }],
    clients: [{ name: 'Ivoire Logistique' }],
    missions: [{ name: 'CAC Ivoire Logistique 2026', client: 'Ivoire Logistique', kind: 'audit', type: 'CAC', year: '2026', planned_start: '2026-10-01', planned_end: '2026-12-31',
      status: 'active', team: [{ person: 'Yao Kouassi', role: 'senior' }], source: '/TATY share drive/Clients/Ivoire Logistique/Lettre de mission.pdf' }],
    questions: [] }) }; };
  const posts = [];
  let staff = [];
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'POST') {
      const body = JSON.parse(o.body); posts.push([path, body]);
      if (path === 'office_staff_profiles') { const r = { id: 's' + staff.length, ...body[0] }; staff.push(r); return [r]; }
      if (path === 'office_missions') return [{ id: 'm1', ...body[0] }];
      return [];
    }
    if (path.startsWith('office_staff_profiles')) return [...staff];
    return [];
  };
  const k = await learnFirm('org', { drive, folder: 'MEM', runAI, fetchRows });
  assert.equal(k.status, 'applied');
  assert.match(sentInput, /Awa Koné/); assert.match(sentInput, /CV Yao Kouassi/);
  assert.deepEqual(k.applied, { team_added: 2, team_completed: 0, missions_added: 1, assignments_proposed: 1, firm_domains: ['cab.ci'] });
  const yao = posts.find(p => p[0] === 'office_staff_profiles' && p[1][0].full_name === 'Yao Kouassi')[1][0];
  assert.deepEqual(yao.skills, ['IFRS', 'SYSCOHADA']); assert.equal(yao.cv_drive_file_id, 'cv1');
  const m = posts.find(p => p[0] === 'office_missions')[1][0];
  assert.equal(m.mission_code, 'CAC-2026');
  const a = posts.find(p => p[0] === 'office_mission_assignments')[1][0];
  assert.equal(a.status, 'proposed'); assert.equal(a.staff_profile_id, 's1');
  // Written in the agents' memory, in the Drive
  assert.ok([...drive.files.values()].some(f => f.name === 'OFFICE_MANAGER_FIRM_KNOWLEDGE.json'));
});
