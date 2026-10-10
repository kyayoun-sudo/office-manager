import crypto from 'node:crypto';
import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, updateJsonFile } from './mapping-scan.js';
import { firstAvailable, parseJsonLoose, providersStatus } from './ai-plus.js';
import { audit } from './audit-log.js';

// SHADOW — THE LEARNING LAB (2026-10-08). Not an operational agent: it never works on real
// missions, never writes to a client, never touches the real Drive, never deploys anything.
// Visible to the owner only, in Entraînement. Its loop:
//   real work / training → observation → success / error / human correction → a SHORT lesson
//   → lesson memory (deduplicated, versioned) → golden tests → measure → candidate version
//   → Firm Manager's independent review → OWNER's decision → new version → measure after.
// Low-risk lessons confirmed by facts become active at once (recorded, versioned, reversible);
// anything that changes behaviour significantly waits for the owner. An agent can learn to use its
// power better; it can never give itself more power: lessons that would touch permissions, secrets,
// approvals, audit log, rollback, independence, signature, external sending… are refused.
// Memory: ONE file in the agents' Atelier mémoire (SHADOW_LAB.json), distilled — never the
// conversations. Supabase: nothing new (the audit log already exists).

export const LAB_FILE = 'SHADOW_LAB.json';
export const AGENT_KEYS = ['orpailleur', 'mission-controller', 'grand-controleur', 'enhanced-auditor', 'sika'];
const CODE = { orpailleur: 'ORP', 'mission-controller': 'MC', 'grand-controleur': 'FM', 'enhanced-auditor': 'EA', sika: 'SIK' };
const LESSON_TYPES = ['professional_rule', 'firm_rule', 'experience_lesson', 'hypothesis'];
const STATUSES = ['active', 'under_review', 'superseded', 'deprecated', 'rejected'];
const q = encodeURIComponent;
const cut = (s, n) => String(s ?? '').slice(0, n);
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const today = (now = new Date()) => now.toISOString().slice(0, 10);
const words = s => new Set(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
export function similarity(a, b) { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.min(A.size, B.size); }

// Forbidden zones: what no lesson, rule or proposal may weaken or change. They live in
// lib/shadow-guard.js, a file Shadow can never rewrite (2026-10-10, Shadow may now propose code).
import { touchesProtected } from './shadow-guard.js';
export { touchesProtected };

export function shadowConfig(env = process.env) {
  return { enabled: String(env.SHADOW_ENABLED || 'true').toLowerCase() !== 'false', model: env.SHADOW_MODEL || null,
    maxRuns: Math.max(1, Number(env.SHADOW_MAX_DAILY_RUNS) || 12), maxCost: Math.max(0.1, Number(env.SHADOW_MAX_DAILY_COST) || 2),
    costPerMTok: Math.max(0.1, Number(env.SHADOW_COST_PER_MTOK) || 8) };
}

export function emptyLab() {
  return { schema: 'office-manager.shadow-lab/1', agents: Object.fromEntries(AGENT_KEYS.map(k => [k, { version: '1.0', scores: {}, score_history: [], weaknesses: [], versions: [] }])),
    lessons: [], tests: [], experiments: [], problems: [], sources: [], surveys: [], usage: {}, self: { proposals: 0, approved: 0, rejected: 0, more_tests: 0, regressions_after: 0, rollbacks: 0, false_diagnoses: 0 },
    last_observed_at: null, last_run: null, updated_at: null };
}
const DRIVE = d => ({ drive: d.drive || driveAdapter, folder: d.folder || memoryFolderId() });
export async function loadLab(d = {}) { const { drive, folder } = DRIVE(d); const s = (await loadJsonFile(LAB_FILE, drive, folder).catch(() => ({ state: null }))).state; return s ? { ...emptyLab(), ...s, agents: { ...emptyLab().agents, ...(s.agents || {}) } } : emptyLab(); }
export async function changeLab(fn, d = {}) {
  let out = null;
  await (d.updateJsonFile || updateJsonFile)(LAB_FILE, cur => { const lab = cur ? { ...emptyLab(), ...cur, agents: { ...emptyLab().agents, ...(cur.agents || {}) } } : emptyLab(); out = fn(lab) ?? lab; lab.updated_at = new Date().toISOString(); trim(lab); return lab; }, DRIVE(d));
  return out;
}
function trim(lab) {
  lab.problems = lab.problems.slice(-200); lab.experiments = lab.experiments.slice(-60); lab.surveys = lab.surveys.slice(-12);
  lab.lessons = lab.lessons.slice(-400); lab.tests = lab.tests.slice(-300);
  for (const a of Object.values(lab.agents)) { a.score_history = (a.score_history || []).slice(-60); a.versions = (a.versions || []).slice(-30); }
  for (const k of Object.keys(lab.usage)) if (k < today(new Date(Date.now() - 60 * 86400000))) delete lab.usage[k];
}

// Its own calls, counted apart (calls, tokens estimated, cost estimated, agent, purpose).
export async function shadowAI(lab, args, purpose, d = {}) {
  const cfg = shadowConfig(d.env);
  const u = (lab.usage[today()] ||= { runs: 0, tokens: 0, cost: 0, by: {} });
  if (u.runs >= cfg.maxRuns) throw fail('SHADOW_DAILY_RUNS_REACHED', 429);
  if (u.cost >= cfg.maxCost) throw fail('SHADOW_DAILY_COST_REACHED', 429);
  const env = { ...(d.env || process.env) };
  if (cfg.model && /claude/i.test(cfg.model)) env.ANTHROPIC_MODEL = cfg.model;
  if (cfg.model && /gpt|o\d/i.test(cfg.model)) env.OPENAI_MODEL = cfg.model;
  if (cfg.model && /gemini/i.test(cfg.model)) env.GEMINI_MODEL = cfg.model;
  const order = cfg.model && /gemini/i.test(cfg.model) ? ['gemini', 'anthropic', 'openai'] : cfg.model && /gpt|o\d/i.test(cfg.model) ? ['openai', 'anthropic', 'gemini'] : ['anthropic', 'openai', 'gemini'];
  const r = await (d.ai || firstAvailable)(order, { ...args, maxTokens: args.maxTokens || 4000 }, { ...d, env });
  const tokens = Math.round((String(args.instructions || '').length + String(args.input || '').length + String(r.text || '').length) / 4);
  u.runs++; u.tokens += tokens; u.cost = Math.round((u.cost + tokens / 1e6 * cfg.costPerMTok) * 1000) / 1000;
  u.by[purpose.agent || 'shadow'] = (u.by[purpose.agent || 'shadow'] || 0) + 1;
  (lab.calls ||= []).push({ at: new Date().toISOString(), purpose: purpose.kind, agent: purpose.agent || null, ref: purpose.ref || null, tokens, provider: r.provider });
  lab.calls = lab.calls.slice(-200);
  return r;
}

// ---------- 1. Observe (what changed since the last pass only) ----------
export async function observe(orgId, since, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const org = 'org_id=eq.' + q(orgId);
  const after = since ? '&updated_at=gte.' + q(since) : '';
  const signals = [];
  const cases = await fetchRows('office_training_cases?' + org + after + '&status=in.(graded,to_confirm,confirmed)&select=id,agent_key,title,score,lesson,grade,feedback,updated_at&order=updated_at.desc&limit=40').catch(() => []) || [];
  for (const c of cases) {
    const g = c.grade || {};
    const misses = (g.traps || []).filter(t => !t.detected).map(t => t.id);
    signals.push({ agent: c.agent_key, kind: c.feedback?.verdict === 'a_corriger' ? 'human_correction' : 'training', ref: 'training:' + c.id, score: c.score ?? null,
      text: cut(c.title, 120) + ' — score ' + (c.score ?? '?') + (misses.length ? ' ; oublis : ' + misses.join(', ') : '') + ((g.invented || []).length ? ' ; inventé : ' + g.invented.join(' | ') : '') + ((g.false_alarms || []).length ? ' ; fausses alertes : ' + g.false_alarms.join(' | ') : '') + (c.feedback?.note ? ' ; correction de l’équipe : ' + c.feedback.note : '') + (c.lesson ? ' ; leçon de l’examinateur : ' + c.lesson : '') });
  }
  const decided = await fetchRows('office_action_decisions?' + org + (since ? '&created_at=gte.' + q(since) : '') + '&decision=eq.reject&select=id,note,decided_by,action_snapshot,created_at&order=created_at.desc&limit=40').catch(() => []) || [];
  for (const x of decided) signals.push({ agent: x.action_snapshot?.agent_key || 'grand-controleur', kind: 'human_correction', ref: 'decision:' + x.id,
    text: 'Proposition refusée par ' + (x.decided_by || 'un responsable') + ' : « ' + cut(x.action_snapshot?.summary, 200) + ' » — motif : ' + cut(x.note, 300) });
  const passes = await fetchRows('office_agent_passes?' + org + (since ? '&started_at=gte.' + q(since) : '') + '&status=eq.failed&select=id,agent_key,summary&limit=20').catch(() => []) || [];
  for (const p of passes) signals.push({ agent: p.agent_key, kind: 'incident', ref: 'pass:' + p.id, text: 'Passage en échec : ' + cut(p.summary, 240) });
  const runs = await fetchRows('office_agent_runs?' + org + (since ? '&started_at=gte.' + q(since) : '') + '&status=eq.failed&select=id,agent_key,summary&limit=20').catch(() => []) || [];
  for (const r of runs) signals.push({ agent: r.agent_key, kind: 'incident', ref: 'run:' + r.id, text: 'Réponse en échec : ' + cut(r.summary, 240) });
  return signals.filter(s => AGENT_KEYS.includes(s.agent)).slice(0, 60);
}

// ---------- 2. Distil: evaluate, diagnose, extract lessons and future tests ----------
const DISTIL = `Tu es SHADOW, le laboratoire d'apprentissage d'agents IA d'un cabinet d'audit (agents : orpailleur = documents et Drive ; mission-controller = préparation des missions, TDR, équipe ; grand-controleur = agent central ; enhanced-auditor = revue d'audit ; sika = facturation).
On te donne des OBSERVATIONS factuelles (résultats d'entraînement notés, corrections humaines, refus de propositions, incidents) et les LEÇONS DÉJÀ CONNUES.
Pour chaque vrai problème : évalue objectivement, trouve la cause probable (règle manquante, information manquante, méthode), écris UNE leçon courte et exploitable, une règle à l'impératif, et un test futur qui prouverait que l'agent a appris.
Ne crée pas une leçon qui existe déjà : renvoie alors son id dans "same_as". Distingue faits et hypothèses : une cause non prouvée = type "hypothesis". Une règle venant d'une norme (ISA, IFRS, ACCA, SYSCOHADA) = "professional_rule" UNIQUEMENT si la norme est citée avec sa référence, sinon "hypothesis". Une décision du cabinet = "firm_rule". Un enseignement d'un cas réel ou d'un entraînement = "experience_lesson".
Ne propose JAMAIS de réduire un contrôle, une validation humaine, des permissions, la confidentialité, l'indépendance, les signatures ou les envois externes.
Le travail réel ne se juge pas sur une seule occurrence : "confidence" basse si un seul cas.
JSON STRICT : {"problems":[{"agent":"","category":"(court, ex. deduplication, classement, reconnaissance mission, risques, preuves)","situation":"","error":"","cause":"","lesson":"","rule":"","type":"experience_lesson|hypothesis|professional_rule|firm_rule","source":"(norme et paragraphe si professional_rule)","future_test":{"name":"","scenario":"","expected":""},"evidence":["ref"],"confidence":"haute|moyenne|basse","same_as":""}],"not_problems":["ref d'observations qui ne montrent pas d'erreur"]}`;

export function mergeLesson(lab, p, now = new Date().toISOString()) {
  if (!AGENT_KEYS.includes(p.agent) || !String(p.lesson || p.rule || '').trim()) return null;
  if (touchesProtected(p.lesson + ' ' + p.rule)) { (lab.refused ||= []).push({ at: now, agent: p.agent, text: cut(p.lesson || p.rule, 200), why: 'zone protégée' }); return null; }
  const type = LESSON_TYPES.includes(p.type) ? p.type : 'hypothesis';
  const fromHuman = (p.evidence || []).some(e => /^decision:|correction/.test(e)) || p.kind === 'human_correction';
  let l = (p.same_as && lab.lessons.find(x => x.id === p.same_as)) || lab.lessons.find(x => x.agent === p.agent && !['superseded', 'deprecated', 'rejected'].includes(x.status) && similarity(x.lesson + ' ' + x.rule, p.lesson + ' ' + p.rule) >= 0.6);
  if (l) {
    // New evidence of a known lesson, not a new lesson.
    l.occurrences = (l.occurrences || 1) + 1; l.evidence = [...new Set([...(l.evidence || []), ...(p.evidence || [])])].slice(-20); l.last_at = now;
    if (l.confidence !== 'haute' && (p.confidence === 'haute' || l.occurrences >= 3)) l.confidence = 'haute';
    if (l.status === 'under_review' && l.type === 'experience_lesson' && l.occurrences >= 2 && !l.needs_owner) l.status = 'active';
    return { lesson: l, merged: true };
  }
  const id = 'L-' + crypto.createHash('sha1').update(p.agent + '|' + p.lesson + '|' + now).digest('hex').slice(0, 8);
  // Low risk and proven (a human correction, or a confirmed experience): active at once, versioned.
  // A hypothesis, a firm rule or a professional rule waits for the owner.
  const auto = type === 'experience_lesson' && (fromHuman || p.confidence === 'haute');
  l = { id, agent: p.agent, category: cut(p.category || 'général', 60), situation: cut(p.situation, 300), error: cut(p.error, 300), cause: cut(p.cause, 300), lesson: cut(p.lesson, 400), rule: cut(p.rule, 300),
    type, source: cut(p.source, 200) || null, status: auto ? 'active' : 'under_review', needs_owner: !auto, auto, confidence: ['haute', 'moyenne', 'basse'].includes(p.confidence) ? p.confidence : 'basse',
    occurrences: 1, evidence: (p.evidence || []).slice(0, 10), first_at: now, last_at: now, history: [{ at: now, status: auto ? 'active' : 'under_review', why: auto ? 'apprentissage automatique (risque faible, fait prouvé)' : 'à revoir par le propriétaire' }] };
  lab.lessons.push(l);
  // A future test from a real error becomes a permanent golden test.
  if (p.future_test?.scenario && (fromHuman || p.confidence !== 'basse')) addGolden(lab, p.agent, p.category, p.future_test, l.id, now);
  return { lesson: l, merged: false };
}

export function addGolden(lab, agent, category, t, lessonId, now = new Date().toISOString(), kind = 'golden') {
  const n = lab.tests.filter(x => x.agent === agent).length + 1;
  const cat = String(category || 'GENERAL').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 24);
  if (lab.tests.some(x => x.agent === agent && similarity(x.scenario, t.scenario) >= 0.7)) return null;
  const test = { id: CODE[agent] + '_' + cat + '_' + String(n).padStart(3, '0'), agent, kind, name: cut(t.name, 120), scenario: cut(t.scenario, 2000), expected: cut(t.expected, 1000), lesson_id: lessonId || null, created_at: now, results: [] };
  lab.tests.push(test);
  return test;
}

