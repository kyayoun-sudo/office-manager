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
    const signed = { ...pilotOnly, ...internalHeaders(ORG, process.env, { path: '/api/app?route=passes' }) };
    await assert.rejects(handleApp({ method: 'GET', url: '/api/app?route=passes', query: { route: 'passes' }, headers: signed }), e => !/USER_SESSION_REQUIRED|UNAUTHORIZED/.test(e.message));
    // The same signature does not open another route.
    await assert.rejects(handleApp({ method: 'POST', url: '/api/app?route=tidy', query: { route: 'tidy' }, headers: signed, body: { action: 'step' } }), /USER_SESSION_REQUIRED/);
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

test('a person\'s missions are searched directly (an older one is no longer missed beyond the 100 latest)', async () => {
  const saved = { ...process.env }, original = globalThis.fetch, asked = [];
  Object.assign(process.env, { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'k' });
  globalThis.fetch = async url => { asked.push(String(url)); return new Response(JSON.stringify([{ id: '44444444-4444-4444-8444-444444444444', name: 'Ancienne' }])); };
  try {
    const { listMissions } = await import('../lib/mission-dossier.js');
    const r = await listMissions(ORG, { ids: new Set(['44444444-4444-4444-8444-444444444444', 'not-an-id']) });
    assert.equal(r.missions.length, 1);
    assert.match(asked[0], /id=in\.\(44444444-4444-4444-8444-444444444444\)/);
    assert.deepEqual((await listMissions(ORG, { ids: new Set() })).missions, [], 'no mission: nothing asked');
    assert.equal(asked.length, 1);
  } finally { globalThis.fetch = original; process.env = saved; }
});

test('a personal session passes the first gate without the shared token, and is then verified (the firm name included)', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { OFFICE_MANAGER_ACCESS_TOKEN: 'pilot', DEFAULT_ORG_ID: ORG });
  delete process.env.OFFICE_MANAGER_MULTI_CABINET; delete process.env.OFFICE_MANAGER_TEST_RUN;
  try {
    const { requirePilotAccess } = await import('../lib/auth.js');
    const bearer = { headers: { authorization: 'Bearer ' + 'a'.repeat(40) } };
    assert.equal(requirePilotAccess({ headers: { 'x-office-manager-token': 'pilot' } }), 'token');
    // Fail closed by default: a bearer header is not a proof; only a caller that verifies it right after opts in.
    assert.throws(() => requirePilotAccess(bearer), /UNAUTHORIZED/);
    assert.equal(requirePilotAccess(bearer, { allowSession: true }), 'unverified-session');
    assert.throws(() => requirePilotAccess({ headers: { authorization: 'Bearer short' } }, { allowSession: true }), /UNAUTHORIZED/);
    assert.throws(() => requirePilotAccess({ headers: {} }, { allowSession: true }), /UNAUTHORIZED/);
    delete process.env.OFFICE_MANAGER_ACCESS_TOKEN;
    assert.throws(() => requirePilotAccess(bearer, { allowSession: true }), /ACCESS_TOKEN_MISSING/, 'no token on the server: closed');
    process.env.OFFICE_MANAGER_ACCESS_TOKEN = 'pilot';
    // Branding with the token: served. With a made-up « session » and no token: the session is checked (and refused).
    const { handleApp } = await import('../api/app.js');
    await assert.rejects(handleApp({ method: 'GET', query: { route: 'branding' }, headers: { authorization: 'Bearer ' + 'x'.repeat(40) } }), e => /SUPABASE|TOKEN|SESSION|AUTH|ACCOUNT/.test(e.message));
  } finally { process.env = saved; }
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

test('wrong owner codes typed by hand are limited per address; an empty header (session pages) is not counted', async () => {
  const saved = { ...process.env };
  process.env.OFFICE_MANAGER_OWNER_TOKEN = 'the-owner-code';
  try {
    const { requireFirmOwner } = await import('../lib/owner-auth.js');
    const { _resetAttempts } = await import('../lib/attempts.js');
    _resetAttempts();
    const from = (code, ip = '203.0.113.9') => ({ headers: { 'x-office-manager-owner-token': code, 'x-forwarded-for': ip } });
    for (let i = 0; i < 30; i++) assert.throws(() => requireFirmOwner(from('')), /OWNER_ONLY/);
    for (let i = 0; i < 10; i++) assert.throws(() => requireFirmOwner(from('guess' + i)), /OWNER_ONLY/);
    assert.throws(() => requireFirmOwner(from('the-owner-code')), /TOO_MANY_ATTEMPTS/, 'even the right code waits once the tries are used');
    requireFirmOwner(from('the-owner-code', '198.51.100.3'));
    _resetAttempts();
  } finally { process.env = saved; }
});

