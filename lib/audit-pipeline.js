import { reasonWithDocuments, documentIdsIn } from './document-reasoning.js';
// Un test d'audit écrit en mots, exécuté par la machine (Paul, 2026-10-25 : « si le cabinet n'a pas de workbook, l'auditeur écrit ce qu'il
// faut faire et la machine le fait ; je veux que ce soit intelligent, et qu'il le donne dès qu'il le voit »).
//
// L'IA traduit la consigne (une étape du SOP, ou la phrase de l'auditeur) en une SUITE d'opérations prises dans une liste FERMÉE, avec leurs
// paramètres ; le CODE valide cette suite (opérations connues, pièces de la mission seulement, paramètres bornés) puis l'exécute — toujours
// le même résultat pour les mêmes pièces : chaque chiffre est traçable, rien n'est du code écrit par l'IA et exécuté. Chaque étape garde
// combien de lignes entrent et sortent ; le résultat s'affiche tout de suite (aperçu, rien d'écrit) puis s'écrit dans une feuille à part du
// working file sur « Écrire ».
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const round = n => Math.round((Number(n) || 0) * 100) / 100;
const MAX_STEPS = 8, MAX_OUT = 5000;

export const PIPELINE_OPS = Object.freeze({
  filter: 'garder les lignes qui répondent à des critères (comptes, période, montant mini / maxi, mots du libellé, tiers, journal)',
  duplicates: 'garder les doublons possibles (mêmes valeurs sur les champs choisis : date, montant, pièce, tiers, libellé, compte)',
  round_amounts: 'garder les montants ronds (multiple choisi, 1 000 par défaut)',
  weekend: 'garder les écritures passées un samedi ou un dimanche',
  out_of_period: 'garder les écritures hors de la période de la mission',
  cutoff: 'garder les écritures autour de la date de clôture (± jours)',
  top: 'garder les N plus gros montants',
  group: 'regrouper par compte, tiers, mois, journal ou libellé (nombre, débit, crédit, montant)',
  compare: 'rapprocher avec une autre pièce (grand livre ↔ balance, relevé…) par compte : écarts',
  sample: 'tirer un échantillon (aléatoire reproductible, plus gros montants, ou systématique)',
  benford: 'loi de Benford : répartition des premiers chiffres comparée à l’attendu',
  checklist: 'ajouter des colonnes à remplir pour chaque ligne (ex. « Bon de commande ? », « Facture ? »)'
});
const FIELDS = ['date', 'amount', 'ref', 'party', 'label', 'account', 'journal'];
const GROUPS = ['account', 'party', 'month', 'journal', 'label'];

const str = (v, n = 80) => (v == null ? null : String(v).slice(0, n));
const num = v => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const day = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const list = (v, n = 20, len = 60) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(x => String(x).slice(0, len)).filter(Boolean).slice(0, n);