// ---------- 3. Scores (technical KPI of the agents, never HR) ----------
export async function agentScores(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const rows = await fetchRows('office_training_cases?org_id=eq.' + q(orgId) + '&updated_at=gte.' + q(since) + '&status=in.(graded,to_confirm,confirmed)&select=agent_key,score,grade&limit=1000').catch(() => []) || [];
  const out = {};
  for (const r of rows) {
    const o = (out[r.agent_key] ||= { training: [], recognition: [], traps: [], accuracy: [] });
    if (r.score != null) o.training.push(Number(r.score));
    const g = r.grade || {};
    if (g.recognition) { const v = Object.values(g.recognition); o.recognition.push(v.filter(Boolean).length / Math.max(1, v.length) * 100); }
    if ((g.traps || []).length) o.traps.push(g.traps.filter(t => t.detected).length / g.traps.length * 100);
    if (g.accuracy != null) o.accuracy.push(Number(g.accuracy) / 15 * 100);
  }
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { entrainement: avg(v.training), reconnaissance: avg(v.recognition), anomalies_detectees: avg(v.traps), exactitude: avg(v.accuracy), cas: v.training.length }]));
}

// ---------- 4. Experiment: current version vs candidate, on the golden tests ----------
const EXAM = `Tu es l'examinateur indépendant. On te donne un test (situation et résultat attendu) et la réponse d'un agent. Dis si la réponse obtient le résultat attendu, sans indulgence.
JSON STRICT : {"pass":true|false,"score":0-100,"why":"une phrase"}`;
const REVIEW = `Tu es le FIRM MANAGER (agent central) d'un cabinet d'audit. Shadow te soumet une proposition d'amélioration d'un agent. Revois-la de façon indépendante : cohérence globale, interaction avec les autres agents, sécurité, confidentialité, coût, doublons, impact sur les missions, sur les personnes, éthique, indépendance, régressions, compatibilité avec les règles du cabinet. Shadow ne valide jamais son propre travail : sois critique.
JSON STRICT : {"opinion":"favorable|favorable_avec_reserves|defavorable","justification":"","pros":[""],"cons":[""],"risks":[""]}`;

