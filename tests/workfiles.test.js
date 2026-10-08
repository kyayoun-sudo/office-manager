import test from 'node:test';
import assert from 'node:assert/strict';
import { identify, beat, checkIdleWorkfiles, decideWorkfileAction, gridPatterns, workfileKpisFrom, reviewWorkbook } from '../lib/workfiles.js';
import { executeDecision } from '../lib/action-executor.js';

const items = [
  { id: 'f1', name: 'WP_stocks.xlsx', path: '/TATY/01_CLIENTS/Mines du Sud/CAC 2026/WP_stocks.xlsx' },
  { id: 'f2', name: 'WP_stocks.xlsx', path: '/TATY/01_CLIENTS/Nova/CAC 2026/WP_stocks.xlsx' }];
const missions = [{ id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Mines du Sud — Audit 2026' }, { id: 'bbbbbbbb-1111-4111-8111-111111111111', name: 'Nova — Audit 2026' }];

test('panel: the open file and its mission are recognised from the path on the computer', () => {
  const r = identify('WP_stocks.xlsx', 'G:\\Drive partagés\\TATY\\01_CLIENTS\\Mines du Sud\\CAC 2026\\WP_stocks.xlsx', items, missions);
  assert.equal(r.file_id, 'f1'); assert.equal(r.mission.name, 'Mines du Sud — Audit 2026');
  const unknown = identify('Classeur1.xlsx', 'C:\\Users\\yao\\Desktop\\Classeur1.xlsx', items, missions);
  assert.equal(unknown.file_id, null); assert.equal(unknown.mission, null);
});

test('heartbeat: active time counted only when the person worked; the save-and-close request is passed on', async () => {
  const s = { id: 's1', last_seen_at: '2026-10-08T10:00:00Z', active_seconds: 60, edits: 2, save_close_requested: true, closed_at: null };
  const patches = [];
  const fetchRows = async (path, o = {}) => { if (o.method === 'PATCH') { patches.push(JSON.parse(o.body)); return []; } return [s]; };
  const r = await beat('org', {}, { session: 'wf-abcdefgh', active: true, edits: 3 }, { fetchRows, now: () => new Date('2026-10-08T10:02:00Z') });
  assert.equal(r.active_seconds, 180); assert.equal(r.save_close, true); assert.equal(patches[0].edits, 5);
  const idle = await beat('org', {}, { session: 'wf-abcdefgh', active: false }, { fetchRows, now: () => new Date('2026-10-08T10:30:00Z') });
  assert.equal(idle.active_seconds, 60);
});

test('Orpailleur: a file open without activity for 3 hours → proposal to its user; a silent panel → session closed', async () => {
  const now = new Date('2026-10-08T23:00:00Z');
  const open = [
    { id: 'idle', user_email: 'yao@taty.info', user_name: 'Yao', file_name: 'WP_stocks.xlsx', last_seen_at: '2026-10-08T22:58:00Z', last_activity_at: '2026-10-08T18:30:00Z' },
    { id: 'busy', user_email: 'awa@taty.info', file_name: 'WP_paie.xlsx', last_seen_at: '2026-10-08T22:59:00Z', last_activity_at: '2026-10-08T22:50:00Z' },
    { id: 'gone', user_email: 'ali@taty.info', file_name: 'WP_caisse.xlsx', last_seen_at: '2026-10-08T19:00:00Z', last_activity_at: '2026-10-08T18:00:00Z' }];
  const posts = [], patches = [];
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'POST') { const row = JSON.parse(o.body)[0]; posts.push(row); return [{ id: 'act1' }]; }
    if (o.method === 'PATCH') { patches.push({ path, body: JSON.parse(o.body) }); return []; }
    return open;
  };
  const r = await checkIdleWorkfiles('org', { fetchRows, now: () => now });
  assert.deepEqual([r.proposed, r.timed_out], [1, 1]);
  assert.equal(posts[0].action_type, 'WORKFILE_SAVE_CLOSE'); assert.equal(posts[0].agent_key, 'orpailleur');
  assert.match(posts[0].summary, /Yao a laissé « WP_stocks.xlsx » ouvert.*Veux-tu que je l’enregistre et le ferme/);
  assert.equal(posts[0].payload.user_email, 'yao@taty.info');
  assert.ok(patches.some(p => p.path.includes('id=eq.gone') && p.body.close_reason === 'timeout'));
});

