import test from 'node:test';
import assert from 'node:assert/strict';
import { locateRequiredDocument, confirmDocumentReference, confirmDocumentUnavailable } from '../lib/file-index.js';
import { receptionDate, ficheWrites, findTemplate, ownerWorkflowOverride, setReceptionDate } from '../lib/opportunities.js';
import { SENDERS, mayRecordSending } from '../lib/secretariat.js';

function setup() {
  let state = { files: {} }; const calls = [];
  const files = { f1: { id: 'f1', name: 'Quotation_Template.xlsx', modifiedTime: 'v1', mimeType: 'application/xlsx' } };
  const d = { folder: 'memory', drive: {
    findFilesByExactName: async () => [{ id: 'index' }], downloadBuffer: async () => Buffer.from(JSON.stringify(state)),
    getMeta: async id => files[id] || null,
    searchFiles: async () => { calls.push('search'); return Object.values(files); },
    readText: async id => { calls.push('read:' + id); return { supported: true, text: 'Blank quotation template with team and expense inputs', file: files[id] }; }
  }, updateJsonFile: async (name, fn) => { state = fn(state); return { state }; },
    ai: async () => { calls.push('analysis'); return { text: JSON.stringify({ file_id: 'f1', confidence: 96, ambiguous: false, reason: 'Blank template' }) }; } };
  return { d, calls, files, state: () => state };
}
const request = { document_type: 'quotation', document_role: 'template', requested_by_agent: 'mission-controller' };

test('required document: memory → mission → Drive → Orpailleur reads/analyzes; nothing moved or created', async () => {
  const { d, calls } = setup();
  const result = await locateRequiredDocument('org', request, d);
  assert.equal(result.status, 'FOUND'); assert.equal(result.confidence, 96);
  assert.deepEqual(result.steps, ['memory', 'mission', 'drive', 'orpailleur_analysis']);
  assert.deepEqual(calls, ['search', 'read:f1', 'analysis']);
  assert.equal(result.file.text, undefined, 'contents are not exposed back to the UI');
});

test('human confirmation remembers role/scope/version; same version reused, changed version requires confirmation', async () => {
  const { d, calls, files, state } = setup();
  await confirmDocumentReference('org', { ...request, file_id: 'f1' }, { role: 'manager', email: 'manager@example.org' }, d);
  const record = Object.values(state().references)[0];
  assert.equal(record.requested_by_agent, 'mission-controller'); assert.equal(record.confirmed_by, 'manager@example.org');
  assert.equal((await locateRequiredDocument('org', request, d)).status, 'FOUND');
  assert.equal((await locateRequiredDocument('org', { ...request, mission_id: 'new-mission', period: '2027' }, d)).confidence, 100, 'firm default template reused on a new mission');
  assert.deepEqual(calls, [], 'confirmed current version does not repeat the search');
  files.f1.modifiedTime = 'v2';
  assert.equal((await locateRequiredDocument('org', request, d)).reason, 'CONFIRMED_DOCUMENT_CHANGED');
  await confirmDocumentReference('org', { ...request, file_id: 'f1' }, { role: 'owner', email: 'owner@example.org' }, d);
  assert.equal(state().reference_history.length, 1);
  assert.equal((await locateRequiredDocument('org', request, d)).reference.version, 'v2');
});

test('no silent choice on ambiguous, unreadable, low confidence or invented candidates; no false absence', async () => {
  for (const decision of [{ file_id: 'f1', confidence: 99, ambiguous: true }, { file_id: 'other', confidence: 99, ambiguous: false }, { file_id: 'f1', confidence: 54, ambiguous: false }]) {
    const { d } = setup(); d.ai = async () => ({ text: JSON.stringify(decision) });
    const result = await locateRequiredDocument('org', request, d);
    assert.equal(result.status, 'ASK_USER'); assert.equal(result.availability, 'NOT_FOUND_YET');
  }
  const { d } = setup(); d.drive.readText = async () => ({ supported: false });
  assert.equal((await locateRequiredDocument('org', request, d)).status, 'ASK_USER');
});

