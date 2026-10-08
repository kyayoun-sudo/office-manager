import test from 'node:test';
import assert from 'node:assert/strict';

// A Drive in memory: files by (parent, name), modifiedTime bumped at each write.
function fakeDrive() {
  const files = new Map(); let n = 0, clock = 0;
  const stamp = () => '2026-10-08T00:00:' + String(++clock).padStart(2, '0') + '.000Z';
  return {
    files,
    findFilesByExactName: async (name, parent) => [...files.values()].filter(f => f.name === name && f.parent === parent).map(f => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime })),
    downloadBuffer: async id => Buffer.from(files.get(id).content),
    getMeta: async id => ({ id, modifiedTime: files.get(id).modifiedTime }),
    createBinary: async ({ name, parentId, buffer }) => { const id = 'f' + (++n); files.set(id, { id, name, parent: parentId, content: buffer.toString(), modifiedTime: stamp() }); return { id }; },
    updateBinary: async (id, { buffer, expectedModifiedTime }) => {
      const f = files.get(id);
      if (f.modifiedTime !== expectedModifiedTime) throw new Error('MEMORY_CONFLICT: expected ' + expectedModifiedTime);
      f.content = buffer.toString(); f.modifiedTime = stamp(); return { id };
    },
    listChildren: async () => []
  };
}
const fakeTidy = () => ({ async findOrCreateFolder(parent, name) { return { id: parent + '/' + name }; } });

test('statuses: one list, old values understood, archive only after closing', async () => {
  const s = await import('../lib/mission-status.js');
  assert.equal(s.canonicalStatus('active'), 'fieldwork');
  assert.equal(s.canonicalStatus('Terminée'), 'closed');
  assert.equal(s.canonicalStatus('planned'), 'planning');
  assert.equal(s.canonicalStatus(''), 'fieldwork');
  assert.equal(s.isLive('completed'), false);
  assert.equal(s.isNotStarted('proposal'), true);
  assert.ok(s.LIVE_FILTER.includes('completed') && s.LIVE_FILTER.includes('cancelled') && s.LIVE_FILTER.includes('closed'));
  assert.ok(!s.NOT_ARCHIVED_FILTER.includes('closed'));
  assert.equal(s.canMove('fieldwork', 'archived'), false);
  assert.equal(s.canMove('completed', 'archived'), true);
  assert.equal(s.canMove('archived', 'fieldwork'), false);
  assert.equal(s.canMove('fieldwork', 'nonsense'), false);
});

test('Drive JSON: the modifiedTime read with the content is the one checked; updateJsonFile retries a conflict', async () => {
  const { loadJsonFile, saveJsonFile, updateJsonFile } = await import('../lib/mapping-scan.js');
  const drive = fakeDrive();
  await saveJsonFile('X.json', drive, 'root', null, { v: 1 });
  const a = await loadJsonFile('X.json', drive, 'root');
  assert.ok(a.modifiedTime);
  await saveJsonFile('X.json', drive, 'root', a.fileId, { v: 2 }, a.modifiedTime);
  // A writer holding the old version is refused (it would have erased v2).
  await assert.rejects(() => saveJsonFile('X.json', drive, 'root', a.fileId, { v: 3 }, a.modifiedTime), /MEMORY_CONFLICT/);
  // Without the option, the old behaviour stays (fresh metadata).
  await saveJsonFile('X.json', drive, 'root', a.fileId, { v: 4 });
  let first = true;
  const r = await updateJsonFile('X.json', async st => {
    if (first) { first = false; const cur = await loadJsonFile('X.json', drive, 'root'); await saveJsonFile('X.json', drive, 'root', cur.fileId, { v: 99, other: true }, cur.modifiedTime); }
    return { ...st, mine: true };
  }, { drive, folder: 'root' });
  assert.equal(r.written, true);
  assert.deepEqual((await loadJsonFile('X.json', drive, 'root')).state, { v: 99, other: true, mine: true });
});