test('the user decides for his own file (even a collaborator); someone else cannot, a manager can', async () => {
  const action = { id: 'a1', status: 'proposed', payload: { user_email: 'yao@taty.info', session_id: 's1' } };
  const calls = [];
  const fetchRows = async (path, o = {}) => { calls.push({ path, o }); return o.method ? [] : [action]; };
  const r = await decideWorkfileAction('org', { email: 'YAO@taty.info', role: 'collaborator' }, { action_id: 'a1', decision: 'approve' }, { fetchRows });
  assert.equal(r.done, true);
  assert.ok(calls.some(c => c.path.includes('office_workfile_sessions') && JSON.parse(c.o.body).save_close_requested === true));
  await assert.rejects(decideWorkfileAction('org', { email: 'ali@taty.info', role: 'collaborator' }, { action_id: 'a1', decision: 'approve' }, { fetchRows }), /ROLE_NOT_ALLOWED/);
  const viaValidations = await executeDecision('org', { id: 'a1', action_type: 'WORKFILE_SAVE_CLOSE', payload: { session_id: 's1', file_name: 'WP_stocks.xlsx' } }, 'approve', 'Paul',
    { fetchRows: async (path, o = {}) => path.includes('status=in.') ? [{ id: 'a1' }] : [] });
  assert.match(viaValidations.effect, /enregistre et ferme « WP_stocks.xlsx »/);
});

test('review in Excel: patterns computed on the grid read by the panel, remarks kept for the file and the mission', async () => {
  const values = [['Article', 'Qté', 'Prix', 'Total']], formulas = [['Article', 'Qté', 'Prix', 'Total']];
  for (let i = 2; i <= 9; i++) { values.push(['A' + i, i, 1000, i * 1000]); formulas.push(['A' + i, i, 1000, '=B' + i + '*C' + i]); }
  values.push(['A10', 10, 1000, 9999]); formulas.push(['A10', 10, 1000, 9999]);
  const p = gridPatterns([{ name: 'Stocks', address: 'Stocks!A1:D10', values, formulas }]);
  assert.equal(p[0].formulas, 8); assert.deepEqual(p[0].hard_coded_in_computed_columns[0], { column: 'D', cells: ['D10'] });
  let saved = null;
  const out = await reviewWorkbook('org', {}, { file_name: 'WP_stocks.xlsx', file_id: 'f1', mission_id: missions[0].id, sheets: [{ name: 'Stocks', address: 'Stocks!A1:D10', values, formulas }] }, {
    engagementState: async () => ({ risk_brief: { text: 'Dépréciation des stocks' } }), auditorState: async () => ({}), missionDocuments: async () => [],
    ai: async (o, { input }) => { assert.match(input, /\{=B2\*C2\}=2000/); return { provider: 'anthropic', text: JSON.stringify({ summary: 'Total saisi en dur', remarks: [{ sheet: 'Stocks', cell: '$D$10', remark: 'Total saisi en dur au lieu de la formule', severity: 'haute' }] }) }; },
    fetchRows: async (path, o) => { saved = JSON.parse(o.body); return saved.map((x, i) => ({ ...x, id: 'r' + i })); } });
  assert.equal(saved[0].cell, 'D10'); assert.equal(saved[0].severity, 'high'); assert.equal(saved[0].mission_id, missions[0].id);
  assert.equal(out.remarks[0].id, 'r0');
});

test('indicators: actual time per person and mission, overlaps, planned without work, work without assignment', () => {
  const M1 = missions[0].id, M2 = missions[1].id, now = new Date('2026-10-08T18:00:00Z');
  const S = (who, email, file, m, start, end, sec) => ({ user_name: who, user_email: email, file_name: file, file_id: file, mission_id: m, started_at: start, last_seen_at: end, last_activity_at: end, active_seconds: sec });
  const sessions = [
    S('Yao', 'yao@t', 'WP_stocks', M1, '2026-10-08T08:00:00Z', '2026-10-08T11:00:00Z', 7200),
    S('Yao', 'yao@t', 'WP_paie', M2, '2026-10-08T13:00:00Z', '2026-10-08T15:00:00Z', 3600),
    S('Awa', 'awa@t', 'WP_stocks', M1, '2026-10-08T10:00:00Z', '2026-10-08T12:00:00Z', 1800)];
  const staff = [{ id: 's1', full_name: 'Yao', email: 'yao@t' }, { id: 's2', full_name: 'Awa', email: 'awa@t' }];
  const assignments = [{ office_mission_id: M1, staff_profile_id: 's1', planned_start: '2026-10-01', planned_end: '2026-10-31', status: 'confirmed' },
    { office_mission_id: M2, staff_profile_id: 's2', planned_start: '2026-10-01', planned_end: '2026-10-31', status: 'confirmed', mission_role: 'senior' }];
  const k = workfileKpisFrom({ sessions, staff, assignments, missions }, now);
  assert.equal(k.people[0].person, 'Yao'); assert.equal(k.people[0].hours, 3);
  assert.equal(k.missions.find(m => m.mission_id === M1).hours, 2.5);
  assert.ok(k.overlaps.some(o => o.type === 'plusieurs missions le même jour' && o.person === 'Yao'));
  assert.ok(k.overlaps.some(o => o.type === 'même fichier ouvert en même temps' && o.file === 'WP_stocks'));
  assert.deepEqual(k.planned_without_work.map(x => x.person + ':' + x.mission), ['Awa:Nova — Audit 2026']);
  assert.deepEqual(k.work_without_assignment.map(x => x.person + ':' + x.mission).sort(), ['Awa:Mines du Sud — Audit 2026', 'Yao:Nova — Audit 2026']);
});
