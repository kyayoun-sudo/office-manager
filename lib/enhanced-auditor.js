import ExcelJS from 'exceljs';
import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, saveJsonFile } from './mapping-scan.js';
import { firstAvailable, multiModel, parseJsonLoose, providersStatus } from './ai-plus.js';
import { fileForAI, saveReport, saveWorkbook } from './agent-outputs.js';
import { engagementState } from './engagement-prep.js';
import { fireInternal } from './agent-passes.js';
import { downloadFileBuffer, getDriveFileMetadata } from './google-drive.js';
import { missionDocuments } from './mission-files.js';

// ENHANCED AUDITOR — new agent of Office Manager AI (Paul, 2026-10-08): audit intelligence and
// review, for the engagement team, under the Grand Contrôleur.
//   1. takes the Grand Contrôleur's risk assessment (industry risk briefing of the engagement
//      preparation) and the AUDITOR's risk assessment (files given by the team), and builds one
//      risk register;
//   2. reads the working files and the evidence — pictures and scans included (Gemini, Claude and
//      ChatGPT see them): turns pictures into Excel tables and short reports;
//   3. looks for PATTERNS in the working files (computed, not guessed: hard-coded figures among
//      formulas, round amounts, duplicates, first-digit distribution, errors, external links,
//      outliers), then interpreted by the AI;
//   4. for each risk: procedures planned / performed, MISSING procedures, evidence evaluated
//      (sufficient, appropriate, reliable), and a verdict: fully covered / partially covered /
//      not covered — with the points that need attention;
//   5. several models answer independently (Claude, ChatGPT, Gemini when configured); the most
//      prudent verdict is kept and every disagreement is shown;
//   6. the review is saved as a Google Doc and an Excel coverage matrix in the agents' folder
//      (ENHANCED_AUDITOR). It concludes nothing in the auditor's place: the engagement team and
//      the partner decide.

const FILE = 'OFFICE_MANAGER_ENHANCED_AUDITOR.json';
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const q = encodeURIComponent;
const VERDICT_RANK = { 'non couvert': 0, 'partiellement couvert': 1, 'couvert': 2 };

async function loadAll(d) { return loadJsonFile(FILE, d.drive || driveAdapter, d.folder || memoryFolderId()); }
async function saveOne(missionId, st, d) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const cur = await loadAll(d);
  const all = cur.state || { reviews: {} };
  st.updated_at = new Date().toISOString();
  all.reviews[missionId] = st;
  await saveJsonFile(FILE, drive, folder, cur.fileId, all);
  return st;
}
export async function auditorState(missionId, d = {}) {
  return (await loadAll(d)).state?.reviews?.[missionId] || { status: 'none' };
}
export async function auditorReviews(d = {}) {
  const all = (await loadAll(d)).state?.reviews || {};
  return Object.entries(all).map(([id, r]) => ({ mission_id: id, mission: r.mission?.name, status: r.status, finished_at: r.finished_at || null, summary: r.summary || null, report: r.report || null }));
}

