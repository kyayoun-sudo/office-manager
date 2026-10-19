import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../lib/firm-workflow.js';

// Point 1 (Paul, 2026-10-19): the firm's workflow, one per mission type, versioned; the AI proposes from the firm's
// document, a partner confirms; only the gates block, and going past one needs a reason, traced.

const partner = { role: 'partner', email: 'p@c.ci', display_name: 'Associé' };
const manager = { role: 'manager', email: 'm@c.ci' };
const auditor = { role: 'auditor', email: 'a@c.ci' };

function base() {
  const t = { rows: [], audits: [], missions: {} };
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_firm_workflows')) {
      if (o.method === 'POST') { const r = { id: 'w' + (t.rows.length + 1), updated_at: 'u' + Math.random(), ...JSON.parse(o.body)[0] }; t.rows.push(r); return [r]; }
      if (o.method === 'PATCH') {
        const id = decodeURIComponent(path.match(/[?&]id=eq\.([^&]+)/)[1]); const r = t.rows.find(x => x.id === id);
        if (path.includes('status=eq.draft') && r.status !== 'draft') return [];
        Object.assign(r, JSON.parse(o.body), { updated_at: 'u' + Math.random() }); return [r];
      }
      const type = path.match(/mission_type=eq\.([^&]+)/)?.[1], status = path.match(/status=eq\.([^&]+)/)?.[1];
      return t.rows.filter(r => (!type || r.mission_type === decodeURIComponent(type)) && (!status || r.status === status)).sort((a, b) => b.version - a.version);
    }
    if (path.startsWith('office_audit_events')) { t.audits.push(...JSON.parse(o.body)); return []; }
    if (path.startsWith('office_missions') && o.method === 'PATCH') { t.missions.patch = JSON.parse(o.body); return []; }
    return [];
  };
  return { t, d: { fetchRows, audit: async (org, e) => { t.audits.push(e); } } };
}

test('the built-in path is the path the application already had, plus the report and the closing; gates where a decision is required', () => {
  const ids = W.DEFAULT_STEPS.map(s => s.id);
  assert.deepEqual(ids.slice(0, 3), ['reception', 'decision', 'team']);
  assert.deepEqual(ids.slice(-2), ['report', 'closure']);
  assert.equal(ids.includes('learning'), false, 'Shadow is not a step of a mission');
  assert.deepEqual(W.DEFAULT_STEPS.filter(s => s.gate).map(s => s.id), ['decision', 'acceptance', 'programme', 'review', 'report']);
  assert.ok(W.DEFAULT_STEPS.every(s => s.responsible.length && s.outcomes.includes('continue')));
});

test('steps are cleaned: closed lists, unique ids, a responsible required', () => {
  assert.throws(() => W.cleanSteps([{ label: 'X', responsible: ['nobody'] }]), /WORKFLOW_STEP_RESPONSIBLE_REQUIRED/);
  assert.throws(() => W.cleanSteps([]), /WORKFLOW_STEPS_REQUIRED/);
  const s = W.cleanSteps([{ label: 'Réception', responsible: ['secretary', 'boss'], outcomes: ['refuse', 'fly'], gate: 'yes', detector: 'nope' }, { label: 'Réception', responsible: ['bdm'] }]);
  assert.deepEqual(s[0].responsible, ['secretary']); assert.deepEqual(s[0].outcomes, ['continue', 'refuse']);
  assert.equal(s[0].gate, false, 'only true is a gate'); assert.equal(s[0].detector, null);
  assert.notEqual(s[0].id, s[1].id);
});

