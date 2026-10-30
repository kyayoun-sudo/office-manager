import test from 'node:test';
import assert from 'node:assert/strict';
import { internalHeaders, isSignedInternal } from '../lib/firm-context.js';

// Audit 2026-10-30 (AUDIT_2026-10-30.md): secrets in error details, the agent opened by the shared pilot token alone,
// background tidy steps without the firm.
const ORG = '11111111-1111-4111-8111-111111111111';

test('error details never show a token, a key or a JWT', async () => {
  const { redactSecrets } = await import('../api/app.js');
  const out = redactSecrets('fetch failed: Authorization Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc apikey=sk-live-1234567890 token: abcdef123 key=AIzaSyA1234567890abcdefghijk');
  for (const s of ['eyJhbGciOiJIUzI1NiJ9', 'sk-live-1234567890', 'abcdef123', 'AIzaSyA1234567890abcdefghijk']) assert.ok(!out.includes(s), s + ' leaked: ' + out);
  // An ordinary message stays readable.
  assert.equal(redactSecrets('duplicate key value violates unique constraint'), 'duplicate key value violates unique constraint');
});

test('one firm too, the server signs its own background calls (none without a secret)', () => {
  const env = { DEFAULT_ORG_ID: ORG, OFFICE_MANAGER_SCHEDULER_SECRET: 's3cret' };
  const headers = internalHeaders(ORG, env);
  assert.equal(headers['x-office-manager-org'], ORG);
  assert.ok(isSignedInternal({ headers }, ORG, env));
  assert.ok(!isSignedInternal({ headers: { 'x-office-manager-internal': 'forged' } }, ORG, env));
  assert.deepEqual(internalHeaders(ORG, { DEFAULT_ORG_ID: ORG }), {});
});

test('/api/agent: the shared pilot token alone is refused (a person or a signed server call is needed)', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { OFFICE_MANAGER_ACCESS_TOKEN: 'pilot', DEFAULT_ORG_ID: ORG, OFFICE_MANAGER_SCHEDULER_SECRET: 's3cret' });
  delete process.env.OFFICE_MANAGER_MULTI_CABINET; delete process.env.OFFICE_MANAGER_TEST_RUN;
  try {
    const { default: handler } = await import('../api/agent.js');
    let status = 0, body = null;
    const res = { setHeader() {}, status(s) { status = s; return this; }, json(b) { body = b; return this; } };
    await handler({ method: 'POST', headers: { 'x-office-manager-token': 'pilot' }, body: { message: 'liste les documents de la mission X' } }, res);
    assert.equal(status, 401);
    assert.equal(body.error, 'UNAUTHORIZED');
  } finally { process.env = saved; }
});

test('api/app: a route without its own rule needs a person or the signed server; the firm name stays readable', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { OFFICE_MANAGER_ACCESS_TOKEN: 'pilot', DEFAULT_ORG_ID: ORG, OFFICE_MANAGER_SCHEDULER_SECRET: 's3cret' });
  delete process.env.OFFICE_MANAGER_MULTI_CABINET; delete process.env.OFFICE_MANAGER_TEST_RUN;
  try {
    const { handleApp, ROUTES } = await import('../api/app.js');
    const pilotOnly = { 'x-office-manager-token': 'pilot' };
    for (const [route, method] of [['passes', 'GET'], ['tidy', 'POST'], ['mission-dedupe', 'POST'], ['firm-learn', 'POST'], ['opportunity-step', 'POST'], ['tool-gateway', 'GET']]) {
      await assert.rejects(handleApp({ method, query: { route }, headers: pilotOnly, body: { action: 'step' } }), /USER_SESSION_REQUIRED/, route + ' must refuse the shared token alone');
    }
    // The server's own background call goes through the access check (it then fails further on, on the missing database).
    const signed = { ...pilotOnly, ...internalHeaders(ORG) };
    await assert.rejects(handleApp({ method: 'GET', query: { route: 'passes' }, headers: signed }), e => !/USER_SESSION_REQUIRED|UNAUTHORIZED/.test(e.message));
    // Every route is now decided: public, owner, roles, screen, or « a person / the server ».
    assert.ok(ROUTES.branding.GET, 'branding stays readable on the login page');
  } finally { process.env = saved; }
});

test('missions a person may see: the firm rights decide « all » or « mine »; the server sees all', async () => {
  const { visibleMissionIds } = await import('../lib/caller.js');
  const missionAccess = { accessibleMissionIds: async () => new Set(['m1']) };
  assert.equal(await visibleMissionIds(ORG, null), null, 'the signed server call');
  assert.equal(await visibleMissionIds(ORG, { role: 'partner' }, { permissions: { requireScreenAccess: async () => ({ ok: true, mine: false }) }, missionAccess }), null);
  assert.deepEqual([...await visibleMissionIds(ORG, { role: 'auditor' }, { permissions: { requireScreenAccess: async () => ({ ok: true, mine: true }) }, missionAccess })], ['m1']);
});

test('the owner code is never handed out at login', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { OFFICE_MANAGER_OWNER_TOKEN: 'owner-code' });
  try {
    const { sessionPayload } = await import('../lib/accounts.js');
    const s = sessionPayload({ email: 'p@x', display_name: 'P', role: 'owner' }, { refresh_token: 'r', access_token: 'a' });
    assert.equal(s.owner_token, null);
  } finally { process.env = saved; }
});

test('the owner tools accept the owner\'s session and sign in the name of the connected account', async () => {
  const { handleOwnerRequest } = await import('../api/owner.js');
  // Without a session nor the code: refused before anything is read.
  await assert.rejects(handleOwnerRequest({ method: 'GET', headers: {} }, { drive: {} }), /OWNER_UNAUTHORIZED|OWNER_TOKEN_MISSING/);
  // With the owner's session the code is not asked (it fails further on, on the missing approval secret / memory).
  await assert.rejects(handleOwnerRequest({ method: 'GET', headers: {} }, { drive: {}, ownerAccount: { role: 'owner', email: 'p@x' } }), e => !/OWNER_UNAUTHORIZED|OWNER_TOKEN_MISSING/.test(e.message));
});

test('the next tidy step carries the firm, signed', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { OFFICE_MANAGER_SCHEDULER_SECRET: 's3cret', DEFAULT_ORG_ID: ORG });
  try {
    const { continueInBackground } = await import('../api/app.js');
    const { runInFirm } = await import('../lib/firm-context.js');
    let sent = null;
    await runInFirm(ORG, () => continueInBackground({ headers: { host: 'app.example' } }, 'req-1', async (url, init) => { sent = init.headers; return { ok: true }; }));
    assert.equal(sent['x-office-manager-org'], ORG);
    assert.ok(isSignedInternal({ headers: sent }, ORG, process.env));
  } finally { process.env = saved; }
});
