import test from 'node:test';
import assert from 'node:assert/strict';
import { emit, dispatch, ROUTES } from '../lib/event-bus.js';
import { handleMissionEvents, missionForFolder, pbcStatusFor } from '../lib/mission-events.js';

// A tiny in-memory office_events table (unique org_id + idempotency_key, like the SQL).
function eventsDb(extra = {}) {
  const rows = [];
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_events?on_conflict') && o.method === 'POST') {
      const r = JSON.parse(o.body)[0];
      if (rows.some(x => x.org_id === r.org_id && x.idempotency_key === r.idempotency_key)) return [];
      const row = { id: 'e' + (rows.length + 1), status: 'new', attempts: 0, ...r }; rows.push(row); return [row];
    }
    if (path.startsWith('office_events?') && o.method === 'PATCH') {
      const id = decodeURIComponent(path.match(/&id=eq\.([^&]+)/)[1]); const row = rows.find(x => x.id === id);
      if (row && (!/status=in/.test(path) || ['new', 'failed'].includes(row.status))) Object.assign(row, JSON.parse(o.body));
      return null;
    }
    if (path.startsWith('office_events?')) {
      const consumer = decodeURIComponent((path.match(/consumer=eq\.([^&]+)/) || [])[1] || '');
      return rows.filter(x => (!consumer || x.consumer === consumer) && ['new', 'failed'].includes(x.status) && x.attempts < 5);
    }
    for (const [k, v] of Object.entries(extra)) if (path.startsWith(k)) return typeof v === 'function' ? v(path, o) : v;
    return [];
  };
  return { rows, fetchRows };
}

test('the bus: an event is recorded once (idempotency), routed to its consumer, kept small', async () => {
  const { rows, fetchRows } = eventsDb();
  const ev = { type: 'DOCUMENT_CLASSIFIED', agent: 'orpailleur', object_type: 'drive_file', object_id: 'f1', idempotency_key: 'DOCUMENT_CLASSIFIED:f1:D:x.pdf', payload: { name: 'x.pdf', text: 'y'.repeat(5000) } };
  assert.equal((await emit('org', ev, { fetchRows })).recorded, true);
  assert.equal((await emit('org', ev, { fetchRows })).duplicate, true);
  assert.equal(rows.length, 1); assert.equal(rows[0].consumer, ROUTES.DOCUMENT_CLASSIFIED);
  assert.ok(JSON.stringify(rows[0].small_payload).length < 4000);
  assert.equal((await emit('org', { type: 'bad type', object_id: 'x' }, { fetchRows })).error, 'INVALID_EVENT');
});

test('dispatch: handled once; a failure is retried; an unknown event is ignored with its reason', async () => {
  const { rows, fetchRows } = eventsDb();
  await emit('org', { type: 'DOCUMENT_CLASSIFIED', object_id: 'a', idempotency_key: 'k-aaaaaaaa' }, { fetchRows });
  await emit('org', { type: 'POSSIBLE_DUPLICATE', object_id: 'b', idempotency_key: 'k-bbbbbbbb' }, { fetchRows });
  await emit('org', { type: 'NEEDS_HUMAN_CLASSIFICATION', object_id: 'c', idempotency_key: 'k-cccccccc' }, { fetchRows });
  let fail = true;
  const r = await dispatch('org', 'mission-controller', { DOCUMENT_CLASSIFIED: async () => 'ok', POSSIBLE_DUPLICATE: async () => { if (fail) throw new Error('drive down'); return 'ok'; } }, { fetchRows });
  assert.deepEqual(r, { handled: 1, ignored: 1, failed: 1 });
  fail = false;
  const r2 = await dispatch('org', 'mission-controller', { POSSIBLE_DUPLICATE: async () => 'ok' }, { fetchRows });
  assert.deepEqual(r2, { handled: 1, ignored: 0, failed: 0 });
  assert.deepEqual(rows.map(x => x.status), ['handled', 'handled', 'ignored']);
});

const F = 'application/vnd.google-apps.folder';
const items = [
  { id: 'y25', name: '2025', mimeType: F, parents: ['aud'] },
  { id: 'ble', name: 'BLE_TRANSIT_AUDIT_2025', mimeType: F, parents: ['y25'] },
  { id: 'pbc', name: '04_PBC_DOCUMENTS_CLIENT', mimeType: F, parents: ['ble'] },
  { id: 'nova', name: 'NOVA_AUDIT_2026', mimeType: F, parents: ['y26'] }
];
const missions = [{ id: 'M1', name: 'BLE TRANSIT — Audit 2025', client_name: 'BLE TRANSIT', drive_folder_id: 'ble' }, { id: 'M2', name: 'Nova Distribution 2026', client_name: 'Nova Distribution', drive_folder_id: null }];

