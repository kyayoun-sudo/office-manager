import test from 'node:test';
import assert from 'node:assert/strict';
import { readDriveBudgetSources } from '../lib/drive-budget-sources.js';

function fixture() {
  const files = Object.fromEntries(['master', 'programme', 'template'].map(id => [id, { id, name: id, driveId: 'drive', modifiedTime: 'v1', mimeType: 'text/plain' }]));
  const sheets = {
    Collaborateurs: [['ID', 'Nom', 'Prenom', 'Fonction', 'Actif', 'Telephone', 'Lien_CV'], ['S-1', 'Fictif', 'Test', 'Manager', 'Oui', 'PRIVATE', 'PRIVATE']],
    Missions: [['ID_Mission', 'Client', 'Objet', 'Equipe', 'URL_Planification_Validee'], ['M-1', 'Client fictif', 'Mission fictive', 'S-1', 'programme']],
    Planning: [['ID_Affectation', 'Collaborateur', 'Mission', 'Date_Debut', 'Date_Fin', 'Charge_Pct', 'Role_Mission', 'Cycle_Workstream', 'Reviewer', 'Statut', 'Source_Plan_File_ID', 'Source_Plan_Modified_At'], ['A-1', 'S-1', 'M-1', '2026-10-12', '2026-10-13', 50, 'Manager', 'W-1', '', 'SOURCE_CONFIRMEE', 'programme', 'v1']]
  };
  const io = { masterId: 'master', driveId: 'drive', metadata: async id => ({ ...files[id] }), values: async (_id, range) => sheets[range.split('!')[0]], read: async id => ({ supported: true, truncated: false, text: 'Source fictive : heures à confirmer', file: { ...files[id] } }) };
  return { files, sheets, io, input: { mission_key: 'M-1', programme_file_id: 'programme', template_file_id: 'template' } };
}

test('reads existing Drive sources without DB or writes and never approves a packet', async () => {
  const f = fixture();
  const result = await readDriveBudgetSources(f.input, f.io);
  assert.equal(result.status, 'REVIEW_REQUIRED');
  assert.equal(result.ready_to_export, false);
  assert.equal(result.written, false);
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].Charge_Pct, 50);
  assert.equal('hours' in result.assignments[0], false);
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.ok(result.programme.content_fingerprint);
});

test('empty registers and missing template report missing sources', async () => {
  const f = fixture();
  f.sheets.Missions = f.sheets.Missions.slice(0, 1);
  f.sheets.Planning = f.sheets.Planning.slice(0, 1);
  f.input.template_file_id = null;
  const r = await readDriveBudgetSources(f.input, f.io);
  assert.ok(r.issues.includes('MISSION_NOT_IN_REGISTER'));
  assert.ok(r.issues.includes('NO_REGISTER_ASSIGNMENTS'));
  assert.ok(r.issues.includes('TEMPLATE_NOT_SELECTED'));
});

test('refuses foreign or trashed sources before any content read', async () => {
  for (const change of [{ driveId: 'other' }, { trashed: true }]) {
    const f = fixture(); Object.assign(f.files.template, change);
    f.io.values = async () => { throw new Error('must not read'); };
    const r = await readDriveBudgetSources(f.input, f.io);
    assert.equal(r.status, 'SOURCE_SCOPE_REQUIRED');
  }
});

test('draft, truncated and outdated planning cannot be silently accepted', async () => {
  const f = fixture(); f.files.programme.name = 'PROGRAMME_A_VALIDER.docx';
  f.sheets.Planning[1][11] = 'old';
  f.io.read = async id => ({ supported: true, truncated: true, text: 'partial', file: f.files[id] });
  const r = await readDriveBudgetSources(f.input, f.io);
  assert.ok(r.issues.includes('PROGRAMME_DRAFT'));
  assert.ok(r.issues.includes('PROGRAMME_TRUNCATED'));
  assert.ok(r.issues.includes('ASSIGNMENT_PROVENANCE_REVIEW_REQUIRED'));
  assert.equal(r.programme.content_fingerprint, null);
});

test('unreadable documents and mismatched extracted versions are explicit', async () => {
  const f = fixture();
  f.io.read = async () => ({ supported: false, file: { id: 'wrong', modifiedTime: 'old' } });
  const r = await readDriveBudgetSources(f.input, f.io);
  assert.ok(r.issues.includes('PROGRAMME_UNREADABLE'));
  assert.ok(r.issues.includes('PROGRAMME_VERSION_REVIEW_REQUIRED'));
  assert.equal(r.programme.text, '');
});

test('duplicate mission identifiers and incomplete headers require review', async () => {
  const f = fixture(); f.sheets.Missions.push([...f.sheets.Missions[1]]);
  f.sheets.Planning[0][11] = 'unexpected';
  const r = await readDriveBudgetSources(f.input, f.io);
  assert.ok(r.issues.includes('MISSION_ID_AMBIGUOUS'));
  assert.ok(r.issues.includes('REGISTER_HEADERS_REQUIRED'));
  assert.equal(r.mission, null);
});

test('sources changed while reading invalidate the snapshot', async () => {
  const f = fixture(); let calls = 0;
  f.io.metadata = async id => ({ ...f.files[id], modifiedTime: ++calls > 3 ? 'v2' : 'v1' });
  const r = await readDriveBudgetSources(f.input, f.io);
  assert.ok(r.issues.includes('SOURCES_CHANGED_DURING_READ'));
});
