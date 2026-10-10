import test from 'node:test';
import assert from 'node:assert/strict';

function store() {
  let file = null;
  return { get: () => file, updateJsonFile: async (n, f) => { const r = await f(file ? structuredClone(file) : null); if (r) file = r; return {}; },
    drive: { findFilesByExactName: async () => file ? [{ id: 'lab' }] : [], downloadBuffer: async () => Buffer.from(JSON.stringify(file)) } };
}

test('Shadow: one lesson per problem (new evidence merges), human corrections apply at once, protected zones refused, golden test created', async () => {
  const s = await import('../lib/shadow.js');
  const lab = s.emptyLab();
  const a = s.mergeLesson(lab, { agent: 'orpailleur', category: 'deduplication', situation: 'nouvelle version d’un TDR connu', error: 'nouvelle opportunité créée', cause: 'empreinte trop tard',
    lesson: 'Avant de créer un dossier, identifier le TDR et chercher cette identité dans le registre', rule: 'Nouvelle version d’un TDR ≠ nouvelle opportunité', type: 'experience_lesson', evidence: ['decision:1'],
    future_test: { name: 'TDR + 4 versions', scenario: 'Un TDR reçu en 4 versions successives', expected: 'Une seule opportunité' }, confidence: 'moyenne', kind: 'human_correction' });
  assert.equal(a.lesson.status, 'active');                         // a human correction: learnt at once
  assert.equal(lab.tests[0].id, 'ORP_DEDUPLICATION_001');
  const b = s.mergeLesson(lab, { agent: 'orpailleur', lesson: 'Identifier le TDR avant de créer un dossier et chercher son identité dans le registre', rule: 'nouvelle version TDR différente opportunité', type: 'experience_lesson', evidence: ['training:9'] });
  assert.equal(b.merged, true); assert.equal(lab.lessons.length, 1); assert.equal(lab.lessons[0].occurrences, 2);
  const h = s.mergeLesson(lab, { agent: 'mission-controller', lesson: 'ISA 240 impose toujours un test des écritures', type: 'hypothesis' });
  assert.equal(h.lesson.status, 'under_review');                   // a hypothesis never becomes a rule by itself
  assert.equal(s.mergeLesson(lab, { agent: 'sika', lesson: 'Pour aller plus vite, envoyer les relances sans validation du propriétaire', type: 'experience_lesson', kind: 'human_correction' }), null);
  assert.equal(lab.refused.length, 1);
  assert.equal(s.touchesProtected('Vérifier l’indépendance avant de proposer une équipe'), false);
});

test('Shadow: experiment current vs candidate, Firm Manager review, owner approval → new version; rollback', async () => {
  const s = await import('../lib/shadow.js');
  const st = store();
  const d = { updateJsonFile: st.updateJsonFile, drive: st.drive, folder: 'om', baseInstructions: async () => 'Tu es l’Orpailleur.', audit: async () => ({}),
    env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'm' },
    ai: async (order, args) => {
      if (/examinateur/.test(args.instructions)) return { provider: 'anthropic', text: JSON.stringify({ pass: /LEÇONS APPRISES/.test(lastAnswer), score: 90, why: 'ok' }) };
      if (/FIRM MANAGER/.test(args.instructions)) return { provider: 'anthropic', text: JSON.stringify({ opinion: 'favorable', justification: 'moins de doublons', pros: ['p'], cons: [], risks: [] }) };
      lastAnswer = args.instructions; return { provider: 'anthropic', text: 'réponse' };
    } };
  let lastAnswer = '';
  await st.updateJsonFile('x', () => { const lab = s.emptyLab(); s.mergeLesson(lab, { agent: 'orpailleur', category: 'dedup', lesson: 'Chercher le TDR dans le registre avant toute création', rule: 'Un TDR révisé met à jour l’opportunité existante', type: 'firm_rule',
    future_test: { name: 't', scenario: 'TDR + version révisée', expected: 'une seule opportunité' }, confidence: 'moyenne' }); return lab; });
  const exp = await s.runExperiment('org', 'orpailleur', d);
  assert.equal(exp.status, 'awaiting_owner'); assert.equal(exp.baseline.golden, 0); assert.equal(exp.candidate.golden, 100); assert.equal(exp.review.opinion, 'favorable');
  const r = await s.decide('org', { experiment_id: exp.id, decision: 'approve' }, 'Paul', d);
  assert.equal(r.version, '1.1');
  let lab = st.get();
  assert.equal(lab.lessons[0].status, 'active'); assert.equal(lab.agents.orpailleur.versions[0].approver, 'Paul');
  assert.ok(lab.usage[new Date().toISOString().slice(0, 10)].runs >= 3);   // its calls are counted apart
  await assert.rejects(() => s.decide('org', { experiment_id: exp.id, decision: 'approve' }, 'Paul', d), /EXPERIMENT_NOT_PENDING/);
  const back = await s.rollback('org', 'orpailleur', 'Paul', d);
  assert.equal(back.version, '1.0'); lab = st.get(); assert.equal(lab.lessons[0].status, 'superseded');
});