export async function startAuditorReview(orgId, req, body = {}, d = {}) {
  const missionId = String(body.mission_id || '');
  if (!ID.test(missionId)) throw fail('VALID_MISSION_ID_REQUIRED');
  const [mission] = await (d.fetchRows || rest)('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId) + '&status=not.in.(cancelled,canceled,archived)&select=id,name,mission_code,status&limit=1') || [];
  if (!mission) throw fail('MISSION_NOT_FOUND', 404);
  const ids = k => (Array.isArray(body[k]) ? body[k] : []).map(String).filter(Boolean).slice(0, 25);
  const st = { status: 'running', stage: 'collect', mission: { id: mission.id, name: mission.name },
    auditor_risk_files: ids('auditor_risk_files'), work_files: ids('work_files'), evidence_files: ids('evidence_files'),
    focus: String(body.focus || '').slice(0, 2000), requested_by: body.requested_by || null, started_at: new Date().toISOString(), log: [], providers: providersStatus(d.env) };
  if (!st.auditor_risk_files.length && !st.work_files.length && !st.evidence_files.length) throw fail('FILES_REQUIRED');
  await saveOne(missionId, st, d);
  await (d.fire || fireInternal)(req, '/api/app?route=auditor-step', { mission_id: missionId });
  return { started: true, mission: st.mission };
}

// ---- Patterns in a workbook: computed (the AI then interprets) ----
const BENFORD = [0, 30.1, 17.6, 12.5, 9.7, 7.9, 6.7, 5.8, 5.1, 4.6];
export async function workbookPatterns(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = [];
  for (const ws of wb.worksheets) {
    const nums = [], cols = {};
    let formulas = 0, errors = 0, external = 0;
    ws.eachRow({ includeEmpty: false }, (row, r) => row.eachCell({ includeEmpty: false }, (cell, c) => {
      const v = cell.value;
      const col = (cols[c] ||= { formulas: 0, hard: 0, hardCells: [] });
      if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) {
        formulas++; col.formulas++;
        if (/\[[^\]]+\.xls/i.test(String(v.formula || ''))) external++;
        const res = v.result;
        if (res && typeof res === 'object' && res.error) errors++;
        if (typeof res === 'number') nums.push({ v: res, at: cell.address });
      } else if (typeof v === 'number') {
        col.hard++; if (col.hardCells.length < 8) col.hardCells.push(cell.address);
        nums.push({ v, at: cell.address });
      } else if (v && typeof v === 'object' && v.error) errors++;
    }));
    // Hard-coded figures in a column that is mostly computed.
    const inconsistent = Object.entries(cols).filter(([, x]) => x.formulas >= 5 && x.hard > 0 && x.hard <= x.formulas / 3).map(([c, x]) => ({ column: Number(c), hard_coded: x.hard, formulas: x.formulas, cells: x.hardCells }));
    const big = nums.filter(n => Math.abs(n.v) >= 100);
    const round = big.filter(n => Math.abs(n.v) % 1000 === 0);
    const count = {};
    for (const n of big) count[n.v] = (count[n.v] || 0) + 1;
    const dups = Object.entries(count).filter(([, k]) => k >= 3).map(([v, k]) => ({ value: Number(v), times: k })).sort((a, b) => b.times - a.times).slice(0, 10);
    const first = Array(10).fill(0);
    for (const n of big) { const dgt = Number(String(Math.abs(n.v)).replace(/^0+\.?0*/, '')[0]); if (dgt >= 1 && dgt <= 9) first[dgt]++; }
    const total = first.reduce((a, b) => a + b, 0);
    const mad = total >= 100 ? Math.round(first.slice(1).reduce((s, k, i) => s + Math.abs(100 * k / total - BENFORD[i + 1]), 0) / 9 * 100) / 100 : null;
    const vals = big.map(n => n.v);
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const sd = vals.length > 2 ? Math.sqrt(vals.reduce((s, x) => s + (x - mean) ** 2, 0) / (vals.length - 1)) : 0;
    const outliers = sd ? big.filter(n => Math.abs(n.v - mean) > 4 * sd).slice(0, 10).map(n => ({ cell: n.at, value: n.v })) : [];
    sheets.push({ sheet: ws.name, numbers: nums.length, formulas, errors, external_links: external, hard_coded_in_computed_columns: inconsistent.slice(0, 10),
      round_thousands_pct: big.length ? Math.round(100 * round.length / big.length) : null, repeated_amounts: dups,
      benford: total >= 100 ? { amounts: total, mean_abs_deviation_pct: mad, reading: mad > 1.5 ? 'écart notable à la loi de Benford : à examiner (ce n’est pas une preuve)' : 'conforme' } : { amounts: total, reading: 'trop peu de montants pour conclure' },
      negatives: nums.filter(n => n.v < 0).length, outliers });
  }
  return sheets;
}

