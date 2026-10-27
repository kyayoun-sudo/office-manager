import test from 'node:test';
import assert from 'node:assert/strict';
import { completedLearningView, completedLearningAction } from '../lib/completed-mission-learning.js';
import { emptyLab, mergeLesson, mergeLabs } from '../lib/shadow.js';
import { localAgentLessons } from '../lib/agent-learning-context.js';
import { runInFirm } from '../lib/firm-context.js';
import { ROUTES } from '../api/app.js';

const owner = { role: 'owner', email: 'owner@example.test' };
function fixture() {
  let state = emptyLab(), answer = {}, documentsWritten = [], notes = [], transmitted = [], calls = 0;
  const missions = [], versions = {}, files = {
    ROOT: { id: 'ROOT', mimeType: 'application/vnd.google-apps.folder' },
    F: { id: 'F', name: 'Ancienne mission', mimeType: 'application/vnd.google-apps.folder', parents: ['ROOT'] },
    A: { id: 'A', name: 'scan', mimeType: 'text/plain', parents: ['F'] },
    B: { id: 'B', name: 'inconnu', mimeType: 'text/plain', parents: ['F'] }
  };
  const d = { folder: 'MEM', root: () => 'ROOT', permissions: async () => ({ granted: true }),
    readState: async () => ({ state: structuredClone(state) }),
    updateState: async (_, fn) => { const next = fn(structuredClone(state)); state = next; return { state, written: true }; },
    fetchRows: async (path, opts) => {
      if (opts?.method === 'POST') { const row = JSON.parse(opts.body); if (!missions.some(m => m.id === row.id)) missions.push(row); return []; }
      const folder = path.match(/drive_folder_id=eq\.([^&]+)/)?.[1], id = path.match(/&id=eq\.([^&]+)/)?.[1];
      return missions.filter(m => (!folder || m.drive_folder_id === folder) && (!id || m.id === id));
    },
    drive: { getMeta: async id => files[id] ? { ...files[id], modifiedTime: versions[id] || 'v1' } : null,
      listChildren: async id => Object.values(files).filter(f => f.parents?.includes(id)) },
    readWindow: async (doc, _, request) => ({ file_id: doc.id, revision: (versions[doc.id] || 'v1') + '||', window: { text: 'SOP : rapprocher les valeurs et conserver la référence source.', request } }),
    ai: async (_, req) => { calls++; const inp = JSON.parse(req.input); return { provider: 'mock', text: JSON.stringify(typeof answer === 'function' ? answer(inp) : answer) }; },
    recordDocuments: async (m, docs) => { documentsWritten.push({ m, docs }); },
    noteMission: async (...args) => { notes.push(args); },
    sendLesson: async payload => { transmitted.push(payload); return { stored: true, id: payload.id }; }, labReady: () => true
  };
  const act = (body, acc = owner) => completedLearningAction('ORG', acc, body, d);
  const add = folder_id => act({ action: 'add', name: 'Mission exemple', folder_id: folder_id || 'F', completed: true });
  const step = s => act({ action: 'step', id: s.id, seq: s.seq });
  const set = v => { answer = v; };
  async function review() {
    let s = await add(); s = await step(s);
    for (const file_id of ['A', 'B']) { set({ inspect: { file_id } }); s = await step(s); s = await step(s); }
    set(input => ({ finish: { summary: 'Méthode observée dans les passages lus.', questions: ['Vérifier le reste des pages.'],
      lessons: [{ agent: 'enhanced-auditor', rule: 'Rapprocher les valeurs et conserver la référence source.', evidence: [{ window_id: input.windows[0].window_id, quote: 'rapprocher les valeurs' }] }] } }));
    return step(s);
  }
  return { d, files, versions, missions, act, add, step, set, review, state: () => state, writes: () => ({ documentsWritten, notes, transmitted, calls }) };
}

test('five-mission onboarding adds a historical folder as closed once, without running an active engagement', async () => {
  const f = fixture(); const first = await f.add(), again = await f.add();
  assert.equal(first.id, again.id); assert.equal(f.missions.length, 1); assert.equal(f.missions[0].status, 'closed');
  const view = await completedLearningView('ORG', owner, f.d);
  assert.equal(view.target, 5); assert.equal(view.validated, 0); assert.equal(view.samples.length, 1);
  for (let i = 2; i <= 5; i++) { f.files['F' + i] = { ...f.files.F, id: 'F' + i }; await f.add('F' + i); }
  f.files.F6 = { ...f.files.F, id: 'F6' };
  await assert.rejects(f.add('F6'), /FIVE_MISSIONS/); assert.equal(f.missions.length, 5);
});