test('a database failure is not « no Google connection » (and is not remembered as such)', async () => {
  const { loadGoogleConnection, resetGoogleConnectionCache } = await import('../lib/google-connection.js');
  resetGoogleConnectionCache();
  let calls = 0;
  const down = async () => { calls++; throw new Error('SUPABASE_503: upstream connect error'); };
  assert.equal(await loadGoogleConnection(ORG, { fetchRows: down }), null);
  await loadGoogleConnection(ORG, { fetchRows: down });
  const before = calls;
  // Not cached as « none »: the next request asks the database again.
  await loadGoogleConnection(ORG, { fetchRows: down });
  assert.ok(calls > before, 'the failure was not remembered as « no connection »');
  // A table not installed yet still means « no connection ».
  const missing = async () => { throw new Error('SUPABASE_404: {"code":"PGRST205"}'); };
  assert.equal(await loadGoogleConnection('33333333-3333-4333-8333-333333333333', { fetchRows: missing }), null);
  resetGoogleConnectionCache();
});

test('the next tidy step carries the firm, signed', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { OFFICE_MANAGER_SCHEDULER_SECRET: 's3cret', DEFAULT_ORG_ID: ORG, VERCEL_URL: 'app.example' });
  try {
    const { continueInBackground } = await import('../api/app.js');
    const { runInFirm } = await import('../lib/firm-context.js');
    let sent = null, to = null;
    await runInFirm(ORG, () => continueInBackground({ headers: { host: 'app.example' } }, 'req-1', async (url, init) => { to = url; sent = init.headers; return { ok: true }; }));
    assert.equal(sent['x-office-manager-org'], ORG);
    assert.ok(isSignedInternal({ headers: sent, url: '/api/app?route=tidy' }, ORG, process.env));
    // A forged Host never receives the call (nor the secrets it carries): this deployment's own address is used.
    await runInFirm(ORG, () => continueInBackground({ headers: { host: 'attacker.example' } }, 'req-1', async url => { to = url; return { ok: true }; }));
    assert.equal(to, 'https://app.example/api/app?route=tidy');
  } finally { process.env = saved; }
});

test('a server signature is valid for one endpoint and a few minutes only', async () => {
  const { INTERNAL_MAX_AGE_MS } = await import('../lib/firm-context.js');
  const env = { OFFICE_MANAGER_INTERNAL_SECRET: 's3cret' };
  const now = 1_800_000_000_000;
  const headers = internalHeaders(ORG, env, { path: '/api/app?route=tidy-plan-step', now });
  assert.ok(isSignedInternal({ headers, url: '/api/app?route=tidy-plan-step' }, ORG, env, now + 1000));
  assert.ok(!isSignedInternal({ headers, url: '/api/app?route=firm-reset' }, ORG, env, now + 1000), 'another route');
  assert.ok(!isSignedInternal({ headers, url: '/api/agent' }, ORG, env, now + 1000), 'another endpoint');
  assert.ok(!isSignedInternal({ headers, url: '/api/app?route=tidy-plan-step' }, ORG, env, now + INTERNAL_MAX_AGE_MS + 1), 'expired');
  assert.ok(!isSignedInternal({ headers: { ...headers, 'x-office-manager-internal-at': String(now + 5000) }, url: '/api/app?route=tidy-plan-step' }, ORG, env, now), 'date changed');
  assert.ok(!isSignedInternal({ headers: { 'x-office-manager-internal': headers['x-office-manager-internal'] }, url: '/api/app?route=tidy-plan-step' }, ORG, env, now), 'no date');
});

test('background calls go to this deployment, a forged Host is ignored', async () => {
  const { internalBaseUrl } = await import('../lib/firm-context.js');
  const env = { VERCEL_URL: 'om-abc123.vercel.app', VERCEL_BRANCH_URL: 'om-git-branch.vercel.app', OFFICE_MANAGER_PUBLIC_URL: 'https://app.cabinet.ci' };
  assert.equal(internalBaseUrl({ headers: { host: 'om-git-branch.vercel.app' } }, env), 'https://om-git-branch.vercel.app');
  assert.equal(internalBaseUrl({ headers: { host: 'app.cabinet.ci' } }, env), 'https://app.cabinet.ci');
  assert.equal(internalBaseUrl({ headers: { host: 'evil.example' } }, env), 'https://om-abc123.vercel.app');
  assert.equal(internalBaseUrl({ headers: { host: 'localhost:3000' } }, {}), 'http://localhost:3000');
  assert.equal(internalBaseUrl({ headers: { host: 'evil.example' } }, {}), null, 'nowhere to send it: nothing is sent');
});
