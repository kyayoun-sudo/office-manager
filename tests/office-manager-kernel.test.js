import test from 'node:test';
import assert from 'node:assert/strict';
import { runOfficeManagerKernel, KERNEL_STATUS } from '../lib/office-manager-kernel.js';

test('une réponse informative sans action opérationnelle peut être verified', async () => {
  const result = await runOfficeManagerKernel({ orgId: 'O', runId: 'R', message: 'Quel est le statut ?', requestedAgent: 'auto' }, {
    runOfficeManager: async () => ({ text: 'La mission est en cours.', toolsUsed: ['read_office_mission_dossier'], provider: 'test' }),
    getRunToolEvents: async () => [{ tool_name: 'read_office_mission_dossier', phase: 'completed', metadata: {} }]
  });
  assert.equal(result.status, KERNEL_STATUS.VERIFIED);
  assert.equal(result.verification.mode, 'informational');
});

test('une action opérationnelle sans preuve ne devient jamais verified', async () => {
  const result = await runOfficeManagerKernel({ orgId: 'O', runId: 'R', message: 'Mets à jour la mission', requestedAgent: 'auto' }, {
    runOfficeManager: async () => ({ text: 'Mise à jour demandée.', toolsUsed: ['update_mission_status'], provider: 'test' }),
    getRunToolEvents: async () => [{ tool_name: 'update_mission_status', phase: 'completed', metadata: {} }]
  });
  assert.equal(result.status, KERNEL_STATUS.AWAITING_HUMAN);
  assert.match(result.questions[0], /Vérifier l’effet réel/);
});

test('une action opérationnelle avec preuve explicite peut être verified', async () => {
  const result = await runOfficeManagerKernel({ orgId: 'O', runId: 'R', message: 'Mets à jour la mission', requestedAgent: 'auto' }, {
    runOfficeManager: async () => ({ text: 'Mise à jour terminée.', toolsUsed: ['update_mission_status'], provider: 'test' }),
    getRunToolEvents: async () => [{ tool_name: 'update_mission_status', phase: 'completed', metadata: { verified: true } }]
  });
  assert.equal(result.status, KERNEL_STATUS.VERIFIED);
  assert.equal(result.verification.mode, 'operational');
});

test('un outil encore running bloque la fausse réussite', async () => {
  const result = await runOfficeManagerKernel({ orgId: 'O', runId: 'R', message: 'Fais le travail', requestedAgent: 'auto' }, {
    runOfficeManager: async () => ({ text: 'Travail lancé.', toolsUsed: ['update_mission_status'], provider: 'test' }),
    getRunToolEvents: async () => [{ tool_name: 'update_mission_status', phase: 'running', metadata: {} }]
  });
  assert.equal(result.status, KERNEL_STATUS.BLOCKED);
  assert.equal(result.error.reason, 'OFFICE_MANAGER_TOOL_EVENTS_INCOMPLETE');
});
