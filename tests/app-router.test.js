import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { ROUTES, handleApp } from '../api/app.js';

test('app router: one endpoint serves the four screens, methods are restricted', async () => {
  assert.deepEqual(Object.keys(ROUTES).sort(), ['actions', 'agent-intro', 'agent-message', 'agent-names', 'agent-permissions', 'agent-persona', 'agent-schedule', 'ai-providers', 'analytical-review', 'assign-action', 'audit-log', 'auditor', 'auditor-evening-step', 'auditor-step', 'auditor-work', 'auditor-wp-step', 'bootstrap-owner', 'branding', 'cabinets', 'capabilities', 'capabilities-step', 'chat', 'claim-owner', 'close-account', 'cockpit', 'completed-mission-learning', 'coordination', 'deposit', 'deposit-step', 'diagnostic', 'dossier', 'dossier-followup', 'drop', 'engagement', 'engagement-step', 'external-specialists', 'firm-knowledge', 'firm-learn', 'firm-reset', 'firm-restart', 'firm-settings', 'google', 'google-callback', 'learnings', 'login', 'logout', 'mail-thread', 'mail-triage', 'management-card', 'mapping-scan', 'mapping-step', 'memory', 'messages', 'methodology', 'mission-client-contacts', 'mission-contacts', 'mission-dedupe', 'mission-fact', 'mission-file', 'mission-quick', 'mission-quick-step', 'mission-view', 'mission-write', 'my-ai', 'my-kpi', 'my-questions', 'notifications', 'oauth-login', 'oauth-start', 'opportunities', 'opportunity-commercial-step', 'opportunity-handoff-step', 'opportunity-kyc-step', 'opportunity-quotation-step', 'opportunity-step', 'opportunity-team-step', 'partner-dashboard', 'partner-view', 'passes', 'pbc', 'people-brief', 'people-policy', 'people-questions', 'permissions', 'personal-ai', 'personal-learning', 'plan-integrate', 'procedure', 'readiness', 'scheduler-run', 'scheduler-tick', 'search', 'secretariat', 'server-files', 'session', 'setup-state', 'shadow', 'shadow-code-step', 'shadow-investigate-step', 'shadow-survey', 'signoff', 'signup', 'sika-expenses', 'specialist-registry', 'submissions', 'submissions-step', 'team-kpi', 'team-recommendation', 'team-roles', 'tender-step', 'tenders', 'test-run', 'test-run-step', 'tidy', 'tidy-plan-step', 'tool-gateway', 'training', 'training-confirm', 'training-step', 'translate', 'users', 'work-programme', 'workfile', 'workfile-kpi', 'workflow']);
  assert.ok(!ROUTES.search.POST && !ROUTES['mission-view'].POST);
  process.env.OFFICE_MANAGER_ACCESS_TOKEN = 't';
  process.env.DEFAULT_ORG_ID = 'org-1';
  const req = (route, method = 'GET', token = 't') => ({ method, query: { route }, headers: { 'x-office-manager-token': token } });
  await assert.rejects(handleApp(req('search', 'GET', 'bad')), /UNAUTHORIZED/);
  await assert.rejects(handleApp(req('personal-learning')), /USER_SESSION_REQUIRED/);
  await assert.rejects(handleApp(req('sika-expenses')), /USER_SESSION_REQUIRED/);
  await assert.rejects(handleApp(req('sika-expenses', 'POST')), /USER_SESSION_REQUIRED/);
  await assert.rejects(handleApp(req('nope')), /UNKNOWN_ROUTE/);
  await assert.rejects(handleApp(req('search', 'POST')), /METHOD_NOT_ALLOWED/);
  await assert.rejects(handleApp({ ...req('search'), query: { route: 'search', q: 'a' } }), /USER_SESSION_REQUIRED/);
});

test('app router: stays within the Vercel Hobby limit of 12 functions', () => {
  const fns = readdirSync(new URL('../api/', import.meta.url)).filter(f => /\.(js|ts|mjs)$/.test(f));
  assert.ok(fns.length <= 12, 'api/ has ' + fns.length + ' functions');
});
test('validation errors from workbook inspection keep their actionable 422 code', async () => {
 const {default: app}=await import('../api/app.js');
 const route='chat'; const original = ROUTES[route].GET;
 process.env.OFFICE_MANAGER_ACCESS_TOKEN='t';process.env.DEFAULT_ORG_ID='org-1';
 // A bare stub would need a person since the audit of 2026-10-30; public: only the error path is under test here.
 ROUTES[route].GET=Object.assign(()=>{throw Object.assign(new Error('WORKBOOK_LEGEND_NOT_FOUND'),{statusCode:422});},{public:true});
 let status,body;const res={setHeader(){},status(n){status=n;return this;},json(b){body=b;return this;}};
 try {await app({method:'GET',query:{route},headers:{'x-office-manager-token':'t'}},res);assert.equal(status,422);assert.equal(body.error,'WORKBOOK_LEGEND_NOT_FOUND');}
 finally {ROUTES[route].GET=original;}
});
