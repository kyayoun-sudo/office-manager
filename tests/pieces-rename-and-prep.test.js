import test from 'node:test';
import assert from 'node:assert/strict';
import { pieceName, renamePieces } from '../lib/deposit-analysis.js';
import { tdrCandidates } from '../lib/engagement-prep.js';

test('a piece is named from what was read: type, client, period; unread = no name', () => {
  assert.equal(pieceName({ name: 'scan001.PDF', type: 'Convention de financement', client: 'ONG Éclat', period: '2025' }), 'CONVENTION_DE_FINANCEMENT_ONG_ECLAT_2025.pdf');
  assert.equal(pieceName({ name: 'x.xlsx', role: 'etat_financier' }, 'Projet Eau'), 'ETATS_FINANCIERS_PROJET_EAU.xlsx');
  assert.equal(pieceName({ name: 'x.pdf' }), null);
});

test('pieces are renamed in place, never over another file, and the change is logged', async () => {
  const files = { A: { id: 'A', name: 'scan001.pdf', parents: ['P'] }, B: { id: 'B', name: 'img.jpg', parents: ['P'] } };
  const taken = new Set(['BALANCE_GENERALE_2025.pdf']), moves = [], logs = [];
  const drive = { getFile: async id => files[id], nameTaken: async (p, n, ex) => taken.has(n), move: async (id, from, to, name) => { moves.push([id, name]); taken.add(name); } };
  const st = { mission_id: 'M', understood: [{ id: 'A', name: 'scan001.pdf', path: 'PIECES_RECUES/scan001.pdf', type: 'Balance générale', period: '2025' }, { id: 'B', name: 'img.jpg' }] };
  const r = await renamePieces('org', st, { tidyDrive: drive, engagementMissions: async () => [{ id: 'M', name: 'Audit projet' }], recordFiles: async () => {}, recordMissionDocuments: async () => {}, audit: async (o, e) => logs.push(e) });
  assert.deepEqual(moves, [['A', 'BALANCE_GENERALE_2025_2.pdf']]);
  assert.equal(r.kept, 1); assert.equal(st.understood[0].path, 'PIECES_RECUES/BALANCE_GENERALE_2025_2.pdf');
  assert.match(logs[0].decision, /scan001\.pdf.*BALANCE_GENERALE_2025_2\.pdf/);
});

test('« Préparer une mission » offers every received piece; a financing agreement is recommended', async () => {
  const list = await tdrCandidates('org', '11111111-1111-4111-8111-111111111111', {
    fetchRows: async () => [{ id: 'M', name: 'Audit projet' }], drive: {}, folder: 'F', loadScan: undefined,
    missionDocuments: async () => [{ id: 'C', name: 'CONVENTION.pdf', role: 'convention', type: 'Convention de financement' }, { id: 'E', name: 'EF.xlsx', role: 'etat_financier' }] });
  assert.deepEqual(list.map(x => [x.id, x.recommended]), [['C', true], ['E', false]]);
});
