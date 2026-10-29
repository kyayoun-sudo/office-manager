import test from 'node:test';
import assert from 'node:assert/strict';
import { KERNEL_STATUS, runAgentKernel } from '../lib/agent-kernel.js';

test('le kernel continue après une action et ne déclare verified qu’après relecture réussie', async () => {
  let observations = 0;
  let verifications = 0;
  const checkpoints = [];

  const result = await runAgentKernel({
    orgId: 'O',
    missionId: 'M',
    agent: 'orpailleur',
    objective: 'Ranger et vérifier le fichier F1',
    actions: { move: { describe: 'déplacer un fichier' } },
    observe: async () => ({ read: { location: observations++ === 0 ? 'INBOX' : 'AUDIT' } }),
    verify: async () => {
      verifications += 1;
      return verifications === 1
        ? { verified: false, progress: true, reason: 'fichier déplacé mais contrôle suivant requis' }
        : { verified: true, location: 'AUDIT' };
    },
    checkpoint: async state => checkpoints.push(state)
  }, {
    think: async () => ({
      understanding: 'F1 doit être dans AUDIT',
      done: [{ action: 'move', result: { ok: true } }],
      proposed: [], refused: [], questions: [], notes: []
    })
  });

  assert.equal(result.status, KERNEL_STATUS.VERIFIED);
  assert.equal(result.cycle, 2, 'une première action réussie ne suffit pas : le kernel repart pour un cycle');
  assert.equal(result.trace.length, 2);
  assert.equal(verifications, 2);
  assert.ok(checkpoints.some(x => x.phase === 'next'), 'la continuation est explicitement enregistrée');
  assert.equal(checkpoints.at(-1).status, KERNEL_STATUS.VERIFIED);
});

test('une action qui exige une personne arrête le kernel en awaiting_human', async () => {
  let verified = false;
  const result = await runAgentKernel({
    orgId: 'O', agent: 'mission-controller', objective: 'Envoyer la lettre',
    observe: async () => ({ read: { letter_ready: true } }),
    verify: async () => { verified = true; return { verified: true }; }
  }, {
    think: async () => ({
      understanding: 'La lettre est prête mais doit être validée', done: [], refused: [], questions: [],
      proposed: [{ action: 'send_mail', params: { to: 'client@example.com' }, why: 'envoi externe' }]
    })
  });

  assert.equal(result.status, KERNEL_STATUS.AWAITING_HUMAN);
  assert.equal(result.proposed[0].action, 'send_mail');
  assert.equal(verified, false, 'on ne masque pas une validation humaine par une vérification automatique');
});

test('une réponse IA sans action ni preuve de fin est bloquée, jamais verified', async () => {
  const result = await runAgentKernel({
    orgId: 'O', agent: 'enhanced-auditor', objective: 'Compléter D1',
    observe: async () => ({ read: { wp: 'D1' } }),
    verify: async () => ({ verified: false, reason: 'D1 reste incomplet' })
  }, {
    think: async () => ({
      understanding: 'Il faudrait compléter D1', done: [], proposed: [], refused: [], questions: [], notes: []
    })
  });

  assert.equal(result.status, KERNEL_STATUS.BLOCKED);
  assert.equal(result.error.reason, 'NO_PROGRESS');
});

test('une panne IA bloque le travail et aucune fausse réussite n’est produite', async () => {
  let verifyCalled = false;
  const result = await runAgentKernel({
    orgId: 'O', agent: 'sika', objective: 'Mettre à jour le suivi',
    observe: async () => ({ read: {} }),
    verify: async () => { verifyCalled = true; return { verified: true }; }
  }, {
    think: async () => ({ ai_error: 'AI_TIMEOUT', done: [], proposed: [], refused: [], questions: [] })
  });

  assert.equal(result.status, KERNEL_STATUS.BLOCKED);
  assert.equal(result.error.reason, 'AI_UNAVAILABLE');
  assert.equal(verifyCalled, false);
});

test('un agent long reste running si son checkpoint est persisté et la prochaine invocation est programmée', async () => {
  let continuations = 0;
  const checkpoints = [];
  const result = await runAgentKernel({
    orgId: 'O',
    agent: 'orpailleur',
    objective: 'Traiter un long lot documentaire',
    maxCycles: 2,
    observe: async () => ({ read: { remaining: 10 } }),
    work: async () => ({
      understanding: 'Un lot a été traité',
      done: [{ action: 'batch', result: { ok: true } }],
      progress: true,
      proposed: [], refused: [], questions: []
    }),
    verify: async () => ({ verified: false, progress: true, reason: 'des fichiers restent' }),
    onCycleLimit: async () => {
      continuations += 1;
      return { continue: true, scheduled: true };
    },
    checkpoint: async state => checkpoints.push(state)
  });

  assert.equal(result.status, KERNEL_STATUS.RUNNING);
  assert.equal(result.phase, 'continued');
  assert.equal(result.cycle, 2);
  assert.equal(continuations, 1);
  assert.equal(checkpoints.at(-1).status, KERNEL_STATUS.RUNNING);
});