// The code's check of what the AI proposed: only known operations, only the mission's files, bounded parameters.
export function cleanPipeline(raw, sourceIds, defaults = {}) {
  const ids = new Set(sourceIds), problems = [];
  const steps = (Array.isArray(raw) ? raw : []).slice(0, MAX_STEPS).map((s, i) => {
    const op = Object.hasOwn(PIPELINE_OPS, s?.op) ? s.op : null;
    if (!op) { problems.push('étape ' + (i + 1) + ' : opération inconnue « ' + String(s?.op || '').slice(0, 30) + ' »'); return null; }
    const p = s.params || {};
    const params = {
      filter: () => ({ accounts: list(p.accounts, 30, 12).map(a => a.replace(/[^\dA-Za-z]/g, '')), accounts_exclude: list(p.accounts_exclude, 30, 12).map(a => a.replace(/[^\dA-Za-z]/g, '')),
        date_from: day(p.date_from), date_to: day(p.date_to), min_amount: num(p.min_amount), max_amount: num(p.max_amount),
        label_contains: list(p.label_contains, 10), label_excludes: list(p.label_excludes, 10), party_contains: list(p.party_contains, 10), journal: list(p.journal, 10, 20) }),
      duplicates: () => ({ by: list(p.by, 7, 12).filter(f => FIELDS.includes(f)).length ? list(p.by, 7, 12).filter(f => FIELDS.includes(f)) : ['date', 'amount', 'ref'] }),
      round_amounts: () => ({ multiple: Math.max(1, num(p.multiple) || 1000) }),
      weekend: () => ({}),
      out_of_period: () => ({ period_start: day(p.period_start) || defaults.start || null, period_end: day(p.period_end) || defaults.end || null }),
      cutoff: () => ({ period_end: day(p.period_end) || defaults.end || null, days: Math.min(90, Math.max(1, num(p.days) || 15)) }),
      top: () => ({ n: Math.min(500, Math.max(1, num(p.n) || 10)) }),
      group: () => ({ by: GROUPS.includes(p.by) ? p.by : 'account' }),
      compare: () => ({ with_file_id: ids.has(String(p.with_file_id || '')) ? String(p.with_file_id) : null, account_length: Math.min(12, Math.max(0, num(p.account_length) || 0)) || null, tolerance: Math.max(0, num(p.tolerance) ?? 0.01) }),
      sample: () => ({ size: Math.min(500, Math.max(1, num(p.size) || 25)), method: ['random', 'largest', 'systematic'].includes(p.method) ? p.method : 'random', seed: str(p.seed, 40) || defaults.seed || 'office-manager' }),
      benford: () => ({}),
      checklist: () => ({ columns: list(p.columns, 8, 60) })
    }[op]();
    if (op === 'compare' && !params.with_file_id) problems.push('étape ' + (i + 1) + ' : la pièce à rapprocher n’est pas une pièce de la mission');
    if ((op === 'cutoff') && !params.period_end) problems.push('étape ' + (i + 1) + ' : date de clôture inconnue');
    return { op, params, why: str(s.why, 200) };
  }).filter(Boolean);
  if (!steps.length) problems.push('aucune opération');
  return { steps, problems, ready: !problems.length };
}

// A seeded random generator: the same seed gives the same sample (reproducible, as the working files require).
function seeded(seed) { let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1e9) / 1e9; }; }
const has = (s, words) => words.some(w => fold(s).includes(fold(w)));
const prefix = (a, ps) => ps.some(p => String(a || '').replace(/\s/g, '').startsWith(p));

