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

test('client folder: found from the client name or the mission folder; a proposal when unsure', async () => {
  const mm = await import('../lib/mission-memory.js');
  assert.deepEqual(mm.clientTokens({ name: 'Audit légal BLE TRANSIT 2025' }), ['ble', 'transit']);
  assert.deepEqual(mm.clientTokens({ name: 'x', client_name: 'Mines du Sud SA' }), ['mines', 'sud']);
  const f = [{ id: 'r', name: 'Clients', parent: null, path: '/Clients' }, { id: 'c', name: 'BLE TRANSIT', parent: 'r', path: '/Clients/BLE TRANSIT' },
    { id: 'p', name: '01 Dossier permanent', parent: 'c', path: '/Clients/BLE TRANSIT/01 Dossier permanent' },
    { id: 'y', name: '2025', parent: 'c', path: '/Clients/BLE TRANSIT/2025' }, { id: 'a', name: 'Audit', parent: 'y', path: '/Clients/BLE TRANSIT/2025/Audit' }];
  const want = mm.clientTokens({ name: 'Audit BLE TRANSIT 2025' });
  assert.equal(mm.matchClientFolder(want, f).folder.id, 'c');
  const twin = [...f, { id: 'c2', name: 'BLE TRANSIT', parent: 'z', path: '/Archives/BLE TRANSIT' }];
  assert.equal(mm.matchClientFolder(want, twin).certain, false);
  assert.equal(mm.matchClientFolder(want, twin, 'a').folder.id, 'c');      // the mission's folder decides
  assert.equal((await mm.permanentFolder(f[1], f)).id, 'p');
  assert.equal((await mm.permanentFolder({ id: 'y', name: '2025' }, f, { drive: { listChildren: async () => [] } })).id, 'y');
  // The mission folder matching keeps working as before.
  assert.equal(mm.matchMissionFolder({ name: 'Audit BLE TRANSIT 2025' }, f).folder.id, 'a');
  const calls = [];
  const fetchRows = async (path, o = {}) => { calls.push({ path, body: o.body ? JSON.parse(o.body) : null }); return path.startsWith('orpailleur_inventory') && path.includes('is_folder=eq.true') ? twin.map(x => ({ file_id: x.id, name: x.name, folder_path: x.path, parent_id: x.parent })).filter(x => x.file_id !== 'a') : []; };
  const r = await mm.writeMissionMemory('org', { id: 'm1', name: 'Revue BLE TRANSIT 2026', status: 'planned' }, { fetchRows, drive: fakeDrive(), folder: 'om', central: {} });
  assert.equal(r.status, 'folder_unknown');
  const p = calls.find(c => c.path.startsWith('office_action_queue') && c.body);
  assert.equal(p.body[0].action_type, 'MISSION_FOLDER_LINK'); assert.equal(p.body[0].payload.kind, 'client');
  await assert.rejects(() => mm.writeMissionMemory('org', { id: 'm1', name: 'x' }, { writer: 'sika' }), /SINGLE_WRITER/);
});

