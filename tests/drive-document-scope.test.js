import test from 'node:test';
import assert from 'node:assert/strict';
import { driveDocumentScope } from '../lib/agent-tools.js';

// Synthetic Drive: DRIVE > MISSION_A > doc_a ; DRIVE > MISSION_B > doc_b ; OTHER_DRIVE > doc_x
const files = {
  MISSION_A: { id: 'MISSION_A', parents: ['DRIVE'] },
  MISSION_B: { id: 'MISSION_B', parents: ['DRIVE'] },
  doc_a: { id: 'doc_a', parents: ['MISSION_A'] },
  doc_b: { id: 'doc_b', parents: ['MISSION_B'] },
  doc_x: { id: 'doc_x', parents: ['OTHER_DRIVE'] }
};
const getMeta = async id => files[id] || null;
const fetchRows = async path => {
  if (path.startsWith('office_staff_profiles')) return [{ id: 'staff1' }];
  if (path.startsWith('office_mission_assignments')) return [{ office_mission_id: 'A', status: 'active' }];
  if (path.startsWith('office_missions')) return [{ id: path.includes('id=eq.B') ? 'B' : 'A', drive_folder_id: path.includes('id=eq.B') ? 'MISSION_B' : 'MISSION_A' }];
  return [];
};
const d = { getMeta, fetchRows, driveKind: 'folder', driveId: 'DRIVE' };
const auditor = { orgId: 'org', account: { email: 'a@example.test', role: 'auditor' } };

test('a file outside the firm Drive is never read, even by an agent turn without a person', async () => {
  assert.equal(await driveDocumentScope(files.doc_x, { orgId: 'org' }, null, d), 'DOCUMENT_OUTSIDE_FIRM_DRIVE');
  assert.equal(await driveDocumentScope(files.doc_a, { orgId: 'org' }, null, d), null);
  assert.equal(await driveDocumentScope(files.doc_a, { orgId: 'org' }, null, { ...d, driveId: null, driveKind: null }), 'FIRM_DRIVE_NOT_CHOSEN');
});

test('a staff member reads only documents of a mission they are on', async () => {
  assert.equal(await driveDocumentScope(files.doc_a, auditor, null, d), 'MISSION_ID_REQUIRED');
  assert.equal(await driveDocumentScope(files.doc_a, auditor, 'A', d), null);
  assert.equal(await driveDocumentScope(files.doc_b, auditor, 'B', d), 'NOT_ON_THIS_MISSION');
  assert.equal(await driveDocumentScope(files.doc_b, auditor, 'A', d), 'DOCUMENT_OUTSIDE_MISSION');
});

test('owner and partner read any document of the firm Drive', async () => {
  assert.equal(await driveDocumentScope(files.doc_b, { orgId: 'org', account: { role: 'partner' } }, null, d), null);
});