test('the mission is found from the folder (or a parent); unsure → none', () => {
  assert.equal(missionForFolder('pbc', '/x/BLE_TRANSIT_AUDIT_2025/04_PBC', missions, items).mission.id, 'M1');
  assert.equal(missionForFolder('zz', '/01/01_AUDIT/2026/NOVA_DISTRIBUTION_AUDIT_2026/04', missions, []).mission.id, 'M2');
  assert.equal(missionForFolder('zz', '/01/AUTRE', missions, []).mission, null);
  assert.equal(pbcStatusFor('EXACT', 'PBC-03-02'), 'RECEIVED_REVIEW_REQUIRED');
  assert.equal(pbcStatusFor('PARTIEL', 'PBC-03-02'), 'PARTIAL');
  assert.equal(pbcStatusFor('EXACT', ''), 'UNMATCHED');
});

test('Orpailleur → Mission Controller: a VERIFIED filing becomes a document of the mission with its PBC status (received ≠ complete)', async () => {
  const { executeDecision } = await import('../lib/action-executor.js');
  const { rows, fetchRows } = eventsDb({ 'office_action_queue?': p => p.includes('status=in.(proposed') ? [{ id: 'a1' }] : [] });
  const td = { nameTaken: async () => false, move: async () => ({}), getFile: async () => ({ id: 'f1', name: 'PBC-03-02_Releve_SGCI_122025_BLE.pdf', parents: ['pbc'] }), binEmptyFolder: async () => ({ binned: false }) };
  const action = { id: 'a1', agent_key: 'orpailleur', action_type: 'FILE_MOVE', payload: { file_id: 'f1', file_name: 'scan.pdf', from_parent: 'loose', to_parent: 'pbc', to_name: '/x/BLE_TRANSIT_AUDIT_2025/04_PBC_DOCUMENTS_CLIENT', new_name: 'PBC-03-02_Releve_SGCI_122025_BLE.pdf',
    classification: { pbc_ref: 'PBC-03-02', pbc_role: 'EXACT', doc_type: 'relevé bancaire', period: '12/2025', read_method: 'vision', confidence: 'haute' } } };
  const r = await executeDecision('org', action, 'approve', 'Paul', { fetchRows, tidyDrive: td });
  assert.equal(r.verified, true);
  assert.equal(rows.length, 1); assert.equal(rows[0].event_type, 'DOCUMENT_CLASSIFIED'); assert.equal(rows[0].small_payload.pbc_ref, 'PBC-03-02');
  // Same filing announced twice → one event.
  await executeDecision('org', { ...action }, 'approve', 'Paul', { fetchRows, tidyDrive: td });
  assert.equal(rows.length, 1);
  const recorded = [];
  const out = await handleMissionEvents('org', { fetchRows: async (p, o) => p.startsWith('office_missions') ? missions : fetchRows(p, o),
    loadScan: async () => ({ state: { items } }), recordMissionDocuments: async (m, docs) => recorded.push([m.id, docs[0]]), writeAgentMemory: async () => null });
  assert.equal(out.handled, 1);
  assert.equal(recorded[0][0], 'M1');
  assert.equal(recorded[0][1].pbc_status, 'RECEIVED_REVIEW_REQUIRED'); assert.equal(recorded[0][1].source, 'orpailleur');
  assert.match(rows[0].result, /BLE TRANSIT.*PBC-03-02 → RECEIVED_REVIEW_REQUIRED/);
  assert.equal(rows[0].engagement_id, 'M1');
});

test('nothing is announced when the move could not be verified in Drive', async () => {
  const { executeDecision } = await import('../lib/action-executor.js');
  const { rows, fetchRows } = eventsDb({ 'office_action_queue?': p => p.includes('status=in.(proposed') ? [{ id: 'a2' }] : [] });
  const td = { nameTaken: async () => false, move: async () => ({}), getFile: async () => ({ id: 'f2', name: 'x.pdf', parents: ['elsewhere'] }), binEmptyFolder: async () => ({ binned: false }) };
  const r = await executeDecision('org', { id: 'a2', agent_key: 'orpailleur', action_type: 'FILE_MOVE', payload: { file_id: 'f2', file_name: 'x.pdf', from_parent: 'l', to_parent: 'pbc' } }, 'approve', 'Paul', { fetchRows, tidyDrive: td });
  assert.equal(r.verified, false); assert.equal(rows.length, 0);
});

test('a document of an unknown mission is not attached: noted for review', async () => {
  const { rows, fetchRows } = eventsDb();
  await emit('org', { type: 'DOCUMENT_CLASSIFIED', object_id: 'f9', idempotency_key: 'DOCUMENT_CLASSIFIED:f9:z', payload: { name: 'contrat.pdf', folder_id: 'zz', folder_path: '/01/AUTRE' } }, { fetchRows });
  const notes = [], recorded = [];
  const out = await handleMissionEvents('org', { fetchRows: async (p, o) => p.startsWith('office_missions') ? missions : fetchRows(p, o), loadScan: async () => ({ state: { items } }),
    recordMissionDocuments: async () => recorded.push(1), writeAgentMemory: async (a, fn) => notes.push(fn({ open_items: [] })) });
  assert.equal(out.ignored, 1); assert.equal(recorded.length, 0);
  assert.match(notes[0].open_items[0].label, /sans mission identifiée/);
  assert.equal(rows[0].status, 'ignored');
});