test('role, processing grant, Drive ancestry and completed status protect historical learning', async () => {
  const f = fixture();
  await f.add();
  await assert.rejects(f.act({ action: 'add' }, { role: 'auditor' }), /ROLE_NOT_ALLOWED/);
  await assert.rejects(f.act({ action: 'add', folder_id: 'F' }), /COMPLETED_CONFIRMATION/);
  f.files.OUT = { ...f.files.F, id: 'OUT', parents: ['OTHER'] };
  await assert.rejects(f.add('OUT'), /OUTSIDE_FIRM/);
  f.d.permissions = async () => ({ granted: false });
  await assert.rejects(f.add(), /AGENTS_NOT_AUTHORIZED/);
  f.d.permissions = async () => ({ granted: true });
  f.missions[0].status = 'fieldwork';
  // A registered sample cannot bypass the live mission check when executing work.
  const sample = f.state().completed_learning.samples[0];
  await assert.rejects(f.step({ id: sample.id, seq: sample.seq }), /COMPLETED_MISSION_REQUIRED/);
  assert.deepEqual(f.writes().documentsWritten, []);
});

test('the AI reads badly named pieces before proposing sourced lessons; human validation feeds both memory levels', async () => {
  const f = fixture(), s = await f.review(); assert.equal(s.status, 'review');
  assert.equal(s.read, 2); assert.equal(f.writes().documentsWritten.length, 0);
  const validated = await f.act({ action: 'validate', id: s.id, seq: s.seq, confirm: true, cabinet_method: true });
  assert.equal(validated.status, 'validated'); assert.equal(validated.memory_saved, true);
  assert.equal(f.writes().documentsWritten[0].docs.length, 2); assert.equal(f.writes().notes.length, 1);
  assert.equal(f.state().lessons[0].validated_by, owner.email); assert.equal(f.state().lessons[0].mission_id, null);
  assert.equal(f.state().completed_learning.samples[0].windows.length, 0, 'temporary windows are cleared after analysis');
  assert.equal(f.writes().transmitted.length, 0, 'local validation never transmits to the Lab');
});

test('unseen documents become read requests; foreign sources and invented evidence are refused', async () => {
  const f = fixture(); let s = await f.add(); s = await f.step(s);
  f.set({ inspect: { file_id: 'FOREIGN' } }); await assert.rejects(f.step(s), /PIECE_NOT_IN_MISSION/);
  f.set({ finish: { summary: 'Tout est lu', lessons: [] } }); s = await f.step(s);
  assert.equal(s.status, 'reading'); assert.equal(f.state().completed_learning.samples[0].pending.file_id, 'A');
  s = await f.step(s); f.set({ inspect: { file_id: 'B' } }); s = await f.step(s); s = await f.step(s);
  f.set({ finish: { summary: 'Hypothèse', lessons: [{ agent: 'sika', rule: 'Inventée', evidence: [{ window_id: 'fake', quote: 'fake' }] }] } });
  await assert.rejects(f.step(s), /EVIDENCE_NOT_FOUND/);
});

test('changed source versions and stale requests stop memory promotion; restart discards old observations', async () => {
  const f = fixture(); const s = await f.review(); f.versions.A = 'v2';
  await assert.rejects(f.act({ action: 'validate', id: s.id, seq: s.seq, confirm: true }), /SOURCE_CHANGED/);
  assert.equal(f.writes().documentsWritten.length, 0);
  await assert.rejects(f.act({ action: 'restart', id: s.id, seq: s.seq - 1 }), /STALE/);
  const fresh = await f.act({ action: 'restart', id: s.id, seq: s.seq }); assert.equal(fresh.read, 0); assert.equal(fresh.status, 'cataloguing');
});

test('central contribution is a separately reviewed generic text; no source or tenant metadata crosses the boundary', async () => {
  const f = fixture(); let s = await f.review();
  s = await f.act({ action: 'validate', id: s.id, seq: s.seq, confirm: true });
  assert.equal(f.state().lessons[0].mission_id, f.missions[0].id, 'mission scope is the default');
  await assert.rejects(f.act({ action: 'prepare-share', id: s.id, seq: s.seq, text: 'Méthode', non_confidential: false }), /SHARE_REVIEW/);
  const method = 'Comparer les données sources au tableau rempli et conserver les références des contrôles.';
  s = await f.act({ action: 'prepare-share', id: s.id, seq: s.seq, text: method, non_confidential: true });
  assert.equal(f.writes().transmitted.length, 0);
  s = await f.act({ action: 'send-share', id: s.id, seq: s.seq, confirm: true });
  assert.equal(s.share.status, 'sent'); const payload = f.writes().transmitted[0];
  assert.deepEqual(Object.keys(payload).sort(), ['collection', 'id', 'metadata', 'text']);
  assert.equal(payload.text, method); assert.equal(payload.metadata.status, 'candidate');
  assert.ok(!JSON.stringify(payload).includes(f.missions[0].id)); assert.ok(!JSON.stringify(payload).includes('owner@'));
  await f.act({ action: 'send-share', id: s.id, seq: s.seq, confirm: true }); assert.equal(f.writes().transmitted.length, 1);
});