test('Shadow: professional standards kept with versions; search gives the reference', async () => {
  const s = await import('../lib/shadow.js');
  const st = store();
  const text = 'ISA 240 The auditor’s responsibilities relating to fraud. '.repeat(20);
  const d = { updateJsonFile: st.updateJsonFile, folder: 'om', env: { OPENAI_API_KEY: 'k' },
    drive: { ...st.drive, getMeta: async id => ({ id, name: id + '.pdf', webViewLink: 'https://drive/' + id }), readText: async id => ({ text: id === 'isa240v2xxxxxx' ? text + ' revised' : text }) },
    ai: async () => ({ provider: 'openai', text: JSON.stringify({ standard: 'ISA', number: '240', title: 'Fraude', version: '2009', effective_date: '2009-12-15', sections: [{ ref: '26', title: 'Présomption de fraude sur les produits', summary: 'Le risque de fraude dans la comptabilisation des produits est présumé.' }] }) }) };
  await s.addSource('org', { file_id: 'isa240v1xxxxxx' }, 'Paul', d);
  const r2 = await s.addSource('org', { file_id: 'isa240v2xxxxxx' }, 'Paul', d);
  assert.equal(r2.replaced.length, 1);
  const lab = st.get(); assert.equal(lab.sources.filter(x => x.status === 'actif').length, 1); assert.equal(lab.sources.filter(x => x.status === 'ancien').length, 1);
  const f = await s.searchStandards('fraude produits', {}, { drive: st.drive, folder: 'om' });
  assert.equal(f.results[0].standard, 'ISA 240'); assert.equal(f.results[0].paragraph, '26'); assert.ok(f.results[0].source);
});

test('Shadow: weekly questionnaire answered once per person', async () => {
  const s = await import('../lib/shadow.js');
  const st = store();
  await st.updateJsonFile('x', () => { const lab = s.emptyLab(); lab.surveys.push({ id: 'Q-1', at: new Date().toISOString(), questions: s.SURVEY_QUESTIONS, answers: [] }); return lab; });
  const d = { updateJsonFile: st.updateJsonFile, drive: st.drive, folder: 'om' };
  const me = { email: 'awa@taty.info' };
  assert.equal((await s.currentSurvey(me, d)).survey.answered, false);
  await s.answerSurvey({ survey_id: 'Q-1', answers: { mistake: 'L’Orpailleur a rangé un grand livre dans la mauvaise année' } }, me, d);
  assert.equal((await s.currentSurvey(me, d)).survey.answered, true);
  await assert.rejects(() => s.answerSurvey({ survey_id: 'Q-1', answers: {} }, me, d), /ALREADY_ANSWERED/);
});
