import test from 'node:test';
import assert from 'node:assert/strict';
import { entryKind, commercialState, sendingProgress, parallelTasks } from '../lib/opportunity-workflow.js';

test('AMI and direct proposals have different next documents; TDR alone is not guessed', () => {
  assert.equal(entryKind('AMI — avis à manifestation d’intérêt'), 'ami');
  assert.equal(entryKind('Demande de propositions — liste restreinte'), 'proposal');
  assert.equal(entryKind('TDR'), 'unknown');
  assert.equal(commercialState({ id: 'a', kind: 'AMI' }).document_kind, 'mi');
  assert.equal(commercialState({ id: 'b', kind: 'DDP' }).document_kind, 'proposition');
  assert.equal(commercialState({ id: 'c', kind: 'TDR' }).stage, 'identify');
});
test('verified MI sending waits for shortlisting, never awards a mission or completes KYC', () => {
  const o = { id: 'a', status: 'phase0', kind: 'AMI', phase1: { status: 'preparing' }, answers: [{ human: true }] };
  const original = structuredClone(o);
  assert.equal(sendingProgress(o, { status: 'declared', kind: 'mi', proof: { kind: 'link' } }), undefined);
  assert.equal(sendingProgress(o, { status: 'sent', kind: 'cv', proof: { kind: 'receipt' } }), undefined);
  const progress = sendingProgress(o, { status: 'sent', kind: 'mi', proof: { kind: 'receipt' } });
  assert.equal(progress.stage, 'mi_waiting');
  assert.deepEqual(o, original);
  assert.equal(commercialState({ ...o, commercial: progress }).document_kind, null);
});
test('offer preparation and KYC remain parallel; award selects engagement letter', () => {
  const o = { id: 'a', kind: 'DDP', team: { status: 'validated', members: [{ name: 'Auditor', email: 'a@example.com' }] }, phase1: { status: 'ready' } };
  assert.equal(commercialState(o).stage, 'proposal_prepare');
  assert.equal(parallelTasks(o).find(t => t.id === 'kyc').state, 'Préparé — à examiner');
  assert.equal(commercialState({ ...o, won: { letter: {} } }).document_kind, 'lettre_mission');
  assert.equal(commercialState({ ...o, commercial: { stage: 'shortlisted', entry_kind: 'ami' } }).document_kind, null);
});