const RISKS = `Tu es l'Enhanced Auditor, agent d'audit d'Office Manager AI. Tu construis UN registre des risques à partir de deux sources : l'évaluation des risques du Grand Contrôleur (briefing sectoriel) et l'évaluation des risques de l'auditeur (fichiers de l'équipe). Fusionne ce qui est identique, garde la trace de la source, n'invente aucun risque sans fondement.
JSON STRICT : {"risks":[{"id":"R1","risk":"","area":"","accounts":[""],"assertions":[""],"level":"élevé|moyen|faible","significant":true,"fraud":false,"source":"Grand Contrôleur|auditeur|les deux","source_quote":""}],"auditor_assessment_gaps":["risque du secteur absent de l'évaluation de l'auditeur"]}`;

const PICTURE = `Tu es l'Enhanced Auditor. Tu regardes une pièce justificative (photo, scan, capture, PDF). Décris ce que c'est et extrais fidèlement les données ; quand il y a un tableau (relevé, facture, inventaire, balance, état de rapprochement…), recopie-le ligne par ligne. Signale tout ce qui paraît anormal (rature, incohérence de totaux, date, signature manquante, document illisible) sans conclure à la fraude.
JSON STRICT : {"document_type":"","date":"","issuer":"","summary":"","key_figures":[{"label":"","value":""}],"tables":[{"name":"","rows":[["en-tête 1","en-tête 2"],["v1","v2"]]}],"anomalies":[""],"legibility":"bonne|moyenne|mauvaise"}`;

const COVERAGE = `Tu es l'Enhanced Auditor, agent de revue d'audit (normes ISA). On te donne : le registre des risques (avec leurs id), les procédures prévues et réalisées lues dans les fichiers de travail, les constats calculés sur ces fichiers (motifs) et les pièces justificatives lues.
Pour CHAQUE risque (même id) :
- les procédures qui y répondent (prévues / réalisées, avec la référence du fichier) ;
- les procédures MANQUANTES pour couvrir le risque et ses assertions (sois précis : nature, étendue, calendrier) ;
- l'évaluation des éléments probants : suffisants ? appropriés ? fiables ? ce qui manque ;
- le verdict : "couvert" | "partiellement couvert" | "non couvert", et pourquoi ;
- les points d'attention (y compris les motifs relevés dans les fichiers : chiffres saisis en dur dans des colonnes calculées, montants ronds, doublons, écarts de Benford, erreurs).
Puis les conclusions générales pour l'associé.
JSON STRICT : {"coverage":[{"risk_id":"","procedures":[{"procedure":"","status":"prévue|réalisée","reference":""}],"missing_procedures":[""],"evidence":{"sufficient":"oui|partiel|non","appropriate":"oui|partiel|non","reliable":"oui|partiel|non","comment":""},"verdict":"couvert|partiellement couvert|non couvert","why":"","attention":[""]}],
"patterns_reading":[""],"overall":"","priority_actions":[""]}
Ne conclus pas à la place de l'auditeur : dis ce qui est démontré par les fichiers et ce qui ne l'est pas.`;