// Run the steps on ledger-like rows ({row, date, account, label, ref, party, journal, debit, credit, amount}); `others` = other files' rows.
export function runPipeline(rows, pipeline, others = {}) {
  let cur = rows.slice(), columns = ['row', 'date', 'account', 'label', 'ref', 'party', 'debit', 'credit', 'amount'], extra = [];
  const trace = [], flags = [];
  let shape = 'lines';
  for (const s of pipeline.steps) {
    const before = cur.length, p = s.params;
    if (s.op === 'filter') cur = cur.filter(r => (!p.accounts.length || prefix(r.account, p.accounts)) && !(p.accounts_exclude.length && prefix(r.account, p.accounts_exclude))
      && (!p.date_from || (r.date && r.date >= p.date_from)) && (!p.date_to || (r.date && r.date <= p.date_to))
      && (p.min_amount == null || Math.abs(r.amount || 0) >= p.min_amount) && (p.max_amount == null || Math.abs(r.amount || 0) <= p.max_amount)
      && (!p.label_contains.length || has(r.label, p.label_contains)) && !(p.label_excludes.length && has(r.label, p.label_excludes))
      && (!p.party_contains.length || has(r.party, p.party_contains)) && (!p.journal.length || p.journal.some(j => fold(r.journal) === fold(j))));
    else if (s.op === 'duplicates') {
      const k = r => p.by.map(f => (f === 'amount' ? round(r.amount) : fold(r[f]).slice(0, 60))).join('|'), groups = new Map();
      for (const r of cur) { const g = k(r); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
      cur = [...groups.values()].filter(g => g.length > 1 && g[0].amount).flat();
      for (const g of [...groups.values()].filter(g => g.length > 1 && g[0].amount).slice(0, 100)) flags.push({ kind: 'duplicate', text: 'Doublon possible : lignes ' + g.map(r => r.row).join(', ') + ' (' + p.by.join(' + ') + ')' });
    } else if (s.op === 'round_amounts') cur = cur.filter(r => Math.abs(r.amount || 0) >= p.multiple && Math.abs(r.amount) % p.multiple === 0);
    else if (s.op === 'weekend') cur = cur.filter(r => r.date && [0, 6].includes(new Date(r.date + 'T00:00:00Z').getUTCDay()));
    else if (s.op === 'out_of_period') cur = cur.filter(r => r.date && ((p.period_start && r.date < p.period_start) || (p.period_end && r.date > p.period_end)));
    else if (s.op === 'cutoff') { const t = Date.parse(p.period_end + 'T00:00:00Z'), lo = new Date(t - p.days * 864e5).toISOString().slice(0, 10), hi = new Date(t + p.days * 864e5).toISOString().slice(0, 10); cur = cur.filter(r => r.date && r.date >= lo && r.date <= hi); for (const r of cur.filter(r => r.date > p.period_end).slice(0, 50)) flags.push({ kind: 'after_close', text: 'Après clôture ligne ' + r.row + ' (' + r.date + ', ' + r.amount + ') : vérifier la période de rattachement' }); }
    else if (s.op === 'top') cur = [...cur].sort((a, b) => Math.abs(b.amount || 0) - Math.abs(a.amount || 0)).slice(0, p.n);
    else if (s.op === 'group') {
      const key = r => (p.by === 'month' ? String(r.date || '').slice(0, 7) || 'sans date' : String(r[p.by] || '').trim() || '(vide)'), m = new Map();
      for (const r of cur) { const g = key(r); const o = m.get(g) || { key: g, count: 0, debit: 0, credit: 0, amount: 0 }; o.count++; o.debit = round(o.debit + (r.debit || 0)); o.credit = round(o.credit + (r.credit || 0)); o.amount = round(o.amount + (r.amount || 0)); m.set(g, o); }
      cur = [...m.values()].sort((a, b) => String(a.key).localeCompare(String(b.key))); columns = ['key', 'count', 'debit', 'credit', 'amount']; shape = 'groups';
    } else if (s.op === 'compare') {
      const len = p.account_length, key = a => { const x = String(a || '').replace(/\s/g, ''); return len ? x.slice(0, len) : x; };
      const by = rs => { const m = new Map(); for (const r of rs) if (r.account) m.set(key(r.account), round((m.get(key(r.account)) || 0) + (r.amount || 0))); return m; };
      const a = by(cur), b = by(others[p.with_file_id] || []);
      cur = [...new Set([...a.keys(), ...b.keys()])].sort().map(k => ({ key: k, mine: a.get(k) ?? 0, other: b.get(k) ?? 0, difference: round((a.get(k) ?? 0) - (b.get(k) ?? 0)) }));
      columns = ['key', 'mine', 'other', 'difference']; shape = 'compare';
      for (const l of cur.filter(l => Math.abs(l.difference) >= p.tolerance).slice(0, 100)) flags.push({ kind: 'difference', text: 'Compte ' + l.key + ' : ' + l.mine + ' / ' + l.other + ' (écart ' + l.difference + ')' });
    } else if (s.op === 'sample') {
      if (p.method === 'largest') cur = [...cur].sort((a, b) => Math.abs(b.amount || 0) - Math.abs(a.amount || 0)).slice(0, p.size);
      else if (p.method === 'systematic') { const step = Math.max(1, Math.floor(cur.length / p.size)); cur = cur.filter((_, i) => i % step === 0).slice(0, p.size); }
      else { const rnd = seeded(p.seed); cur = cur.map(r => ({ r, k: rnd() })).sort((a, b) => a.k - b.k).slice(0, p.size).map(x => x.r).sort((a, b) => (a.row || 0) - (b.row || 0)); }
    } else if (s.op === 'benford') {
      const counts = Array(10).fill(0); let n = 0;
      for (const r of cur) { const d = String(Math.abs(r.amount || 0)).replace(/^0\.?0*/, '')[0]; if (d >= '1' && d <= '9') { counts[d]++; n++; } }
      cur = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => { const exp = Math.log10(1 + 1 / d), obs = n ? counts[d] / n : 0; return { key: String(d), count: counts[d], observed: round(obs * 100), expected: round(exp * 100), difference: round((obs - exp) * 100) }; });
      columns = ['key', 'count', 'observed', 'expected', 'difference']; shape = 'benford';
      for (const l of cur.filter(l => Math.abs(l.difference) >= 5)) flags.push({ kind: 'benford', text: 'Premier chiffre ' + l.key + ' : ' + l.observed + ' % observé contre ' + l.expected + ' % attendu' });
    } else if (s.op === 'checklist') extra = [...new Set([...extra, ...p.columns])];
    trace.push({ op: s.op, label: PIPELINE_OPS[s.op], in: before, out: cur.length, why: s.why || null });
  }
  const total = shape === 'lines' ? { lines: cur.length, debit: round(cur.reduce((x, r) => x + (r.debit || 0), 0)), credit: round(cur.reduce((x, r) => x + (r.credit || 0), 0)), net: round(cur.reduce((x, r) => x + (r.amount || 0), 0)) } : { lines: cur.length };
  return { shape, columns: [...columns, ...extra], extra, rows: cur.slice(0, MAX_OUT), count: cur.length, truncated: cur.length > MAX_OUT, totals: total, trace, flags: flags.slice(0, 300) };
}

