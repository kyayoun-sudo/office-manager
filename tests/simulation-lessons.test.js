import test from 'node:test';
import assert from 'node:assert/strict';
import { genericProblem, draftLessons, sendLessons } from '../lib/simulation-lessons.js';
import { emptyLab, touchesProtected } from '../lib/shadow.js';
import { resetSimulationGuardCache } from '../lib/simulation-guard.js';

process.env.OFFICE_MANAGER_MULTI_CABINET = 'on';
const PARENT = '11111111-1111-4111-8111-111111111111', SIM = '22222222-2222-4222-8222-222222222222', REAL = '44444444-4444-4444-8444-444444444444';
const owner = { id: 'u-owner', email: 'o@c.test' }, junior = { id: 'u-jr', email: 'jr@c.test' };
const J = i => `00000000-0000-4000-8000-00000000000${i}`;

function world({ journal = 3, lab = {} } = {}) {
  const rows = Array.from({ length: journal }, (_, i) => ({ id: J(i + 1), at: '2026-11-21T10:0' + i + ':00Z', actor_email: 'o@c.test', agent: 'orpailleur', mission_id: null, kind: i % 2 ? 'reponse' : 'consigne', body: 'Texte du journal numéro ' + (i + 1), ref: null }));
  const members = [{ org_id: SIM, auth_user_id: 'u-owner', role: 'owner', active: true, email: 'o@c.test', display_name: 'Amadou Koné' }, { org_id: SIM, auth_user_id: 'u-jr', role: 'auditor', active: true, email: 'jr@c.test', display_name: 'Julie Dupont' }];
  const orgs = { [SIM]: { account_kind: 'simulation', parent_org_id: PARENT, name: 'Entraînement Société Atlas' }, [PARENT]: { account_kind: null, parent_org_id: null, name: 'Cabinet' }, [REAL]: { account_kind: null, parent_org_id: null, name: 'Autre' } };
  const labState = { ...emptyLab(), lessons: [{ id: 'L-seed', agent: 'sika', lesson: 'existante', rule: 'existante', type: 'firm_rule', status: 'active', history: [], evidence: [] }], ...lab };
  const audits = [];
  const fetchRows = async path => {
    if (path.startsWith('office_organizations?id=eq.')) { const r = orgs[/id=eq\.([^&]+)/.exec(path)[1]]; return r ? [r] : []; }
    if (path.startsWith('office_firm_drive')) return [{ drive_id: 'folder:abc' }];
    if (path.startsWith('office_app_users?')) { const org = /org_id=eq\.([^&]+)/.exec(path)[1], uid = /auth_user_id=eq\.([^&]+)/.exec(path)?.[1]; return members.filter(m => m.org_id === org && (!uid || m.auth_user_id === uid)).map(m => ({ ...m })); }
    if (path.startsWith('office_simulation_journal')) return [...rows].reverse();
    throw new Error('unexpected ' + path);
  };
  const d = { fetchRows, updateJsonFile: async (name, fn) => { await fn(labState); }, audit: async (o, e) => { audits.push({ o, e }); } };
  resetSimulationGuardCache();
  return { d, labState, audits };
}
const SENT = { ...{ agent: 'orpailleur', category: 'classement', situation: 'Un relevé a été rangé d’après son nom.', lesson: 'Lire le contenu avant de nommer.', rule: 'Ne jamais ranger un document d’après son seul nom.' }, refs: [J(1), J(2)] };
const ai = lessons => async () => ({ text: JSON.stringify({ lessons }) });
const GOOD = { agent: 'orpailleur', category: 'classement', situation: 'Un relevé a été rangé d’après son nom.', lesson: 'Lire le contenu avant de nommer.', rule: 'Ne jamais ranger un document d’après son seul nom.', refs: [1, 2] };

test('the generic check catches e-mails, web addresses, numbers and known names, and passes a general rule', () => {
  assert.equal(genericProblem('écrire à jean@client.com'), 'adresse e-mail');
  assert.equal(genericProblem('voir https://x.test'), 'adresse web');
  assert.equal(genericProblem('le solde de 1 250 000 FCFA'), 'nombre ou montant');
  assert.equal(genericProblem('facture 12345'), 'nombre ou montant');
  assert.match(genericProblem('chez société atlas', ['société atlas']), /nom connu/);
  assert.equal(genericProblem('Exercice 2024, contrôler les reports', []), null);
});

