// Several firms in one installation (2026-10-24): the firm of a request is fixed once and nothing of one firm
// (Drive, Google, server credentials, session role) is ever used for another. Switch off = exactly as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRequestOrg, runInFirm, serverCredentialsAllowed, internalHeaders, multiCabinet, _resetFirmContext } from '../lib/firm-context.js';
import { loadFirmDrive, firmDriveId, resetGoogleConnectionCache } from '../lib/google-connection.js';
import { login } from '../lib/accounts.js';

const PILOT = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const env = { OFFICE_MANAGER_MULTI_CABINET: 'on', DEFAULT_ORG_ID: PILOT, OFFICE_MANAGER_INTERNAL_SECRET: 's3cret' };
function withEnv(values, run) {
  const saved = {}; for (const k of Object.keys(values)) { saved[k] = process.env[k]; process.env[k] = values[k]; }
  return Promise.resolve().then(run).finally(() => { for (const k of Object.keys(values)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } _resetFirmContext(); resetGoogleConnectionCache(); });
}

test('switch off: the pilot firm, no header read, no membership asked', async () => {
  const req = { headers: { 'x-office-manager-org': OTHER } };
  assert.equal(await resolveRequestOrg(req, { env: { DEFAULT_ORG_ID: PILOT } }), PILOT);
  assert.equal(multiCabinet({}), false);
  assert.deepEqual(internalHeaders(PILOT, { DEFAULT_ORG_ID: PILOT }), {});
});

test('switch on: the firm is accepted only for a member, or for a call signed by the server', async () => {
  const member = async (req, { orgId }) => { if (orgId !== OTHER) throw new Error('ACCOUNT_NOT_ALLOWED'); return { role: 'auditor', email: 'a@x.test' }; };
  const req = { headers: { 'x-office-manager-org': OTHER } };
  assert.equal(await resolveRequestOrg(req, { env, currentAccount: member }), OTHER);
  assert.equal(req.account.role, 'auditor');
  // No header: the pilot firm, and a person of another firm holding the shared token is refused.
  await assert.rejects(resolveRequestOrg({ headers: {} }, { env, currentAccount: member }), /NOT_IN_THIS_CABINET/);
  await assert.rejects(resolveRequestOrg({ headers: { 'x-office-manager-org': 'nope' } }, { env }), /INVALID_CABINET/);
  // Background call: signed for THIS firm only.
  const signed = { headers: internalHeaders(OTHER, env) };
  assert.equal(await resolveRequestOrg(signed, { env, currentAccount: () => { throw new Error('not asked'); } }), OTHER);
  const forged = { headers: { ...internalHeaders(OTHER, env), 'x-office-manager-org': PILOT } };
  await assert.rejects(resolveRequestOrg(forged, { env, currentAccount: member }), /NOT_IN_THIS_CABINET/);
});

test('two firms in the same process never see each other\'s Drive', async () => {
  await withEnv(env, async () => {
    const rows = { [PILOT]: 'drive-pilot', [OTHER]: 'folder:drive-other' };
    const fetchRows = async path => [{ drive_id: rows[decodeURIComponent(path.split('org_id=eq.')[1].split('&')[0])], drive_name: 'D' }];
    await loadFirmDrive(PILOT, { fetchRows }); await loadFirmDrive(OTHER, { fetchRows });
    const seen = await Promise.all([
      runInFirm(PILOT, async () => { await new Promise(r => setTimeout(r, 5)); return firmDriveId(); }),
      runInFirm(OTHER, async () => firmDriveId())
    ]);
    assert.deepEqual(seen, ['drive-pilot', 'drive-other']);
  });
});

test('server credentials and pilot settings serve the pilot firm only; outside a request, no firm at all', async () => {
  await withEnv(env, async () => {
    assert.equal(serverCredentialsAllowed(), false, 'fail closed outside a request context');
    assert.equal(await runInFirm(PILOT, async () => serverCredentialsAllowed()), true);
    assert.equal(await runInFirm(OTHER, async () => serverCredentialsAllowed()), false);
    const { masterSheetId } = await import('../lib/google-drive.js');
    process.env.MASTER_SHEET_ID = 'pilot-sheet';
    assert.equal(await runInFirm(PILOT, async () => masterSheetId()), 'pilot-sheet');
    await assert.rejects(runInFirm(OTHER, async () => masterSheetId()), /MASTER_SHEET_NOT_CONFIGURED/);
    delete process.env.MASTER_SHEET_ID;
  });
});

