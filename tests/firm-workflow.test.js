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