test('agent memory: in MEMORY/AGENTS, one writer, checkpoint moves only on success', async () => {
  const m = await import('../lib/agent-memory.js');
  m.resetAgentMemoryFolderCache();
  const drive = fakeDrive(), d = { drive, folder: 'om', tidyDrive: fakeTidy() };
  await m.beginPass('orpailleur', { ref: 'pass:1' }, d);
  let { memory } = await m.loadAgentMemory('orpailleur', d);
  assert.equal(memory.status, 'running');
  assert.ok([...drive.files.values()].some(f => f.parent === 'om/MEMORY/AGENTS' && f.name === 'ORPAILLEUR_MEMORY.json'));
  assert.ok(memory.sources.some(s => s.file === 'OFFICE_MANAGER_TIDY_STATE.json'));
  await m.endPass('orpailleur', { ok: true, checkpoint: { last_pass_at: 'T1' } }, d);
  await m.endPass('orpailleur', { ok: false, error: 'boom', checkpoint: { last_pass_at: 'T2' } }, d);
  ({ memory } = await m.loadAgentMemory('orpailleur', d));
  assert.deepEqual(memory.checkpoint, { last_pass_at: 'T1' });
  assert.equal(memory.status, 'failed'); assert.equal(memory.retry_count, 1); assert.equal(memory.last_error, 'boom');
  await assert.rejects(() => m.writeAgentMemory('orpailleur', x => x, { ...d, writer: 'sika' }), /SINGLE_WRITER/);
  assert.equal(m.isStale({ status: 'running', heartbeat_at: '2026-10-08T00:00:00Z' }, 15, new Date('2026-10-08T00:20:00Z')), true);
  assert.match(m.memorySummary('orpailleur', memory), /ÉCHEC : boom/);
  // A memory problem never breaks the pass.
  const r = await m.beginPass('sika', {}, { drive: { findFilesByExactName: async () => { throw new Error('down'); } }, folder: 'om', tidyDrive: fakeTidy() });
  assert.ok(r.memory_error !== undefined || r.status === 'running');
});

test('audit log: references and hashes only; works without the migration', async () => {
  const a = await import('../lib/audit-log.js');
  const row = a.auditRow('org', { agent: 'sika', input: { secret: 'contenu' }, status: 'weird', mission_id: 'not-a-uuid' });
  assert.match(row.input_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.status, 'succeeded'); assert.equal(row.mission_id, null);
  assert.ok(!JSON.stringify(row).includes('contenu'));
  const out = await a.audit('org', { agent: 'sika', action_type: 'X' }, { fetchRows: async () => { throw new Error('relation "office_audit_events" does not exist'); }, drive: false });
  assert.equal(out.db, false); assert.match(out.db_error, /MIGRATION/);
  const rows = [];
  const ok = await a.audit('org', { agent: 'sika', action_type: 'X' }, { fetchRows: async () => [], folder: 'om', tidyDrive: fakeTidy(), findFiles: async () => [], createFile: async () => ({ id: 'sheet' }), appendValues: async (id, r, v) => rows.push(...v) });
  assert.equal(ok.db, true); assert.equal(ok.drive, true); assert.equal(rows[0][1], 'sika');
});

test('mission folder: created only when sure, else a proposal', async () => {
  const mm = await import('../lib/mission-memory.js');
  const f = [{ id: 'r', name: 'Clients', parent: null, path: '/Clients' }, { id: 'c', name: 'BLE TRANSIT', parent: 'r', path: '/Clients/BLE TRANSIT' },
    { id: 'y', name: '2025', parent: 'c', path: '/Clients/BLE TRANSIT/2025' }, { id: 'a', name: 'Audit', parent: 'y', path: '/Clients/BLE TRANSIT/2025/Audit' },
    { id: 'a2', name: 'Audit BLE TRANSIT 2025 (copie)', parent: 'r', path: '/Clients/Audit BLE TRANSIT 2025 (copie)' }];
  assert.equal(mm.matchMissionFolder({ name: 'Audit BLE TRANSIT 2025' }, f.slice(0, 4)).folder.id, 'a');
  const two = mm.matchMissionFolder({ name: 'Audit BLE TRANSIT 2025' }, f);
  assert.equal(two.certain, false); assert.equal(two.candidates.length, 2);
  assert.equal(mm.matchMissionFolder({ name: 'Audit BLE TRANSIT 2025' }, f, ['a']).folder.id, 'a');
  const calls = [];
  const fetchRows = async (path, o = {}) => { calls.push({ path, body: o.body ? JSON.parse(o.body) : null }); return path.startsWith('orpailleur_inventory') && path.includes('is_folder=eq.true') ? f.map(x => ({ file_id: x.id, name: x.name, folder_path: x.path, parent_id: x.parent })) : []; };
  const r = await mm.writeMissionMemory('org', { id: 'm1', name: 'Audit BLE TRANSIT 2025', status: 'active' }, { fetchRows, drive: fakeDrive(), folder: 'om' });
  assert.equal(r.status, 'folder_unknown');
  const p = calls.find(c => c.path.startsWith('office_action_queue'));
  assert.equal(p.body[0].action_type, 'MISSION_FOLDER_LINK');
  await assert.rejects(() => mm.writeMissionMemory('org', { id: 'm1', name: 'x' }, { writer: 'sika' }), /SINGLE_WRITER/);
});

