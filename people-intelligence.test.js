import test from 'node:test';
import assert from 'node:assert/strict';
import { assessEligibility, getPeopleIntelligence } from '../lib/people-intelligence.js';
import handler from '../api/people.js';

const mission = { id: 'mission', planned_start: '2026-10-01', planned_end: '2026-10-10' };
const staff = { id: 'staff', skills: ['Audit'] };

test('skills precede people fit; missing evidence is not availability', () => {
  assert.equal(assessEligibility(staff, mission, { required_skills: ['Tax'] }, [], []).state, 'excluded');
  assert.deepEqual(assessEligibility(staff, mission, { required_skills: ['audit'] }, [], []),
    { technical: true, availability: null, state: 'manager_review_required' });
  assert.equal(assessEligibility(staff, mission, {}, [], []).technical, null);
});

test('approved absence or another active assignment excludes a candidate', () => {
  const absence = { staff_profile_id: 'staff', approved: true, starts_at: '2026-10-10T18:00:00Z', ends_at: '2026-10-11' };
  assert.equal(assessEligibility(staff, mission, {}, [absence], []).state, 'excluded');
  assert.equal(assessEligibility(staff, mission, {}, [], [{ staff_profile_id: 'staff', office_mission_id: 'other', status: 'active', planned_start: null, planned_end: null }]).state, 'excluded');
  assert.equal(assessEligibility(staff, { id: 'mission' }, {}, [], []).state, 'manager_review_required');
});

test('people route denies unauthorised requests before fetching data', async () => {
  process.env.OFFICE_MANAGER_ACCESS_TOKEN = 'test-only';
  const result = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } };
  await handler({ method: 'POST', headers: {}, body: {} }, result);
  assert.equal(result.code, 401);
  assert.deepEqual(result.value, { error: 'UNAUTHORIZED' });
});

test('staffing uses operational eligibility and includes workers without questionnaire', async () => {
  process.env.SUPABASE_URL = 'https://example.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    let rows;
    if (url.includes('/rpc/')) rows = [
      { staff_profile_id: 'staff', technical_eligible: true, available_for_window: true, current_load_pct: 30, profile_available: false, management_support: { instruction: 'Normal management' }, data_quality_flags: ['MISSION_DATES_MISSING'] },
      { staff_profile_id: 'unskilled', technical_eligible: false, available_for_window: true, current_load_pct: 0 },
      { staff_profile_id: 'absent', technical_eligible: true, available_for_window: false, current_load_pct: 0 },
      { staff_profile_id: 'overloaded', technical_eligible: true, available_for_window: true, current_load_pct: 100 }
    ];
    else if (url.includes('/office_missions?')) rows = [mission];
    else if (url.includes('/office_mission_people_requirements?')) rows = [{ required_skills: ['Tax'] }];
    else if (url.includes('/office_staff_profiles?')) rows = [staff];
    else rows = [];
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  try {
    const result = await getPeopleIntelligence('tenant-a', 'mission');
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].profile_available, false);
    assert.equal(result.candidates[0].eligibility.availability, null);
    assert.equal(result.candidates[0].people_fit_score, undefined);
    assert.ok(calls.some(call => call.url.includes('rpc/office_mission_staffing_advice')));
    assert.ok(!calls.some(call => call.url.includes('rpc/office_people_match')));
    assert.ok(calls.every(call => call.url.includes('org_id=eq.tenant-a') || JSON.parse(call.options.body).p_org_id === 'tenant-a'));
    assert.ok(calls.every(call => !call.options.method || call.options.method === 'POST' && call.url.includes('/rpc/')));
  } finally { globalThis.fetch = original; }
});