test('versions: a partner writes a draft and confirms it; the previous version is superseded; nobody else edits', async () => {
  const { t, d } = base();
  await assert.rejects(W.saveWorkflowDraft('org', { mission_type: 'project', steps: W.DEFAULT_STEPS }, manager, d), /PARTNER_EDITS_WORKFLOW/);
  await assert.rejects(W.saveWorkflowDraft('org', { mission_type: 'space', steps: W.DEFAULT_STEPS }, partner, d), /UNKNOWN_MISSION_TYPE/);
  const v1 = await W.saveWorkflowDraft('org', { mission_type: 'project', steps: W.DEFAULT_STEPS.slice(0, 5) }, partner, d);
  assert.equal(v1.workflow.version, 1);
  await W.confirmWorkflow('org', { mission_type: 'project' }, partner, d);
  assert.equal(t.rows[0].status, 'confirmed'); assert.equal(t.audits.at(-1).action_type, 'WORKFLOW_CONFIRMED');
  // Changing after confirmation = a new version; the confirmed one is never touched.
  const v2 = await W.saveWorkflowDraft('org', { mission_type: 'project', steps: W.DEFAULT_STEPS }, partner, d);
  assert.equal(v2.workflow.version, 2); assert.equal(t.rows[0].steps.length, 5);
  await assert.rejects(W.saveWorkflowDraft('org', { mission_type: 'project', steps: W.DEFAULT_STEPS, expected_updated_at: 'stale' }, partner, d), /WORKFLOW_CHANGED_RELOAD/);
  await W.confirmWorkflow('org', { mission_type: 'project' }, partner, d);
  assert.deepEqual(t.rows.map(r => r.status), ['superseded', 'confirmed']);
  await assert.rejects(W.confirmWorkflow('org', { mission_type: 'project' }, partner, d), /NO_WORKFLOW_DRAFT/);
  // A project mission follows its own; a statutory audit the common one; without anything, the built-in path.
  assert.equal((await W.effectiveWorkflow('org', 'project', d.fetchRows)).version, 2);
  assert.equal((await W.effectiveWorkflow('org', 'statutory', d.fetchRows)).builtin, true);
  await W.saveWorkflowDraft('org', { mission_type: 'default', steps: W.DEFAULT_STEPS.slice(10) }, partner, d);
  await W.confirmWorkflow('org', { mission_type: 'default' }, partner, d);
  assert.equal((await W.effectiveWorkflow('org', 'statutory', d.fetchRows)).mission_type, 'default');
  const list = await W.listWorkflows('org', auditor, d);
  assert.equal(list.may_edit, false); assert.equal(list.types.find(x => x.mission_type === 'project').history.length, 2);
});

test('a direct mission skips the opportunity steps; the current step is the first not done', () => {
  const wf = { mission_type: 'default', version: 0, builtin: true, steps: W.DEFAULT_STEPS };
  const st = W.workflowState(wf, { acceptance: 'recorded', programme: 'pending' }, {}, { hasOpportunity: false });
  assert.equal(st.steps.find(s => s.id === 'reception').state, 'not_applicable');
  assert.equal(st.steps.find(s => s.id === 'acceptance').state, 'recorded');
  assert.equal(st.current, 'risks');
  const withOpp = W.workflowState(wf, {}, {}, { hasOpportunity: true });
  assert.equal(withOpp.current, 'reception');
});

function mission(states = {}, position = {}, team = []) {
  const wf = W.workflowState({ mission_type: 'default', version: 0, builtin: true, steps: W.DEFAULT_STEPS }, states, position, { hasOpportunity: false });
  return async () => ({ workflow: wf, position, team });
}

