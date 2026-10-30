import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { archiveReadiness, requestArchive, archivePass, freezeArchive, assertNotArchived, compareFrozen, flagFile, _resetArchiveLockCache } from '../lib/mission-archive.js';

// Archiving (spec 01 §38-42, 02 §66-70), built 2026-10-30.
const ORG = '11111111-1111-4111-8111-111111111111', MID = '22222222-2222-4222-8222-222222222222';
const partner = { role: 'partner', email: 'p@cab.ci', display_name: 'Associé' }, manager = { role: 'manager', email: 'm@cab.ci', display_name: 'Manager' };

function world({ status = 'report_issued', work = [{ procedure_code: 'ACH-01', status: 'reviewed', review_points: [] }], pbc = [], folder = 'FOLDER' } = {}) {
  const mission = { id: MID, name: 'Audit X 2025', client_name: 'Entité X', mission_code: 'AX25', status, period_label: '2025', drive_folder_id: folder, followups: {} };
  const events = [], audits = [];
  const fetchRows = async (path, o) => {
    if (path.startsWith('office_missions') && o?.method === 'PATCH') { Object.assign(mission, JSON.parse(o.body)); return []; }
    if (path.startsWith('office_missions')) return [structuredClone(mission)];
    if (path.startsWith('office_procedure_work')) return work;
    if (path.startsWith('office_pbc_requests')) return pbc;
    return [];
  };
  const d = { fetchRows, emit: async (org, ev) => { events.push(ev); return { recorded: true }; }, audit: async (org, ev) => { audits.push(ev); }, now: () => new Date('2026-11-30T10:00:00Z') };
  return { mission, events, audits, d };
}

test('closing controls: report, procedures signed, review points cleared, PBC resolved, folder known', async () => {
  const { d } = world({ status: 'fieldwork', work: [{ procedure_code: 'ACH-01', status: 'submitted', review_points: [{ status: 'open', text: 'pièce manquante' }] }], pbc: [{ document: 'GL', status: 'requested' }] });
  const r = await archiveReadiness(ORG, MID, d);
  assert.equal(r.ready, false);
  const failed = r.checks.filter(c => !c.ok).map(c => c.key).sort();
  assert.deepEqual(failed, ['pbc', 'procedures', 'report', 'review_points']);
  const ok = await archiveReadiness(ORG, MID, world().d);
  assert.equal(ok.ready, true);
});

test('request: refused while a control fails; a partner passes it only with a reason; a manager cannot', async () => {
  const w = world({ pbc: [{ document: 'Relevé décembre', status: 'requested' }] });
  await assert.rejects(requestArchive(ORG, MID, {}, manager, w.d), /ARCHIVE_CHECKS_NOT_MET/);
  await assert.rejects(requestArchive(ORG, MID, { overrides: { pbc: 'la banque a fermé le compte en novembre' } }, manager, w.d), /PARTNER_REQUIRED/);
  await assert.rejects(requestArchive(ORG, MID, {}, { role: 'auditor' }, w.d), /MANAGER_OR_PARTNER_ONLY/);
  const r = await requestArchive(ORG, MID, { overrides: { pbc: 'la banque a fermé le compte en novembre' } }, partner, w.d);
  assert.equal(r.archive.status, 'ready');
  assert.equal(r.archive.overrides[0].key, 'pbc');
  assert.equal(w.events[0].type, 'MISSION_READY_FOR_ARCHIVE');
  await assert.rejects(requestArchive(ORG, MID, {}, partner, w.d), /ARCHIVE_ALREADY_READY/);
  const noFolder = world({ folder: null });
  await assert.rejects(requestArchive(ORG, MID, { overrides: { folder: 'pas de dossier, tant pis pour nous' } }, partner, noFolder.d), /ARCHIVE_CHECK_BLOCKING/, 'without a folder nothing can be archived');
});

