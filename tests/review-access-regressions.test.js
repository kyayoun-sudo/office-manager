import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApp } from '../api/app.js';
import { _clearAuthCache } from '../lib/user-auth.js';
import { requireScreenAccess, can } from '../lib/permissions.js';
import { accessibleMissionIds, requireMissionAccess } from '../lib/mission-access.js';
import { decideTender } from '../lib/tender-watch.js';

const partner = { role: 'partner', email: 'p@cabinet.ci' };
test('a shared pilot token cannot read dossiers or search without a personal session', async () => {
  const previous = process.env.OFFICE_MANAGER_ACCESS_TOKEN, previousOrg = process.env.DEFAULT_ORG_ID;
  process.env.DEFAULT_ORG_ID = 'review-org';
  process.env.OFFICE_MANAGER_ACCESS_TOKEN = 'review-pilot';
  try {
    for (const route of ['search', 'mission-view', 'actions']) {
      await assert.rejects(handleApp({ method: 'GET', query: { route, q: 'audit' }, headers: { 'x-office-manager-token': 'review-pilot' } }), /USER_SESSION_REQUIRED/);
    }
  } finally { if (previousOrg === undefined) delete process.env.DEFAULT_ORG_ID; else process.env.DEFAULT_ORG_ID = previousOrg; if (previous === undefined) delete process.env.OFFICE_MANAGER_ACCESS_TOKEN; else process.env.OFFICE_MANAGER_ACCESS_TOKEN = previous; }
});

test('personal sessions check an active account and reject IT access to client dossiers', async () => {
  const previous = { ...process.env }, originalFetch = globalThis.fetch;
  Object.assign(process.env, { OFFICE_MANAGER_ACCESS_TOKEN: 'review-pilot', DEFAULT_ORG_ID: 'review-org', SUPABASE_URL: 'https://review.invalid', SUPABASE_SERVICE_ROLE_KEY: 'review-key' });
  let account = { auth_user_id: 'u1', email: 'it@cabinet.ci', role: 'it_admin', active: true };
  globalThis.fetch = async url => ({ ok: true, status: 200, json: async () => ({ id: 'u1' }), text: async () => JSON.stringify(String(url).includes('office_app_users') ? [account] : []) });
  const req = { method: 'GET', query: { route: 'mission-view', mission_id: 'm1' }, headers: { 'x-office-manager-token': 'review-pilot', authorization: 'Bearer review-session-123456789012345' } };
  try {
    _clearAuthCache(); await assert.rejects(handleApp(req), /ROLE_NOT_ALLOWED/);
    account = { ...account, role: 'auditor', active: false }; _clearAuthCache();
    await assert.rejects(handleApp(req), /ACCOUNT_NOT_ALLOWED/);
  } finally {
    globalThis.fetch = originalFetch; _clearAuthCache();
    for (const key of ['OFFICE_MANAGER_ACCESS_TOKEN', 'DEFAULT_ORG_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});

test('configured restrictions reject actions at the server and in the tender module', async () => {
  const overrides = { matrix: { partner: { tenders: 'none' } } };
  await assert.rejects(requireScreenAccess('org', partner, 'tenders', 'approve', { loadOverrides: async () => overrides }), /SCREEN_NOT_ALLOWED/);
  assert.equal(can(partner, 'tender_follow_decision', { permissions: overrides }).ok, false);
  assert.equal(can(partner, 'tender_follow_decision', { permissions: { matrix: { partner: { tenders: 'view' } } } }).reason, 'PERMISSION_LEVEL_REQUIRED');
  assert.equal(can(partner, 'tender_follow_decision', { permissions: {} }).ok, true);
  const state = { tenders: { t1: { id: 't1', stage: 'new', deadline: '2099-12-31', verified: true, deadline_source: 'https://example.org/tender', history: [] } }, runs: [], companies: {} };
  await assert.rejects(decideTender('org', { id: 't1', follow: true }, partner, {
    loadOverrides: async () => overrides, fetchRows: async () => [], loadJsonFile: async () => ({ state }),
    updateJsonFile: async (name, mutate) => ({ state: await mutate(structuredClone(state)) })
  }), /SCREEN_NOT_ALLOWED/);
});

test('mission scopes exclude unrelated and ended assignments and preserve partners access', async () => {
  const fetchRows = async path => path.startsWith('office_staff_profiles') ? [{ id: 's1' }] : [{ office_mission_id: 'mine', status: 'active' }, { office_mission_id: 'ended', status: 'completed' }];
  const auditor = { role: 'auditor', email: 'a@cabinet.ci' };
  assert.deepEqual([...await accessibleMissionIds('org', auditor, fetchRows)], ['mine']);
  await requireMissionAccess('org', 'mine', auditor, fetchRows);
  await assert.rejects(requireMissionAccess('org', 'other', auditor, fetchRows), /NOT_ON_THIS_MISSION/);
  await requireMissionAccess('org', 'other', partner, fetchRows);
});


test('scoped searches expose only assigned mission documents and preserve the existing team directory', async () => {
  const {smartSearch}=await import('../lib/smart-search.js');
  const result=await smartSearch('org',{q:'facture',status:'toutes',allowedMissionIds:new Set(['mine'])},{
    drive:{findFilesByExactName:async()=>[]},folder:'MEM',
    fetchRows:async path=>path.startsWith('office_missions')?[{id:'mine',name:'Audit A',status:'fieldwork'},{id:'other',name:'Audit B',status:'fieldwork'}]:path.startsWith('office_staff_profiles')?[{id:'staff',full_name:'Facture Person',role_title:'Auditeur'}]:[],
    loadScan:async()=>({state:{items:[]}}),loadFileIndex:async()=>({a:{id:'a',name:'facture A',mission_id:'mine'},b:{id:'b',name:'facture B',mission_id:'other'},c:{id:'c',name:'facture sans rattachement'}})
  });
  assert.deepEqual(result.results.documents.map(x=>x.file_id),['a']);
  assert.equal(result.results.people[0].full_name,'Facture Person');
  assert.equal(result.total,2);
});
