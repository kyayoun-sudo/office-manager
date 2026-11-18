import test from 'node:test';
process.env.OFFICE_MANAGER_MULTI_CABINET = 'on';
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ||= 'k'.repeat(48);
process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'sec';
import assert from 'node:assert/strict';
import { runInFirm } from '../lib/firm-context.js';
import { loadGoogleConnection, resetGoogleConnectionCache, encryptToken, SCOPES } from '../lib/google-connection.js';
import { primeOrgKind, resetSimulationGuardCache, assertSimulationDriveCall } from '../lib/simulation-guard.js';
import { tidyDrive } from '../lib/tidy-drive.js';
import { googleDriveApi } from '../lib/drive-copy.js';
import { belongsToDrive, findAtelier } from '../lib/memory-home.js';

const SIM = '22222222-2222-4222-8222-222222222222', REAL = '11111111-1111-4111-8111-111111111111';
const fetchRows = async path => {
  if (path.startsWith('office_organizations?id=eq.' + SIM)) return [{ account_kind: 'simulation', parent_org_id: REAL }];
  if (path.startsWith('office_organizations?id=eq.' + REAL)) return [{ account_kind: null, parent_org_id: null }];
  if (path.startsWith('office_firm_drive?org_id=eq.' + SIM)) return [{ drive_id: 'folder:SIMFOLDER' }];
  if (path.startsWith('office_firm_drive?org_id=eq.' + REAL)) return [{ drive_id: 'REALDRIVE' }];
  if (path.startsWith('office_google_connections?org_id=eq.' + REAL)) return [{ google_email: 'c@x.test', refresh_token_enc: encryptToken('r'), scopes: [SCOPES.drive], connected_by: 'p', connected_at: '2026-11-01' }];
  return [];
};
const PARENTS = { INSIDE: ['SIMFOLDER'], REALFILE: ['REALFOLDER'], REALFOLDER: ['REALDRIVE'] };
const calls = []; const realFetch = globalThis.fetch;
const stub = () => { globalThis.fetch = async url => {
  const u = String(url); calls.push(u);
  if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3000 }));
  const m = /drive\/v3\/files\/([^?/]+)\?/.exec(u);
  return new Response(JSON.stringify(m ? { id: m[1], parents: PARENTS[m[1]] || [] } : { files: [] }));
}; };
async function inSim(fn) {
  resetGoogleConnectionCache(); resetSimulationGuardCache(); calls.length = 0; stub();
  await primeOrgKind(SIM, { fetchRows }); await loadGoogleConnection(SIM, { fetchRows });
  try { await runInFirm(SIM, fn); } finally { globalThis.fetch = realFetch; }
}
const API = 'https://www.googleapis.com/drive/v3/files';
// The ancestry walk that decides (fields=id,parents only) is allowed; any other request to a file outside is a leak.
const contentCalls = () => calls.filter(c => /drive\/v3\/files/.test(c) && !/fields=id,parents$/.test(c));

test('raw Drive calls of tidy-drive and drive-copy stay inside the simulation folder', async () => {
  await inSim(async () => {
    await assert.rejects(tidyDrive.getFile('REALFILE'), /SIMULATION_READ_OUTSIDE_FOLDER/);
    await assert.rejects(tidyDrive.nameTaken('REALFOLDER', 'x'), /SIMULATION_READ_OUTSIDE_FOLDER/);
    await assert.rejects(tidyDrive.createFolder('REALFOLDER', 'x'), /SIMULATION_(WRITE|READ)_OUTSIDE_FOLDER/);
    const api = googleDriveApi();
    await assert.rejects(api.children('REALFOLDER'), /SIMULATION_READ_OUTSIDE_FOLDER/);
    await assert.rejects(api.drive('REALDRIVE'), /SIMULATION_READ_OUTSIDE_FOLDER/);
    assert.deepEqual(contentCalls(), []);
    assert.equal((await tidyDrive.getFile('INSIDE')).id, 'INSIDE');
  });
});

test('the URL guard refuses a listing without a parent, uploads outside, and lets the real firm through', async () => {
  await inSim(async () => {
    await assert.rejects(assertSimulationDriveCall(API + '?q=' + encodeURIComponent("name = 'x'")), /OUTSIDE_FOLDER/);
    await assert.rejects(assertSimulationDriveCall('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', body: '{"parents":["REALFOLDER"]}' }), /SIMULATION_WRITE_OUTSIDE_FOLDER/);
    await assert.doesNotReject(assertSimulationDriveCall(API + '?q=' + encodeURIComponent("'SIMFOLDER' in parents")));
  });
  resetSimulationGuardCache(); await primeOrgKind(REAL, { fetchRows });
  await runInFirm(REAL, () => assertSimulationDriveCall(API + '/REALFILE?x=1'));
});

test('memory-home never reaches Google outside the simulation folder', async () => {
  await inSim(async () => {
    const seen = []; const fetchImpl = async u => { seen.push(String(u)); return new Response('{"files":[]}'); };
    const H = { headers: {} };
    assert.equal(await belongsToDrive('REALFILE', H, { kind: 'folder', driveId: 'SIMFOLDER', fetchImpl }), false);
    await findAtelier(H, { kind: 'folder', driveId: 'SIMFOLDER', fetchImpl });
    assert.ok(seen.every(u => decodeURIComponent(u).replaceAll('+', ' ').includes("'SIMFOLDER' in parents")), 'only the simulation folder is listed: ' + seen.join(' '));
  });
});
