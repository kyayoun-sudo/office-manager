import test from 'node:test';
import assert from 'node:assert/strict';
import { tenderKey, verifiedOpen, mergeFound, emptyState, tenderKpis, tenderWorkload, reportMarkdown, pipelineSheets, NOTHING_TODAY, cleanSettings, DEFAULT_SETTINGS,
  decideTender, markTdr, recordSubmission, recordResult, decideLossReview, tendersView, tenderTasks, linkOpportunity, deciderCheck } from '../lib/tender-watch.js';

const partner = { role: 'partner', email: 'associe@cabinet.ci', display_name: 'Associé A' };
const partner2 = { role: 'partner', email: 'associe2@cabinet.ci', display_name: 'Associé B' };
const bdm = { role: 'bdm', email: 'bdm@cabinet.ci', display_name: 'BDM' };
const it = { role: 'it_admin', email: 'it@cabinet.ci', display_name: 'IT' };
const auditor = { role: 'auditor', email: 'a@cabinet.ci', display_name: 'Auditeur' };

// An in-memory Drive JSON + firm settings, so the people's actions run end to end.
function world(settings = {}) {
  const files = {};
  const firm = { tender_watch: settings };
  const d = {
    loadJsonFile: async name => ({ state: files[name] ? structuredClone(files[name]) : null }),
    updateJsonFile: async (name, fn) => { const next = await fn(files[name] ? structuredClone(files[name]) : null); if (next != null) files[name] = next; return { state: next }; },
    fetchRows: async () => [{ settings: firm }],
    audit: async () => null, fire: async () => null,
    capabilityContext: async () => ({ people: [{ full_name: 'Awa K', load_pct: 60, missions_active: 2 }, { full_name: 'Yao B', load_pct: 20 }] })
  };
  return { files, d, firm };
}
const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
const item = (o = {}) => ({ title: 'Audit des comptes du projet PADEC 2026', buyer: 'Ministère de l’Agriculture', country: 'Côte d’Ivoire', reference: 'AMI-012/2026', deadline: future, verified: true, deadline_source: 'https://example.org/ami', ...o });

test('one tender = one key; a tender found again is updated, never added twice', () => {
  const st = emptyState();
  assert.equal(tenderKey(item()), tenderKey(item({ title: 'Autre libellé' })), 'same buyer + reference = same tender');
  assert.deepEqual(mergeFound(st, [item()]), { new: 1, updated: 0, watch: 0 });
  const later = new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10);
  assert.deepEqual(mergeFound(st, [item({ deadline: later, status_note: 'prorogé' })]), { new: 0, updated: 1, watch: 0 });
  const t = Object.values(st.tenders);
  assert.equal(t.length, 1);
  assert.equal(t[0].deadline, later);
});

test('an unverified deadline is never recommended: it goes « à surveiller »; a passed deadline expires', () => {
  const st = emptyState();
  mergeFound(st, [item({ verified: false, reference: 'X-1' }), item({ reference: 'X-2', deadline: past })]);
  const stages = Object.values(st.tenders).map(t => t.stage).sort();
  assert.deepEqual(stages, ['expired', 'watch']);
  assert.equal(verifiedOpen({ verified: true, deadline: future }), true);
  assert.equal(verifiedOpen({ verified: false, deadline: future }), false);
  assert.equal(verifiedOpen({ verified: true, deadline: past }), false);
});

test('report: five sections; nothing new → the agreed sentence', () => {
  const st = emptyState();
  const md = reportMarkdown(st, { day: '2026-10-11' });
  for (const h of ['## 1. Résumé exécutif', '## 2. Opportunités prioritaires', '## 3. Équipe optimale', '## 4. Entreprises à approcher', '## 5. Actions à lancer']) assert.ok(md.includes(h), h);
  assert.ok(md.includes(NOTHING_TODAY));
  const sheets = pipelineSheets(st).map(s => s.name);
  assert.deepEqual(sheets, ['Pipeline', 'Entreprises à contacter', 'Appels d’offres ouverts', 'Opportunités à surveiller', 'Matrice CV', 'Experts partenaires manquants']);
});