export async function auditorStep(orgId, req, body = {}, d = {}) {
  const missionId = String(body.mission_id || '');
  const st = await auditorState(missionId, d);
  if (st.status !== 'running') return st;
  const say = m => st.log.push({ at: new Date().toISOString(), m });
  const next = async stage => { st.stage = stage; await saveOne(missionId, st, d); await (d.fire || fireInternal)(req, '/api/app?route=auditor-step', { mission_id: missionId }); return st; };
  const ai = d.ai || firstAvailable, read = d.fileForAI || fileForAI;
  try {
    if (st.stage === 'collect') {
      // Documents already attached to the mission (deposits) are reviewed too, each by its role.
      const attached = await (d.missionDocuments || missionDocuments)(missionId, d).catch(() => []);
      const add = (key, roles, max) => { for (const x of attached.filter(a => roles.includes(a.role)).slice(0, max)) if (!st[key].includes(x.id)) st[key].push(x.id); };
      add('auditor_risk_files', ['evaluation_des_risques'], 5);
      add('work_files', ['feuille_de_travail', 'programme_de_travail'], 10);
      add('evidence_files', ['piece_justificative', 'etat_financier', 'facture'], 15);
      if (attached.length) say(attached.length + ' document(s) déjà rattaché(s) à la mission repris dans la revue.');
      const eng = await (d.engagementState || engagementState)(missionId, d).catch(() => ({}));
      st.gc_risks = eng.risk_brief?.text ? { text: eng.risk_brief.text.slice(0, 40000), doc: eng.risk_doc || null } : null;
      st.auditor_risks = [];
      for (const id of st.auditor_risk_files) { try { const f = await read(id); st.auditor_risks.push({ id, name: f.name, url: f.url, text: f.visual ? null : f.text.slice(0, 40000), visual: f.visual }); } catch (e) { say('Fichier illisible : ' + id); } }
      st.workings = []; st.patterns = [];
      for (const id of st.work_files) {
        try {
          const meta = await (d.getMeta || getDriveFileMetadata)(id);
          if (/spreadsheetml|ms-excel/i.test(meta?.mimeType || '') && Number(meta.size || 0) < 20 * 1024 * 1024) {
            const buf = await (d.download || downloadFileBuffer)(id);
            st.patterns.push({ file: meta.name, url: meta.webViewLink || null, sheets: await workbookPatterns(Buffer.from(buf)) });
          }
          const f = await read(id);
          st.workings.push({ name: f.name, url: f.url, text: f.visual ? '(image)' : f.text.slice(0, 30000) });
        } catch (e) { say('Fichier de travail illisible : ' + id + ' (' + String(e.message || e).slice(0, 60) + ')'); }
      }
      say('Lu : ' + (st.gc_risks ? 'évaluation du Grand Contrôleur, ' : 'pas d’évaluation du Grand Contrôleur pour cette mission (lancer la préparation de l’engagement), ') + st.auditor_risks.length + ' fichier(s) de l’auditeur, ' + st.workings.length + ' fichier(s) de travail, ' + st.patterns.length + ' classeur(s) analysés.');
      return next('risks');
    }
    if (st.stage === 'risks') {
      const visual = [];
      for (const r of st.auditor_risks.filter(x => x.visual)) visual.push(await read(r.id).catch(() => null));
      const r = await ai(['anthropic', 'openai', 'gemini'], { instructions: RISKS, input: 'MISSION : ' + st.mission.name + (st.focus ? '\nFOCUS DEMANDÉ : ' + st.focus : '') +
        '\n\nÉVALUATION DU GRAND CONTRÔLEUR :\n' + (st.gc_risks?.text || '(aucune)') + '\n\nÉVALUATION DE L’AUDITEUR :\n' + st.auditor_risks.filter(x => x.text).map(x => '### ' + x.name + '\n' + x.text).join('\n\n'), files: visual.filter(Boolean), maxTokens: 8000 });
      const out = parseJsonLoose(r.text);
      st.risks = out.risks || []; st.auditor_assessment_gaps = out.auditor_assessment_gaps || [];
      say(st.risks.length + ' risques dans le registre (' + r.provider + ').');
      return next('pictures');
    }
    if (st.stage === 'pictures') {
      st.pictures = st.pictures || []; st.picture_done = st.picture_done || 0;
      const batch = st.evidence_files.slice(st.picture_done, st.picture_done + 3);
      for (const id of batch) {
        try {
          const f = await read(id);
          if (!f.visual) { st.pictures.push({ name: f.name, url: f.url, summary: 'Document texte', text: f.text.slice(0, 8000) }); continue; }
          // Gemini first for pictures, then Claude, then ChatGPT.
          const r = await ai(['gemini', 'anthropic', 'openai'], { instructions: PICTURE, input: 'Pièce : ' + f.name + ' — mission ' + st.mission.name, files: [f], maxTokens: 6000 });
          const p = parseJsonLoose(r.text);
          let excel = null;
          if ((p.tables || []).some(t => (t.rows || []).length > 1)) excel = await (d.saveWorkbook || saveWorkbook)('auditor', st.mission.name + ' — ' + f.name.replace(/\.[a-z0-9]+$/i, ''), p.tables.map(t => ({ name: t.name || 'Tableau', rows: t.rows })), d).catch(() => null);
          st.pictures.push({ name: f.name, url: f.url, read_by: r.provider, ...p, excel });
        } catch (e) { say('Pièce non lue : ' + id + ' (' + String(e.message || e).slice(0, 60) + ')'); }
      }
      st.picture_done += batch.length;
      if (st.picture_done < st.evidence_files.length) return next('pictures');
      say(st.pictures.length + ' pièce(s) lue(s)' + (st.pictures.some(p => p.excel) ? ', tableaux transformés en Excel' : '') + '.');
      return next('coverage');
    }
    if (st.stage === 'coverage') {
      const input = 'MISSION : ' + st.mission.name + (st.focus ? '\nFOCUS : ' + st.focus : '') + '\n\nREGISTRE DES RISQUES : ' + JSON.stringify(st.risks) +
        '\n\nFICHIERS DE TRAVAIL :\n' + st.workings.map(w => '### ' + w.name + '\n' + w.text).join('\n\n').slice(0, 90000) +
        '\n\nMOTIFS CALCULÉS SUR LES CLASSEURS : ' + JSON.stringify(st.patterns).slice(0, 20000) +
        '\n\nPIÈCES LUES : ' + JSON.stringify(st.pictures.map(p => ({ name: p.name, type: p.document_type, summary: p.summary, key_figures: p.key_figures, anomalies: p.anomalies, text: p.text }))).slice(0, 30000);
      const results = await (d.multiModel || multiModel)({ instructions: COVERAGE, input, maxTokens: 12000 }, ['anthropic', 'openai', 'gemini'], d);
      const opinions = [];
      for (const r of results) { if (r.error) { say('Avis ' + r.provider + ' indisponible : ' + r.error.slice(0, 80)); continue; } try { opinions.push({ provider: r.provider, ...parseJsonLoose(r.text) }); } catch { say('Avis ' + r.provider + ' illisible.'); } }
      if (!opinions.length) throw fail('NO_MODEL_ANSWERED', 502);
      st.opinions = opinions.map(o => ({ provider: o.provider, overall: o.overall }));
      st.coverage = consolidate(st.risks, opinions);
      st.patterns_reading = [...new Set(opinions.flatMap(o => o.patterns_reading || []))].slice(0, 15);
      st.priority_actions = [...new Set(opinions.flatMap(o => o.priority_actions || []))].slice(0, 12);
      st.overall = opinions[0].overall || '';
      const n = v => st.coverage.filter(c => c.verdict === v).length;
      st.summary = n('couvert') + ' risque(s) couvert(s), ' + n('partiellement couvert') + ' partiellement, ' + n('non couvert') + ' non couvert(s)' + (st.coverage.some(c => c.disagreement) ? ' ; avis divergents à examiner' : '') + '.';
      say('Couverture analysée par ' + opinions.map(o => o.provider).join(', ') + ' : ' + st.summary);
      return next('report');
    }
    if (st.stage === 'report') {
      st.report = await (d.saveReport || saveReport)('auditor', st.mission.name + ' — Revue Enhanced Auditor', auditorMarkdown(st), d).catch(e => ({ error: String(e.message || e).slice(0, 200) }));
      st.matrix = await (d.saveWorkbook || saveWorkbook)('auditor', st.mission.name + ' — Matrice de couverture des risques', [{ name: 'Couverture', rows: [['Id', 'Risque', 'Niveau', 'Source', 'Verdict', 'Procédures manquantes', 'Éléments probants', 'Points d’attention', 'Avis divergents'],
        ...st.coverage.map(c => [c.risk_id, c.risk, c.level, c.source, c.verdict, (c.missing_procedures || []).join(' ; '), c.evidence_comment || '', (c.attention || []).join(' ; '), c.disagreement || ''])] }], d).catch(() => null);
      st.status = 'done'; st.stage = 'done'; st.finished_at = new Date().toISOString();
      say('Revue enregistrée dans le Drive (dossier ENHANCED_AUDITOR).');
      await saveOne(missionId, st, d);
      return st;
    }
  } catch (e) {
    st.status = 'failed'; st.error = String(e.message || e).slice(0, 300); say('Arrêt : ' + st.error);
    await saveOne(missionId, st, d);
  }
  return st;
}