function baseInstructions(agent) {
  return import('../agents/index.js').then(m => agent === 'grand-controleur' ? m.GRAND_CONTROLEUR_INSTRUCTIONS : m.AGENTS[agent]?.instructions || '');
}
const withLessons = (base, lessons) => base + (lessons.length ? '\n\nLEÇONS APPRISES (applique-les) :\n' + lessons.map(l => '- ' + (l.rule || l.lesson)).join('\n') : '');

export async function runExperiment(orgId, agent, d = {}) {
  if (!AGENT_KEYS.includes(agent)) throw fail('UNKNOWN_AGENT');
  const lab = await loadLab(d);
  const candidates = lab.lessons.filter(l => l.agent === agent && l.status === 'under_review');
  const tests = lab.tests.filter(t => t.agent === agent).slice(-(d.maxTests || 5));
  if (!candidates.length) return { skipped: 'NO_CANDIDATE' };
  if (!tests.length) return { skipped: 'NO_GOLDEN_TEST' };
  const active = lab.lessons.filter(l => l.agent === agent && l.status === 'active');
  const base = await (d.baseInstructions || baseInstructions)(agent);
  const versions = { current: withLessons(base, active), candidate: withLessons(base, [...active, ...candidates]) };
  const results = { current: [], candidate: [] };
  for (const t of tests) {
    for (const v of ['current', 'candidate']) {
      try {
        const ans = await shadowAI(lab, { instructions: versions[v] + '\n\nMODE TEST (laboratoire Shadow) : situation fictive, aucun outil, ne prétends jamais avoir agi.', input: t.scenario, maxTokens: 1500 }, { kind: 'test', agent, ref: t.id }, d);
        const ex = parseJsonLoose((await shadowAI(lab, { instructions: EXAM, input: 'TEST : ' + t.scenario + '\nATTENDU : ' + t.expected + '\n\nRÉPONSE : ' + cut(ans.text, 8000), maxTokens: 400 }, { kind: 'exam', agent, ref: t.id }, d)).text);
        results[v].push({ test: t.id, pass: Boolean(ex.pass), score: Number(ex.score) || 0, why: cut(ex.why, 200) });
      } catch (e) { results[v].push({ test: t.id, pass: false, score: 0, why: 'non exécuté : ' + cut(e.message, 80) }); if (/DAILY_/.test(e.message)) break; }
    }
  }
  const rate = list => list.length ? Math.round(list.filter(x => x.pass).length / list.length * 100) : null;
  const regressions = results.current.filter(c => c.pass && results.candidate.find(x => x.test === c.test && !x.pass)).map(c => c.test);
  const exp = { id: 'X-' + Date.now().toString(36), agent, at: new Date().toISOString(), problem: [...new Set(candidates.map(l => l.category))].join(', '),
    lessons: candidates.map(l => l.id), change: candidates.map(l => l.rule || l.lesson), baseline: { version: lab.agents[agent].version, golden: rate(results.current), results: results.current },
    candidate: { golden: rate(results.candidate), results: results.candidate }, regressions, tests: tests.map(t => t.id), status: 'firm_manager_review', rollback: 'Version ' + lab.agents[agent].version + ' et ses leçons actives, conservées.' };
  try {
    exp.review = parseJsonLoose((await shadowAI(lab, { instructions: REVIEW, input: JSON.stringify({ agent, lessons: candidates.map(l => ({ type: l.type, situation: l.situation, cause: l.cause, lesson: l.lesson, rule: l.rule, source: l.source, occurrences: l.occurrences })), before: exp.baseline.golden, after: exp.candidate.golden, regressions }).slice(0, 20000), maxTokens: 1500 }, { kind: 'review', agent, ref: exp.id }, d)).text);
  } catch (e) { exp.review = { opinion: 'defavorable', justification: 'Revue impossible : ' + cut(e.message, 100) }; }
  exp.status = 'awaiting_owner';
  exp.cost = lab.usage[today()]?.cost || 0;
  await changeLab(l => { l.experiments.push(exp); l.self.proposals++; l.usage = { ...l.usage, ...lab.usage }; l.calls = lab.calls; const a = l.agents[agent]; for (const r of results.candidate) { const t = l.tests.find(x => x.id === r.test); if (t) t.results = [...(t.results || []), { at: exp.at, version: 'candidate', pass: r.pass }].slice(-10); } a.last_experiment = exp.id; }, d);
  return exp;
}

