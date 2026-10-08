import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { ROUTES, handleApp } from '../api/app.js';

test('app router: one endpoint serves the four screens, methods are restricted', async () => {
  assert.deepEqual(Object.keys(ROUTES).sort(), ['actions', 'agent-message', 'agent-names', 'agent-permissions', 'agent-persona', 'agent-schedule', 'ai-providers', 'assign-action', 'audit-log', 'auditor', 'auditor-evening-step', 'auditor-step', 'auditor-work', 'auditor-wp-step', 'bootstrap-owner', 'branding', 'capabilities', 'capabilities-step', 'chat', 'claim-owner', 'close-account', 'cockpit', 'coordination', 'deposit', 'deposit-step', 'diagnostic', 'drop', 'engagement', 'engagement-step', 'external-specialists', 'firm-knowledge', 'firm-learn', 'google', 'google-callback', 'learnings', 'login', 'logout', 'mail-thread', 'mail-triage', 'management-card', 'mapping-scan', 'mapping-step', 'memory', 'messages', 'mission-client-contacts', 'mission-contacts', 'mission-dedupe', 'mission-fact', 'mission-file', 'mission-view', 'mission-write', 'my-kpi', 'notifications', 'oauth-login', 'oauth-start', 'partner-dashboard', 'partner-view', 'passes', 'people-brief', 'people-policy', 'people-questions', 'plan-integrate', 'readiness', 'scheduler-run', 'scheduler-tick', 'search', 'session', 'setup-state', 'signoff', 'signup', 'submissions', 'submissions-step', 'team-kpi', 'team-recommendation', 'test-run', 'test-run-step', 'tidy', 'tidy-plan-step', 'training', 'training-confirm', 'training-step', 'translate', 'users']);
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