export const COLUMN_LABEL = { row: 'Ligne source', date: 'Date', account: 'Compte', label: 'Libellé', ref: 'Pièce', party: 'Tiers', debit: 'Débit', credit: 'Crédit', amount: 'Montant',
  key: 'Clé', count: 'Nombre', mine: 'Cette pièce', other: 'Autre pièce', difference: 'Écart', observed: '% observé', expected: '% attendu' };

export const PLAN_PROMPT = `Tu es l'Enhanced Auditor. Transforme la consigne (une étape du SOP ou la phrase de l'auditeur) en un test exécutable : une SUITE
d'opérations prises UNIQUEMENT dans cette liste, appliquée à une pièce de la mission (la population) :
${Object.entries(PIPELINE_OPS).map(([k, v]) => '- ' + k + ' : ' + v).join('\n')}
Paramètres : filter {accounts[], accounts_exclude[], date_from, date_to, min_amount, max_amount, label_contains[], label_excludes[], party_contains[], journal[]} ;
duplicates {by[] parmi date, amount, ref, party, label, account, journal} ; round_amounts {multiple} ; out_of_period {period_start, period_end} ;
cutoff {period_end, days} ; top {n} ; group {by : account|party|month|journal|label} ; compare {with_file_id, account_length, tolerance} ;
sample {size, method : random|largest|systematic, seed} ; checklist {columns[] : ce que l'auditeur doit vérifier sur chaque ligne}.
Choisis la pièce par son CONTENU (en-têtes, premières lignes), jamais par son nom. Dates au format AAAA-MM-JJ. Si la consigne demande de
vérifier des pièces justificatives ligne par ligne, termine par checklist avec ces vérifications. Si une information manque (seuil, pièce),
mets-la dans "questions" au lieu de l'inventer.
JSON STRICT : {"understood":"ce que fait le test, en une phrase","source_file_id":"…","pipeline":[{"op":"…","params":{},"why":"…"}],"questions":["…"]}`;

