import test from 'node:test';
import assert from 'node:assert/strict';

import { startAuditorReview, auditorStep } from '../lib/enhanced-auditor.js';

const reality = (changed = false) => ({
  ok: true,
  changed,
  repaired_files: changed ? 1 : 0,
  content_changed: false,
  drive_scan: { files: 1, folders: 1, possibly_truncated: false },
  documents: [{ id: 'doc-1', name: 'piece.pdf' }],
  inventory_sync: { status: 'ok' },
  memory_copy_sync: { status: 'ok' }
});

test('a normal Enhanced Auditor review is persisted on knowledge before the first step is scheduled', async () => {
  let state = null;
  let scheduled = null;

  const out = await startAuditorReview('org-1', {}, { mission_id: '11111111-1111-1111-1111-111111111111' }, {
    hydrateReality: async () => reality(true),
    startDomain: async (_org, _req, body, deps) => {
      assert.equal(await deps.fire(), true);
      state = {
        status: 'running',
        stage: 'collect',
        analytical_review: false,
        mission: { id: body.mission_id, name: 'Mission A' },
        evidence_files: [], work_files: [], auditor_risk_files: [], log: []
      };
      return { started: true, mission: state.mission };
    },
    state: async () => state,
    save: async (_id, next) => { state = structuredClone(next); return state; },
    fire: async (_req, route, body) => { scheduled = { route, body }; return true; }
  });

  assert.equal(state.stage, 'knowledge');
  assert.deepEqual(state.knowledge_done, []);
  assert.equal(state.reality.files, 1);
  assert.equal(scheduled.route, '/api/app?route=auditor-step');
  assert.equal(out.reality.remembered, 1);
});

test('a changed mission reality rewinds a running review to knowledge instead of continuing blind', async () => {
  let state = {
    status: 'running', stage: 'coverage', analytical_review: false,
    mission: { id: '11111111-1111-1111-1111-111111111111', name: 'Mission A' },
    knowledge_done: ['old-doc'], log: []
  };

  const result = await auditorStep('org-1', {}, { mission_id: state.mission.id }, {
    forceKernel: true,
    hydrateReality: async () => reality(true),
    state: async () => state,
    save: async (_id, next) => { state = structuredClone(next); return state; },
    runKernel: async (_org, _req, _mission, options) => {
      assert.equal(state.stage, 'knowledge');
      return { status: 'observed', step: options.step };
    }
  });

  assert.equal(result.status, 'observed');
  assert.equal(state.stage, 'knowledge');
  assert.deepEqual(state.knowledge_done, []);
});

test('coverage is stopped when SOP/Working Paper execution was not actually prepared', async () => {
  const missionId = '11111111-1111-1111-1111-111111111111';
  let state = {
    status: 'running', stage: 'execute', analytical_review: false,
    mission: { id: missionId, name: 'Mission A' },
    knowledge_done: ['doc-1'], log: []
  };

  const out = await auditorStep('org-1', {}, { mission_id: missionId }, {
    forceKernel: true,
    hydrateReality: async () => reality(false),
    state: async () => state,
    save: async (_id, next) => { state = structuredClone(next); return state; },
    domainStep: async () => {
      state = {
        ...state,
        stage: 'risks',
        execution: { status: 'no_validated_programme', procedures: [] }
      };
      return state;
    },
    runKernel: async (org, req, _mission, options) => options.step(org, req, { mission_id: missionId }, { fire: async () => true })
  });

  assert.equal(out.status, 'needs_documents');
  assert.equal(out.stage, 'done');
  assert.equal(out.execution_gate.reason, 'ENHANCED_AUDITOR_EXECUTION_NOT_PREPARED');
  assert.match(out.missing_documents[0], /programme d'audit validé/i);
});

test('coverage is stopped when a prepared procedure still has business blockers', async () => {
  const missionId = '11111111-1111-1111-1111-111111111111';
  let state = {
    status: 'running', stage: 'execute', analytical_review: false,
    mission: { id: missionId, name: 'Mission A' }, knowledge_done: ['doc-1'], log: []
  };

  const out = await auditorStep('org-1', {}, { mission_id: missionId }, {
    forceKernel: true,
    hydrateReality: async () => reality(false),
    state: async () => state,
    save: async (_id, next) => { state = structuredClone(next); return state; },
    domainStep: async () => {
      state = {
        ...state,
        stage: 'risks',
        execution: {
          status: 'prepared',
          procedures: [{
            code: 'D1',
            locked: false,
            sop: { loaded: true },
            working_paper: { loaded: true },
            brain: { status: 'PREPARED_REVIEW_REQUIRED', limit_reached: false },
            blockers: ['EVIDENCE_REQUIRED', 'HUMAN_TEST_DECISION_REQUIRED']
          }]
        }
      };
      return state;
    },
    runKernel: async (org, req, _mission, options) => options.step(org, req, { mission_id: missionId }, { fire: async () => true })
  });

  assert.equal(out.status, 'needs_documents');
  assert.equal(out.execution_gate.reason, 'ENHANCED_AUDITOR_EXECUTION_INCOMPLETE');
  assert.ok(out.missing_documents.some(x => /EVIDENCE_REQUIRED/.test(x)));
  assert.ok(out.missing_documents.some(x => /HUMAN_TEST_DECISION_REQUIRED/.test(x)));
});

test('an unreadable receipt is persisted with the current Drive revision instead of causing a reread loop', async () => {
  const missionId = '11111111-1111-1111-1111-111111111111';
  let state = {
    status: 'running', stage: 'knowledge', analytical_review: false,
    mission: { id: missionId, name: 'Mission A' }, knowledge_done: [], log: []
  };
  let recorded = null;

  const out = await auditorStep('org-1', {}, { mission_id: missionId }, {
    forceKernel: true,
    hydrateReality: async () => reality(false),
    state: async () => state,
    save: async (_id, next) => { state = structuredClone(next); return state; },
    domainDeps: {
      getMeta: async () => ({ modifiedTime: '2026-10-30T08:00:00.000Z', version: '9', md5Checksum: 'abc' }),
      recordMissionDocuments: async (_mission, docs) => { recorded = docs; return 1; }
    },
    domainStep: async (_org, _req, _body, deps) => {
      await deps.recordMissionDocuments(state.mission, [{ id: 'doc-1', audit_read: { status: 'UNREADABLE', error: 'SOURCE_UNREADABLE' } }], {});
      return state;
    },
    runKernel: async (org, req, _mission, options) => options.step(org, req, { mission_id: missionId }, { fire: async () => true })
  });

  assert.equal(out.status, 'running');
  assert.equal(recorded[0].audit_read.status, 'UNREADABLE');
  assert.equal(recorded[0].audit_read.revision, '2026-10-30T08:00:00.000Z|9|abc');
  assert.equal(recorded[0].audit_read.source_state, 'unreadable_at_this_revision');
});