// ---------- 5. Owner decision, versions, rollback ----------
export async function decide(orgId, input, by, d = {}) {
  const decision = String(input.decision || '');
  if (!['approve', 'refuse', 'more_tests'].includes(decision)) throw fail('INVALID_DECISION');
  const out = await changeLab(lab => {
    const exp = lab.experiments.find(x => x.id === input.experiment_id);
    if (!exp || exp.status !== 'awaiting_owner') throw fail('EXPERIMENT_NOT_PENDING', 409);
    const now = new Date().toISOString();
    exp.status = decision === 'approve' ? 'approved' : decision === 'refuse' ? 'refused' : 'more_tests'; exp.decided_by = cut(by, 120); exp.decided_at = now; exp.owner_note = cut(input.note, 500) || null;
    const a = lab.agents[exp.agent];
    if (decision === 'approve') {
      const [maj, min] = String(a.version || '1.0').split('.').map(Number);
      const previous = a.version;
      a.version = maj + '.' + ((min || 0) + 1);
      for (const id of exp.lessons) { const l = lab.lessons.find(x => x.id === id); if (l) { l.status = 'active'; l.needs_owner = false; l.history.push({ at: now, status: 'active', why: 'approuvée par ' + by + ' (expérience ' + exp.id + ')' }); } }
      a.versions.push({ version: a.version, previous, at: now, reason: exp.problem, change: exp.change, tests: { before: exp.baseline.golden, after: exp.candidate.golden, regressions: exp.regressions }, decision: 'approuvée', approver: cut(by, 120), lessons: exp.lessons, rollback_to: previous });
      exp.measure_from = now; lab.self.approved++;
    } else if (decision === 'refuse') {
      for (const id of exp.lessons) { const l = lab.lessons.find(x => x.id === id); if (l) { l.status = 'rejected'; l.history.push({ at: now, status: 'rejected', why: 'refusée par ' + by + (input.note ? ' : ' + cut(input.note, 200) : '') }); } }
      lab.self.rejected++;
    } else { lab.self.more_tests++; exp.want_more_tests = true; }
    return { experiment: exp.id, status: exp.status, version: a.version };
  }, d);
  await (d.audit || audit)(orgId, { agent: 'shadow', action_type: 'SHADOW_DECISION', decision, status: decision === 'approve' ? 'approved' : decision === 'refuse' ? 'rejected' : 'proposed', reviewer: by, approved_by: decision === 'approve' ? by : null, ref_id: input.experiment_id }).catch(() => null);
  return out;
}

