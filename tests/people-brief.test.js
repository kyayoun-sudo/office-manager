import test from 'node:test';
import assert from 'node:assert/strict';
import { peopleBrief } from '../lib/people-brief.js';

test('Équipe et briefing: the firm policy and the app rules go to the AI; briefings per person come back; nothing is assigned', async () => {
  const M = '11111111-1111-4111-8111-111111111111';
  const fetchRows = async (path) => {
    if (path.startsWith('office_missions')) return [{ id: M, name: 'CAC Nova 2026' }];
    if (path.startsWith('office_staff_profiles')) return [{ id: 's1', full_name: 'Fatim', role_title: 'Junior', skills: ['AP'] }, { id: 's2', full_name: 'Yvan', role_title: 'Senior' }];
    if (path.startsWith('office_mission_assignments')) return [{ office_mission_id: M, staff_profile_id: 's1', mission_role: 'AP testing', allocation_pct: 50 }];
    return [];
  };
  let input = '';
  const r = await peopleBrief('org', M, { fetchRows, loadPolicy: async () => ({ text: '# FATIM — COMMUNICATION PROTOCOL\n- clear, reassuring' }),
    runAI: async (o) => { input = o.input; return { text: JSON.stringify({ team: [{ full_name: 'Fatim', leadership_style: 'S1', briefing: 'Fatim, voici la SOP…' }], raci: [], alerts: [{ type: 'supervision', message: 'x' }] }) }; } });
  assert.match(input, /R011/); assert.match(input, /FATIM — COMMUNICATION PROTOCOL/); assert.match(input, /"load_pct":50/);
  assert.equal(r.policy_used, true); assert.equal(r.team[0].leadership_style, 'S1'); assert.match(r.notice, /rien n’est affecté/);
});
