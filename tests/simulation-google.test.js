import test from 'node:test';
import assert from 'node:assert/strict';
import { runInFirm } from '../lib/firm-context.js';
import { loadGoogleConnection, connectedGoogle, resetGoogleConnectionCache, encryptToken } from '../lib/google-connection.js';
import { primeOrgKind, resetSimulationGuardCache } from '../lib/simulation-guard.js';

process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ||= 'k'.repeat(48);
const SIM = '22222222-2222-4222-8222-222222222222', REAL = '11111111-1111-4111-8111-111111111111';
const enc = () => encryptToken('refresh-of-parent');
const fetchRows = async path => {
  if (path.startsWith('office_organizations?id=eq.' + SIM)) return [{ account_kind: 'simulation', parent_org_id: REAL }];
  if (path.startsWith('office_organizations?id=eq.' + REAL)) return [{ account_kind: null, parent_org_id: null }];
  if (path.startsWith('office_firm_drive?org_id=eq.' + SIM)) return [{ drive_id: 'folder:SIMFOLDER', drive_name: 'Simulation' }];
  if (path.startsWith('office_firm_drive?org_id=eq.' + REAL)) return [{ drive_id: 'REALDRIVE', drive_name: 'Cabinet' }];
  if (path.startsWith('office_google_connections?org_id=eq.' + REAL)) return [{ google_email: 'cab@x.test', refresh_token_enc: enc(), scopes: 'https://www.googleapis.com/auth/drive', connected_by: 'p', connected_at: '2026-11-01' }];
  if (path.startsWith('office_google_connections?org_id=eq.' + SIM)) return [];
  throw new Error('unexpected ' + path);
};

test('a simulation borrows the parent connection but keeps its own Drive folder', async () => {
  resetGoogleConnectionCache(); resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  await loadGoogleConnection(SIM, { fetchRows });
  await runInFirm(SIM, async () => {
    const c = connectedGoogle();
    assert.ok(c, 'connection borrowed');
    assert.equal(c.refresh, 'refresh-of-parent');
    assert.equal(c.orgId, SIM);
  });
});

test('the parent keeps its own connection, and a parent without connection gives none to the simulation', async () => {
  resetGoogleConnectionCache(); resetSimulationGuardCache();
  await primeOrgKind(REAL, { fetchRows });
  await loadGoogleConnection(REAL, { fetchRows });
  await runInFirm(REAL, async () => assert.equal(connectedGoogle().refresh, 'refresh-of-parent'));
  resetGoogleConnectionCache(); resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  const none = async p => p.startsWith('office_google_connections') ? [] : p.startsWith('office_integration_connections') ? [] : fetchRows(p);
  await loadGoogleConnection(SIM, { fetchRows: none });
  await runInFirm(SIM, async () => assert.equal(connectedGoogle(), null));
});