// ---- Service: plan (AI, cached), preview (code, nothing written), write (one click) ------------------------------------------
const fail = (code, statusCode = 400, extra = {}) => Object.assign(new Error(code), { statusCode, ...extra });
const keyOf = s => { let h = 5381; for (const c of fold(s)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return 'p' + h.toString(36); };
const isTable = n => /\.(xlsx|xls|csv)$/i.test(n || '');
export const PIPELINE_MARK = 'Office Manager — test exécuté';

async function deps(d) {
  const sr = await import('./step-runner.js');
  return { sr, view: d.view || (await import('./procedure-work.js')).procedureView, drive: d.drive || (await import('./drive-adapter.js')).driveAdapter,
    table: d.clientTable || (await import('./workfile-table-import.js')).clientTable };
}
// The population as ledger rows: a grand livre by account sections is flattened first (account on each entry, report / total lines set aside).
export async function loadRows(fileId, sheet, x) {
  const t = await x.table(fileId, x.drive, sheet || undefined);
  const cols = x.sr.ledgerColumns((t.rows[t.header_row] || []).map(String));
  if (cols.amount == null && cols.debit == null && cols.credit == null) throw fail('AMOUNT_COLUMN_NOT_FOUND', 422, { headers: (t.rows[t.header_row] || []).map(String).slice(0, 30) });
  const rows = x.sr.ledgerRows(t, cols).filter(r => r.amount != null || r.debit || r.credit);
  if (t.lines) for (const r of rows) r.row = t.lines[r.row - 2] || r.row;   // the line number in the client's own file
  return { rows, meta: t.meta, flattened: t.flattened || null };
}
function publicResult(res, plan, src) {
  return { understood: plan.understood, questions: plan.questions || [], source: src ? { file_id: src.meta.id, name: src.meta.name, flattened: src.flattened } : null,
    pipeline: plan.pipeline, shape: res?.shape || null, columns: (res?.columns || []).map(c => ({ key: c, label: COLUMN_LABEL[c] || c })), count: res?.count ?? 0,
    totals: res?.totals || null, trace: res?.trace || [], flags: (res?.flags || []).slice(0, 60), rows: (res?.rows || []).slice(0, 30) };
}
async function preview(plan, sources, period, x) {
  const checked = cleanPipeline(plan.pipeline, sources.map(s => s.file_id), period);
  if (!sources.some(s => s.file_id === plan.source_file_id)) checked.problems.unshift('la population n’est pas une pièce de la mission');
  if (checked.problems.length) return { ready: false, problems: checked.problems, steps: checked.steps };
  let src;
  try { src = await loadRows(plan.source_file_id, plan.source_sheet, x); }
  catch (e) { return { ready: false, problems: [e.message === 'SOURCE_SHEET_REQUIRED' ? 'le fichier a plusieurs feuilles : laquelle est la population ?' : e.message === 'AMOUNT_COLUMN_NOT_FOUND' ? 'aucune colonne de montant reconnue dans cette pièce' : 'pièce illisible (' + e.message + ')'], steps: checked.steps }; }
  const others = {};
  for (const s of checked.steps.filter(s => s.op === 'compare')) others[s.params.with_file_id] = (await loadRows(s.params.with_file_id, null, x).catch(() => ({ rows: [] }))).rows;
  return { ready: true, steps: checked.steps, src, result: runPipeline(src.rows, { steps: checked.steps }, others) };
}

export async function planPipeline(org, mission, code, body = {}, account, d = {}) {
  const x = await deps(d);
  const view = await x.view(org, mission, code, account, { ...d, refreshSop: true });
  const sv = await x.sr.stepsView(org, mission, code, account, { ...d, view: async () => view });
  const step = sv.steps.find(s => s.n === Number(body.step)) || null;
  const instruction = String(body.text || step?.text || '').slice(0, 1200).trim();
  if (!instruction) throw fail('INSTRUCTION_REQUIRED');
  const period = await x.sr.missionPeriod(org, mission, d);
  const sources = sv.sources.filter(s => s.file_id !== view.workpaper?.file_id);
  const key = keyOf((step ? 'step' + step.n + ':' : '') + instruction + '|' + (body.hint || ''));
  const cached = (view.work?.walkthrough || []).filter(r => r.kind === 'audit-pipeline' && r.key === key).at(-1);
  let plan = null, provider = null, ai = null, brain = null;
  if (!plan && Array.isArray(body.pipeline) && body.source_file_id) plan = { pipeline: body.pipeline, source_file_id: String(body.source_file_id), source_sheet: body.source_sheet || null, understood: 'Test choisi par l’auditeur', questions: [] };
  if (!plan) {
    const grant = await (d.permissions || (async () => (await import('./agent-permissions.js')).agentPermissions(org, d.fetchRows)))().catch(() => ({ granted: false }));
    if (!grant?.granted) return { key, step: step?.n ?? null, instruction, ai: 'AGENTS_NOT_AUTHORIZED', sources: sources.map(s => ({ file_id: s.file_id, name: s.name })) };
    const decision = await (d.reasonWithDocuments || reasonWithDocuments)({ org, mission, code, view, documents: sources, drive: x.drive,
      task: instruction, context: { sop: view.card, procedure: view.line, mission_period: period },
      schema: PLAN_PROMPT + '\nPour une lecture documentaire, réponds {"calculation":false}.', evidenceIds: documentIdsIn,
      key: 'pipeline:' + key, body, account }, d);
    if (!decision.result) return { ...decision, key, step: step?.n ?? null, instruction, ai: decision.ai_error ? 'AI_UNAVAILABLE' : 'reading', ready: false, sources: sources.map(s => ({ file_id: s.file_id, name: s.name })) };
    brain = decision; provider = decision.provider; const raw = decision.result;
    if (raw.calculation === false) plan = { calculation: false, pipeline: [], understood: 'Lecture de documents, pas un calcul', questions: [] };
    else plan = { pipeline: Array.isArray(raw.pipeline) ? raw.pipeline.slice(0, MAX_STEPS) : [], source_file_id: String(raw.source_file_id || ''), source_sheet: str(raw.source_sheet, 31),
      understood: str(raw.understood, 400), questions: list(raw.questions, 5, 300) };
    ai = decision.reused ? 'cached' : 'ok';
    // Kept in the procedure: opening it again shows the same test without asking the AI again.
    const keep = (view.work?.walkthrough || []).filter(r => !(r.kind === 'audit-pipeline' && r.key === key));
    const rec = { kind: 'audit-pipeline', key, step: step?.n ?? null, instruction, ...plan, provider, at: new Date().toISOString() };
    if (view.work) await (d.save || (await import('./procedure-work.js')).patch)(org, view.work, { walkthrough: [...keep, rec] }, account, d.fetchRows || (await import('./supabase.js')).rest);
  }
  if (plan.calculation === false) return { key, step: step?.n ?? null, instruction, calculation: false, ai };
  const p = await preview(plan, sources, period || {}, x);
  if (brain?.reportExecution) {
    const next = await brain.reportExecution(plan, { ready: p.ready, problems: p.problems || [], count: p.result?.count || 0,
      totals: p.result?.totals || null, trace: p.result?.trace || [], rows: (p.result?.rows || []).slice(0, 20), note: 'Résultat calculé, pas encore écrit. Vérifier puis conserver ou adapter le plan.' });
    if (next) return { ...next, key, ready: false, ai: provider };
  }
  return { key, step: step?.n ?? null, instruction, ai, provider, ready: p.ready, problems: p.problems || [], ...publicResult(p.result, { ...plan, pipeline: p.steps }, p.src),
    sources: sources.map(s => ({ file_id: s.file_id, name: s.name })), editable: sv.editable };
}

export async function writePipeline(org, mission, code, body = {}, account, d = {}) {
  const x = await deps(d);
  const view = await x.view(org, mission, code, account, { ...d, refreshSop: true });
  if (view.editable === false || ['submitted', 'reviewed'].includes(view.work?.status)) throw fail('IN_REVIEW_OR_NOT_EDITABLE', 409);
  const plan = (view.work?.walkthrough || []).filter(r => r.kind === 'audit-pipeline' && r.key === body.key).at(-1);
  if (!plan || plan.calculation === false) throw fail('PREPARE_AGAIN', 409);
  const sv = await x.sr.stepsView(org, mission, code, account, { ...d, view: async () => view });
  const sources = sv.sources.filter(s => s.file_id !== view.workpaper?.file_id);
  const p = await preview(plan, sources, (await x.sr.missionPeriod(org, mission, d)) || {}, x);
  if (!p.ready) throw fail('PLAN_INCOMPLETE', 400, { problems: p.problems });
  const res = p.result, base = `${String(code).slice(0, 22)}_T${plan.step ?? String(plan.key).slice(1, 5)}`;
  const { cellValue } = await import('./procedure-work.js'), ExcelJS = (await import('exceljs')).default;
  let name, attempt = 0;
  for (;;) {
    const { wb, meta } = await x.sr.procedureSheet(view, { ...d, drive: x.drive });
    name = null;
    for (let i = 1; i < 50 && !name; i++) {
      const nm = (i === 1 ? base : base + '_' + i).slice(0, 31), w = wb.getWorksheet(nm);
      if (!w) name = nm; else if (String(cellValue(w.getCell('A1').value)) === PIPELINE_MARK) { wb.removeWorksheet(w.id); name = nm; }   // our own earlier result: redone
    }
    if (!name) throw fail('NO_FREE_SHEET_NAME', 409);
    const ws = wb.addWorksheet(name), now = (d.now ? new Date(d.now()) : new Date()).toISOString();
    const head = [[PIPELINE_MARK, ''], ['Procédure', code], ['Consigne', plan.instruction], ['Compris', plan.understood || ''], ['Population', `${p.src.meta.name} (version ${p.src.meta.modifiedTime || '?'})`],
      ['Exécuté le', now], ['Par', `Enhanced Auditor (code), demandé par ${account?.display_name || account?.email || '?'}`], ['Lignes', res.count + (res.truncated ? ` (les ${MAX_OUT} premières écrites)` : '')], ['Totaux', JSON.stringify(res.totals)]];
    for (const r of head) ws.addRow(r).getCell(1).font = { bold: true };
    ws.addRow(['Étapes du test']).font = { bold: true };
    for (const t of res.trace) ws.addRow([t.op, t.label, `${t.in} → ${t.out} ligne(s)`, JSON.stringify(p.steps[res.trace.indexOf(t)]?.params || {})]);
    ws.addRow([]);
    ws.addRow(res.columns.map(c => COLUMN_LABEL[c] || c)).font = { bold: true };
    for (const r of res.rows) ws.addRow(res.columns.map(c => (res.extra.includes(c) ? '' : r[c] ?? '')));
    if (res.flags.length) { ws.addRow([]); ws.addRow(['Points relevés par le code']).font = { bold: true }; for (const f of res.flags) ws.addRow([f.kind, f.text]); }
    ws.getColumn(1).width = 18; ws.getColumn(2).width = 18; ws.getColumn(4).width = 40;
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    try { await x.drive.updateBinary(view.workpaper.file_id, { buffer, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', expectedModifiedTime: meta.modifiedTime }); break; }
    catch (e) { if (!/MEMORY_CONFLICT|412|conflict/i.test(String(e.message || e)) || ++attempt >= 4) throw e; await new Promise(r => setTimeout(r, 300 * attempt)); }
  }
  const back = new ExcelJS.Workbook(); await back.xlsx.load(Buffer.from(await x.drive.downloadBuffer(view.workpaper.file_id)));
  const verified = String(cellValue(back.getWorksheet(name)?.getCell('B2').value)) === code;
  await (d.audit || (await import('./audit-log.js')).audit)(org, { agent: 'enhanced-auditor', mission_id: mission, action_type: 'WORKPAPER_TEST_RUN', status: verified ? 'succeeded' : 'failed',
    decision: `${code} : « ${String(plan.instruction).slice(0, 120)} » sur « ${p.src.meta.name} » — ${res.count} ligne(s)`, approved_by: String(account?.display_name || account?.email || '').slice(0, 120), output_ref: 'drive:' + view.workpaper.file_id + '#' + name }, { fetchRows: d.fetchRows }).catch(() => null);
  return { sheet: name, verified, count: res.count };
}