test('client memory: one permanent file per client, a new mission is added to it', async () => {
  const mm = await import('../lib/mission-memory.js');
  const drive = fakeDrive();
  const children = { CF: [{ id: 'DP', name: 'Dossier permanent', mimeType: 'application/vnd.google-apps.folder' }], DP: [] };
  drive.listChildren = async id => children[id] || [];
  const tidy = { async findOrCreateFolder(parent, name) { const f = { id: parent + '/' + name, name, mimeType: 'application/vnd.google-apps.folder' }; (children[parent] ||= []).push(f); return f; } };
  const patches = [];
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'PATCH') { patches.push(JSON.parse(o.body)); return []; }
    if (path.startsWith('office_mission_assignments')) return [{ staff_profile_id: 's1', mission_role: 'chef de mission', planned_start: '2026-01-05', planned_end: '2026-02-20', status: 'active' }];
    if (path.startsWith('office_staff_profiles')) return [{ id: 's1', full_name: 'Awa K.', title: 'Senior' }];
    if (path.startsWith('office_action_queue')) return [{ id: 'q1', agent_key: 'grand-controleur', action_type: 'PBC_EXTERNAL_REMINDER', summary: 'Relance PBC', status: 'proposed' }];
    return [];
  };
  const cov = [{ risk_id: 'R1', risk: 'Reconnaissance du revenu', level: 'élevé', verdict: 'non couvert', missing_procedures: ['cut-off'] }];
  const central = { 'OFFICE_MANAGER_MISSION_FILES.json': { missions: { m1: { documents: [{ name: 'Lettre.pdf', role: 'lettre_de_mission', summary: 's' }] } } },
    'OFFICE_MANAGER_ENGAGEMENTS.json': { engagements: { m1: { status: 'done', tdr: { client: 'BLE TRANSIT', industry: 'Transport', engagement_type: 'Audit légal' }, match: { requirements: [{ capability: 'IFRS 16', internal: 'non', gap: true }] } } } },
    'OFFICE_MANAGER_ENHANCED_AUDITOR.json': { reviews: { m1: { status: 'done', summary: '1 non couvert', coverage: cov }, m2: { status: 'done', coverage: cov } } } };
  const d = { fetchRows, drive, folder: 'om', central, tidyDrive: tidy, folders: [] };
  const r = await mm.writeMissionMemory('org', { id: 'm1', name: 'Audit BLE TRANSIT 2025', status: 'completed', client_folder_id: 'CF', planned_start: '2025-01-05' }, d);
  assert.equal(r.status, 'written'); assert.equal(r.permanent.id, 'DP'); assert.equal(r.folder.id, 'DP/00_OFFICE_MANAGER');
  const mem = r.memory;
  assert.equal(mem.mission.status, 'closed'); assert.equal(mem.mission.client, 'BLE TRANSIT');
  assert.equal(mem.tables.team.rows[0][0], 'Awa K.');
  assert.equal(mem.tables.risks.rows[0][4], 'non couvert');
  assert.ok(patches.some(p => p.memory_file_id && p.client_name === 'BLE TRANSIT'));
  // Next year: SAME file, a second section, the permanent part updated (recurring risk).
  const r2 = await mm.writeMissionMemory('org', { id: 'm2', name: 'Audit BLE TRANSIT 2026', status: 'planned', client_folder_id: 'CF', planned_start: '2026-01-05' }, d);
  assert.equal(r2.file_id, r.file_id);
  const file = r2.client_memory;
  assert.deepEqual(Object.keys(file.missions).sort(), ['m1', 'm2']);
  assert.equal(file.permanent.client, 'BLE TRANSIT');
  assert.equal(file.permanent.missions_history.length, 2);
  assert.equal(file.permanent.recurring_risks[0].missions, 2);
  // Reading one mission gives its section with the client's permanent part.
  const one = mm.missionSectionOf(file, 'm1');
  assert.equal(one.mission.id, 'm1'); assert.equal(one.client_permanent.client, 'BLE TRANSIT');
  assert.equal(mm.compactMemory(one).client_permanent.recurring_risks.length, 1);
  // Prior year for the 2026 mission, read from the same file.
  const prior = await mm.priorMissionMemories('org', { id: 'm2', name: 'Audit BLE TRANSIT 2026', client_name: 'BLE TRANSIT' },
    { drive, fetchRows: async () => [{ id: 'm1', name: 'Audit BLE TRANSIT 2025', status: 'completed', client_name: 'BLE TRANSIT', memory_file_id: r.file_id }] });
  assert.equal(prior.length, 1); assert.equal(prior[0].mission.id, 'm1');
  // Closed: learnings from the memory itself.
  const l = mm.learningsFrom({ ...mem, mission: { ...mem.mission, planned_end: '2026-02-20', closed_at: '2026-04-01T00:00:00Z' } });
  assert.ok(l.some(x => x.category === 'cycle_duration')); assert.ok(l.some(x => x.category === 'risk')); assert.ok(l.some(x => x.category === 'training_need'));
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