test('outcomes: the responsible acts; a gate needs the decision or a reason from the manager / a partner; all traced', async () => {
  const { t, d } = base();
  const team = [{ email: 'm@c.ci', mission_function: 'manager' }, { email: 'a@c.ci', mission_function: 'auditor' }, { email: 'm2@c.ci', mission_function: 'senior' }];
  // risks: auditor or manager. The auditor continues.
  const r1 = await W.advanceMission('org', { mission_id: 'M', outcome: 'continue' }, auditor, { ...d, missionWorkflow: mission({ acceptance: 'recorded' }, {}, team) });
  assert.equal(r1.next, 'analytical'); assert.equal(t.missions.patch.workflow.history[0].by, 'a@c.ci');
  // A senior grade not holding the function on this mission: refused.
  await assert.rejects(W.advanceMission('org', { mission_id: 'M', outcome: 'continue' }, { role: 'senior', email: 'x@c.ci' }, { ...d, missionWorkflow: mission({ acceptance: 'recorded' }, { step: 'analytical' }, team) }), /STEP_HELD_BY_OTHER/);
  // Gate: programme not validated in the application.
  const atProgramme = { step: 'programme', history: [] };
  await assert.rejects(W.advanceMission('org', { mission_id: 'M', outcome: 'continue' }, manager, { ...d, missionWorkflow: mission({ acceptance: 'recorded' }, atProgramme, team) }), /GATE_NOT_PASSED/);
  const over = await W.advanceMission('org', { mission_id: 'M', outcome: 'continue', reason: 'Programme validé sur papier, saisie demain' }, manager, { ...d, missionWorkflow: mission({ acceptance: 'recorded' }, atProgramme, team) });
  assert.equal(over.gate_override, true); assert.equal(t.audits.at(-1).action_type, 'WORKFLOW_STEP_CONTINUE_GATE_OVERRIDE');
  // Programme validated: the gate is open, no reason needed.
  const open = await W.advanceMission('org', { mission_id: 'M', outcome: 'continue' }, manager, { ...d, missionWorkflow: mission({ acceptance: 'recorded', programme: 'recorded' }, atProgramme, team) });
  assert.equal(open.gate_override, false);
  // Complement / return need a reason; return reopens the earlier step; refuse is a partner's.
  await assert.rejects(W.advanceMission('org', { mission_id: 'M', outcome: 'complement' }, auditor, { ...d, missionWorkflow: mission({}, { step: 'analytical' }, team) }), /REASON_REQUIRED/);
  const back = await W.advanceMission('org', { mission_id: 'M', outcome: 'return', reason: 'Risques à revoir' }, auditor,
    { ...d, missionWorkflow: mission({ acceptance: 'recorded' }, { step: 'analytical', history: [{ step: 'risks', outcome: 'continue', by: 'a@c.ci', at: 't' }] }, team) });
  assert.equal(back.next, 'risks'); assert.ok(t.missions.patch.workflow.history[0].undone, 'the earlier « continue » no longer counts');
  await assert.rejects(W.advanceMission('org', { mission_id: 'M', outcome: 'refuse', reason: 'x' }, manager, { ...d, missionWorkflow: mission({}, { step: 'acceptance' }, team) }), /PARTNER_REFUSES/);
  const refused = await W.advanceMission('org', { mission_id: 'M', outcome: 'refuse', reason: 'Conflit d’intérêts' }, partner, { ...d, missionWorkflow: mission({}, { step: 'acceptance' }, team) });
  assert.equal(refused.status, 'refused');
  await assert.rejects(W.advanceMission('org', { mission_id: 'M', outcome: 'continue', step: 'risks' }, manager, { ...d, missionWorkflow: mission({ acceptance: 'recorded' }, { step: 'analytical' }, team) }), /WORKFLOW_STEP_CHANGED_RELOAD/);
});

test('the firm document is read by the AI as a PROPOSAL: a draft, passages checked word for word, never without the firm grant', async () => {
  const { t, d } = base();
  const text = 'Étape 1 : la secrétaire enregistre le TDR reçu. Étape 2 : l’associé décide de poursuivre ou non avant toute offre.';
  let called = 0;
  const deps = { ...d, references: async () => [{ document_type: 'firm_workflow', file_id: 'F1' }], documentText: async () => ({ meta: { id: 'F1', name: 'Workflow TATY.docx' }, text }),
    permissions: async () => ({ granted: true }),
    ai: async () => { called++; return { provider: 'mock', text: JSON.stringify({ steps: [
      { label: 'Réception du TDR', responsible: ['secretary'], detector: 'reception', source: { excerpt: 'la secrétaire enregistre le TDR reçu' } },
      { label: 'Décision de poursuivre', responsible: ['partner'], gate: true, outcomes: ['continue', 'refuse'], source: { excerpt: 'l’associé valide tout seul' } },
      { label: 'Étape sans responsable connu', responsible: ['boss'] }], unclear: ['Qui envoie l’offre ?'] }) }; } };
  await assert.rejects(W.proposeFromDocument('org', { mission_type: 'default' }, partner, { ...deps, permissions: async () => ({ granted: false }) }), /AGENTS_NOT_AUTHORIZED/);
  assert.equal(called, 0);
  const r = await W.proposeFromDocument('org', { mission_type: 'default' }, partner, deps);
  assert.equal(r.workflow.status, 'draft', 'never confirmed by the AI');
  assert.deepEqual(r.unverified, ['Décision de poursuivre', 'Étape sans responsable connu']);
  assert.equal(r.workflow.steps[0].source.verified, true);
  assert.deepEqual(r.workflow.steps[2].responsible, ['manager'], 'unknown responsible: proposed to the manager, to correct');
  assert.deepEqual(r.unclear, ['Qui envoie l’offre ?']);
  assert.equal(t.rows[0].source.name, 'Workflow TATY.docx');
  await assert.rejects(W.proposeFromDocument('org', { mission_type: 'default' }, partner, { ...deps, references: async () => [] }), /WORKFLOW_DOCUMENT_NOT_CONFIGURED/);
});

