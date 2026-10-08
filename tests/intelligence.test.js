import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { callModel, firstAvailable, deepResearch, providersStatus } from '../lib/ai-plus.js';
import { markdownToHtml } from '../lib/agent-outputs.js';
import { hrFiles, mergePerson, capabilityIndex, recurringGaps } from '../lib/capabilities.js';
import { engagementMissions, startEngagementPrep, engagementStep, engagementState, engagementMarkdown } from '../lib/engagement-prep.js';
import { measure, submissionKpis } from '../lib/submissions.js';
import { workbookPatterns, consolidate } from '../lib/enhanced-auditor.js';
import { buildManagerAgent } from '../lib/orchestrator.js';

const ENV = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-x', OPENAI_API_KEY: 'k', GEMINI_API_KEY: 'g' };
const json = body => ({ ok: true, status: 200, json: async () => body });

test('AI layer: web search sources from Claude, ChatGPT and Gemini; pictures sent to each provider', async () => {
  let sent = null;
  const fetchImpl = async (url, o) => { sent = { url, body: JSON.parse(o.body), headers: o.headers };
    if (url.includes('anthropic')) return json({ content: [{ type: 'web_search_tool_result', content: [{ url: 'https://a.example', title: 'A' }] }, { type: 'text', text: 'Réponse', citations: [{ url: 'https://b.example', title: 'B' }] }] });
    if (url.includes('openai')) return json({ output: [{ content: [{ type: 'output_text', text: 'Answer', annotations: [{ type: 'url_citation', url: 'https://c.example', title: 'C' }] }] }] });
    return json({ candidates: [{ content: { parts: [{ text: 'Gemini' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://d.example', title: 'D' } }] } }] });
  };
  const img = [{ mimeType: 'image/png', base64: 'AAAA', name: 'x.png' }];
  const a = await callModel({ provider: 'anthropic', instructions: 'i', input: 'q', files: img, webSearch: true }, { env: ENV, fetchImpl });
  assert.equal(sent.body.tools[0].type, 'web_search_20250305');
  assert.equal(sent.body.messages[0].content[0].type, 'image');
  assert.deepEqual(a.sources.map(s => s.url), ['https://a.example', 'https://b.example']);
  const o = await callModel({ provider: 'openai', instructions: 'i', input: 'q', files: img, webSearch: true }, { env: ENV, fetchImpl });
  assert.equal(sent.body.tools[0].type, 'web_search');
  assert.match(sent.body.input[0].content[1].image_url, /^data:image\/png;base64,/);
  assert.equal(o.sources[0].url, 'https://c.example');
  const g = await callModel({ provider: 'gemini', instructions: 'i', input: 'q', files: img, webSearch: true }, { env: ENV, fetchImpl });
  assert.equal(sent.headers['x-goog-api-key'], 'g');
  assert.ok(sent.body.tools[0].google_search);
  assert.equal(sent.body.contents[0].parts[1].inline_data.mime_type, 'image/png');
  assert.equal(g.sources[0].url, 'https://d.example');
});

test('AI layer: providers without a key are skipped; research says when it could not run', async () => {
  assert.deepEqual([providersStatus({}).openai, providersStatus({ GEMINI_API_KEY: 'x' }).gemini], [false, true]);
  const calls = [];
  const r = await firstAvailable(['anthropic', 'gemini'], { input: 'q' }, { env: { GEMINI_API_KEY: 'x' }, callModel: async a => { calls.push(a.provider); return { provider: a.provider, text: 'ok' }; } });
  assert.deepEqual(calls, ['gemini']); assert.equal(r.text, 'ok');
  const none = await deepResearch({ instructions: 'i', question: 'q' }, { env: {} });
  assert.equal(none.web, false); assert.match(none.error, /NO_AI_PROVIDER/);
});

test('reports: Markdown becomes a formatted Google Doc (titles, bold, underline, lists, tables), no stray asterisks', () => {
  const html = markdownToHtml('### Risques\n**Stocks** et ++à valider++\n- un\n- deux\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n*note* ***', 'Titre');
  assert.match(html, /<h1>Titre<\/h1>/); assert.match(html, /<h4>Risques<\/h4>/); assert.match(html, /<b>Stocks<\/b>/); assert.match(html, /<u>à valider<\/u>/);
  assert.match(html, /<ul><\/?li>|<ul>\n<li>un<\/li>/); assert.match(html, /<th[^>]*>A<\/th>/); assert.match(html, /<td>2<\/td>/);
  assert.ok(!/\*/.test(html.replace(/<[^>]+>/g, '')));
});

test('capabilities: HR/CV files from the Drive map, profiles merged, competency index, recurring gaps', () => {
  const F = 'application/vnd.google-apps.folder';
  const items = [{ id: 'hr', name: '04_EQUIPE_RH_CV', mimeType: F, path: '/D/04_EQUIPE_RH_CV' }, { id: 'c1', name: 'CV_Awa.pdf', mimeType: 'application/pdf', path: '/D/04_EQUIPE_RH_CV/CV_Awa.pdf' },
    { id: 'x', name: 'Facture.pdf', mimeType: 'application/pdf', path: '/D/01_CLIENTS/Facture.pdf' }, { id: 'cons', name: 'Consultants', mimeType: F, path: '/D/Consultants' }, { id: 'c2', name: 'Expert mines.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', path: '/D/Consultants/Expert mines.docx' }];
  assert.deepEqual(hrFiles(items, 'hr').map(f => f.id), ['c1', 'c2']);
  const list = [];
  mergePerson(list, { full_name: 'Awa Koné', specialist_skills: ['IFRS 9'], languages: ['Français'] });
  mergePerson(list, { full_name: 'awa kone', email: 'awa@taty.info', specialist_skills: ['IFRS 9', 'Audit IT'] });
  assert.equal(list.length, 1); assert.deepEqual(list[0].specialist_skills, ['IFRS 9', 'Audit IT']); assert.equal(list[0].email, 'awa@taty.info');
  assert.deepEqual(capabilityIndex(list).find(c => c.capability === 'Audit IT').people, ['Awa Koné']);
  const rec = recurringGaps([{ mission: 'A', category: 'Mines', capability: 'Évaluation minière' }, { mission: 'B', category: 'mines', capability: 'Géologie' }, { mission: 'A', category: 'ESG', capability: 'ESG' }]);
  assert.equal(rec[0].category, 'Mines'); assert.equal(rec[0].strategic, true); assert.equal(rec[1].strategic, false);
});

function memDrive() {
  const files = new Map(); let n = 0;
  return { files,
    findFilesByExactName: async name => [...files.entries()].filter(([, f]) => f.name === name).map(([id]) => ({ id })),
    downloadBuffer: async id => files.get(id).buffer, getMeta: async () => ({ modifiedTime: 't' }),
    createBinary: async ({ name, buffer }) => { const id = 'f' + (++n); files.set(id, { name, buffer }); return { id }; },
    updateBinary: async (id, { buffer }) => { files.get(id).buffer = buffer; } };
}

test('engagement preparation: active and not-yet-started missions only; TDR → research → capability check → externals → risk briefing', async () => {
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const M = 'aaaaaaaa-1111-4111-8111-111111111111';
  const fetchRows = async path => path.startsWith('office_missions') ? [
    { id: M, name: 'Mines du Sud — Audit 2026', status: 'planned', planned_start: future },
    { id: 'bbbbbbbb-1111-4111-8111-111111111111', name: 'Nova — Audit 2026', status: 'active', planned_start: '2026-01-01' },
    { id: 'c', name: 'AIN-2025-110 (entraînement)', status: 'active' }] : [];
  const ms = await engagementMissions('org', { fetchRows });
  assert.deepEqual(ms.map(m => m.phase), ['not_started', 'active']);
  const drive = memDrive(), fired = [], saved = [], gaps = [];
  const d = { drive, folder: 'MEM', fetchRows, fire: async (r, p) => { fired.push(p); return true; },
    fileForAI: async id => ({ id, name: 'TDR.pdf', text: 'Termes de référence : audit des comptes d’une société minière ; expert en évaluation minière requis (10 ans).', visual: false }),
    research: async ({ question }) => question.includes('MANQUES')
      ? { text: JSON.stringify({ externals: [{ gap: 'Évaluation minière', suggestions: [{ name: 'Cabinet X', why: 'évaluations minières en Afrique de l’Ouest', source: 'https://x.example' }] }] }), sources: [], provider: 'anthropic', web: true }
      : { text: '### Le secteur\nRisques de dépréciation des actifs miniers [source](https://s.example)', sources: [{ url: 'https://s.example', title: 'S' }], provider: 'anthropic', web: true },
    capabilityContext: async () => ({ people: [{ full_name: 'Awa Koné', kind: 'employee', specialist_skills: ['IFRS 9'], technical_skills: ['Audit financier'], load_pct: 40 }], cv_database: { profiles: 1 } }),
    ai: async (order, { instructions }) => {
      if (instructions.includes('termes de référence (TDR)')) return { provider: 'anthropic', text: JSON.stringify({ client: 'Mines du Sud', country: 'Côte d’Ivoire', industry: 'Mines', stated_requirements: [{ category: 'specialist', requirement: 'Évaluation minière', quote: 'expert en évaluation minière requis' }] }) };
      if (instructions.includes('JAMAIS une équipe')) return { provider: 'openai', text: JSON.stringify({ requirements: [
        { category: 'technical', capability: 'Audit financier', source: 'TDR', internal: 'oui', people: [{ name: 'Awa Koné', available: 'oui' }], gap: false },
        { category: 'specialist', capability: 'Évaluation minière', source: 'TDR', internal: 'non', people: [], gap: true, gap_category: 'Mines' }], proposed_team: [{ name: 'Awa Koné', role: 'Chef de mission', why: 'Audit financier' }], team_ready: false, blocking_gaps: ['Évaluation minière'] }) };
      return { provider: 'anthropic', text: '### Risques inhérents du secteur\n| Risque | Comptes |\n| --- | --- |\n| Dépréciation | Actifs miniers |' };
    },
    recordGaps: async e => { gaps.push(e); },
    saveReport: async (kind, title) => { saved.push(kind + ':' + title); return { id: 'doc', url: 'https://docs.google.com/document/d/doc/edit' }; } };
  await assert.rejects(startEngagementPrep('org', {}, { mission_id: M }, d), /TDR_REQUIRED/);
  await startEngagementPrep('org', {}, { mission_id: M, tdr_file_ids: ['tdr1'] }, d);
  for (let i = 0; i < 6; i++) { const st = await engagementStep('org', {}, { mission_id: M }, d); if (st.status !== 'running') break; }
  const st = await engagementState(M, d);
  assert.equal(st.status, 'done', st.error);
  assert.deepEqual(st.log.length >= 4, true);
  const gap = st.match.requirements.find(r => r.gap);
  assert.equal(gap.external_specialists[0].name, 'Cabinet X');
  assert.equal(gaps[0].gaps[0].category, 'Mines');
  assert.ok(saved.some(s => s.startsWith('risks:Mines du Sud')) && saved.some(s => s.startsWith('engagements:')));
  const md = engagementMarkdown(st);
  assert.match(md, /\| Capacité requise \| Source \| Disponible en interne \| Personne\(s\) \| Manque \|/);
  assert.match(md, /Évaluation minière.*\*\*Oui\*\*/);
});

test('submissions: margins and KPI computed from the dates (never estimated)', () => {
  const a = measure({ opportunity: 'BAD', received_at: '2026-10-02T09:00', deadline: '2026-10-15T12:00', submitted_at: '2026-10-14T12:00',
    milestones: [{ type: 'cv_request', at: '2026-10-05T09:00' }, { type: 'cv_received', at: '2026-10-07T09:00' }, { type: 'partner_review_done', at: '2026-10-15T03:00' }], people: [{ name: 'Yao', role: 'preparer' }] });
  assert.equal(a.window_days, 13.1); assert.equal(a.margin_days, 1); assert.equal(a.timing, 'à moins de 48 h'); assert.equal(a.cv_delay_days, 2); assert.equal(a.partner_review_hours_before_deadline, 9);
  const b = measure({ opportunity: 'UE', received_at: '2026-09-01', deadline: '2026-09-10T12:00', submitted_at: '2026-09-10T13:00' });
  assert.equal(b.timing, 'en retard');
  const k = submissionKpis([a, b, measure({ opportunity: 'sans dates' })]);
  assert.equal(k.firm.submissions, 3); assert.equal(k.firm.with_dates, 2); assert.equal(k.firm.on_time_pct, 50); assert.equal(k.firm.late, 1);
  assert.equal(k.process.partner_review_last_12h, 1); assert.equal(k.people[0].name, 'Yao');
});

test('Enhanced Auditor: patterns computed in a workbook; the most prudent verdict kept, disagreements shown', async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Stocks');
  for (let r = 1; r <= 8; r++) { ws.getCell('A' + r).value = r * 1000; ws.getCell('B' + r).value = { formula: 'A' + r + '*2', result: r * 2000 }; }
  ws.getCell('B9').value = 123456;
  const p = await workbookPatterns(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(p[0].sheet, 'Stocks'); assert.equal(p[0].formulas, 8);
  assert.deepEqual(p[0].hard_coded_in_computed_columns[0].cells, ['B9']);
  assert.ok(p[0].round_thousands_pct > 50);
  const cov = consolidate([{ id: 'R1', risk: 'Dépréciation des stocks', level: 'élevé' }, { id: 'R2', risk: 'Ventes' }], [
    { provider: 'anthropic', coverage: [{ risk_id: 'R1', verdict: 'partiellement couvert', missing_procedures: ['Test de valeur nette de réalisation'] }, { risk_id: 'R2', verdict: 'couvert' }] },
    { provider: 'openai', coverage: [{ risk_id: 'R1', verdict: 'non couvert', missing_procedures: ['test de valeur nette de réalisation', 'Revue des rotations'] }, { risk_id: 'R2', verdict: 'couvert' }] }]);
  assert.equal(cov[0].verdict, 'non couvert'); assert.match(cov[0].disagreement, /anthropic : partiellement couvert/);
  assert.equal(cov[0].missing_procedures.length, 2);
  assert.equal(cov[1].verdict, 'couvert'); assert.equal(cov[1].disagreement, null);
});

test('architecture: the Grand Contrôleur consults the Enhanced Auditor', () => {
  const manager = buildManagerAgent({ 'mission-controller': {}, orpailleur: {}, sika: {}, 'enhanced-auditor': {} }, { orgId: 'o', runId: null }, {});
  assert.ok(manager.tools.map(t => t.name).includes('consult_enhanced_auditor'));
});

test('deposits: every document understood and kept for all agents; Enhanced Auditor gets each one by its role', async () => {
  const { startDepositAnalysis, depositStep, depositState, listDeposits } = await import('../lib/deposit-analysis.js');
  const drive = memDrive(); let handed = null;
  const d = { drive, folder: 'MEM', fire: async () => true,
    fileForAI: async id => id === 'img' ? { id, name: 'inventaire.jpg', visual: true, mimeType: 'image/jpeg', base64: 'AA' } : { id, name: id + '.xlsx', text: 'contenu ' + id, visual: false },
    ai: async (order, { files }) => ({ provider: files.length ? 'gemini' : 'anthropic', text: JSON.stringify({ documents: [
      { file_id: 'risk', type: 'Évaluation des risques', role: 'evaluation_des_risques', client: 'Mines du Sud', summary: 'Risques significatifs' },
      { file_id: 'wp', type: 'Feuille de travail stocks', role: 'feuille_de_travail', summary: 'Test des stocks' },
      { file_id: 'img', type: 'Fiche de comptage', role: 'piece_justificative', summary: 'Comptage du stock d’or' }] }) }),
    startAuditorReview: async (org, req, b) => { handed = b; return { started: true }; } };
  await assert.rejects(startDepositAnalysis('org', {}, { purpose: 'auditor', files: [{ id: 'x' }] }, d), /VALID_MISSION_ID_REQUIRED/);
  const { id } = await startDepositAnalysis('org', {}, { purpose: 'auditor', mission_id: 'm1', question: 'stocks', files: [{ id: 'risk', path: 'Dossier/risques.xlsx' }, { id: 'wp', path: 'Dossier/WP/stocks.xlsx' }, { id: 'img', path: 'Dossier/Pièces/inventaire.jpg' }] }, d);
  for (let i = 0; i < 4; i++) { const st = await depositStep('org', {}, { id }, d); if (st.status !== 'running') break; }
  const st = await depositState(id, d);
  assert.equal(st.status, 'done', st.error);
  assert.deepEqual([handed.auditor_risk_files, handed.work_files, handed.evidence_files], [['risk'], ['wp'], ['img']]);
  assert.equal(handed.focus, 'stocks');
  const list = await listDeposits(d);
  assert.equal(list[0].label, 'Dossier');
  assert.equal(list[0].documents.find(x => x.path === 'Dossier/Pièces/inventaire.jpg').summary, 'Comptage du stock d’or');
});