export async function rollback(orgId, agent, by, d = {}) {
  const out = await changeLab(lab => {
    const a = lab.agents[agent]; if (!a) throw fail('UNKNOWN_AGENT');
    const v = [...(a.versions || [])].reverse().find(x => x.version === a.version && !x.rolled_back);
    if (!v) throw fail('NOTHING_TO_ROLL_BACK', 409);
    const now = new Date().toISOString();
    for (const id of v.lessons || []) { const l = lab.lessons.find(x => x.id === id); if (l) { l.status = 'superseded'; l.history.push({ at: now, status: 'superseded', why: 'retour à la version ' + v.rollback_to + ' par ' + by }); } }
    v.rolled_back = { at: now, by: cut(by, 120) }; a.version = v.rollback_to; lab.self.rollbacks++;
    return { agent, version: a.version };
  }, d);
  await (d.audit || audit)(orgId, { agent: 'shadow', action_type: 'SHADOW_ROLLBACK', status: 'executed', reviewer: by, decision: agent + ' → ' + out.version }).catch(() => null);
  return out;
}

export async function setLessonStatus(orgId, input, by, d = {}) {
  if (!STATUSES.includes(input.status)) throw fail('INVALID_STATUS');
  return changeLab(lab => {
    const l = lab.lessons.find(x => x.id === input.id); if (!l) throw fail('LESSON_NOT_FOUND', 404);
    if (input.status === 'active' && touchesProtected(l.lesson + ' ' + l.rule)) throw fail('PROTECTED_ZONE', 403);
    l.status = input.status; l.needs_owner = false; l.history.push({ at: new Date().toISOString(), status: input.status, why: (by || 'propriétaire') + (input.note ? ' : ' + cut(input.note, 200) : '') });
    return l;
  }, d);
}