test('Lab failures remain pending and retry the same id; an unconfirmed write is never announced as sent', async () => {
  const f = fixture(); let s = await f.review(); s = await f.act({ action: 'validate', id: s.id, seq: s.seq, confirm: true });
  s = await f.act({ action: 'prepare-share', id: s.id, seq: s.seq, text: 'Rapprocher chaque donnée avec une preuve puis vérifier le résultat de la transformation.', non_confidential: true });
  const ids = []; f.d.sendLesson = async p => { ids.push(p.id); return {}; };
  s = await f.act({ action: 'send-share', id: s.id, seq: s.seq, confirm: true }); assert.equal(s.share.status, 'failed');
  f.d.sendLesson = async p => { ids.push(p.id); return { stored: true, id: p.id }; };
  s = await f.act({ action: 'send-share', id: s.id, seq: s.seq, confirm: true }); assert.equal(s.share.status, 'sent'); assert.equal(ids[0], ids[1]);
});

test('Shadow cannot merge a mission-specific lesson into another mission or the firm-wide scope', () => {
  const lab = emptyLab(), p = { agent: 'sika', lesson: 'Conserver les références des contrôles de facturation.', rule: 'Conserver les références des contrôles de facturation.' };
  const one = mergeLesson(lab, { ...p, mission_id: 'M1' });
  mergeLesson(lab, { ...p, mission_id: 'M2', same_as: one.lesson.id }); mergeLesson(lab, p);
  assert.equal(lab.lessons.length, 3);
});

test('historical training routes require a cabinet owner or partner session', () => {
  for (const verb of ['GET', 'POST']) assert.deepEqual([...ROUTES['completed-mission-learning'][verb].userRoles].sort(), ['owner', 'partner']);
});

test('reading failure remains explicit and cannot become learned knowledge', async () => {
  const f = fixture(); let s = await f.add(); s = await f.step(s);
  f.set({ inspect: { file_id: 'A' } }); s = await f.step(s);
  f.d.readWindow = async () => { throw Error('OCR_UNAVAILABLE'); }; s = await f.step(s);
  assert.equal(s.read, 0); assert.equal(s.errors[0].error, 'OCR_UNAVAILABLE');
  f.set({ finish: { summary: 'Lecture impossible', lessons: [] } }); s = await f.step(s);
  assert.equal(s.status, 'reading'); assert.equal(f.state().lessons.length, 0);
});

test('all agents receive validated local methods, mission scope and memory failure explicitly', async () => {
  for (const agent of ['firm-manager', 'mission-controller', 'orpailleur', 'enhanced-auditor', 'sika', 'shadow']) {
    const r = await localAgentLessons(agent, { missionId: 'M', activeLessons: async (key, d) => { assert.equal(d.missionId, 'M'); assert.equal(d.strict, true); return [key + ': méthode']; } });
    assert.equal(r.lessons.length, 1);
  }
  const failed = await localAgentLessons('sika', { activeLessons: async () => { throw Error('MEMORY_OFFLINE'); } });
  assert.equal(failed.memory_error, 'MEMORY_OFFLINE');
});

test('Shadow recovery retains the latest learning job only within the same cabinet', () => {
  const base = { ...emptyLab(), completed_learning: { org_id: 'ORG', samples: [{ id: 'S', seq: 1 }] } };
  mergeLabs(base, { completed_learning: { org_id: 'OTHER', samples: [{ id: 'FOREIGN', seq: 4 }] } });
  assert.equal(base.completed_learning.samples.length, 1);
  mergeLabs(base, { completed_learning: { org_id: 'ORG', samples: [{ id: 'S', seq: 2 }] } });
  assert.equal(base.completed_learning.samples[0].seq, 2);
  const empty = emptyLab();
  runInFirm('ORG', () => mergeLabs(empty, { completed_learning: { org_id: 'ORG', samples: [{ id: 'S', seq: 2 }] } }));
  assert.equal(empty.completed_learning.samples.length, 1);
});