test('confirmed locations never cross organisations, missions or template/active roles; unauthorized confirmation refused', async () => {
  const { d } = setup();
  await confirmDocumentReference('org', { ...request, file_id: 'f1' }, { role: 'owner', email: 'owner@example.org' }, d);
  assert.notEqual((await locateRequiredDocument('other-org', request, d)).confidence, 100);
  assert.notEqual((await locateRequiredDocument('org', { ...request, document_role: 'mission_document', mission_id: 'mission' }, d)).confidence, 100);
  await assert.rejects(confirmDocumentReference('org', { ...request, file_id: 'f1' }, { role: 'auditor', email: 'a@example.org' }, d), /ROLE_NOT_ALLOWED/);
  await assert.rejects(locateRequiredDocument('org', { ...request, document_role: 'mission_document' }, d), /MISSION_REQUIRED/);
});

test('TDR reception is a real validated date distinct from creation; ambiguous acceptance models rejected; manager backup allowed', () => {
  assert.equal(receptionDate('2026-10-01'), '2026-10-01');
  for (const value of ['2026-02-30', '01/10/2026', '2026-13-01']) assert.throws(() => receptionDate(value), /INVALID_TDR_RECEPTION_DATE/);
  const fiche = { name: 'Fiche', rows: [{ label: 'Date de réception', fields: [{ cell: 'C48' }] }] };
  assert.deepEqual(ficheWrites(fiche, { created_at: '2026-10-13' }), []);
  assert.equal(ficheWrites(fiche, { created_at: '2026-10-13', tdr_received_at: '2026-10-01' })[0].value, '2026-10-01');
  assert.throws(() => findTemplate([{ id: 'a', name: 'ACCEPTATION_TEMPLATE.xlsx', mimeType: 'spreadsheet' }, { id: 'b', name: 'ACCEPTATION_MODELE.xlsx', mimeType: 'spreadsheet' }]), /ACCEPTANCE_TEMPLATE_AMBIGUOUS/);
  assert.ok(SENDERS.includes('manager'));
  assert.equal(mayRecordSending({ role: 'manager' }, { kind: 'rapport' }), false);
  assert.equal(mayRecordSending({ role: 'manager' }, { kind: 'lettre_mission' }), true);
});

test('only an explicit human declaration establishes unavailability and a later selection replaces it', async () => {
  const { d } = setup();
  await confirmDocumentUnavailable('org', request, { role: 'manager', email: 'm@example.org' }, d);
  assert.equal((await locateRequiredDocument('org', request, d)).status, 'CONFIRMED_NOT_AVAILABLE');
  await confirmDocumentReference('org', { ...request, file_id: 'f1' }, { role: 'manager', email: 'm@example.org' }, d);
  assert.equal((await locateRequiredDocument('org', request, d)).status, 'FOUND');
});

function opportunityWorld() {
  let state = { opportunities: { opp: { id: 'opp', status: 'phase0', created_at: '2026-10-13', answers: [], declarations: {}, log: [] } } };
  let version = 1; const calls = [];
  const d = { folder: 'memory', drive: {
    findFilesByExactName: async () => [{ id: 'memory', modifiedTime: String(version) }],
    downloadBuffer: async () => Buffer.from(JSON.stringify(state)),
    updateBinary: async (id, args) => { assert.equal(args.expectedModifiedTime, String(version)); state = JSON.parse(args.buffer); version++; },
    getMeta: async () => ({ modifiedTime: String(version) })
  }, fetchRows: async (query, options = {}) => { calls.push({ query, options }); return [{ id: '11111111-1111-1111-1111-111111111111', status: 'acceptance' }]; } };
  return { d, calls, state: () => state };
}
const owner = { role: 'owner', email: 'owner@example.org' };