test('cockpit: each KPI says what, how, sources and lists its elements', async () => {
  const { cockpitFrom } = await import('../lib/cockpit.js');
  const now = Date.parse('2026-10-08T10:00:00Z');
  const c = cockpitFrom({ missions: [{ id: 'm1', name: 'A', status: 'active', planned_start: '2026-01-01', planned_end: '2026-09-01' }, { id: 'm2', name: 'B', status: 'proposal' }, { id: 'm3', name: 'C', status: 'active', planned_start: '2026-12-01' }, { id: 'm4', name: 'D', status: 'cancelled' }],
    staff: [{ id: 's', full_name: 'Awa' }], assignments: [{ staff_profile_id: 's', office_mission_id: 'm1', allocation_pct: 80, planned_start: '2026-10-01', planned_end: '2026-12-01' }, { staff_profile_id: 's', office_mission_id: 'm2', allocation_pct: 50, planned_start: '2026-11-01', planned_end: '2026-12-31' }],
    actions: [{ id: 'a', action_type: 'PBC_EXTERNAL_REMINDER', summary: 'PBC', status: 'proposed', office_mission_id: 'm1', due_at: '2026-10-01' }],
    reviews: { m1: { coverage: [{ risk: 'Revenu', level: 'élevé', verdict: 'partiellement couvert' }, { risk: 'Stocks', level: 'élevé', verdict: 'couvert' }] } },
    mails: [{ id: 'g', subject: 'x', importance: 'haute', deadline: '2026-10-10' }] }, now);
  const k = Object.fromEntries(c.kpis.map(x => [x.key, x]));
  assert.equal(k.missions_running.value, 1); assert.equal(k.missions_waiting.value, 1); assert.equal(k.missions_won.value, 1);
  assert.equal(k.risks.value, 1); assert.equal(k.pbc_missing.value, 1); assert.equal(k.conflicts.value, 1);
  assert.equal(k.delays.value, 2); assert.equal(k.mails.value, 1);
  for (const x of c.kpis) { assert.ok(x.measured && x.method && x.sources.length, x.key); assert.ok(Array.isArray(x.items)); }
});

test('search: « grand livre BLE TRANSIT » finds the ledger of that client, by name or by what was read in it', async () => {
  const s = await import('../lib/smart-search.js');
  const missions = [{ id: 'm1', name: 'BLE TRANSIT — Audit 2025', status: 'active', client_name: 'BLE TRANSIT' }, { id: 'm2', name: 'Nova — CAC 2025', status: 'completed' }, { id: 'm3', name: 'BLE TRANSIT — Audit 2024', status: 'completed', client_name: 'BLE TRANSIT' }];
  const q = s.words('grand livre BLE TRANSIT');
  const named = s.missionTerms(q, missions);
  assert.deepEqual(named.missions.map(m => m.id), ['m1', 'm3']);
  const groups = s.documentTerms(q.filter(w => !named.used.has(w)));
  assert.equal(groups.length, 1); assert.ok(groups[0].alts.includes('general ledger'));
  const docs = [
    { file_id: 'f1', name: 'GL_2025.xlsx', path: '/Clients/BLE TRANSIT/2025/GL_2025.xlsx' },
    { file_id: 'f2', name: 'export_sage.xlsx', path: '/Clients/BLE TRANSIT/2025/export_sage.xlsx', doc_type: 'grand livre', summary: 'Grand livre général 2025 de BLE TRANSIT' },
    { file_id: 'f3', name: 'Grand livre.xlsx', path: '/Clients/Nova/2025/Grand livre.xlsx' },
    { file_id: 'f4', name: 'Balance.xlsx', path: '/Clients/BLE TRANSIT/2025/Balance.xlsx' }];
  const r = s.rankDocuments(docs, groups, named.missions);
  assert.deepEqual(r.map(x => x.file_id).sort(), ['f1', 'f2']);
  // « 2024 » asked: only the 2024 mission.
  assert.deepEqual(s.missionTerms(s.words('grand livre BLE TRANSIT 2024'), missions).missions.map(m => m.id), ['m3']);
  // Filters: status and mission are optional.
  assert.equal(s.statusFilter('en_cours')('active'), true); assert.equal(s.statusFilter('active')('proposal'), true); assert.equal(s.statusFilter('terminee')('completed'), true);
  const out = await s.smartSearch('org', { q: 'grand livre BLE TRANSIT', status: 'toutes' }, { fetchRows: async p => p.startsWith('office_missions') ? missions : [], drive: {}, folder: 'om',
    loadFileIndex: async () => ({ f2: { id: 'f2', name: 'export_sage.xlsx', path: '/Clients/BLE TRANSIT/2025/export_sage.xlsx', doc_type: 'grand livre', summary: 'Grand livre 2025', parent: 'P' } }), loadScan: async () => ({ state: { items: [] } }) });
  assert.equal(out.results.documents[0].file_id, 'f2');
  assert.match(out.results.documents[0].web_url, /^https:\/\/drive\.google\.com\/file\/d\/f2/);
  assert.match(out.results.documents[0].folder_url, /folders\/P/);
  assert.deepEqual(out.understood.document, ['grand livre']);
});

