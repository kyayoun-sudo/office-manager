import test from 'node:test';
import assert from 'node:assert/strict';
import { shortenName, fitName, longPaths, pathLength, TARGET, EXCEL_LIMIT } from '../lib/path-budget.js';
import { shortenMissionPaths } from '../lib/path-repair.js';
import { missionFolderName } from '../lib/mission-quick.js';

// A Drive: shared drive « TATY » > 01_CLIENTS_ET_MISSIONS > 01_AUDIT > 2024 > <long mission folder> > 05_WORKING_PAPERS > file.
const LONG = 'MINISTERE DE L AGRICULTURE ET DU DEVELOPPEMENT RURAL — Audit des comptes du Projet d Appui à la Gestion des Filières Cacao — Exercices 2023 et 2024';
function drive() {
  const items = {
    D: { id: 'D', name: 'TATY & ASSOCIES' }, C: { id: 'C', name: '01_CLIENTS_ET_MISSIONS', parents: ['D'], folder: true }, A: { id: 'A', name: '01_AUDIT', parents: ['C'], folder: true },
    Y: { id: 'Y', name: '2024', parents: ['A'], folder: true }, M: { id: 'M', name: LONG, parents: ['Y'], folder: true }, W: { id: 'W', name: '05_WORKING_PAPERS_CYCLES_SELECTIONNES', parents: ['M'], folder: true },
    F: { id: 'F', name: 'NL-T01_PRJ_Projets_Bailleurs_Reporting_mission_ef188e85_v1.xlsx', parents: ['W'] }, S: { id: 'S', name: 'court.pdf', parents: ['M'] }
  };
  return {
    items,
    getMeta: async id => items[id] || null,
    getFile: async id => items[id] || null,
    listChildren: async id => Object.values(items).filter(x => (x.parents || [])[0] === id).map(x => ({ id: x.id, name: x.name, mimeType: x.folder ? 'application/vnd.google-apps.folder' : 'application/octet-stream' })),
    nameTaken: async () => false,
    move: async (id, from, to, name) => { items[id].name = name; }
  };
}

test('a long file name is shortened, keeping its code, years and version', () => {
  const n = shortenName('NL-T01_PRJ_Projets_Bailleurs_Reporting_mission_ef188e85_v1.xlsx', 30);
  assert.ok(n.length <= 30, n);
  assert.match(n, /^NL-T01/);
  assert.match(n, /v1\.xlsx$/);
  assert.equal(shortenName('court.pdf', 30), 'court.pdf');
});

test('a new name in a deep folder keeps the full path under the limit', async () => {
  const d = drive();
  d.items.M.name = 'PAGFIC — Audit 2023-2024';
  const r = await fitName('NL-T01_PRJ_Projets_Bailleurs_Reporting_mission_ef188e85_v1.xlsx' + '_'.repeat(0), 'W', d, new Map(), { target: 170 });
  assert.ok(r.length <= 170, String(r.length));
  assert.equal(r.shortened, true);
  assert.match(r.name, /^NL-T01/);
  // A folder so deep that no file name can fit: said, not hidden.
  const deep = await fitName('x.xlsx', 'W', d, new Map(), { target: 90 });
  assert.equal(deep.too_deep, true);
});

test('the mission’s files too long for Excel are found with a shorter name, renamed only on request, verified', async () => {
  const d = drive();
  const before = pathLength(['TATY & ASSOCIES', '01_CLIENTS_ET_MISSIONS', '01_AUDIT', '2024', LONG, '05_WORKING_PAPERS_CYCLES_SELECTIONNES'], d.items.F.name);
  assert.ok(before > EXCEL_LIMIT);
  const lp = await longPaths('M', d);
  assert.ok(lp.files.some(f => f.id === 'F' && f.over_excel));
  assert.ok(!lp.files.some(f => f.id === 'S'));
  const deps = { view: async () => ({ editable: true }), fetchRows: async () => [{ id: 'm', drive_folder_id: 'M' }], drive: d, tidyDrive: d, audit: async () => null };
  assert.ok(lp.folders.some(x => x.id === 'M' && x.proposed));       // the mission folder is what makes every path too long
  const nameF = d.items.F.name;
  // Only what the person asked for is renamed: the mission folder (same id), then the file fits.
  const r1 = await shortenMissionPaths('O', 'm', 'PRJ-01', { email: 'p' }, { ids: ['M'] }, deps);
  assert.deepEqual(r1.done.map(x => x.id), ['M']);
  assert.ok(d.items.M.name.length <= 40);
  assert.equal(d.items.F.name, nameF);
  const lp2 = await longPaths('M', d);
  assert.ok(!lp2.files.some(x => x.id === 'F'));
});

test('a new mission folder name is short', () => {
  assert.ok(missionFolderName({ name: 'Audit des comptes du Projet d Appui à la Gestion des Filières Cacao', client_name: 'MINISTERE DE L AGRICULTURE ET DU DEVELOPPEMENT RURAL', period_label: 'Exercices 2023 et 2024' }).length <= 60);
});
