import test from 'node:test';
import assert from 'node:assert/strict';
import { runMissionControllerKernel, KERNEL_STATUS } from '../lib/mission-controller-kernel.js';

test('Mission Controller n’est verified qu’après relecture de sa mémoire persistante', async () => {
  let state = { memory: { status: 'idle', last_successful_at: '2026-10-29T20:00:00.000Z', pending: [] } };
  const result = await runMissionControllerKernel('O', {
    loadAgentMemory: async () => state,
    pass: async () => {
      state = { memory: { status: 'idle', last_attempted_at: '2026-10-29T21:00:00.000Z', last_successful_at: '2026-10-29T21:00:01.000Z', pending: [], checkpoint: { seen: { M1: 'now' } } } };
      return { missions: [{ mission_id: 'M1', status: 'updated' }], status_proposals: [], assignments: {} };
    }
  });
  assert.equal(result.status, KERNEL_STATUS.VERIFIED);
  assert.equal(result.verification.state.last_successful_at, '2026-10-29T21:00:01.000Z');
});

test('Mission Controller attend un humain lorsqu’un dossier de mission reste inconnu', async () => {
  let state = { memory: { status: 'idle', last_successful_at: 'old', pending: [] } };
  const result = await runMissionControllerKernel('O', {
    loadAgentMemory: async () => state,
    pass: async () => {
      state = { memory: { status: 'idle', last_successful_at: 'new', last_attempted_at: 'new', pending: [{ label: 'Dossier Drive de la mission à confirmer' }] } };
      return { missions: [{ mission_id: 'M2', status: 'folder_unknown' }] };
    }
  });
  assert.equal(result.status, KERNEL_STATUS.AWAITING_HUMAN);
  assert.match(result.questions[0], /Dossier Drive/);
});

test('Mission Controller ne transforme jamais un échec général en succès', async () => {
  let state = { memory: { status: 'idle', pending: [] } };
  const result = await runMissionControllerKernel('O', {
    loadAgentMemory: async () => state,
    pass: async () => ({ missions: [{ mission_id: 'M1', status: 'failed', error: 'DRIVE_ERROR' }] })
  });
  assert.equal(result.status, KERNEL_STATUS.BLOCKED);
  assert.equal(result.error.reason, 'MISSION_CONTROLLER_ALL_MISSIONS_FAILED');
});
