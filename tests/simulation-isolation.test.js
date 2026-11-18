import test from 'node:test';
import assert from 'node:assert/strict';
import { runInFirm } from '../lib/firm-context.js';
import { primeOrgKind, resetSimulationGuardCache } from '../lib/simulation-guard.js';
import { sendViaGmail } from '../lib/agent-mail.js';

const SIM = '22222222-2222-4222-8222-222222222222', REAL = '11111111-1111-4111-8111-111111111111';
const fetchRows = async path => {
  if (path.startsWith('office_organizations?id=eq.' + SIM)) return [{ account_kind: 'simulation', parent_org_id: REAL }];
  if (path.startsWith('office_organizations?id=eq.' + REAL)) return [{ account_kind: null, parent_org_id: null }];
  if (path.startsWith('office_firm_drive')) return [{ drive_id: 'folder:F' }];
  throw new Error('unexpected ' + path);
};

test('sendViaGmail refuses in a simulation before any network call', async () => {
  resetSimulationGuardCache(); await primeOrgKind(SIM, { fetchRows });
  let called = false;
  await runInFirm(SIM, async () => {
    await assert.rejects(sendViaGmail({ recipients: ['x@y.test'], subject: 's', body: 'b' }, {}, { fetchImpl: async () => { called = true; return { ok: true }; } }), /SIMULATION_NO_OUTBOUND/);
  });
  assert.equal(called, false);
});

test('the real firm keeps sending (guard does not leak across firms)', async () => {
  resetSimulationGuardCache(); await primeOrgKind(REAL, { fetchRows }); await primeOrgKind(SIM, { fetchRows });
  await runInFirm(REAL, async () => {
    await assert.rejects(sendViaGmail({ recipients: ['x@y.test'], subject: 's', body: 'b' }, {}, { fetchImpl: async () => ({ ok: true }) }), e => !/SIMULATION_NO_OUTBOUND/.test(e.message));
  });
});
