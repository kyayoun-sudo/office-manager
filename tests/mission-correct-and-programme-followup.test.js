import test from 'node:test';
import assert from 'node:assert/strict';
import { setMissionDetails } from '../lib/mission-quick.js';
import { handleMissionEvents } from '../lib/mission-events.js';

const ID = '11111111-1111-4111-8111-111111111111';
function db(mission, others = []) {
  const calls = [];
  const fetchRows = async (path, o = {}) => {
    calls.push({ path, o });
    if (o.method === 'PATCH') { Object.assign(mission, JSON.parse(o.body)); return []; }
    if (path.startsWith('office_missions?') && path.includes('&id=eq.')) return [mission];
    if (path.startsWith('office_missions?')) return others;
    return [];
  };
  return { fetchRows, calls };
}

test('the creator corrects the type and the name of their mission; before/after kept in the audit log', async () => {
  const m = { id: ID, name: 'Audit', client_name: 'ONG X', engagement_type: 'statutory', period_label: null, created_by: 'a@x' };
  const { fetchRows } = db(m); const logs = [];
  const r = await setMissionDetails('org', { mission_id: ID, name: 'Audit de projet', engagement_type: 'project' }, { email: 'a@x', role: 'auditor' }, { fetchRows, audit: async (o, e) => logs.push(e) });
  assert.deepEqual(r.changed.sort(), ['engagement_type', 'name']);
  assert.equal(m.engagement_type, 'project'); assert.equal(m.name, 'Audit de projet');
  assert.match(logs[0].decision, /statutory.*project|Audit.*Audit de projet/);
});

test('someone else on the mission who is not a manager cannot; a same-name mission of the client asks for confirmation', async () => {
  const m = { id: ID, name: 'Audit', client_name: 'ONG X', created_by: 'a@x' };
  await assert.rejects(setMissionDetails('org', { mission_id: ID, name: 'Y' }, { email: 'b@x', role: 'auditor' }, { fetchRows: db(m).fetchRows, audit: async () => {} }), /ROLE_NOT_ALLOWED/);
  const { fetchRows } = db(m, [{ id: 'other', name: 'Audit 2025', status: 'fieldwork' }]);
  await assert.rejects(setMissionDetails('org', { mission_id: ID, name: 'audit 2025' }, { email: 'm@x', role: 'manager' }, { fetchRows, audit: async () => {} }), /POSSIBLE_DUPLICATE/);
  const r = await setMissionDetails('org', { mission_id: ID, name: 'audit 2025', confirm_duplicate: true }, { email: 'm@x', role: 'manager' }, { fetchRows, audit: async () => {} });
  assert.deepEqual(r.changed, ['name']);
});

test('a validated programme makes the Mission Controller prepare the Working Papers itself and note who prepares what', async () => {
  const ev = { id: 'E1', event_type: 'WORK_PROGRAMME_VALIDATED', consumer: 'mission-controller', engagement_id: ID, object_id: 'P1', occurred_at: 't' };
  const settled = []; let memory = {};
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_events') && o.method === 'PATCH') { settled.push(JSON.parse(o.body)); return []; }
    if (path.startsWith('office_events')) return [ev];
    if (path.startsWith('office_work_programmes')) return [{ id: 'P1', version: 1, cycles: [{ cycle_code: 'C02', preparer: 'yvan@x', procedures: [{ code: 'ACH-01', active: true }, { code: 'ACH-02', active: true, preparer: 'paul@x' }, { code: 'ACH-03', active: false }] }] }];
    return [];
  };
  let prepared = 0;
  await handleMissionEvents('org', { fetchRows, drive: {}, folder: 'M', loadScan: async () => ({ state: { items: [] } }),
    prepareCycleWorkpapers: async () => { prepared++; return { workpapers: [{ cycle_code: 'C02', file_id: 'F1', status: 'CREATED' }] }; },
    writeAgentMemory: async (a, fn) => { memory = fn(memory); }, recordMissionDocuments: async () => {} });
  assert.equal(prepared, 1);
  const s = settled.find(x => x.status);
  assert.equal(s.status, 'handled'); assert.match(s.result, /1 Working Paper.*1 test\(s\) pour yvan@x, 1 test\(s\) pour paul@x/);
  assert.match(memory.open_items[0].label, /Programme v1 validé/);
});