test('login with several firms: the session names its firm and lists them; no firm = create or join', async () => {
  await withEnv(env, async () => {
    const tokens = { user: { id: 'u1', email: 'p@x.test' }, refresh_token: 'r', access_token: 'a' };
    const authCall = async () => ({ status: 200, data: tokens });
    const member = (orgs) => async path => {
      if (path.startsWith('office_app_users?org_id=eq.')) { const o = decodeURIComponent(path.split('org_id=eq.')[1].split('&')[0]); return orgs.includes(o) ? [{ auth_user_id: 'u1', email: 'p@x.test', display_name: 'P', role: 'manager', active: true }] : []; }
      if (path.startsWith('office_app_users?auth_user_id=eq.')) return orgs.map(o => ({ org_id: o, role: 'manager' }));
      if (path.startsWith('office_organizations?id=in.')) return orgs.map(o => ({ id: o, name: o === PILOT ? 'TATY' : 'Autre' }));
      return [];
    };
    const onlyOther = await login(PILOT, { email: 'p@x.test', password: 'x' }, { authCall, fetchRows: member([OTHER]) });
    assert.equal(onlyOther.org_id, OTHER); assert.equal(onlyOther.owner_token, null);
    assert.deepEqual(onlyOther.cabinets.map(c => c.org_id), [OTHER]);
    const both = await login(OTHER, { email: 'p@x.test', password: 'x' }, { authCall, fetchRows: member([PILOT, OTHER]) });
    assert.equal(both.org_id, OTHER); assert.equal(both.cabinets.length, 2);
    const none = await login(PILOT, { email: 'p@x.test', password: 'x' }, { authCall, fetchRows: member([]) });
    assert.equal(none.needs_cabinet, true); assert.equal(none.org_id, null); assert.equal(none.user.role, null); assert.equal(none.pilot_token, null, 'no shared token without a firm');
  });
});

test('several firms: a WAITING sign-up left in the pilot firm does not lock the person out — they may create their own firm', async () => {
  await withEnv(env, async () => {
    const tokens = { user: { id: 'u9', email: 'new@x.test' }, refresh_token: 'r', access_token: 'a' };
    const authCall = async () => ({ status: 200, data: tokens });
    const fetchRows = async path => {
      if (path.startsWith('office_app_users?org_id=eq.') && path.includes('&active=eq.true')) return [{ auth_user_id: 'owner' }];   // the pilot firm has its owner
      if (path.startsWith('office_app_users?org_id=eq.')) return [{ auth_user_id: 'u9', email: 'new@x.test', display_name: 'N', role: 'collaborator', active: false }];
      return [];
    };
    const s = await login(PILOT, { email: 'new@x.test', password: 'x' }, { authCall, fetchRows });
    assert.equal(s.needs_cabinet, true); assert.equal(s.org_id, null); assert.equal(s.pilot_token, null);
  });
});

test('router with several firms: the shared token alone opens nothing; the owner code never enters another firm', async () => {
  await withEnv({ ...env, OFFICE_MANAGER_ACCESS_TOKEN: 't' }, async () => {
    const { handleApp } = await import('../api/app.js');
    const req = (route, method = 'GET', headers = {}) => ({ method, query: { route }, headers: { 'x-office-manager-token': 't', ...headers }, body: {} });
    await assert.rejects(handleApp(req('passes')), /USER_SESSION_REQUIRED/);
    await assert.rejects(handleApp(req('claim-owner', 'POST', { 'x-office-manager-org': OTHER })), /PILOT_FIRM_ONLY/);
    await assert.rejects(handleApp(req('cabinets')), /USER_SESSION_REQUIRED/);
  });
});
