import test from 'node:test';
import assert from 'node:assert/strict';
import { presentRun } from '../lib/run-status.js';
import handler from '../api/runs.js';

test('overdue requests are unknown, never reported as cancelled or completed', () => {
  const row = { id: 'synthetic', status: 'running', started_at: '2026-10-06T10:00:00Z' };
  assert.equal(presentRun(row, Date.parse('2026-10-06T10:03:00Z')).status, 'running');
  const stalled = presentRun(row, Date.parse('2026-10-06T10:07:00Z'));
  assert.equal(stalled.status, 'completion_unknown');
  assert.match(stalled.warning, /preuves avant de relancer/);
  assert.equal(presentRun({ ...row, status: 'verified' }, Date.parse('2026-10-07')).status, 'verified');
  assert.equal(presentRun({ ...row, status: 'running', started_at: 'invalid' }).status, 'running');
});

const response = () => ({
  headers: {}, setHeader(k,v) { this.headers[k]=v; },
  status(code) { this.code=code; return this; },
  json(value) { this.value=value; return this; }
});

test('history rejects unauthorized users without fetching', async () => {
  process.env.OFFICE_MANAGER_ACCESS_TOKEN='synthetic-token';
  const res=response();
  await handler({ method:'GET', headers:{} },res);
  assert.equal(res.code,401);
  assert.equal(res.headers['Cache-Control'],'no-store');
});

test('history imposes server organisation and never discloses metrics or errors', async () => {
  process.env.OFFICE_MANAGER_ACCESS_TOKEN='synthetic-token';
  process.env.DEFAULT_ORG_ID='server-org';
  process.env.SUPABASE_URL='https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
  const original=globalThis.fetch;
  let requested;
  globalThis.fetch=async url => {
    requested=url;
    return new Response(JSON.stringify([{id:'synthetic',status:'failed',summary:'Synthetic failure',metrics:{private:'hidden'},errors:['private']}]));
  };
  try {
    const res=response();
    await handler({method:'GET',headers:{'x-office-manager-token':'synthetic-token'},query:{org_id:'attacker'}},res);
    assert.equal(res.code,200);
    assert.ok(requested.includes('org_id=eq.server-org'));
    assert.ok(!requested.includes('attacker'));
    assert.equal(res.value.runs[0].metrics,undefined);
    assert.equal(res.value.runs[0].errors,undefined);
  } finally { globalThis.fetch=original; }
});
