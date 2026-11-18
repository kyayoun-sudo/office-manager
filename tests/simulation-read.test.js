import test from 'node:test';
process.env.OFFICE_MANAGER_MULTI_CABINET = 'on';
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ||= 'k'.repeat(48);
process.env.GOOGLE_CLIENT_ID = 'cid'; process.env.GOOGLE_CLIENT_SECRET = 'sec';
import assert from 'node:assert/strict';
import { runInFirm } from '../lib/firm-context.js';
import { loadGoogleConnection, connectedHas, resetGoogleConnectionCache, encryptToken, SCOPES } from '../lib/google-connection.js';
import { primeOrgKind, resetSimulationGuardCache } from '../lib/simulation-guard.js';
import { getDriveFileMetadata, downloadFileBuffer, getSheetValues, listDriveChildrenPage, findFilesByExactName, searchDriveFiles } from '../lib/google-drive.js';
import { gmailToken, GMAIL_READ } from '../lib/agent-mail.js';

const SIM = '22222222-2222-4222-8222-222222222222', REAL = '11111111-1111-4111-8111-111111111111';
const ALL = [SCOPES.drive, SCOPES.sheets, SCOPES.gmailRead, SCOPES.gmailSend].join(' ');
const fetchRows = async path => {
  if (path.startsWith('office_organizations?id=eq.' + SIM)) return [{ account_kind: 'simulation', parent_org_id: REAL }];
  if (path.startsWith('office_organizations?id=eq.' + REAL)) return [{ account_kind: null, parent_org_id: null }];
  if (path.startsWith('office_firm_drive?org_id=eq.' + SIM)) return [{ drive_id: 'folder:SIMFOLDER', drive_name: 'Simulation' }];
  if (path.startsWith('office_firm_drive?org_id=eq.' + REAL)) return [{ drive_id: 'REALDRIVE', drive_name: 'Cabinet' }];
  if (path.startsWith('office_google_connections?org_id=eq.' + REAL)) return [{ google_email: 'cab@x.test', refresh_token_enc: encryptToken('r'), scopes: ALL.split(' '), connected_by: 'p', connected_at: '2026-11-01' }];
  return [];
};
const PARENTS = { INSIDE: ['SIMFOLDER'], DEEP: ['INSIDE'], REALFILE: ['REALFOLDER'], REALFOLDER: ['REALDRIVE'] };
const calls = [];
const realFetch = globalThis.fetch;
function stubGoogle() {
  globalThis.fetch = async (url, o) => {
    const u = String(url); calls.push(u);
    if (u.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3000 }));
    const m = /drive\/v3\/files\/([^?/]+)\?/.exec(u);
    if (m) return new Response(JSON.stringify({ id: m[1], parents: PARENTS[m[1]] || [], mimeType: 'text/plain', size: '3', capabilities: { canDownload: true } }));
    return new Response(JSON.stringify({ files: [], values: [] }));
  };
}
async function inSim(fn) {
  resetGoogleConnectionCache(); resetSimulationGuardCache(); calls.length = 0; stubGoogle();
  await primeOrgKind(SIM, { fetchRows });
  await loadGoogleConnection(SIM, { fetchRows });
  try { await runInFirm(SIM, fn); } finally { globalThis.fetch = realFetch; }
}
const drive = u => calls.filter(c => /googleapis\.com\/(drive|upload)/.test(c) && !/files\/(INSIDE|DEEP|SIMFOLDER)\?/.test(c));

test('a simulation cannot read a file or folder of the real firm Drive, by id', async () => {
  await inSim(async () => {
    for (const run of [
      () => getDriveFileMetadata('REALFILE'),
      () => downloadFileBuffer('REALFILE'),
      () => getSheetValues('REALFILE', 'A1:B2'),
      () => listDriveChildrenPage('REALFOLDER'),
      () => findFilesByExactName('x', 'REALFOLDER')
    ]) await assert.rejects(run(), /SIMULATION_READ_OUTSIDE_FOLDER/);
    assert.deepEqual(drive().filter(c => /files\?|values|alt=media/.test(c)), [], 'no content request left for the real Drive');
  });
});

test('a simulation still reads inside its own folder', async () => {
  await inSim(async () => {
    assert.equal((await getDriveFileMetadata('DEEP')).id, 'DEEP');
    await assert.doesNotReject(listDriveChildrenPage('SIMFOLDER'));
  });
});