// The rest of point 1: the step waiting for each person, stuck steps, the same for the agents and the bell.
function overviewWorld() {
  const now = Date.parse('2026-10-19T10:00:00Z');
  const missions = [
    { id: 'M1', name: 'Audit projet PRJ', engagement_type: 'project', status: 'fieldwork', created_at: '2026-10-01T00:00:00Z', followups: { acceptance: { status: 'done' } },
      workflow: { step: 'programme', history: [{ step: 'analytical', outcome: 'continue', at: '2026-10-08T00:00:00Z' }] } },
    { id: 'M2', name: 'CAC Société X', engagement_type: 'statutory', status: 'fieldwork', created_at: '2026-10-18T00:00:00Z', followups: {}, workflow: {} },
    { id: 'M3', name: 'Ancienne mission', status: 'archived', created_at: '2025-01-01T00:00:00Z' }
  ];
  const fetchRows = async (path) => {
    if (path.startsWith('office_missions')) { const ids = path.match(/[?&]id=in\.\(([^)]*)\)/)?.[1]; return ids ? missions.filter(m => ids.split(',').map(decodeURIComponent).includes(m.id)) : missions; }
    if (path.startsWith('office_mission_assignments')) return [
      { office_mission_id: 'M1', staff_profile_id: 's1', mission_function: 'manager', status: 'confirmed' },
      { office_mission_id: 'M2', staff_profile_id: 's2', mission_function: 'manager', status: 'confirmed' },
      { office_mission_id: 'M2', staff_profile_id: 's1', mission_function: 'senior', status: 'confirmed' }];
    if (path.startsWith('office_staff_profiles')) return [{ id: 's1', full_name: 'Awa', email: 'awa@c.ci' }, { id: 's2', full_name: 'Kofi', email: 'kofi@c.ci' }];
    return [];
  };
  return { now, d: { fetchRows, now, settings: async () => ({ workflow_stuck_days: 7 }), accessibleMissionIds: async () => null } };
}

test('overview: where each open mission waits, for whom, since when; stuck after the firm\'s days', async () => {
  const { d } = overviewWorld();
  const awa = { role: 'manager', email: 'awa@c.ci' };
  const o = await W.workflowOverview('org', awa, d);
  assert.deepEqual(o.items.map(x => x.mission_id), ['M1', 'M2'], 'an archived mission is not followed');
  const m1 = o.items.find(x => x.mission_id === 'M1');
  assert.equal(m1.step.id, 'programme'); assert.equal(m1.days, 11); assert.equal(m1.stuck, true);
  assert.equal(m1.mine, true, 'Awa is the manager of M1, the programme is the manager\'s');
  assert.deepEqual(m1.waiting_for, ['Awa']);
  const m2 = o.items.find(x => x.mission_id === 'M2');
  // M2: a direct mission without acceptance recorded → the acceptance step, which is the manager's (Kofi), not Awa's (senior there).
  assert.equal(m2.step.id, 'acceptance'); assert.equal(m2.mine, false); assert.equal(m2.stuck, false); assert.deepEqual(m2.waiting_for, ['Kofi']);
  // The agents see the same, without a person (mine = false).
  const agents = await W.workflowOverview('org', null, d);
  assert.equal(agents.items.length, 2); assert.ok(agents.items.every(x => x.mine === false));
});

test('the bell: « une étape vous attend » for the person, « étape bloquée » for the mission\'s manager and the partners', async () => {
  const { buildNotifications } = await import('../lib/notifications.js');
  const { d } = overviewWorld();
  const o = await W.workflowOverview('org', { role: 'partner', email: 'p@c.ci' }, d);
  const stuck = o.items.filter(x => x.stuck && x.lead);
  assert.equal(stuck.length, 1);
  const n = buildNotifications({ kpis: [] }, { workflowSteps: [o.items[1]], workflowStuck: stuck });
  assert.deepEqual(n.map(x => x.type).sort(), ['workflow_step', 'workflow_stuck']);
  assert.ok(n.every(x => x.action_required && x.href.startsWith('/dossiers.html?mission_id=')));
  assert.match(n.find(x => x.type === 'workflow_stuck').title, /bloquée depuis 11 j/);
});