test('missions: phase, planned time, automatic status proposals', async () => {
  const f = await import('../lib/mission-full.js');
  assert.equal(f.phaseOf({ status: 'proposal' }).key, 'waiting');
  assert.equal(f.phaseOf({ status: 'won' }).key, 'won');
  assert.equal(f.phaseOf({ status: 'active', planned_start: '2999-01-01' }, '2026-10-08').key, 'won');
  assert.equal(f.phaseOf({ status: 'active', planned_start: '2026-01-01' }, '2026-10-08').key, 'running');
  assert.equal(f.workingDays('2026-10-05', '2026-10-11'), 5);
  const tb = f.timeBudget({ planned_start: '2026-10-05', planned_end: '2026-10-16' }, [{ full_name: 'A', allocation_pct: 50 }, { full_name: 'B', allocation_pct: 100, planned_start: '2026-10-05', planned_end: '2026-10-09' }], { budget_or_days: '12 jours-homme' });
  assert.equal(tb.planned_days, 10); assert.equal(tb.budget_days, 12); assert.equal(tb.gap_days, -2);
  const mm = await import('../lib/mission-memory.js');
  assert.equal(mm.autoStatusFor({ status: 'proposal' }, [{ role: 'lettre_de_mission', name: 'LM.pdf' }]).to, 'acceptance');
  assert.equal(mm.autoStatusFor({ status: 'planned', planned_start: '2026-10-01' }, [], '2026-10-08').to, 'fieldwork');
  assert.equal(mm.autoStatusFor({ status: 'active', planned_start: '2026-10-01' }, [], '2026-10-08'), null);
});