// ---------- 6. Challenge: harder variants that prove the lesson is really learnt ----------
const CHALLENGE = `Tu es SHADOW. Pour la faiblesse donnée d'un agent d'un cabinet d'audit, crée des situations d'entraînement PLUS DIFFICILES (variantes trompeuses, cas limites, ordre inversé, nom différent, qualité dégradée, deux cas presque identiques mais réellement différents). Chaque situation est fictive, réaliste et se suffit à elle-même.
JSON STRICT : {"tests":[{"name":"","scenario":"","expected":""}]}`;
export async function generateTests(orgId, agent, d = {}) {
  if (!AGENT_KEYS.includes(agent)) throw fail('UNKNOWN_AGENT');
  const lab = await loadLab(d);
  const weak = lab.lessons.filter(l => l.agent === agent && ['active', 'under_review'].includes(l.status)).slice(-5);
  if (!weak.length) return { created: 0, reason: 'Aucune faiblesse connue pour cet agent.' };
  const r = await shadowAI(lab, { instructions: CHALLENGE, input: JSON.stringify(weak.map(l => ({ category: l.category, situation: l.situation, error: l.error, lesson: l.lesson }))), maxTokens: 3000 }, { kind: 'challenge', agent }, d);
  const tests = parseJsonLoose(r.text).tests || [];
  let created = 0;
  await changeLab(l => { l.usage = { ...l.usage, ...lab.usage }; l.calls = lab.calls; for (const t of tests.slice(0, 6)) if (addGolden(l, agent, weak[0].category, t, weak[0].id, undefined, 'challenge')) created++; }, d);
  return { created };
}

// ---------- 7. Professional standards (ISA, IFRS, ACCA, SYSCOHADA, SOP) — light index ----------
const INDEX = `Tu indexes une norme professionnelle (ISA, IFRS, code ACCA, SYSCOHADA, procédure du cabinet). Uniquement ce qui est écrit dans le texte.
JSON STRICT : {"standard":"ISA|IFRS|IAS|ACCA_Ethics|SYSCOHADA|Firm_SOP|autre","number":"","title":"","version":"","effective_date":"","sections":[{"ref":"(paragraphe, ex. A12 ou 26)","title":"","summary":"(une phrase)"}]}`;
export async function addSource(orgId, input, by, d = {}) {
  const id = String(input.file_id || '').trim();
  if (!/^[\w-]{10,}$/.test(id)) throw fail('FILE_ID_REQUIRED');
  const drive = d.drive || driveAdapter;
  const meta = await drive.getMeta(id);
  const t = await drive.readText(id, { maxChars: 150000 }).catch(() => null);
  const text = String(t?.text ?? t ?? '');
  if (text.length < 200) throw fail('STANDARD_UNREADABLE', 422);
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  const lab = await loadLab(d);
  if (lab.sources.some(s => s.hash === hash)) return { already: true };
  const idx = parseJsonLoose((await shadowAI(lab, { instructions: INDEX, input: cut(text, 120000), maxTokens: 8000 }, { kind: 'index', ref: id }, d)).text);
  return changeLab(l => {
    l.usage = { ...l.usage, ...lab.usage }; l.calls = lab.calls;
    const now = new Date().toISOString();
    const same = l.sources.filter(s => s.standard === idx.standard && String(s.number) === String(idx.number) && s.status === 'actif');
    const src = { id: 'S-' + hash.slice(0, 10), standard: cut(idx.standard, 30), number: cut(idx.number, 20), title: cut(idx.title, 200), version: cut(idx.version, 60) || null, effective_date: cut(idx.effective_date, 30) || null,
      file_id: id, url: meta?.webViewLink || null, name: meta?.name || null, hash, ingested_at: now, ingested_by: cut(by, 120), status: 'actif',
      sections: (idx.sections || []).slice(0, 400).map(s => ({ ref: cut(s.ref, 30), title: cut(s.title, 160), summary: cut(s.summary, 300) })) };
    // A new version never erases the old one: kept for the missions of its period.
    for (const old of same) { old.status = 'ancien'; old.replaced_by = src.id; old.applies_until = src.effective_date || now.slice(0, 10);
      const before = new Set(old.sections.map(s => s.ref)), after = new Set(src.sections.map(s => s.ref));
      src.changes = { added: [...after].filter(r => !before.has(r)).slice(0, 50), removed: [...before].filter(r => !after.has(r)).slice(0, 50), previous: old.id }; }
    l.sources.push(src);
    return { added: src.id, sections: src.sections.length, replaced: same.map(s => s.id) };
  }, d);
}

