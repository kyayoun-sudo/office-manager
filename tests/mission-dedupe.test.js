import test from 'node:test';
import assert from 'node:assert/strict';
import { findSameMission, groupDuplicates, dedupeMissions } from '../lib/mission-dedupe.js';

const M = (id, name, extra = {}) => ({ id, name, status: 'active', ...extra });
const list = [
  M('a', 'Atlas Industrie — Trésorerie 2026', { planned_end: '2026-12-18' }), M('a2', 'Trésorerie 2026'),
  M('n', 'Nova Distribution — Audit financier 2026', { planned_end: '2026-12-18' }), M('n2', 'Audit financier 2026'),
  M('b1', 'BLE TRANSIT AUDIT 2025'), M('b2', 'BLE_TRANSIT_AUDIT_2025'), M('b3', 'Audit BLE TRANSIT 2025'),
  M('h', 'Horizon Services — Organisation 2026'), M('h2', 'Organisation 2026'),
  M('p1', 'Proposition Expertise France — IMPLUS SERA (Lots 1-3)'), M('p2', 'Proposition Expertise France / IMPLUS (SERA, Lots 1-3)'),
  M('x', 'Audit financier 2025')
];

test('the same mission under different names is recognised; a generic name never merges two clients', () => {
  assert.equal(findSameMission('BLE_TRANSIT_AUDIT_2025', [list[4]]).id, 'b1');
  assert.equal(findSameMission('Trésorerie 2026', [list[0], list[2]]).id, 'a');
  const two = [M('c1', 'Alpha — Audit financier 2026'), M('c2', 'Beta — Audit financier 2026')];
  assert.equal(findSameMission('Audit financier 2026', two), null, 'two clients: ambiguous, not merged');
  assert.equal(findSameMission('Audit financier 2025', [list[4]]), null);
});

test('duplicates grouped under the richest row (client named, dates)', () => {
  const g = groupDuplicates(list);
  const keepOf = id => g.find(x => x.merge.some(m => m.id === id))?.keep.id;
  assert.equal(keepOf('a2'), 'a'); assert.equal(keepOf('n2'), 'n'); assert.equal(keepOf('h2'), 'h');
  assert.ok(['b1', 'b3'].includes(keepOf('b2')) || keepOf('b2') === undefined ? true : false);
  assert.equal(new Set([keepOf('b2'), keepOf('b3'), keepOf('b1')].filter(Boolean)).size, 1);
  assert.ok(keepOf('p2') === 'p1' || keepOf('p1') === 'p2');
  assert.equal(keepOf('x'), undefined);
});

test('merge: assignments and actions moved to the kept mission, duplicate closed (never deleted)', async () => {
  const calls = [];
  const fetchRows = async (path, o = {}) => { if (o.method) calls.push([o.method, path, o.body]); return o.method ? [] : [M('a', 'Atlas Industrie — Trésorerie 2026', { planned_end: '2026-12-18' }), M('a2', 'Trésorerie 2026')]; };
  const r = await dedupeMissions('org', { fetchRows });
  assert.equal(r.merged, 1);
  assert.ok(calls.some(c => c[1].startsWith('office_mission_assignments') && c[1].includes('office_mission_id=eq.a2') && JSON.parse(c[2]).office_mission_id === 'a'));
  assert.ok(calls.some(c => c[1].includes('id=eq.a2') && JSON.parse(c[2]).status === 'cancelled'));
  assert.ok(!calls.some(c => c[0] === 'DELETE'));
});