test('a draft keeps the general lesson, refuses e-mails and names, and stores nothing', async () => {
  const w = world();
  const bad = [{ ...GOOD, lesson: 'Écrire à amadou@atlas.com pour confirmer.' }, { ...GOOD, rule: 'Pour Entraînement Société Atlas, vérifier le solde.' }, { ...GOOD, agent: 'inconnu' }, { ...GOOD, refs: [] }];
  const out = await draftLessons(owner, PARENT, SIM, { ...w.d, runAI: ai([GOOD, ...bad]) });
  assert.equal(out.drafts.length, 1); assert.deepEqual(out.drafts[0].refs, [J(1), J(2)]);
  assert.equal(out.refused.length, 4); assert.equal(out.entries_read, 3);
  assert.equal(w.labState.lessons.length, 1); // only the seed
});

test('the draft needs the owner, a real simulation, a journal, and an AI that answers', async () => {
  const w = world();
  await assert.rejects(draftLessons(junior, PARENT, SIM, { ...w.d, runAI: ai([GOOD]) }), /NOT_SIMULATION_OWNER/);
  await assert.rejects(draftLessons(owner, PARENT, REAL, { ...w.d, runAI: ai([GOOD]) }), /NOT_A_SIMULATION/);
  await assert.rejects(draftLessons(owner, PARENT, SIM, { ...world({ journal: 1 }).d, runAI: ai([GOOD]) }), /JOURNAL_TOO_SHORT/);
  await assert.rejects(draftLessons(owner, PARENT, SIM, { ...w.d, runAI: async () => { throw new Error('down'); } }), /LESSON_AI_UNAVAILABLE/);
  await assert.rejects(draftLessons(owner, PARENT, SIM, { ...w.d, runAI: async () => ({ text: 'pas du json' }) }), /LESSON_AI_UNREADABLE/);
  assert.equal(w.labState.lessons.length, 1);
});

test('a sent lesson waits in the parent lab: under review, needs an owner, never active, evidence = ids only', async () => {
  const w = world();
  const r = await sendLessons(owner, PARENT, SIM, { lessons: [SENT] }, w.d);
  assert.equal(r.written.length, 1); assert.equal(r.refused.length, 0);
  const l = w.labState.lessons.find(x => x.id === r.written[0].id);
  assert.equal(l.status, 'under_review'); assert.equal(l.needs_owner, true); assert.equal(l.type, 'hypothesis'); assert.equal(l.source, 'simulation:' + SIM);
  assert.deepEqual(l.evidence, ['simulation:' + SIM, J(1), J(2)]);
  assert.equal(JSON.stringify(l).includes('Texte du journal'), false);
  assert.equal(w.audits[0].o, PARENT); assert.equal(w.audits[0].e.action_type, 'SIMULATION_LESSONS_SENT');
});

test('sending revalidates: edited text with a name or e-mail, an unknown agent or a protected zone are refused', async () => {
  const w = world();
  const protectedText = ['Réduire les contrôles et supprimer la validation humaine des envois externes.', 'Désactiver la signature et l’indépendance.'].find(t => touchesProtected(t + ' ' + t));
  const lessons = [{ ...SENT, lesson: 'Prévenir Julie Dupont.' }, { ...SENT, rule: 'mail amadou@x.com' }, { ...SENT, agent: 'x' }, ...(protectedText ? [{ ...SENT, lesson: protectedText, rule: protectedText }] : []), SENT];
  const r = await sendLessons(owner, PARENT, SIM, { lessons }, w.d);
  assert.equal(r.written.length, 1); assert.equal(r.refused.length, lessons.length - 1);
  assert.ok(protectedText, 'a protected phrase exists for this test');
  await assert.rejects(sendLessons(junior, PARENT, SIM, { lessons: [SENT] }, w.d), /NOT_SIMULATION_OWNER/);
  await assert.rejects(sendLessons(owner, PARENT, SIM, { lessons: [] }, w.d), /NO_LESSONS/);
});

test('a lesson already known is merged, and 20 pending lessons from one simulation is the ceiling', async () => {
  const w = world();
  const first = await sendLessons(owner, PARENT, SIM, { lessons: [SENT] }, w.d);
  const again = await sendLessons(owner, PARENT, SIM, { lessons: [SENT] }, w.d);
  assert.equal(first.written.length, 1); assert.equal(again.merged.length, 1); assert.equal(again.written.length, 0);
  const full = world({ lab: { lessons: Array.from({ length: 20 }, (_, i) => ({ id: 'P' + i, agent: 'sika', lesson: 'l' + i, rule: 'r' + i, type: 'hypothesis', status: 'under_review', source: 'simulation:' + SIM, history: [], evidence: [] })) } });
  const r = await sendLessons(owner, PARENT, SIM, { lessons: [{ ...SENT, lesson: 'Autre leçon générale.', rule: 'Autre règle générale.' }] }, full.d);
  assert.equal(r.written.length, 0); assert.match(r.refused[0].why, /plafond/);
});