test('mission memory: written in the mission folder from the sources, Excel-shaped, indexed', async () => {
  const mm = await import('../lib/mission-memory.js');
  const drive = fakeDrive();
  drive.listChildren = async () => [{ id: 'sys', name: '00 OFFICE MANAGER', mimeType: 'application/vnd.google-apps.folder' }];
  const patches = [];
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'PATCH') { patches.push(JSON.parse(o.body)); return []; }
    if (path.startsWith('office_mission_assignments')) return [{ staff_profile_id: 's1', mission_role: 'chef de mission', planned_start: '2026-01-05', planned_end: '2026-02-20', status: 'active' }];
    if (path.startsWith('office_staff_profiles')) return [{ id: 's1', full_name: 'Awa K.', title: 'Senior' }];
    if (path.startsWith('office_action_queue')) return [{ id: 'q1', agent_key: 'grand-controleur', action_type: 'PBC_EXTERNAL_REMINDER', summary: 'Relance PBC', status: 'proposed' }];
    return [];
  };
  const central = { 'OFFICE_MANAGER_MISSION_FILES.json': { missions: { m1: { documents: [{ name: 'Lettre.pdf', role: 'lettre_de_mission', summary: 's' }] } } },
    'OFFICE_MANAGER_ENGAGEMENTS.json': { engagements: { m1: { status: 'done', tdr: { client: 'BLE TRANSIT', industry: 'Transport', engagement_type: 'Audit légal' }, match: { requirements: [{ capability: 'IFRS 16', internal: 'non', gap: true }] } } } },
    'OFFICE_MANAGER_ENHANCED_AUDITOR.json': { reviews: { m1: { status: 'done', summary: '1 non couvert', coverage: [{ risk_id: 'R1', risk: 'Reconnaissance du revenu', level: 'élevé', verdict: 'non couvert', missing_procedures: ['cut-off'] }] } } } };
  const r = await mm.writeMissionMemory('org', { id: 'm1', name: 'Audit BLE TRANSIT 2025', status: 'active', drive_folder_id: 'MF' }, { fetchRows, drive, folder: 'om', central });
  assert.equal(r.status, 'written'); assert.equal(r.folder.id, 'sys'); assert.equal(r.folder.reused, true);
  const mem = r.memory;
  assert.equal(mem.mission.status, 'fieldwork'); assert.equal(mem.mission.client, 'BLE TRANSIT');
  assert.deepEqual(mem.tables.team.columns.slice(0, 3), ['person', 'title', 'role']);
  assert.equal(mem.tables.team.rows[0][0], 'Awa K.');
  assert.equal(mem.tables.open_actions.rows.length, 1);
  assert.equal(mem.tables.risks.rows[0][4], 'non couvert');
  assert.ok(patches.some(p => p.memory_file_id && p.client_name === 'BLE TRANSIT'));
  // Closed: learnings from the memory itself.
  const l = mm.learningsFrom({ ...mem, mission: { ...mem.mission, planned_end: '2026-02-20', closed_at: '2026-04-01T00:00:00Z' } });
  assert.ok(l.some(x => x.category === 'cycle_duration')); assert.ok(l.some(x => x.category === 'risk')); assert.ok(l.some(x => x.category === 'training_need'));
  const c = mm.compactMemory(mem);
  assert.deepEqual(c.gaps, ['IFRS 16']); assert.equal(c.uncovered_risks.length, 1);
});

test('learnings: observed once, confirmed at the second mission, rejected stays rejected', async () => {
  const { recordLearnings } = await import('../lib/mission-memory.js');
  const db = [];
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'POST') { db.push({ id: 'L' + db.length, ...JSON.parse(o.body)[0] }); return []; }
    if (o.method === 'PATCH') { const id = /&id=eq\.([^&]+)/.exec(path)[1]; Object.assign(db.find(x => x.id === id), JSON.parse(o.body)); return []; }
    const key = decodeURIComponent(/key=eq\.([^&]+)/.exec(path)[1]); return db.filter(x => x.key === key);
  };
  const item = { category: 'risk', key: 'non-couvert:revenu', statement: 'Revenu mal couvert' };
  await recordLearnings('org', 'm1', [item], { fetchRows });
  assert.equal(db[0].status, 'observed');
  await recordLearnings('org', 'm1', [item], { fetchRows });
  assert.equal(db[0].occurrences, 1);
  await recordLearnings('org', 'm2', [item], { fetchRows });
  assert.equal(db[0].status, 'confirmed'); assert.equal(db[0].occurrences, 2);
  const missing = await recordLearnings('org', 'm3', [item], { fetchRows: async () => { throw new Error('relation "office_learnings" does not exist'); } });
  assert.equal(missing.migration_missing, true);
});