test('a simulation search is scoped to its folder, never to the whole account', async () => {
  await inSim(async () => {
    await searchDriveFiles({ query: 'salaires' });
    const q = decodeURIComponent(calls.filter(c => /drive\/v3\/files\?/.test(c)).pop()).replaceAll('+', ' ');
    assert.match(q, /'SIMFOLDER' in parents/);
    await assert.rejects(searchDriveFiles({ query: 'x', parentId: 'REALFOLDER' }), /SIMULATION_READ_OUTSIDE_FOLDER/);
  });
});

test('a simulation never reads the parent mailbox (borrowed Gmail scopes are dropped)', async () => {
  await inSim(async () => {
    assert.equal(connectedHas(SCOPES.gmailRead), false);
    assert.equal(connectedHas(SCOPES.gmailSend), false);
    assert.equal(connectedHas(SCOPES.drive), true);
    await assert.rejects(gmailToken('cab@x.test', {}, fetch, GMAIL_READ), /SIMULATION_NO_OUTBOUND/);
  });
});

test('the real firm keeps reading everything and keeps its Gmail', async () => {
  resetGoogleConnectionCache(); resetSimulationGuardCache(); calls.length = 0; stubGoogle();
  try {
    await primeOrgKind(REAL, { fetchRows });
    await loadGoogleConnection(REAL, { fetchRows });
    await runInFirm(REAL, async () => {
      assert.equal(connectedHas(SCOPES.gmailRead), true);
      assert.equal((await getDriveFileMetadata('REALFILE')).id, 'REALFILE');
    });
  } finally { globalThis.fetch = realFetch; }
});

test('review: the parent LEGACY connection lends no Gmail either, and text scopes keep Drive', async () => {
  const legacyRows = async (path, o) => {
    if (path.startsWith('office_google_connections?org_id=eq.' + REAL)) return [];
    if (path.startsWith('office_integration_connections?org_id=eq.' + REAL)) return [{ account_email: 'c@x.test', granted_scopes: [SCOPES.drive, SCOPES.gmailRead], status: 'connected' }];
    if (path === 'rpc/office_get_google_drive_secret') return [{ client_id: 'a', client_secret: 'b', refresh_token: 'r' }];
    return fetchRows(path, o);
  };
  await inSim(async () => {});
  resetGoogleConnectionCache(); resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  await loadGoogleConnection(SIM, { fetchRows: legacyRows });
  await runInFirm(SIM, async () => { assert.equal(connectedHas(SCOPES.gmailRead), false); assert.equal(connectedHas(SCOPES.drive), true); });
  const textRows = async (path, o) => path.startsWith('office_google_connections?org_id=eq.' + REAL)
    ? [{ google_email: 'c@x.test', refresh_token_enc: encryptToken('r'), scopes: SCOPES.drive + ' ' + SCOPES.gmailRead, connected_by: 'p', connected_at: '2026-11-01' }] : fetchRows(path, o);
  resetGoogleConnectionCache(); resetSimulationGuardCache();
  await primeOrgKind(SIM, { fetchRows });
  await loadGoogleConnection(SIM, { fetchRows: textRows });
  await runInFirm(SIM, async () => { assert.equal(connectedHas(SCOPES.drive), true); assert.equal(connectedHas(SCOPES.gmailRead), false); });
});

test('review: copying a file of the real Drive into a simulation is refused (source checked)', async () => {
  const { copyDriveFile } = await import('../lib/google-drive.js');
  await inSim(async () => {
    await assert.rejects(copyDriveFile('REALFILE', 'x', 'SIMFOLDER'), /SIMULATION_READ_OUTSIDE_FOLDER/);
    assert.deepEqual(calls.filter(c => /\/copy/.test(c)), []);
  });
});

test('review: a firm known as real stays real when the type read fails once', async () => {
  resetSimulationGuardCache();
  await primeOrgKind(REAL, { fetchRows });
  const { isNotRealKnown } = await import('../lib/simulation-guard.js');
  const { setTimeout: sleep } = await import('node:timers/promises');
  await primeOrgKind(REAL, { fetchRows: async () => { throw new Error('db down'); }, now: () => Date.now() + 61000 });
  await runInFirm(REAL, async () => assert.equal(isNotRealKnown(), false));
});