test('mission contacts and writing to the client: proposed contacts, suggested recipients', async () => {
  const w = await import('../lib/mission-write.js');
  const contacts = [{ email: 'cfo@c.ci', role_key: 'cfo', status: 'validé', name: 'Jean' }, { email: 'achats@c.ci', role_key: 'achats', status: 'validé', name: 'Fatou' }, { email: 'x@c.ci', role_key: 'ventes', status: 'proposé' }];
  const s = w.suggestRecipients({ purpose: 'pbc', cycle: 'achats' }, contacts, [{ email: 'awa@f.ci', name: 'Awa', role: 'Chef de mission' }], { sender_email: 'agent@f.ci', agent_display_name: 'Office Manager' });
  assert.deepEqual(s.to.map(x => x.email), ['achats@c.ci']);
  assert.deepEqual(s.cc.map(x => x.email), ['cfo@c.ci', 'awa@f.ci', 'agent@f.ci']);
  const v = w.suggestRecipients({ purpose: 'ventes', cycle: 'ventes' }, contacts, [], null);
  assert.deepEqual(v.to.map(x => x.email), ['cfo@c.ci']);      // a proposed contact is never used: the CFO is the fallback
  assert.match(w.meetingLink('BLE TRANSIT — Audit'), /^https:\/\/meet\.jit\.si\/OM-ble-transit-audit-[0-9a-f]{8}$/);
  const md = await import('../lib/mission-data.js');
  let file = null;
  const upd = async (n, f) => { const r = f(file ? structuredClone(file) : null); if (r) file = r; return {}; };
  const M = 'aaaaaaaa-1111-4111-8111-111111111111';
  await md.addContacts('org', M, [{ name: 'Jean K', role: 'Directeur financier', email: 'CFO@c.ci', source: 'TDR' }, { name: 'Ama', role: 'responsable des achats' }], 'Mission Controller', { updateJsonFile: upd });
  assert.equal(file.missions[M].contacts[0].role_key, 'cfo'); assert.equal(file.missions[M].contacts[0].status, 'proposé'); assert.equal(file.missions[M].contacts[0].email, 'cfo@c.ci');
  assert.equal(file.missions[M].contacts[1].role_key, 'achats');
  const patched = [];
  await md.decideContact('org', M, file.missions[M].contacts[0].id, 'validate', 'Paul', { updateJsonFile: upd, fetchRows: async (p, o = {}) => { if (o.method) { patched.push(JSON.parse(o.body)); return []; } return [{ id: M, client_contact_emails: [] }]; } });
  assert.equal(file.missions[M].contacts[0].status, 'validé'); assert.deepEqual(patched[0].client_contact_emails, ['cfo@c.ci']);
  const fact = await md.addFact(M, { kind: 'risque', label: 'Litige fiscal', value: 'Redressement 2024 en cours', agent: 'enhanced-auditor' }, { updateJsonFile: upd });
  assert.equal(file.missions[M].facts[0].agent, 'enhanced-auditor'); assert.equal(fact.kind, 'risque');
});

test('team recommendation: two independent judgements, agreement shown, nobody assigned', async () => {
  const p = await import('../lib/people-cards.js');
  const c = p.consolidateJudgements([
    { provider: 'anthropic', team: [{ name: 'Awa Koné', role: 'Chef de mission', why: 'SYSCOHADA, secteur', risks: [] }, { name: 'Yao K', role: 'Assistant', why: 'disponible' }], risks: [{ type: 'charge', message: 'Awa à 90 %' }], confidence: 'haute' },
    { provider: 'openai', team: [{ name: 'awa kone', role: 'Senior', why: 'expérience transport', risks: ['charge élevée'] }, { name: 'Marie D', role: 'Assistant', why: 'IT' }], alternatives: [{ name: 'Marie D', instead_of: 'Yao K', why: 'audit IT' }] }]);
  assert.equal(c.team[0].agreement, 'les deux jugements'); assert.deepEqual(c.team[0].agreed_by, ['anthropic', 'openai']);
  assert.equal(c.team.filter(t => t.agreement === 'un seul jugement').length, 2);
  assert.equal(c.risks[0].by, 'anthropic'); assert.equal(c.alternatives[0].by, 'openai');
  assert.equal(c.judgements.length, 2);
});

