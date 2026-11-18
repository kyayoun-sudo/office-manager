import test from 'node:test';
import assert from 'node:assert/strict';
import { runInFirm } from '../lib/firm-context.js';
import { primeOrgKind, isSimulation, assertNoOutbound, simulationParent, assertSimulationDriveWrite, resetSimulationGuardCache } from '../lib/simulation-guard.js';
import { dailyLimit } from '../lib/ai-usage.js';
import { assertWritableTarget } from '../lib/google-drive.js';

const SIM = '22222222-2222-4222-8222-222222222222', REAL = '11111111-1111-4111-8111-111111111111';
const rows = { [SIM]: { account_kind: 'simulation', parent_org_id: REAL }, [REAL]: { account_kind: null, parent_org_id: null } };
const fetchRows = async path => {
  const id = path.match(/id=eq\.([^&]+)/)?.[1] ?? path.match(/org_id=eq\.([^&]+)/)?.[1];
  if (path.startsWith('office_organizations')) return [rows[id]];
  if (path.startsWith('office_firm_drive')) return id === SIM ? [{ drive_id: 'folder:FOLDER1' }] : [];
  throw new Error('unexpected ' + path);
};

test('a simulation firm is recognised, its parent and folder are known', async () => {
  resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  runInFirm(SIM, () => { assert.equal(isSimulation(), true); assert.equal(simulationParent(), REAL); });
});

test('a real firm is not a simulation and outbound stays allowed', async () => {
  resetSimulationGuardCache();
  await primeOrgKind(REAL, { fetchRows });
  runInFirm(REAL, () => { assert.equal(isSimulation(), false); assert.doesNotThrow(assertNoOutbound); });
});

test('outbound is refused in a simulation with a clear code', async () => {
  resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  runInFirm(SIM, () => assert.throws(assertNoOutbound, e => e.message === 'SIMULATION_NO_OUTBOUND' && e.statusCode === 409));
});

test('an unreadable firm type fails closed (treated as a simulation)', async () => {
  resetSimulationGuardCache();
  await primeOrgKind(REAL, { fetchRows: async () => { throw new Error('db down'); } });
  runInFirm(REAL, () => { assert.equal(isSimulation(), true); assert.throws(assertNoOutbound, /SIMULATION_NO_OUTBOUND/); });
});

test('a firm never primed does not block outbound (tests, scripts) but its Drive writes are refused', async () => {
  resetSimulationGuardCache();
  await runInFirm(REAL, async () => {
    assert.doesNotThrow(assertNoOutbound);
    await assert.rejects(assertSimulationDriveWrite('X', async () => ({ parents: [] })), /SIMULATION_WRITE_OUTSIDE_FOLDER/);
  });
});

test('the AI cap of a simulation defaults to 200 and follows the installation variable', async () => {
  resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  runInFirm(SIM, () => {
    assert.equal(dailyLimit({}), 200);
    assert.equal(dailyLimit({ OFFICE_MANAGER_SIMULATION_AI_DAILY_LIMIT: '50' }), 50);
  });
  await primeOrgKind(REAL, { fetchRows });
  runInFirm(REAL, () => assert.equal(dailyLimit({}), null));
});

test('in a simulation, a Drive write inside the folder passes and outside is refused', async () => {
  resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  const tree = { CHILD: { parents: ['FOLDER1'] }, FOLDER1: { parents: ['ROOT'] }, OTHER: { parents: ['ROOT'] }, ROOT: { parents: [] } };
  const meta = async id => tree[id];
  await runInFirm(SIM, async () => {
    await assert.doesNotReject(assertWritableTarget('CHILD', { meta }));
    await assert.rejects(assertWritableTarget('OTHER', { meta }), /SIMULATION_WRITE_OUTSIDE_FOLDER/);
  });
});