test('owner exception is journaled before starting, keeps missing pieces open and never signs or completes KYC', async () => {
  const { d, state, calls } = opportunityWorld();
  await assert.rejects(ownerWorkflowOverride('org', { opportunity_id: 'opp', target: 'kyc_prepare' }, { role: 'manager', email: 'm@example.org' }, d), /OWNER_ONLY/);
  const result = await ownerWorkflowOverride('org', { opportunity_id: 'opp', target: 'kyc_prepare', outstanding: ['Beneficial ownership document'] }, owner, d);
  assert.equal(result.documentation_completed, false); assert.equal(result.override.policy_unchanged, true);
  assert.equal(state().opportunities.opp.phase1.status, 'todo');
  assert.deepEqual(state().opportunities.opp.answers, []);
  assert.deepEqual(state().opportunities.opp.declarations, {});
  assert.ok(result.override.outstanding.includes('Beneficial ownership document'));
  d.fetchRows = async (query, options = {}) => {
    calls.push({ query, options });
    if (options.method === 'PATCH') assert.ok(state().opportunities.opp.overrides.some(o => o.target === 'audit_start'), 'decision persisted first');
    return [{ id: '11111111-1111-1111-1111-111111111111', status: 'acceptance' }];
  };
  assert.equal((await ownerWorkflowOverride('org', { opportunity_id: 'opp', target: 'audit_start', mission_id: '11111111-1111-1111-1111-111111111111' }, owner, d)).override.status, 'applied');
  assert.match(calls.at(-1).query, /org_id=eq.org.*status=eq.acceptance/);
  assert.equal(JSON.parse(calls.at(-1).options.body).status, 'fieldwork');
});

test('failed mission transition stays pending; real TDR reception corrections keep a signed history', async () => {
  const { d, state } = opportunityWorld();
  const fetchRows = d.fetchRows;
  d.fetchRows = async (query, options = {}) => options.method === 'PATCH' ? [] : fetchRows(query, options);
  const result = await ownerWorkflowOverride('org', { opportunity_id: 'opp', target: 'mission_start', mission_id: '11111111-1111-1111-1111-111111111111' }, owner, d);
  assert.equal(result.override.status, 'pending');
  assert.equal(state().opportunities.opp.overrides[0].status, 'pending');
  await setReceptionDate('org', { opportunity_id: 'opp', tdr_received_at: '2026-10-01' }, owner, d);
  await setReceptionDate('org', { opportunity_id: 'opp', tdr_received_at: '2026-10-02' }, owner, d);
  const opp = state().opportunities.opp;
  assert.equal(opp.created_at, '2026-10-13'); assert.equal(opp.tdr_received_at, '2026-10-02');
  assert.equal(opp.reception_history[1].previous, '2026-10-01');
  assert.equal(opp.reception_history[1].by, owner.email);
});

test('the named manager can start the opportunity mission without a letter; creation is linked and never duplicated', async () => {
  const { d, state } = opportunityWorld();
  const manager = { role: 'manager', email: 'manager@example.org', display_name: 'Manager' };
  Object.assign(state().opportunities.opp, { title: 'Audit client', client: 'Client', team: { status: 'validated', members: [{ name: 'Manager', email: manager.email, role: 'Manager' }] } });
  const missions = new Map(); let creations = 0;
  d.fetchRows = async (query, options = {}) => {
    if (query.startsWith('office_staff_profiles') || query.startsWith('office_mission_assignments')) return [];
    if (options.method === 'POST') { const m = JSON.parse(options.body); creations++; missions.set(m.id, m); return [m]; }
    const match = query.match(/&id=eq.([^&]+)/), m = match && missions.get(decodeURIComponent(match[1]));
    if (!m) return [];
    if (options.method === 'PATCH') Object.assign(m, JSON.parse(options.body));
    return [m];
  };
  const result = await ownerWorkflowOverride('org', { opportunity_id: 'opp', target: 'audit_start' }, manager, d);
  assert.equal(result.override.status, 'applied');
  assert.equal(missions.get(result.mission_id).status, 'fieldwork');
  assert.equal(state().opportunities.opp.mission_id, result.mission_id);
  assert.equal(state().opportunities.opp.won, undefined, 'no letter fabricated');
  assert.deepEqual(state().opportunities.opp.answers, []);
  assert.ok(result.override.outstanding.some(x => /KYC/.test(x)));
  await assert.rejects(ownerWorkflowOverride('org', { opportunity_id: 'opp', target: 'audit_start' }, manager, d), /MISSION_ALREADY_STARTED_OR_ENDED/);
  assert.equal(creations, 1);
});
