import test from 'node:test';
import assert from 'node:assert/strict';

test('Firm Manager asks one question about a real situation; the answer becomes a validated observation', async () => {
  const pq = await import('../lib/people-questions.js');
  const now = Date.parse('2026-10-08T12:00:00Z');
  const facts = {
    staff: [{ id: 's1', full_name: 'Awa K.' }, { id: 's2', full_name: 'Yao B.' }],
    missions: [{ id: 'm1', name: 'Audit BLE TRANSIT 2025' }],
    actions: [
      { id: 'a1', assigned_staff_profile_id: 's1', office_mission_id: 'm1', summary: 'Circularisation clients', due_at: '2026-10-01T00:00:00Z', executed_at: '2026-10-07T00:00:00Z' },
      { id: 'a2', assigned_staff_profile_id: 's1', summary: 'Revue analytique', due_at: '2026-10-01T00:00:00Z', executed_at: '2026-10-05T00:00:00Z' },
      { id: 'a3', assigned_staff_profile_id: 's2', summary: 'Inventaire', due_at: '2026-10-10T00:00:00Z', executed_at: '2026-10-06T00:00:00Z' }
    ],
    assignments: [{ staff_profile_id: 's2', office_mission_id: 'm1', planned_end: '2026-10-01' }]
  };
  const sit = pq.situations(facts, now);
  assert.equal(sit[0].staff_id, 's1'); assert.match(sit[0].situation, /6 jours après l’échéance/);
  let file = null;
  const updateJsonFile = async (name, f) => { const n = await f(file ? structuredClone(file) : null); if (n) file = n; return {}; };
  const r = await pq.askQuestions('org', { loadFacts: async () => facts, updateJsonFile, now: () => now });
  assert.equal(r.created, 2);                                        // one open question per person
  assert.deepEqual(Object.values(file.questions).map(x => x.staff_id).sort(), ['s1', 's2']);
  const again = await pq.askQuestions('org', { loadFacts: async () => facts, updateJsonFile, now: () => now });
  assert.equal(again.created, 0);                                    // never twice
  const key = Object.keys(file.questions).find(k => file.questions[k].staff_id === 's1');
  const obs = [];
  const out = await pq.answerQuestion('org', { key, answer: 'Elle a reçu la liste des clients tard.' }, 'Paul', { updateJsonFile, addObservation: async (o, input, by, validated) => { obs.push({ input, validated }); return { id: 'o1' }; } });
  assert.equal(out.answered, true);
  assert.equal(obs[0].validated, true); assert.equal(obs[0].input.staff_profile_id, 's1');
  assert.match(obs[0].input.observation, /Circularisation clients.*reçu la liste/);
  await assert.rejects(() => pq.answerQuestion('org', { key, answer: 'encore' }, 'Paul', { updateJsonFile }), /QUESTION_NOT_OPEN/);
});

test('a member of the firm found in the HR documents is added to Équipe; consultants and people of a proposal are not', async () => {
  const { applyCapabilities, mergePerson } = await import('../lib/capabilities.js');
  const posted = [];
  const fetchRows = async (path, o = {}) => { if (o.method === 'POST') { const row = JSON.parse(o.body)[0]; posted.push(row); return [{ id: 'new', ...row }]; } return []; };
  const firmMembers = async () => ({ members: [{ full_name: 'Awa Koné', email: 'awa@taty.info' }] });
  const r = await applyCapabilities('org', [{ full_name: 'Awa Koné', kind: 'employee', email: 'awa@taty.info', current_title: 'Senior', technical_skills: ['Audit'] }, { full_name: 'Expert Externe', kind: 'consultant' },
    { full_name: 'Serhii Kovchenko', kind: 'employee', current_title: 'Expert (offre IMPLUS)' }], { fetchRows, firmMembers });
  assert.equal(r.staff_added, 1); assert.equal(posted[0].full_name, 'Awa Koné'); assert.equal(posted[0].profile_status, 'needs_review');
  const list = [{ full_name: 'Awa Koné', work_preferences: { autonomy: 'élevée' } }];
  mergePerson(list, { full_name: 'Awa Koné', work_preferences: { motivation: 'apprendre', autonomy: '' } });
  assert.deepEqual(list[0].work_preferences, { autonomy: 'élevée', motivation: 'apprendre' });
});

test('who is in the firm: team sheet ∪ users of the app ∪ confirmed; others leave Équipe (deactivated) only if the sheet was read', async () => {
  const fm = await import('../lib/firm-members.js');
  const staff = [
    { id: 's1', full_name: 'Yann Kouadio', email: null, active: true, profile_status: 'needs_review' },
    { id: 's2', full_name: 'Serhii Kovchenko', active: true, profile_status: 'needs_review' },
    { id: 's3', full_name: 'Walid', active: true, profile_status: 'needs_review' },
    { id: 's4', full_name: 'Awa Koné', email: 'awa@taty.info', active: true, profile_status: 'validated' },
    { id: 's5', full_name: '[ENTRAINEMENT] Chef fictif', active: true, profile_status: 'needs_review' }
  ];
  const patched = [];
  const fetchRows = async (path, o = {}) => {
    if (o.method === 'PATCH') { patched.push(/id=eq\.([^&]+)/.exec(path.split('&').slice(1).join('&'))?.[1] || path); return []; }
    if (path.startsWith('office_app_users')) return [{ email: 'paul@taty.info', display_name: 'Paul Taty', role: 'owner' }];
    if (path.startsWith('office_staff_profiles')) return staff;
    return [];
  };
  const teamSheetMembers = async () => ({ members: [{ full_name: 'Yann Kouadio', email: 'yann@taty.info', role: 'Senior' }], source: 'TATY_EQUIPE_RESPONSABLES' });
  const f = await fm.firmMembers('org', { fetchRows, teamSheetMembers });
  assert.deepEqual(f.members.map(m => m.full_name).sort(), ['Awa Koné', 'Paul Taty', 'Yann Kouadio']);
  const r = await fm.cleanTeam('org', { fetchRows, teamSheetMembers });
  assert.deepEqual(r.cleaned.sort(), ['Serhii Kovchenko', 'Walid', '[ENTRAINEMENT] Chef fictif'].sort());
  // Without the team sheet read, nobody is taken out.
  const none = await fm.cleanTeam('org', { fetchRows, teamSheetMembers: async () => ({ members: [], reason: 'TEAM_SHEET_NOT_FOUND' }) });
  assert.deepEqual(none.cleaned, []);
  assert.equal(fm.isMember(f.members, { full_name: 'Yann' }), false);   // one first name alone is not enough
});