test('the cycle: a partner decides, the BDM obtains the TDR, links the opportunity, submits, records the result', async () => {
  const { files, d } = world();
  await d.updateJsonFile('OFFICE_MANAGER_TENDERS.json', s => { const st = s || emptyState(); mergeFound(st, [item()]); return st; });
  const id = Object.keys(files['OFFICE_MANAGER_TENDERS.json'].tenders)[0];
  // The BDM, an auditor and the IT administrator never decide.
  for (const a of [bdm, auditor, it]) await assert.rejects(decideTender('org', { id, follow: true }, a, d), /ROLE_NOT_ALLOWED/);
  // « Not followed » needs a reason.
  await assert.rejects(decideTender('org', { id, follow: false }, partner, d), /DECLINE_REASON_REQUIRED/);
  // The TDR cannot be marked before a partner decided to follow.
  await assert.rejects(markTdr('org', { id }, bdm, d), /FOLLOW_DECISION_FIRST/);
  assert.equal((await decideTender('org', { id, follow: true }, partner, d)).stage, 'followed');
  const tdr = await markTdr('org', { id }, bdm, d);
  assert.equal(tdr.stage, 'tdr');
  assert.ok(tdr.create_opportunity.includes(id));
  await linkOpportunity(id, '11111111-1111-4111-8111-111111111111', bdm, d);
  assert.equal(files['OFFICE_MANAGER_TENDERS.json'].tenders[id].stage, 'opportunity');
  await assert.rejects(recordResult('org', null, { id, outcome: 'lost' }, bdm, d), /SUBMISSION_FIRST/);
  await recordSubmission('org', { id, date: '2026-10-20', amount: 25000000 }, bdm, d);
  const r = await recordResult('org', null, { id, outcome: 'lost', reason: 'Offre financière plus élevée', winner: 'Cabinet X' }, bdm, d);
  assert.equal(r.stage, 'lost');
  assert.equal(r.review, true);
  const t = files['OFFICE_MANAGER_TENDERS.json'].tenders[id];
  assert.ok(t.decision.at && t.tdr_at && t.opportunity_at && t.submitted_at && t.result.at, 'every step is dated');
  assert.equal(t.shadow_review.status, 'pending');
});

test('Shadow loss reviews: seen by partners and IT only; a partner validates; shared with the BDM only if asked', async () => {
  const { files, d } = world();
  await d.updateJsonFile('OFFICE_MANAGER_TENDERS.json', s => { const st = s || emptyState(); mergeFound(st, [item()]); const t = Object.values(st.tenders)[0];
    Object.assign(t, { stage: 'lost', decision: { follow: true, at: new Date().toISOString(), by: 'A' }, submitted_at: new Date().toISOString(), result: { outcome: 'lost', at: new Date().toISOString() },
      shadow_review: { status: 'proposed', causes: [{ cause: 'prix', fact: 'gagnant 20 % moins cher' }], improvements: ['revoir le budget'], lesson: 'Comparer le prix aux attributions récentes', confidence: 'moyenne' } }); return st; });
  const id = Object.keys(files['OFFICE_MANAGER_TENDERS.json'].tenders)[0];
  const forBdm = await tendersView('org', bdm, d);
  assert.equal(forBdm.tenders[0].shadow_review, null, 'the BDM does not see Shadow');
  assert.equal(forBdm.me.sees_shadow, false);
  const forPartner = await tendersView('org', partner, d);
  assert.equal(forPartner.tenders[0].shadow_review.status, 'proposed');
  await assert.rejects(decideLossReview('org', { id, accept: true }, bdm, d), /ROLE_NOT_ALLOWED/);
  let lab = null;
  const out = await decideLossReview('org', { id, accept: true, share: true }, partner, { ...d, changeLab: async fn => { lab = { lessons: [], tests: [], refused: [] }; return fn(lab); } });
  assert.equal(out.review.status, 'validated');
  assert.equal(lab.lessons.length, 1, 'the validated review becomes a Shadow lesson of the Firm Manager');
  assert.equal(lab.lessons[0].agent, 'grand-controleur');
  const after = await tendersView('org', bdm, d);
  assert.equal(after.tenders[0].shadow_review.status, 'shared');
  assert.deepEqual(after.tenders[0].shadow_review.improvements, ['revoir le budget']);
  await assert.rejects(tendersView('org', auditor, d), /ROLE_NOT_ALLOWED/);
});

test('the firm chooses who decides: named deciders only', async () => {
  const { files, d } = world({ deciders: 'named', named_deciders: ['associe2@cabinet.ci'] });
  await d.updateJsonFile('OFFICE_MANAGER_TENDERS.json', s => { const st = s || emptyState(); mergeFound(st, [item()]); return st; });
  const id = Object.keys(files['OFFICE_MANAGER_TENDERS.json'].tenders)[0];
  await assert.rejects(decideTender('org', { id, follow: true }, partner, d), /NOT_THE_NAMED_DECIDER/);
  assert.equal((await decideTender('org', { id, follow: true }, partner2, d)).stage, 'followed');
  assert.deepEqual(deciderCheck(partner, { deciders: 'partners' }), {});
});