test('executor: a validated status change follows the lifecycle; closing builds the final memory', async () => {
  const { executeDecision } = await import('../lib/action-executor.js');
  const calls = [];
  let status = 'active';
  const fetchRows = async (path, o = {}) => {
    calls.push({ path, body: o.body ? JSON.parse(o.body) : null });
    if (path.includes('status=in.(proposed')) return [{ id: 'a1' }];
    if (path.startsWith('office_missions') && !o.method) return [{ id: 'm1', status }];
    return [];
  };
  const refused = await executeDecision('org', { id: 'a1', action_type: 'MISSION_UPDATE', payload: { kind: 'status_change', mission_id: 'm1', status: 'archived' } }, 'approve', 'Paul', { fetchRows });
  assert.equal(refused.executed, false);
  let closed = null;
  const r = await executeDecision('org', { id: 'a1', action_type: 'MISSION_UPDATE', payload: { kind: 'status_change', mission_id: 'm1', status: 'closed' } }, 'approve', 'Paul', { fetchRows, closeMission: async (o, id) => { closed = id; return { memory: 'written', learnings: { recorded: [{}] } }; } });
  assert.equal(r.executed, true); assert.equal(closed, 'm1');
  const patch = calls.find(c => c.path.startsWith('office_missions') && c.body?.status === 'closed');
  assert.ok(patch.body.closed_at && patch.body.status_changed_at);
  const link = await executeDecision('org', { id: 'a1', action_type: 'MISSION_FOLDER_LINK', payload: { mission_id: 'm1', folder_id: 'F1', folder_path: '/Clients/X' } }, 'approve', 'Paul', { fetchRows });
  assert.equal(link.executed, true);
  assert.ok(calls.some(c => c.body?.drive_folder_id === 'F1'));
  // Re-execution after a crash: no second approval, the work is done.
  calls.length = 0;
  const again = await executeDecision('org', { id: 'a1', action_type: 'MISSION_FOLDER_LINK', payload: { mission_id: 'm1', folder_id: 'F1' } }, 'approve', 'x', { fetchRows, reexecute: true });
  assert.equal(again.executed, true);
  assert.ok(!calls.some(c => c.path.includes('status=in.(proposed')));
});

test('recovery: stale runs failed, interrupted actions retried then blocked, silent jobs relaunched then failed', async () => {
  const rec = await import('../lib/recovery.js');
  const now = new Date('2026-10-08T12:00:00Z');
  const calls = [];
  const fetchRows = async (path, o = {}) => {
    calls.push({ path, method: o.method || 'GET', body: o.body ? JSON.parse(o.body) : null });
    if (path.startsWith('office_agent_runs') && !o.method) return [{ id: 'r1', agent_key: 'sika' }];
    if (path.startsWith('office_action_queue') && !o.method) return [{ id: 'x1', action_type: 'MISSION_FOLDER_LINK', payload: {} }, { id: 'x2', action_type: 'FILE_MOVE', payload: {} }];
    return [];
  };
  assert.equal(await rec.recoverRuns('org', now, { fetchRows }), 1);
  assert.equal(calls.find(c => c.method === 'PATCH').body.status, 'failed');
  let mem = { checkpoint: { action_retries: { x2: 3 } } };
  const agentMemory = { loadAgentMemory: async () => ({ memory: mem }), writeAgentMemory: async (a, f) => { mem = f(structuredClone(mem)); return mem; } };
  const done = await rec.recoverActions('org', now, { fetchRows, agentMemory, execute: async () => ({ executed: false, effect: 'non' }) });
  assert.equal(done.find(x => x.id === 'x2').blocked, true);
  assert.equal(done.find(x => x.id === 'x1').retry, 1);
  assert.equal(mem.checkpoint.action_retries.x1, 1);
  assert.ok(calls.some(c => c.body?.work_state === 'blocked'));
  // Jobs: one silent for 20 min is relaunched, one at its 3rd retry is failed, a recent one is left alone.
  const files = {
    'OFFICE_MANAGER_ENGAGEMENTS.json': { engagements: { a: { status: 'running', updated_at: '2026-10-08T11:40:00Z', log: [] }, b: { status: 'running', updated_at: '2026-10-08T11:40:00Z', recovery_retries: 3 }, c: { status: 'running', updated_at: '2026-10-08T11:58:00Z' } } }
  };
  const fired = [];
  const out = await rec.recoverJobs('org', {}, now, { updateJsonFile: async (name, f) => { if (files[name]) { const n = f(structuredClone(files[name])); if (n) files[name] = n; } return {}; }, fire: async (req, path, body) => fired.push([path, body]) });
  assert.deepEqual(fired, [['/api/app?route=engagement-step', { mission_id: 'a' }]]);
  assert.equal(files['OFFICE_MANAGER_ENGAGEMENTS.json'].engagements.b.status, 'failed');
  assert.equal(files['OFFICE_MANAGER_ENGAGEMENTS.json'].engagements.c.recovery_retries, undefined);
  assert.ok(out.some(x => x.failed));
});