// For the agents: which standard, which paragraph, with its source — never an invented requirement.
export async function searchStandards(query, { date = null } = {}, d = {}) {
  const lab = await loadLab(d);
  const Q = words(query);
  const hits = [];
  for (const s of lab.sources) {
    if (date && s.status === 'ancien' && s.applies_until && s.applies_until < String(date)) continue;
    if (!date && s.status !== 'actif') continue;
    for (const sec of s.sections) {
      const W = words(s.standard + ' ' + s.number + ' ' + s.title + ' ' + sec.title + ' ' + sec.summary);
      let n = 0; for (const w of Q) if (W.has(w)) n++;
      if (n) hits.push({ n, standard: s.standard + ' ' + s.number, title: s.title, version: s.version, paragraph: sec.ref, section: sec.title, summary: sec.summary, source: s.url || s.name });
    }
  }
  return { results: hits.sort((a, b) => b.n - a.n).slice(0, 10).map(({ n, ...x }) => x), rule: 'Ne cite une exigence d’une norme qu’avec la référence trouvée ici ; sinon dis qu’elle n’est pas dans la bibliothèque du cabinet.' };
}

// ---------- 8. Active lessons, used by the agents at work ----------
let lessonCache = { at: 0, lab: null };
export async function activeLessons(agent, d = {}) {
  if (!lessonCache.lab || Date.now() - lessonCache.at > 300000) lessonCache = { at: Date.now(), lab: await loadLab(d).catch(() => emptyLab()) };
  return lessonCache.lab.lessons.filter(l => l.agent === agent && l.status === 'active').sort((a, b) => (b.occurrences || 1) - (a.occurrences || 1)).slice(0, 8)
    .map(l => (l.rule || l.lesson) + (l.type === 'professional_rule' && l.source ? ' (' + l.source + ')' : ''));
}

// ---------- 9. The users' short questionnaire (orients the trainings) ----------
export const SURVEY_QUESTIONS = [
  { id: 'helped', text: 'Quel agent vous a le plus aidé cette semaine, et sur quoi ?' },
  { id: 'mistake', text: 'Un agent s’est-il trompé ou a-t-il oublié quelque chose ? Lequel, et quoi ?' },
  { id: 'improve', text: 'Qu’est-ce que vous aimeriez que les agents fassent mieux en priorité ?' },
  { id: 'trust', text: 'Sur 5, quelle confiance faites-vous aux propositions des agents ?' }
];
export async function currentSurvey(account, d = {}) {
  const lab = await loadLab(d);
  const s = lab.surveys[lab.surveys.length - 1];
  if (!s || s.closed) return { survey: null };
  const me = String(account?.email || '').toLowerCase();
  return { survey: { id: s.id, questions: s.questions, answered: (s.answers || []).some(a => a.by === me) } };
}
export async function answerSurvey(input, account, d = {}) {
  const me = String(account?.email || '').toLowerCase();
  if (!me) throw fail('USER_SESSION_REQUIRED', 401);
  return changeLab(lab => {
    const s = lab.surveys.find(x => x.id === input.survey_id && !x.closed); if (!s) throw fail('SURVEY_CLOSED', 409);
    if ((s.answers || []).some(a => a.by === me)) throw fail('ALREADY_ANSWERED', 409);
    const answers = Object.fromEntries(s.questions.map(qq => [qq.id, cut(input.answers?.[qq.id], 1000)]));
    (s.answers ||= []).push({ by: me, at: new Date().toISOString(), answers });
    return { saved: true };
  }, d);
}
function surveySignals(lab, since) {
  const out = [];
  for (const s of lab.surveys) for (const a of s.answers || []) {
    if (since && a.at < since) continue;
    const text = [a.answers.mistake, a.answers.improve].filter(Boolean).join(' — ');
    if (!text) continue;
    const agent = /orpailleur|drive|class|rang/i.test(text) ? 'orpailleur' : /audit|revue|risque|working/i.test(text) ? 'enhanced-auditor' : /tdr|mission|équipe|equipe|staffing/i.test(text) ? 'mission-controller' : /factur|paiement|relance/i.test(text) ? 'sika' : 'grand-controleur';
    out.push({ agent, kind: 'human_correction', ref: 'survey:' + s.id, text: 'Questionnaire utilisateur : ' + cut(text, 400) });
  }
  return out;
}