test('chat: no validation, direct conversations readable only by the two people, 24 h then archived', async () => {
  const c = await import('../lib/chat.js');
  const paul = { email: 'Paul@taty.ci', display_name: 'Paul' }, awa = { email: 'awa@taty.ci' }, yao = { email: 'yao@taty.ci' };
  const k = c.directKey('awa@taty.ci', 'PAUL@taty.ci');
  assert.equal(k, 'dm:awa@taty.ci|paul@taty.ci');
  assert.equal(c.canUse(k, paul), true); assert.equal(c.canUse(k, awa), true); assert.equal(c.canUse(k, yao), false);
  assert.equal(c.canUse('cabinet', yao), true);
  const rows = [];
  const fetchRows = async (path, o = {}) => { if (o.method === 'POST') { const r = JSON.parse(o.body)[0]; rows.push(r); return [r]; } if (o.method === 'PATCH') { rows.push({ patch: path, body: JSON.parse(o.body) }); return []; } return []; };
  const sent = await c.sendChat('org', paul, { to: 'awa@taty.ci', body: 'Bonjour' }, { fetchRows });
  assert.equal(sent.conversation, k); assert.equal(rows[0].sender_email, 'paul@taty.ci');
  await assert.rejects(() => c.sendChat('org', yao, { conversation: k, body: 'x' }, { fetchRows }), /CONVERSATION_FORBIDDEN/);
  await c.archiveOldChat('org', { fetchRows, now: () => Date.parse('2026-10-08T12:00:00Z') });
  assert.match(rows.at(-1).patch, /created_at=lt\.2026-10-07T12%3A00/); assert.equal(rows.at(-1).body.archived, true);
  const missing = await c.chatState('org', paul, {}, { fetchRows: async p => { if (p.startsWith('office_chat_messages')) throw new Error('relation "office_chat_messages" does not exist'); return []; } });
  assert.equal(missing.available, false);
});

test('assistant: a saved plan feeds the mission, external specialists are proposed then chosen', async () => {
  const { integratePlan } = await import('../lib/plan-integration.js');
  const M = 'aaaaaaaa-1111-4111-8111-111111111111';
  const facts = [], posts = []; let structured = null;
  const r = await integratePlan('org', M, { content: 'Plan' }, 'Paul', {
    fetchRows: async (p, o = {}) => { if (o.method === 'POST') { posts.push(JSON.parse(o.body)[0]); return []; } if (p.startsWith('office_missions')) return [{ id: M, name: 'BLE', planned_start: '2026-11-01', planned_end: '2027-01-31' }]; if (p.startsWith('office_staff_profiles')) return [{ id: 's1', full_name: 'Awa Koné' }]; return []; },
    ai: async () => ({ provider: 'anthropic', text: JSON.stringify({ briefing: { objectives: ['Certifier'], scope: 'Comptes 2026' }, risks: [{ risk: 'Revenu', level: 'élevé' }], skills: [{ capability: 'IFRS 16' }], deadlines: [{ what: 'Rapport', due: '2027-02-15' }, { what: 'sans date', due: 'bientôt' }], documents_needed: [{ document: 'Grand livre', cycle: 'Achats' }], team: [{ person: 'Awa Koné', role: 'Chef de mission' }, { person: 'Inconnu', role: 'x' }] }) }),
    addFact: async (id, f) => { facts.push(f); return f; }, mergeStructured: async (id, x) => { structured = x; return {}; } });
  assert.equal(r.risks, 1); assert.equal(r.deadlines, 1); assert.equal(r.documents, 1); assert.equal(r.team_proposed, 1); assert.equal(r.briefing, true);
  assert.ok(facts.every(f => /Assistant/.test(f.agent)));
  assert.equal(posts[0].status, 'proposed'); assert.equal(structured.skills[0].capability, 'IFRS 16');
  const ex = await import('../lib/external-specialists.js');
  const found = await ex.searchSpecialists('org', { gap: 'Audit IT' }, { research: async () => ({ web: true, provider: 'openai', text: JSON.stringify({ specialists: [{ name: 'Cabinet X', speciality: 'Audit SI', country: 'CI', source: 'https://x.ci', contact: 'contact@x.ci', why: 'références' }, { name: '' }] }) }) });
  assert.equal(found.specialists.length, 1); assert.equal(found.specialists[0].status, 'proposé');
  const msg = await ex.draftOutreach('org', { specialist: found.specialists[0], gap: 'Audit IT' }, { display_name: 'Paul' }, { ai: async () => ({ text: '{"subject":"Collaboration","body":"Bonjour"}' }) });
  assert.equal(msg.to, 'contact@x.ci'); assert.match(msg.mailto, /^mailto:contact%40x\.ci\?subject=Collaboration/);
});