// Security review (2026-10-19): a mission asked for never widens a person's access (the agents' tool passes the requester).
test('overview: a mission outside the person\'s staffing is never returned, even when asked for by id', async () => {
  const { d } = overviewWorld();
  const awa = { role: 'auditor', email: 'awa@c.ci' };
  const scoped = { ...d, accessibleMissionIds: async () => new Set(['M1']) };
  assert.deepEqual((await W.workflowOverview('org', awa, { ...scoped, missionIds: ['M2'] })).items, []);
  assert.deepEqual((await W.workflowOverview('org', awa, { ...scoped, missionIds: ['M1', 'M2'] })).items.map(x => x.mission_id), ['M1']);
});

// The link mission ← opportunity (2026-10-19, Paul: « règle cette limite »).
test('a mission from an opportunity: its steps before the mission are over (passed or recorded), never the current one', () => {
  const wf = { mission_type: 'default', version: 0, builtin: true, steps: W.DEFAULT_STEPS };
  const st = W.workflowState(wf, { reception: 'recorded', decision: 'recorded', acceptance: 'recorded' }, {}, { hasOpportunity: true, missionStarted: true });
  assert.equal(st.steps.find(s => s.id === 'decision').state, 'recorded');
  assert.equal(st.steps.find(s => s.id === 'method').state, 'passed', 'not seen by the application: said so, not « done »');
  assert.equal(st.current, 'risks');
  // The acceptance is « both »: a mission whose opportunity has no accepted KYC stops there.
  assert.equal(W.workflowState(wf, { decision: 'recorded' }, {}, { hasOpportunity: true, missionStarted: true }).current, 'acceptance');
});

test('overview: missions carry their opportunity; open opportunities show their own step, to whom it belongs', async () => {
  const { d } = overviewWorld();
  const won = { id: 'O1', mission_id: 'M2', title: 'AMI Banque', status: 'won', tdr_files: [{ id: 't' }], kyc_review: { status: 'accepted' } };
  const open = { id: 'O2', title: 'TDR Ministère', client: 'Ministère', status: 'phase0', tdr_files: [{ id: 't' }], updated_at: '2026-10-01T00:00:00Z', team: { members: [{ email: 'awa@c.ci' }] } };
  const deps = { ...d, opportunityLinks: async () => ({ byMission: new Map([['M2', won]]), open: [open] }),
    settings: async () => ({ workflow_stuck_days: 7, business_partner: { name: 'Paul', email: 'paul@c.ci' } }) };
  const paul = await W.workflowOverview('org', { role: 'partner', email: 'paul@c.ci' }, deps);
  const m2 = paul.items.find(x => x.mission_id === 'M2');
  assert.equal(m2.opportunity_id, 'O1'); assert.notEqual(m2.step.id, 'acceptance', 'the KYC accepted on the opportunity counts');
  const o2 = paul.items.find(x => x.opportunity_id === 'O2' && !x.mission_id);
  assert.equal(o2.step.id, 'decision'); assert.equal(o2.mine, true, 'the designated business-development partner decides');
  assert.equal(o2.stuck, true); assert.equal(o2.href, '/opportunites.html?id=O2');
  const other = await W.workflowOverview('org', { role: 'partner', email: 'p2@c.ci' }, deps);
  assert.equal(other.items.find(x => x.opportunity_id === 'O2' && !x.mission_id).mine, false, 'another partner sees it, not his decision');
  const zoe = await W.workflowOverview('org', { role: 'auditor', email: 'zoe@c.ci' }, { ...deps, accessibleMissionIds: async () => new Set() });
  assert.equal(zoe.items.length, 0, 'not on its team: not shown');
  const awa = await W.workflowOverview('org', { role: 'manager', email: 'awa@c.ci' }, deps);
  assert.ok(awa.items.some(x => x.opportunity_id === 'O2'), 'on its team: shown');
  const awaNoMission = await W.workflowOverview('org', { role: 'senior', email: 'awa@c.ci' }, { ...deps, accessibleMissionIds: async () => new Set() });
  assert.deepEqual(awaNoMission.items.map(x => x.opportunity_id), ['O2'], 'no mission yet: the opportunity of her team still shows');
  const auditorTeam = await W.workflowOverview('org', { role: 'auditor', email: 'awa@c.ci' }, { ...deps, accessibleMissionIds: async () => new Set() });
  assert.equal(auditorTeam.items.length, 0, 'the firm gives auditors no Opportunités screen: not shown (security review)');
  assert.equal((await W.workflowOverview('org', { role: 'partner', email: 'paul@c.ci' }, { ...deps, missionIds: ['M1'] })).items.length, 1, 'one mission asked: only it');
});