// ---------- 10. The daily pass (only what changed; within its daily budget) ----------
export async function shadowPass(orgId, d = {}) {
  const cfg = shadowConfig(d.env);
  if (!cfg.enabled) return { skipped: 'SHADOW_DISABLED' };
  const st = providersStatus(d.env || process.env);
  if (!st.anthropic && !st.openai && !st.gemini) return { skipped: 'NO_AI_KEY' };
  const lab = await loadLab(d);
  if (!d.force && lab.last_run === today()) return { skipped: 'ALREADY_TODAY' };
  const since = lab.last_observed_at;
  const signals = [...await observe(orgId, since, d), ...surveySignals(lab, since)];
  const now = new Date().toISOString();
  let distilled = { problems: [] };
  if (signals.length) {
    const known = lab.lessons.filter(l => !['deprecated', 'rejected'].includes(l.status)).slice(-80).map(l => ({ id: l.id, agent: l.agent, lesson: l.lesson }));
    try { distilled = parseJsonLoose((await shadowAI(lab, { instructions: DISTIL, input: 'OBSERVATIONS : ' + JSON.stringify(signals).slice(0, 40000) + '\n\nLEÇONS CONNUES : ' + JSON.stringify(known).slice(0, 20000), maxTokens: 6000 }, { kind: 'distil' }, d)).text); }
    catch (e) { distilled = { problems: [], error: cut(e.message, 120) }; }
  }
  const scores = await agentScores(orgId, d).catch(() => ({}));
  const result = await changeLab(l => {
    l.usage = { ...l.usage, ...lab.usage }; l.calls = lab.calls;
    let added = 0, merged = 0;
    for (const p of distilled.problems || []) {
      const kind = (p.evidence || []).some(e => /^decision:|^survey:/.test(e)) ? 'human_correction' : null;
      const r = mergeLesson(l, { ...p, kind }, now);
      if (!r) continue; r.merged ? merged++ : added++;
      l.problems.push({ at: now, agent: p.agent, category: p.category, problem: cut(p.error || p.situation, 300), cause: cut(p.cause, 300), evidence: (p.evidence || []).slice(0, 8), lesson: r.lesson.id });
    }
    l.self.false_diagnoses += 0;
    for (const [k, v] of Object.entries(scores)) { const a = l.agents[k]; if (!a) continue; a.scores = v; a.score_history.push({ at: now.slice(0, 10), ...v }); a.weaknesses = l.lessons.filter(x => x.agent === k && x.status !== 'deprecated').slice(-5).map(x => x.category); }
    // Weekly questionnaire for the users.
    const last = l.surveys[l.surveys.length - 1];
    if (!last || Date.now() - Date.parse(last.at) > 7 * 86400000) { if (last) last.closed = true; l.surveys.push({ id: 'Q-' + now.slice(0, 10), at: now, questions: SURVEY_QUESTIONS, answers: [] }); }
    l.last_observed_at = now; l.last_run = today();
    return { signals: signals.length, added, merged };
  }, d);
  // One experiment a day at most: the agent with the most lessons waiting.
  const fresh = await loadLab(d);
  const waiting = AGENT_KEYS.map(a => [a, fresh.lessons.filter(x => x.agent === a && x.status === 'under_review').length]).sort((x, y) => y[1] - x[1])[0];
  if (waiting && waiting[1] && !fresh.experiments.some(e => e.agent === waiting[0] && e.status === 'awaiting_owner')) result.experiment = await runExperiment(orgId, waiting[0], d).then(e => e.id || e.skipped, e => cut(e.message, 80));
  // At most one CODE proposal a day (2026-10-10): a branch + draft pull request a person reviews.
  if (d.req?.headers?.host) result.code = await (d.autoCodeProposal || (async (...a) => (await import('./shadow-code.js')).autoCodeProposal(...a)))(orgId, d.req, d).then(r => r.id || r.skipped, e => cut(e.message, 80));
  return result;
}

export async function labView(d = {}) {
  const lab = await loadLab(d);
  const cfg = shadowConfig(d.env);
  return { config: { enabled: cfg.enabled, model: cfg.model, max_daily_runs: cfg.maxRuns, max_daily_cost: cfg.maxCost }, usage_today: lab.usage[today()] || { runs: 0, tokens: 0, cost: 0 },
    usage_30d: Object.values(lab.usage).reduce((a, u) => ({ runs: a.runs + u.runs, cost: Math.round((a.cost + u.cost) * 100) / 100 }), { runs: 0, cost: 0 }),
    agents: lab.agents, lessons: lab.lessons.slice(-150).reverse(), tests: lab.tests.slice(-120).reverse(), experiments: lab.experiments.slice(-30).reverse(), problems: lab.problems.slice(-60).reverse(),
    sources: lab.sources.map(s => ({ ...s, sections: s.sections.length })), surveys: lab.surveys.slice(-4).reverse().map(s => ({ id: s.id, at: s.at, closed: Boolean(s.closed), answers: (s.answers || []).length, latest: (s.answers || []).slice(-10) })),
    self: lab.self, refused: (lab.refused || []).slice(-20), last_run: lab.last_run, calls: (lab.calls || []).slice(-30).reverse(),
    code: (await import('./shadow-code.js')).codeView(lab, d.env || process.env) };
}
