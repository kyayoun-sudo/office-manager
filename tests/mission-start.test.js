import test from 'node:test';
import assert from 'node:assert/strict';
import { announceMissionStarted, handleMissionStartedFor, MISSION_START_CONSUMERS } from '../lib/mission-start.js';

test('every other agent gets its own MISSION_STARTED event, once (idempotency key per agent)', async () => {
  const sent = [];
  const r = await announceMissionStarted('org', { id: 'm1', name: 'Mission A' }, { opportunity_id: 'o1', folder_id: 'F', documents: 3, mode: 'move' }, { emit: async (o, ev) => { sent.push(ev); return { id: 'e' + sent.length }; } });
  assert.equal(r.announced, 4); assert.deepEqual(sent.map(e => e.consumer), [...MISSION_START_CONSUMERS]);
  assert.equal(new Set(sent.map(e => e.idempotency_key)).size, 4);
  assert.ok(sent.every(e => e.type === 'MISSION_STARTED' && e.agent === 'mission-controller' && e.engagement_id === 'm1' && e.payload.folder_id === 'F'));
});

test('an emit failure for one agent is reported without stopping the others', async () => {
  const r = await announceMissionStarted('org', { id: 'm1', name: 'A' }, {}, { emit: async (o, ev) => { if (ev.consumer === 'sika') throw new Error('DOWN'); return {}; } });
  assert.equal(r.announced, 3); assert.equal(r.errors.length, 1);
});

test('an agent writes only its own memory; the Orpailleur learns not to re-file the mission documents', async () => {
  const writes = [];
  const ev = { id: 'e1', event_type: 'MISSION_STARTED', engagement_id: 'm1', object_id: 'm1', occurred_at: '2026-10-17T10:00:00Z', small_payload: { name: 'Mission A', folder_id: 'F' } };
  const d = { fetchRows: async (path, o = {}) => (o.method === 'PATCH' || o.method === 'POST') ? [] : [ev],
    writeAgentMemory: async (agent, fn) => { const m = {}; fn(m); writes.push([agent, m]); } };
  const r = await handleMissionStartedFor('orpailleur', 'org', d);
  assert.equal(r.handled, 1);
  {
    assert.equal(writes.length, 1); assert.equal(writes[0][0], 'orpailleur');
    assert.match(writes[0][1].next_pass_notes[0].note, /Ne pas les reclasser/);
    assert.equal(writes[0][1].active_missions[0].status, 'started');
  }
});
