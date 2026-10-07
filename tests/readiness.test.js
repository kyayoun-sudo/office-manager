import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkReadiness, launchMappingPass, TABLES } from '../lib/readiness.js';
import { ROUTES } from '../api/app.js';
import { ownerMarkMappingReviewed } from '../lib/orpailleur-memory.js';

const FULL_ENV = Object.fromEntries(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DEFAULT_ORG_ID', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL', 'OFFICE_MANAGER_ACCESS_TOKEN', 'OFFICE_MANAGER_OWNER_TOKEN', 'OWNER_APPROVAL_SECRET', 'ORPAILLEUR_JOB_SECRET',
  'OFFICE_MANAGER_SCHEDULER_SECRET'].map(k => [k, 'x']));

function db({ missing = [], owners = 1, enabled = true, lastPass = '2026-10-07T08:00:00Z' } = {}) {
  return async path => {
    const table = path.split('?')[0];
    if (missing.includes(table)) throw new Error('relation does not exist');
    if (table === 'office_app_users' && path.includes('role=in.')) return Array.from({ length: owners }, (_, i) => ({ id: 'u' + i }));
    if (table === 'office_agent_schedule' && path.includes('select=enabled')) return [{ enabled }];
    if (table === 'office_agent_passes' && path.includes('order=')) return lastPass ? [{ started_at: lastPass }] : [];
    return [];
  };
}

// Memory as on the real TATY Drive on 2026-10-07: incomplete first mapping.
function memory(state, complete) {
  if (state === 'MAPPING_REVIEWED') {
    const m = memory('MAPPING_PENDING_REVIEW', true);
    ownerMarkMappingReviewed(m, { approvedBy: 'Paul', secret: 's', now: '2026-10-07T09:00:00Z' }); // real signed rule
    return m;
  }
  const STATE = [{ key: 'mapping_state', value: state }, { key: 'last_scan_complete', value: String(complete) },
    { key: 'scan_count', value: '2' }, { key: 'last_pass_warning', value: complete ? '' : 'LISTING_INCOMPLETE: 100 objects listed' }];
  return { exists: true, map: { sheets: { STATE, MAP: [], RULES: [], ROLES: [] } }, register: { rows: [] } };
}
const now = new Date('2026-10-07T09:30:00Z');
const base = { env: FULL_ENV, google: { connected: true, direct: true }, now, ownerSecret: 's' };

test('readiness: everything in place = ready', async () => {
  const r = await checkReadiness('org', { ...base, fetchRows: db(), loadMemory: async () => memory('MAPPING_REVIEWED', true) });
  assert.equal(r.ready, true, JSON.stringify(r.checks.filter(c => c.status !== 'ok')));
  assert.equal(r.remaining, 0);
});

test('readiness: the real TATY situation — incomplete mapping blocks, the fix and the action are given', async () => {
  const r = await checkReadiness('org', { ...base, fetchRows: db(), loadMemory: async () => memory('FIRST_MAPPING', false) });
  assert.equal(r.ready, false);
  const m = r.checks.find(c => c.id === 'mapping:complete');
  assert.equal(m.status, 'todo');
  assert.equal(m.action, 'mapping-pass');
  assert.match(m.fix, /LISTING_INCOMPLETE/);
  assert.equal(r.checks.find(c => c.id === 'mapping:reviewed').action, null, 'review only once the mapping is complete');
  assert.equal(r.next.id, 'mapping:complete');
});

test('readiness: complete mapping waiting for the owner → review action', async () => {
  const r = await checkReadiness('org', { ...base, fetchRows: db(), loadMemory: async () => memory('MAPPING_PENDING_REVIEW', true) });
  assert.equal(r.checks.find(c => c.id === 'mapping:complete').status, 'ok');
  assert.equal(r.checks.find(c => c.id === 'mapping:reviewed').action, 'mapping-review');
});

test('readiness: missing settings, tables, owner and scheduler are each named with their fix — never a secret value', async () => {
  const env = { ...FULL_ENV, OFFICE_MANAGER_OWNER_TOKEN: '', OFFICE_MANAGER_SCHEDULER_SECRET: '', ANTHROPIC_MODEL: 'secret-model-name' };
  const r = await checkReadiness('org', { ...base, env, fetchRows: db({ missing: ['office_training_cases', 'office_tidy_items'], owners: 0, lastPass: null }),
    loadMemory: async () => memory('MAPPING_REVIEWED', true) });
  const byId = Object.fromEntries(r.checks.map(c => [c.id, c]));
  assert.equal(byId['env:OFFICE_MANAGER_OWNER_TOKEN'].status, 'todo');
  assert.equal(byId['env:OFFICE_MANAGER_SCHEDULER_SECRET'].status, 'ok', 'falls back on ORPAILLEUR_JOB_SECRET');
  assert.equal(byId['db:tables'].status, 'todo');
  assert.deepEqual(byId['db:tables'].missing.map(m => m.split(' ')[0]), ['office_tidy_items', 'office_training_cases']);
  assert.match(byId['db:tables'].fix, /INSTALL_TOUT\.sql/);
  assert.equal(byId['accounts:owner'].status, 'todo');
  assert.equal(byId['schedule:ticking'].status, 'todo');
  assert.ok(!JSON.stringify(r).includes('secret-model-name'), 'values are never returned');
});

test('readiness: no Drive connection, no direct access', async () => {
  const r = await checkReadiness('org', { ...base, google: { connected: false, direct: false }, fetchRows: db(), loadMemory: async () => { throw new Error('should not read'); } });
  const byId = Object.fromEntries(r.checks.map(c => [c.id, c]));
  assert.equal(byId['drive:connected'].status, 'todo');
  assert.equal(byId['drive:direct'].status, 'warn');
  assert.equal(byId['mapping:complete'].status, 'todo');
});

test('readiness: full mapping pass goes to the Orpailleur agent (DRIVE_WALK)', async () => {
  const sent = [];
  const r = await launchMappingPass({ headers: { host: 'x' } }, async (req, path, body) => { sent.push([path, body]); return true; });
  assert.equal(r.started, true);
  assert.equal(sent[0][0], '/api/agent');
  assert.equal(sent[0][1].agent, 'orpailleur');
  assert.match(sent[0][1].message, /run_mapping_pass[\s\S]*DRIVE_WALK/);
  assert.match(sent[0][1].message, /N’approuve rien/);
});

test('readiness: owner only; page wired; every checked table is in the install file', () => {
  assert.ok(ROUTES.readiness.GET.ownerOnly && ROUTES.readiness.POST.ownerOnly);
  const install = readFileSync(new URL('../db/INSTALL_TOUT.sql', import.meta.url), 'utf8');
  for (const [t] of TABLES) assert.match(install, new RegExp('create table if not exists public\\.' + t + '\\b'), t);
  const html = readFileSync(new URL('../mise-en-service.html', import.meta.url), 'utf8');
  assert.ok(!/innerHTML/.test(html));
  assert.match(html, /route=readiness/);
  assert.match(html, /\/api\/owner/);
});