test('bell: deciders see tenders to decide, the BDM the TDR to obtain', async () => {
  const { d } = world();
  await d.updateJsonFile('OFFICE_MANAGER_TENDERS.json', s => { const st = s || emptyState(); mergeFound(st, [item(), item({ reference: 'B-2' })]); Object.values(st.tenders)[1].stage = 'followed'; Object.values(st.tenders)[1].decision = { follow: true, at: new Date().toISOString() }; return st; });
  const p = await tenderTasks('org', partner, d);
  assert.ok(p.some(x => x.title.startsWith('À décider')));
  const b = await tenderTasks('org', bdm, d);
  assert.ok(!b.some(x => x.title.startsWith('À décider')), 'the BDM does not decide');
  assert.ok(b.some(x => x.title.startsWith('TDR à obtenir')));
  assert.deepEqual(await tenderTasks('org', auditor, d), []);
});

test('indicators and workload come from the recorded dates', () => {
  const at = (n) => new Date(Date.parse('2026-09-01T00:00:00Z') + n * 86400000).toISOString();
  const tenders = {
    a: { received_at: at(0), published_at: '2026-08-30', decision: { follow: true, at: at(1) }, tdr_at: at(2), submitted_at: at(10), deadline: '2026-09-15', amount_proposed: 100, stage: 'won', result: { at: at(30) }, recommendation: { team: [{ name: 'Awa K' }], prep_days: 4, mission_days: 40 } },
    b: { received_at: at(0), decision: { follow: true, at: at(3) }, tdr_at: at(4), submitted_at: at(12), deadline: '2026-09-20', amount_proposed: 100, stage: 'lost', result: { at: at(40) } },
    c: { received_at: at(0), decision: { follow: false, reason: 'Délai trop court', at: at(1) }, stage: 'declined' },
    d: { received_at: at(0), stage: 'new' },
    e: { received_at: at(0), decision: { follow: true, at: at(1) }, stage: 'tdr', recommendation: { team: [{ name: 'Awa K' }, { name: 'Yao B' }], prep_days: 6 } },
    f: { received_at: at(0), decision: { follow: true, at: at(1) }, submitted_at: at(5), stage: 'submitted', recommendation: { team: [{ name: 'Yao B' }], mission_days: 20 } }
  };
  const k = tenderKpis(tenders);
  assert.equal(k.received, 6); assert.equal(k.followed, 4); assert.equal(k.submitted, 3); assert.equal(k.won, 1); assert.equal(k.lost, 1);
  assert.equal(k.rates.success, 50);
  assert.equal(k.rates.selection, 66.7);
  assert.equal(k.delays_days.received_to_decision, 1.4, '(1 + 3 + 1 + 1 + 1) / 5');
  assert.deepEqual(k.decline_reasons, { 'Délai trop court': 1 });
  const w = tenderWorkload(tenders, [{ full_name: 'Awa K', load_pct: 60 }], k.rates.success);
  assert.equal(w.bids_in_preparation, 1);
  assert.equal(w.prep_days, 6);
  assert.equal(w.probable_mission_days, 10, '20 days × 50 % success');
  assert.equal(w.per_person.find(p => p.name === 'Awa K').load_pct, 60);
});

test('settings are cleaned; only partners change them', async () => {
  const s = cleanSettings({ zones: 'Sénégal\nMali', deciders: 'nobody', named_deciders: ['x@y.ci', 'pas-un-mail'], hour: 2 });
  assert.deepEqual(s.zones, ['Sénégal', 'Mali']);
  assert.equal(s.deciders, 'partners');
  assert.deepEqual(s.named_deciders, ['x@y.ci']);
  assert.equal(s.hour, 5);
  assert.ok(DEFAULT_SETTINGS.mission_types.length > 3);
  const { saveWatchSettings } = await import('../lib/tender-watch.js');
  await assert.rejects(saveWatchSettings('org', {}, bdm, world().d), /ROLE_NOT_ALLOWED/);
});

