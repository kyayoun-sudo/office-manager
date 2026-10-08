import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { ROUTES, handleApp } from '../api/app.js';

test('app router: one endpoint serves the four screens, methods are restricted', async () => {
  assert.deepEqual(Object.keys(ROUTES).sort(), ['actions', 'agent-message', 'agent-permissions', 'agent-persona', 'agent-schedule', 'ai-providers', 'audit-log', 'auditor', 'auditor-step', 'bootstrap-owner', 'branding', 'capabilities', 'capabilities-step', 'claim-owner', 'close-account', 'cockpit', 'coordination', 'deposit', 'deposit-step', 'diagnostic', 'drop', 'engagement', 'engagement-step', 'firm-knowledge', 'firm-learn', 'google', 'google-callback', 'learnings', 'login', 'logout', 'mail-thread', 'mail-triage', 'mapping-scan', 'mapping-step', 'memory', 'messages', 'mission-contacts', 'mission-dedupe', 'mission-view', 'my-kpi', 'oauth-login', 'oauth-start', 'partner-dashboard', 'passes', 'people-brief', 'people-policy', 'readiness', 'scheduler-run', 'scheduler-tick', 'search', 'session', 'setup-state', 'signup', 'submissions', 'submissions-step', 'team-kpi', 'test-run', 'test-run-step', 'tidy', 'tidy-plan-step', 'training', 'training-confirm', 'training-step', 'translate', 'users']);
  assert.ok(!ROUTES.search.POST && !ROUTES['mission-view'].POST);
  process.env.OFFICE_MANAGER_ACCESS_TOKEN = 't';
  process.env.DEFAULT_ORG_ID = 'org-1';
  const req = (route, method = 'GET', token = 't') => ({ method, query: { route }, headers: { 'x-office-manager-token': token } });
  await assert.rejects(handleApp(req('search', 'GET', 'bad')), /UNAUTHORIZED/);
  await assert.rejects(handleApp(req('nope')), /UNKNOWN_ROUTE/);
  await assert.rejects(handleApp(req('search', 'POST')), /METHOD_NOT_ALLOWED/);
  await assert.rejects(handleApp({ ...req('search'), query: { route: 'search', q: 'a' } }), /QUERY_TOO_SHORT/);
});

test('app router: stays within the Vercel Hobby limit of 12 functions', () => {
  const fns = readdirSync(new URL('../api/', import.meta.url)).filter(f => /\.(js|ts|mjs)$/.test(f));
  assert.ok(fns.length <= 12, 'api/ has ' + fns.length + ' functions');
});