// Independent opinions → one view per risk: the most prudent verdict, every disagreement shown.
export function consolidate(risks, opinions) {
  return (risks || []).map(r => {
    const views = opinions.map(o => ({ provider: o.provider, c: (o.coverage || []).find(x => String(x.risk_id) === String(r.id)) })).filter(v => v.c);
    const verdicts = views.map(v => ({ provider: v.provider, verdict: VERDICT_RANK[v.c.verdict] != null ? v.c.verdict : 'non couvert' }));
    const worst = verdicts.sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict])[0]?.verdict || 'non couvert';
    const distinct = [...new Set(verdicts.map(v => v.verdict))];
    const uniq = list => [...new Map(list.filter(Boolean).map(x => [String(x).toLowerCase().slice(0, 80), x])).values()];
    return { risk_id: r.id, risk: r.risk, level: r.level, source: r.source, significant: r.significant, fraud: r.fraud,
      verdict: views.length ? worst : 'non couvert', why: views.map(v => v.c.why).filter(Boolean)[0] || (views.length ? '' : 'Aucune procédure identifiée pour ce risque.'),
      procedures: uniq(views.flatMap(v => (v.c.procedures || []).map(p => (p.status === 'réalisée' ? 'Réalisée : ' : 'Prévue : ') + p.procedure + (p.reference ? ' (' + p.reference + ')' : '')))),
      missing_procedures: uniq(views.flatMap(v => v.c.missing_procedures || [])),
      evidence_comment: views.map(v => v.c.evidence?.comment).filter(Boolean)[0] || '',
      attention: uniq(views.flatMap(v => v.c.attention || [])).slice(0, 8),
      disagreement: distinct.length > 1 ? verdicts.map(v => v.provider + ' : ' + v.verdict).join(' ; ') : null };
  });
}