test('daily pass, stage by stage: verified tenders matched to real people only; Excel verified; e-mail SENT only with an id', async () => {
  const { files, d } = world();
  const fired = [];
  const mails = [];
  const run = { ...d,
    fire: async (req, path, body) => { fired.push(body); },
    deepResearch: async ({ instructions }) => instructions.includes('Tender Desk')
      ? { web: true, sources: [{ url: 'https://example.org' }], text: JSON.stringify({ items: [item(), item({ reference: 'NV-9', verified: false })] }) }
      : { web: true, text: JSON.stringify({ companies: [{ name: 'Société Y', origin: 'Maroc', country: 'Côte d’Ivoire', event: 'nouvelle filiale', source: 'https://example.org/y' }] }) },
    firstAvailable: async () => ({ text: JSON.stringify({ results: [{ id: '__ID__', score: 82, bid: 'Bid', why: 'références bailleurs', lead: 'Awa K', team: [{ name: 'Awa K', role: 'Chef de mission' }, { name: 'Inventé Z', role: 'Expert' }], missing: ['Expert agronome'], prep_days: 4, mission_days: 30 }] }) }),
    saveWorkbook: async (kind, title, sheets) => { files.__xlsx = { title, sheets: sheets.map(s => s.name) }; return { id: 'xlsx1', url: 'https://drive/xlsx1' }; },
    saveReport: async () => ({ id: 'doc1', url: 'https://docs/doc1' }),
    drive: { getMeta: async id => (id === 'xlsx1' ? { id, webViewLink: 'https://drive/xlsx1' } : null) },
    fetchRows: async (path) => path.startsWith('office_app_users') ? [{ email: 'associe@cabinet.ci', role: 'partner' }, { email: 'bdm@cabinet.ci', role: 'bdm' }] : [{ settings: {} }],
    getPersona: async () => ({ internal_domains: ['cabinet.ci'], sender_email: 'agent@cabinet.ci' }),
    send: async (m) => { mails.push(m); return 'gmail-123'; },
    env: {}
  };
  const { startTenderWatch, tenderStep } = await import('../lib/tender-watch.js');
  const started = await startTenderWatch('org', {}, { force: true, today: '2026-10-11' }, run);
  assert.ok(started.started);
  assert.equal((await startTenderWatch('org', {}, { today: '2026-10-11' }, run)).skipped, 'ALREADY_TODAY');
  const runId = started.run;
  const s1 = await tenderStep('org', {}, { run_id: runId }, run);
  assert.deepEqual([s1.new, s1.watch], [1, 1]);
  const id = Object.values(files['OFFICE_MANAGER_TENDERS.json'].tenders).find(t => t.stage === 'new').id;
  run.firstAvailable = async () => ({ text: JSON.stringify({ results: [{ id, score: 82, bid: 'Bid', why: 'références bailleurs', lead: 'Awa K', team: [{ name: 'Awa K', role: 'Chef de mission' }, { name: 'Inventé Z', role: 'Expert' }], missing: ['Expert agronome'], prep_days: 4, mission_days: 30 }] }) });
  await tenderStep('org', {}, { run_id: runId }, run);
  const t = files['OFFICE_MANAGER_TENDERS.json'].tenders[id];
  assert.deepEqual(t.recommendation.team.map(m => m.name), ['Awa K'], 'an invented person never enters the team');
  await tenderStep('org', {}, { run_id: runId }, run);
  assert.equal(Object.values(files['OFFICE_MANAGER_TENDERS.json'].companies).length, 1);
  const rep = await tenderStep('org', {}, { run_id: runId }, run);
  assert.equal(rep.pipeline.verified, true);
  assert.equal(rep.mail.sent, true);
  assert.equal(rep.mail.message_id, 'gmail-123');
  assert.deepEqual(mails[0].recipients.sort(), ['associe@cabinet.ci', 'bdm@cabinet.ci']);
  assert.match(mails[0].subject, /1 opportunité\(s\) prioritaire\(s\)/);
  assert.equal(files['OFFICE_MANAGER_TENDERS.json'].running, null);
  // A recipient outside the firm is refused: no SENT status.
  run.fetchRows = async (path) => path.startsWith('office_app_users') ? [{ email: 'someone@gmail.com', role: 'bdm' }] : [{ settings: {} }];
  const again = await startTenderWatch('org', {}, { force: true, today: '2026-10-12' }, run);
  files['OFFICE_MANAGER_TENDERS.json'].running.stage = 'report';
  const rep2 = await tenderStep('org', {}, { run_id: again.run }, run);
  assert.equal(rep2.mail.sent, false);
  assert.match(rep2.mail.reason, /RECIPIENT_OUTSIDE_FIRM/);
});