test('recovery: a pass becomes a success only when its work really finished', async () => {
  const rec = await import('../lib/recovery.js');
  const now = new Date('2026-10-08T12:00:00Z');
  const mems = { orpailleur: { status: 'running', current: { started_at: '2026-10-08T11:00:00Z' }, heartbeat_at: '2026-10-08T11:00:00Z' },
    'grand-controleur': { status: 'running', current: { started_at: '2026-10-08T11:50:00Z' }, heartbeat_at: '2026-10-08T11:50:00Z' },
    sika: { status: 'running', current: { started_at: '2026-10-08T10:00:00Z' }, heartbeat_at: '2026-10-08T10:00:00Z' } };
  const ended = {};
  const agentMemory = { loadAgentMemory: async a => ({ memory: mems[a] }), endPass: async (a, v) => { ended[a] = v; } };
  const fetchRows = async path => path.includes('agent_key=eq.grand-controleur') ? [{ id: 'run9', status: 'running' }] : [];
  const r = await rec.settleAgentMemories('org', now, { fetchRows, agentMemory, audit: async () => ({}),
    loadJsonFile: async () => ({ state: { mode: 'changes', status: 'done', finished_at: '2026-10-08T11:30:00Z', last_pass_at: '2026-10-08T11:00:00Z' } }) });
  assert.equal(ended.orpailleur.ok, true); assert.deepEqual(ended.orpailleur.checkpoint.last_pass_at, '2026-10-08T11:00:00Z');
  assert.equal(ended['grand-controleur'], undefined);           // still working: nothing decided
  assert.equal(ended.sika.ok, false);                           // 2 hours without an end: interrupted
  assert.equal(r.orpailleur, 'réussi');
});

test('passes: the memory hooks see the start and the failure; the Orpailleur restarts from its last SUCCESSFUL pass', async () => {
  const { startPass } = await import('../lib/agent-passes.js');
  const seen = [];
  const hooks = { beginPass: async a => seen.push(['begin', a]), endPass: async (a, v) => seen.push(['end', a, v.ok]), audit: async (o, e) => seen.push(['audit', e.status]) };
  const fetchRows = async (path, o = {}) => path.startsWith('office_agent_passes?on_conflict') ? [{ id: 'p1', agent_key: 'sika', slot: '2026-10-08 08:00' }] : [];
  const r = await startPass('org', 'sika', '2026-10-08 08:00', {}, { fetchRows, memoryHooks: hooks, fireInternal: async () => { throw new Error('down'); } });
  assert.ok(r.failed);
  assert.deepEqual(seen.map(x => x[0]), ['begin', 'end', 'audit']);
  assert.equal(seen[1][2], false);
  let since = null;
  const rows = async (path, o = {}) => {
    if (path.startsWith('office_agent_passes?on_conflict')) return [{ id: 'p9', agent_key: 'orpailleur', slot: '2026-10-08 12:00' }];
    if (path.includes('order=started_at.desc')) return [{ id: 'p8', status: 'failed', started_at: '2026-10-08T08:00:00Z' }, { id: 'p7', status: 'done', started_at: '2026-10-07T20:00:00Z' }];
    return [];
  };
  await startPass('org', 'orpailleur', '2026-10-08 12:00', {}, { fetchRows: rows, memoryHooks: null, startChangesPass: null,
    createRequest: async (org, b) => { since = b.since; return { id: 't1' }; }, startDriveScan: async () => false, fireInternal: async () => true });
  assert.equal(since, '2026-10-07T20:00:00Z');
});