test('archive pass: every file read, a manifest written in the mission memory, nothing moved or deleted; then the freeze', async () => {
  const w = world();
  await requestArchive(ORG, MID, {}, manager, w.d);
  const created = [], touched = [];
  const tree = { FOLDER: [{ id: 'WPF', name: '05_WORKING_PAPERS', mimeType: 'application/vnd.google-apps.folder' }, { id: 'MEM', name: '_OFFICE_MANAGER', mimeType: 'application/vnd.google-apps.folder' },
      { id: 'REP', name: 'Rapport final.pdf', mimeType: 'application/pdf', version: '7', md5Checksum: 'abc', modifiedTime: '2026-11-20T10:00:00Z', parents: ['FOLDER'], owners: [{ emailAddress: 'p@cab.ci' }] }],
    WPF: [{ id: 'WP1', name: 'WP_ACH.xlsx', mimeType: 'x', md5Checksum: 'def', modifiedTime: '2026-11-19T10:00:00Z', parents: ['WPF'] }, { id: 'TMP', name: '~$WP_ACH.xlsx', mimeType: 'x', parents: ['WPF'] }],
    MEM: [{ id: 'MM', name: 'OFFICE_MANAGER_MISSION_MEMORY.json', mimeType: 'application/json', parents: ['MEM'] }] };
  const drive = {
    listChildren: async id => tree[id] || [],
    createBinary: async f => { created.push(f); return { id: 'MANIF' }; },
    getMeta: async id => ({ id, webViewLink: 'https://drive/' + id }),
    findFilesByExactName: async () => [],
    moveFile: async () => { touched.push('move'); }, trashFile: async () => { touched.push('trash'); }
  };
  const saved = [];
  const r = await archivePass(ORG, MID, { ...w.d, drive, missionMemoryHome: async () => 'MEM', missionDocuments: async () => [{ file_id: 'REP', title: 'Rapport d’audit', uses: [{ use: 'rapport' }] }],
    saveJsonFile: async (...a) => { saved.push(a); return 'STATE'; } });
  assert.match(r.result, /3 fichiers/, 'the report, the WP and the temporary file; the agents’ own memory is not part of the record');
  assert.deepEqual(touched, [], 'nothing moved, nothing trashed');
  assert.match(created[0].name, /^ARCHIVE_MANIFEST_\d{8}T\d{6}\.xlsx$/);
  assert.equal(created[0].parentId, 'MEM');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(created[0].buffer);
  const rows = []; wb.getWorksheet('MANIFEST').eachRow(row => rows.push(row.values.slice(1)));
  assert.deepEqual(rows[0].slice(0, 4), ['Engagement ID', 'Client', 'Période', 'File ID']);
  const rep = rows.find(x => x[3] === 'REP');
  assert.equal(rep[6], 'rapport'); assert.equal(rep[9], 'abc'); assert.equal(rep[11], 'p@cab.ci');
  assert.match(rows.find(x => x[3] === 'TMP')[12], /temporaire/);
  assert.match(rows.find(x => x[3] === 'WP1')[12], /non classé/);
  assert.equal(w.mission.followups.archive.status, 'manifest_ready');
  assert.equal(Object.keys(saved[0][4].files).length, 3, 'what is frozen: one line per file');
  // The freeze: a partner, on THE manifest they saw.
  await assert.rejects(freezeArchive(ORG, MID, { manifest_file_id: 'MANIF' }, manager, w.d), /PARTNER_ONLY/);
  await assert.rejects(freezeArchive(ORG, MID, { manifest_file_id: 'OTHER' }, partner, w.d), /MANIFEST_CHANGED_RELOAD/);
  const f = await freezeArchive(ORG, MID, { manifest_file_id: 'MANIF' }, partner, w.d);
  assert.equal(f.archive.status, 'archived');
  assert.equal(w.mission.status, 'archived');
  assert.ok(w.events.some(e => e.type === 'MISSION_ARCHIVED'));
});

test('read-only after archiving: a write is refused, unless a partner gives a reason (traced)', async () => {
  _resetArchiveLockCache();
  const w = world({ status: 'archived' });
  await assert.rejects(assertNotArchived(ORG, MID, { body: {}, account: manager }, w.d), /MISSION_ARCHIVED/);
  _resetArchiveLockCache();
  await assert.rejects(assertNotArchived(ORG, MID, { body: { post_archive_reason: 'correction d’une coquille' }, account: manager }, w.d), /PARTNER_ONLY/);
  const ok = await assertNotArchived(ORG, MID, { body: { post_archive_reason: 'correction d’une coquille dans le rapport' }, account: partner, query: { route: 'procedure' } }, w.d);
  assert.equal(ok.approved_by, 'p@cab.ci');
  assert.ok(w.audits.some(a => a.action_type === 'POST_ARCHIVE_CHANGE_APPROVED'));
  _resetArchiveLockCache();
  assert.equal(await assertNotArchived(ORG, MID, { body: {} }, world({ status: 'fieldwork' }).d), null, 'a live mission is not locked');
});

test('after archiving: changed, added and missing files are detected', () => {
  const frozen = { A: { h: 'x', m: '1' }, B: { h: 'y', m: '1', n: 'B.pdf' } };
  const changes = compareFrozen(frozen, [{ id: 'A', name: 'A.xlsx', md5Checksum: 'z', modifiedTime: '2' }, { id: 'C', name: 'C.docx', modifiedTime: '3' }]);
  assert.deepEqual(changes.map(c => c.kind + ':' + c.file_id).sort(), ['added:C', 'changed:A', 'missing:B']);
  assert.deepEqual(flagFile({ name: 'Copie de rapport.docx', location: '/PIECES_RECUES' }, false), ['temporaire', 'encore à ranger', 'non classé']);
});