const c = v => String(v ?? '–').replace(/\|/g, '/').replace(/\n/g, ' ');
export function auditorMarkdown(st) {
  const cov = st.coverage || [];
  return [
    st.summary || '', 'Revue indépendante de ' + (st.opinions || []).map(o => o.provider).join(', ') + ' ; le verdict retenu est le plus prudent. Elle aide l’équipe et l’associé, elle ne conclut pas à leur place.', '',
    '### Couverture des risques',
    '| Risque | Niveau | Source | Verdict | Procédures manquantes |', '| --- | --- | --- | --- | --- |',
    ...cov.map(x => '| ' + [x.risk_id + ' — ' + c(x.risk), c(x.level), c(x.source), x.verdict === 'couvert' ? 'Couvert' : '**' + x.verdict + '**', c((x.missing_procedures || []).join(' ; ') || '–')].join(' | ') + ' |'), '',
    ...cov.filter(x => x.verdict !== 'couvert').flatMap(x => ['### ' + x.risk_id + ' — ' + x.risk, x.why || '', ...(x.missing_procedures || []).map(p => '- Procédure à ajouter : ' + p), x.evidence_comment ? 'Éléments probants : ' + x.evidence_comment : '', ...(x.attention || []).map(a => '- Attention : ' + a), x.disagreement ? '++Avis divergents++ : ' + x.disagreement : '', '']),
    (st.auditor_assessment_gaps || []).length ? '### Risques du secteur absents de l’évaluation de l’auditeur\n' + st.auditor_assessment_gaps.map(g => '- ' + g).join('\n') + '\n' : '',
    (st.patterns_reading || []).length ? '### Motifs relevés dans les fichiers de travail\n' + st.patterns_reading.map(p => '- ' + p).join('\n') + '\n' : '',
    (st.pictures || []).length ? '### Pièces lues\n' + st.pictures.map(p => '- **' + p.name + '** : ' + (p.summary || p.document_type || '') + ((p.anomalies || []).length ? ' — anomalies : ' + p.anomalies.join(' ; ') : '') + (p.excel?.url ? ' [tableau Excel](' + p.excel.url + ')' : '')).join('\n') + '\n' : '',
    '### Actions prioritaires', ...(st.priority_actions || []).map((a, i) => (i + 1) + '. ' + a)
  ].filter(x => x !== null).join('\n');
}
