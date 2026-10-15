import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMissionWorkspace } from '../lib/mission-workspace.js';

const opportunity = { id: 'o', client: 'Client', handoff: { status: 'complete', url: 'https://drive.google.com/drive/folders/mission' }, team: { status: 'validated', members: [{ name: 'Manager' }] } };
const mission = { id: 'm', status: 'planning', drive_folder_id: 'destination' };

test('workspace uses the existing Mission Controller tools and reports rather than certifying execution', async () => {
  let input;
  const result = await prepareMissionWorkspace('org', opportunity, mission, { permissions: async () => ({ granted: true }), run: async request => { input = request; return { text: 'Programme à valider, aucun fichier créé.', toolsUsed: ['analyze_work_programme'] }; } });
  assert.equal(input.requestedAgent, 'mission-controller');
  assert.equal(input.orgId, 'org');
  assert.equal(input.contexts['mission-controller'].destination.folder_id, 'destination');
  assert.deepEqual(input.contexts['mission-controller'].team, opportunity.team);
  assert.match(input.message, /mission_structure/);
  assert.match(input.message, /prefill_headers=true/);
  assert.equal(result.status, 'reported'); assert.equal(result.review_required, true);
  assert.match(result.summary, /aucun fichier créé/);
});

test('workspace respects processing permission, mission approval and document transfer before invoking AI', async () => {
  let calls = 0;
  const d = { permissions: async () => ({ granted: true }), run: async () => { calls++; } };
  await assert.rejects(prepareMissionWorkspace('org', opportunity, mission, { ...d, permissions: async () => ({ granted: false }) }), /AGENTS_NOT_AUTHORIZED/);
  await assert.rejects(prepareMissionWorkspace('org', opportunity, { ...mission, status: 'acceptance' }, d), /MISSION_NOT_AUTHORIZED/);
  await assert.rejects(prepareMissionWorkspace('org', { ...opportunity, handoff: { status: 'partial' } }, mission, d), /MISSION_DOCUMENT_TRANSFER_REQUIRED/);
  assert.equal(calls, 0);
});

test('Excel working-file header prefill preserves formulas and verifies writes in the copy', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const { prefillHeader, XLSX_MIME } = await import('../lib/mission-engine.js');
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Working file');
  ws.getCell('A1').value = 'Client'; ws.getCell('A2').value = 'Mission';
  ws.getCell('D9').value = { formula: '1+2' };
  let bytes = Buffer.from(await wb.xlsx.writeBuffer()), version = 'v1';
  const drive = { getMeta: async () => ({ modifiedTime: version }), downloadBuffer: async () => bytes, updateBinary: async (id, input) => { assert.equal(input.expectedModifiedTime, version); bytes = input.buffer; version = 'v2'; } };
  const result = await prefillHeader(drive, { id: 'copy', mimeType: XLSX_MIME }, { client: 'Client connu', mission: 'Due diligence' });
  assert.equal(result.status, 'PREFILLED');
  const read = new ExcelJS.Workbook(); await read.xlsx.load(bytes);
  assert.equal(read.getWorksheet(1).getCell('B1').value, 'Client connu');
  assert.equal(read.getWorksheet(1).getCell('D9').value.formula, '1+2');
  const before = Buffer.from(bytes);
  assert.equal((await prefillHeader(drive, { id: 'copy', mimeType: XLSX_MIME }, { client: 'Autre client' })).status, 'HEADER_PREFILL_REVIEW_REQUIRED');
  assert.deepEqual(bytes, before);
});
