// La balance générale lue par le CODE, avant la revue analytique (Paul, 2026-11-14 : « une case États financiers dans la mission, avant la
// revue analytique ; c'est ce qui permettra de faire la revue analytique ; on réduit les coûts de l'IA qui n'aura pas besoin de faire certaines
// choses » ; « mais l'IA doit toujours contrôler : elle a des informations de l'industrie et aide à déterminer les risques et les tests »).
//
// Fonctions PURES (aucune lecture du Drive, aucune écriture) :
//   readTrialBalance(rows)      → comptes et soldes de clôture lus dans un tableau (colonnes reconnues par leurs titres, jamais le nom du fichier) ;
//   cycleOfAccount(numéro)      → cycle d'audit par défaut (plan SYSCOHADA / SYCEBNL, préfixes) ;
//   balanceChecks(tb)           → équilibre débit / crédit, résultat, soldes de sens anormal ;
//   compareBalances(n, n1, opt) → variations par cycle et par compte, comptes nouveaux / disparus ;
//   analyticalFigures(...)      → le paquet complet, compact, donné à l'IA qui le CONTRÔLE et le commente.
// Le code calcule ; il ne conclut pas. L'IA (Enhanced Auditor) garde l'interprétation, les risques et les tests ; l'humain décide.

const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const round = n => Math.round((Number(n) || 0) * 100) / 100;

export function amountOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && v.result != null) return amountOf(v.result);
  let s = String(v).replace(/[\s  ]/g, '').replace(/[^\d,.\-()]/g, '');
  if (!/\d/.test(s)) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-'); s = s.replace(/[()-]/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const n = Number(s); return Number.isFinite(n) ? (neg ? -n : n) : null;
}

// ---------- Cycles par défaut (le cabinet peut avoir les siens : ce n'est qu'une proposition) ----------
export const CYCLES = Object.freeze({
  CASH: 'Trésorerie', REV: 'Ventes / ressources et clients', PUR: 'Achats et fournisseurs', OPEX: 'Charges d\'exploitation',
  INV: 'Stocks', FA: 'Immobilisations', PAY: 'Personnel et charges sociales', TAX: 'Impôts et taxes', EQ: 'Capitaux propres / fonds propres',
  LOAN: 'Emprunts et financements', PROV: 'Provisions', FIN: 'Produits et charges financiers', OTH: 'Autres créances et dettes', HAO: 'Hors activités ordinaires'
});
// Préfixe le plus long d'abord. Plan comptable SYSCOHADA révisé ; les classes du SYCEBNL suivent la même logique.
const PREFIXES = [
  ['89', 'TAX'], ['8', 'HAO'],
  ['10', 'EQ'], ['11', 'EQ'], ['12', 'EQ'], ['13', 'EQ'], ['14', 'EQ'], ['15', 'EQ'], ['16', 'LOAN'], ['17', 'LOAN'], ['18', 'LOAN'], ['19', 'PROV'],
  ['2', 'FA'], ['3', 'INV'],
  ['40', 'PUR'], ['41', 'REV'], ['42', 'PAY'], ['43', 'PAY'], ['44', 'TAX'], ['45', 'OTH'], ['46', 'OTH'], ['47', 'OTH'], ['48', 'OTH'], ['49', 'OTH'],
  ['5', 'CASH'],
  ['60', 'PUR'], ['61', 'OPEX'], ['62', 'OPEX'], ['63', 'OPEX'], ['64', 'TAX'], ['65', 'OPEX'], ['66', 'PAY'], ['67', 'FIN'], ['681', 'FA'], ['68', 'FA'], ['69', 'PROV'],
  ['70', 'REV'], ['71', 'REV'], ['72', 'REV'], ['73', 'REV'], ['74', 'REV'], ['75', 'REV'], ['77', 'FIN'], ['78', 'PROV'], ['79', 'PROV']
].sort((a, b) => b[0].length - a[0].length);
export function cycleOfAccount(account) {
  const a = String(account ?? '').replace(/\D/g, '');
  if (!a) return null;
  return (PREFIXES.find(([p]) => a.startsWith(p)) || [null, null])[1];
}

// ---------- Lire une balance ----------
const isAccount = v => (typeof v === 'number' && Number.isInteger(v) && v >= 10 && v < 1e12) || /^\s*\d{2,12}\s*$/.test(String(v ?? ''));
function columnKind(title) {
  const t = fold(title);
  if (!t) return null;
  if (/^(n |numero |no |num )?(compte|cpte|account)( n| numero| general)?$|^n compte$|^compte n$/.test(t)) return { kind: 'account' };
  if (/intitule|libelle|designation|description|label/.test(t)) return { kind: 'label' };
  const prior = /n 1|n1\b|anterieur|precedent|prior|previous/.test(t);
  const side = /\bdebit|\bdebiteur/.test(t) ? 'D' : /\bcredit|\bcrediteur/.test(t) ? 'C' : null;
  const opening = /ouverture|initial|anouveau|a nouveau|report|debut/.test(t);
  const closing = /cloture|final|fin\b|fin d|clos/.test(t);
  const balance = /solde|balance/.test(t);
  const movement = /mouvement|movement|periode|exercice/.test(t) && !balance;
  if (!side && !balance) return null;
  return { kind: 'amount', side, opening, closing, balance, movement, prior };
}
function findHeader(rows) {
  let best = { i: -1, score: 0 };
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const kinds = (rows[i] || []).map(columnKind);
    const amounts = kinds.filter(k => k?.kind === 'amount').length;
    const score = (kinds.some(k => k?.kind === 'account') ? 2 : 0) + (kinds.some(k => k?.kind === 'label') ? 1 : 0) + Math.min(amounts, 4);
    if (score > best.score) best = { i, score };
  }
  return best.score >= 3 ? best.i : -1;
}
// Choose the columns that give the CLOSING balance of the current year: « Solde final / clôture » D and C, else the last « Solde » pair,
// else the last Débit / Crédit pair, else a single signed « Solde ». Columns marked N-1 are kept apart (comparison inside one file).
function pickBalance(cols, prior) {
  const c = cols.filter(x => x.prior === prior && !x.opening);
  const pair = list => { const d = list.filter(x => x.side === 'D').pop(), k = list.filter(x => x.side === 'C').pop(); return d && k ? { debit: d.col, credit: k.col } : null; };
  return pair(c.filter(x => x.closing)) || pair(c.filter(x => x.balance)) || pair(c.filter(x => !x.movement)) || pair(c)
    || ((s => (s ? { signed: s.col } : null))(c.filter(x => x.balance && !x.side).pop()));
}
function yearsIn(rows, upTo) {
  const ys = new Set();
  for (const r of rows.slice(0, Math.max(1, upTo + 1))) for (const v of r || []) for (const y of String(v ?? '').match(/\b20\d\d\b/g) || []) ys.add(Number(y));
  return [...ys].sort();
}

// rows: array of arrays (as `readTable` gives). Returns null when the table is not a trial balance (no account column, no balance columns).
export function readTrialBalance(rows, opts = {}) {
  rows = (rows || []).map(r => (Array.isArray(r) ? r : []));
  const h = findHeader(rows);
  if (h < 0) return null;
  const header = rows[h];
  const kinds = header.map((t, col) => ({ col, title: String(t ?? '').trim(), ...(columnKind(t) || {}) }));
  let accountCol = kinds.find(k => k.kind === 'account')?.col;
  const labelCol = kinds.find(k => k.kind === 'label')?.col;
  const amounts = kinds.filter(k => k.kind === 'amount');
  // A balance without a titled account column: the first column whose cells are account numbers.
  if (accountCol == null) {
    const body = rows.slice(h + 1, h + 40);
    accountCol = header.findIndex((_, col) => body.filter(r => isAccount(r[col])).length >= Math.min(5, body.length / 2));
    if (accountCol < 0) return null;
  }
  const current = pickBalance(amounts, false), prior = pickBalance(amounts, true);
  if (!current) return null;
  const net = (row, spec) => spec.signed != null ? amountOf(row[spec.signed]) ?? 0 : (amountOf(row[spec.debit]) ?? 0) - (amountOf(row[spec.credit]) ?? 0);
  const accounts = [], skipped = { totals: 0, without_amount: 0 };
  const seen = new Map();
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.some(v => v != null && v !== '')) continue;
    const acc = row[accountCol];
    if (!isAccount(acc)) { if (row.some(v => amountOf(v) != null)) skipped.totals++; continue; }
    const number = String(acc).trim();
    const cells = current.signed != null ? [row[current.signed]] : [row[current.debit], row[current.credit]];
    if (cells.every(v => amountOf(v) == null)) { skipped.without_amount++; continue; }
    // A class or group line (« 41 », « 411 ») above its detailed accounts would count the same money twice: only the most detailed lines
    // are kept — an account is dropped when a longer number that starts with it is also in the table (decided after the loop).
    const item = { account: number, label: labelCol != null ? String(row[labelCol] ?? '').trim().slice(0, 120) : '', balance: round(net(row, current)),
      prior: prior ? round(net(row, prior)) : null, cycle: cycleOfAccount(number), row: r + 1 };
    if (seen.has(number)) { const o = seen.get(number); o.balance = round(o.balance + item.balance); if (o.prior != null) o.prior = round(o.prior + (item.prior || 0)); continue; }
    seen.set(number, item); accounts.push(item);
  }
  const numbers = accounts.map(a => a.account);
  const detailed = accounts.filter(a => !numbers.some(n => n !== a.account && n.length > a.account.length && n.startsWith(a.account)));
  const groups = accounts.length - detailed.length;
  if (!detailed.length) return null;
  const years = yearsIn(rows, h);
  return {
    header_row: h + 1, columns: { account: kinds[accountCol]?.title || null, label: labelCol != null ? kinds[labelCol].title : null,
      current: Object.fromEntries(Object.entries(current).map(([k, c]) => [k, header[c]])), prior: prior ? Object.fromEntries(Object.entries(prior).map(([k, c]) => [k, header[c]])) : null },
    years, year: opts.year ?? (years.length ? years[years.length - 1] : null),
    accounts: detailed, skipped: { ...skipped, group_lines: groups }
  };
}

// ---------- Contrôles ----------
const sum = (list, f) => round(list.reduce((s, x) => s + (Number(f(x)) || 0), 0));
const classOf = a => String(a.account)[0];
export function balanceChecks(tb, opts = {}) {
  const tol = opts.tolerance ?? 1, field = opts.field || 'balance';
  const acc = tb.accounts.filter(a => a[field] != null);
  const debit = sum(acc.filter(a => a[field] > 0), a => a[field]), credit = round(-sum(acc.filter(a => a[field] < 0), a => a[field]));
  const result = round(-sum(acc.filter(a => ['6', '7', '8'].includes(classOf(a))), a => a[field]));
  const unusual = [];
  const flag = (a, why) => unusual.push({ account: a.account, label: a.label, balance: a[field], why });
  for (const a of acc) {
    const n = a.account, v = a[field];
    if (!v) continue;
    if (/^41/.test(n) && v < -tol) flag(a, 'client au crédit (avance reçue, avoir, encaissement non lettré ?)');
    else if (/^40/.test(n) && v > tol) flag(a, 'fournisseur au débit (avance versée, double paiement ?)');
    else if (/^57/.test(n) && v < -tol) flag(a, 'caisse au crédit : impossible physiquement');
    else if (/^5[0-5]/.test(n) && v < -tol) flag(a, 'trésorerie au crédit (découvert à classer ?)');
    else if (/^47/.test(n) && Math.abs(v) > tol) flag(a, 'compte d\'attente / divers non soldé à la clôture');
    else if (/^3[0-8]/.test(n) && v < -tol) flag(a, 'stock au crédit');
    else if (/^2[0-7]/.test(n) && v < -tol) flag(a, 'immobilisation au crédit');
    else if (/^2[89]/.test(n) && v > tol) flag(a, 'amortissement ou dépréciation au débit');
  }
  return { debit, credit, difference: round(debit - credit), balanced: Math.abs(debit - credit) <= tol, result, unusual };
}

export function totalsByCycle(tb, field = 'balance') {
  const out = {};
  for (const a of tb.accounts) if (a[field] != null) { const c = a.cycle || 'NON_CLASSE'; out[c] = round((out[c] || 0) + a[field]); }
  return out;
}

// ---------- N / N-1 ----------
export function compareBalances(n, n1, opts = {}) {
  const field1 = opts.priorField || 'balance';
  const threshold = Number(opts.threshold) > 0 ? Number(opts.threshold) : null, pct = opts.percent ?? 20;
  const a = new Map(n.accounts.map(x => [x.account, x])), b = new Map(n1.accounts.map(x => [x.account, x[field1] == null ? x : { ...x, balance: x[field1] }]));
  const accounts = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const cur = a.get(k)?.balance ?? 0, pre = b.get(k)?.balance ?? 0, diff = round(cur - pre);
    if (!diff && cur === 0) continue;
    accounts.push({ account: k, label: a.get(k)?.label || b.get(k)?.label || '', cycle: cycleOfAccount(k), n: cur, n1: pre, variation: diff,
      percent: pre ? round((diff / Math.abs(pre)) * 100) : null, status: !b.has(k) ? 'nouveau' : !a.has(k) ? 'disparu' : 'existant' });
  }
  const big = x => (threshold ? Math.abs(x.variation) >= threshold : true) && (x.percent == null || Math.abs(x.percent) >= pct);
  const ranked = accounts.filter(x => x.variation).sort((x, y) => Math.abs(y.variation) - Math.abs(x.variation));
  const cyc = {}; const tn = totalsByCycle(n), tp = totalsByCycle({ accounts: [...b.values()] });
  for (const c of new Set([...Object.keys(tn), ...Object.keys(tp)])) {
    const cur = tn[c] || 0, pre = tp[c] || 0, d = round(cur - pre);
    cyc[c] = { label: CYCLES[c] || 'Non classé', n: cur, n1: pre, variation: d, percent: pre ? round((d / Math.abs(pre)) * 100) : null };
  }
  return {
    threshold, percent: pct, cycles: cyc,
    significant: ranked.filter(big).slice(0, opts.limit || 25),
    new_accounts: accounts.filter(x => x.status === 'nouveau' && Math.abs(x.n) > 0).sort((x, y) => Math.abs(y.n) - Math.abs(x.n)).slice(0, 15),
    gone_accounts: accounts.filter(x => x.status === 'disparu' && Math.abs(x.n1) > 0).sort((x, y) => Math.abs(y.n1) - Math.abs(x.n1)).slice(0, 15)
  };
}

// ---------- Le paquet pour la revue ----------
// tables: [{ id, name, rows, period? }] — the tables already read from the mission's sources. missionYear: the year audited when known.
export function analyticalFigures(tables, { missionYear = null, threshold = null } = {}) {
  const tbs = [];
  for (const t of tables || []) {
    const tb = readTrialBalance(t.rows, { year: (String(t.period || '').match(/20\d\d/g) || []).map(Number).pop() ?? undefined });
    if (tb) tbs.push({ ...tb, source: { id: t.id, name: t.name } });
  }
  if (!tbs.length) return { status: 'no_trial_balance', message: 'Aucune balance générale reconnue par ses colonnes (compte + soldes) parmi les pièces lues.' };
  // Which one is N: the audited year when a table shows it, else the latest year read; a single table with N-1 columns compares itself.
  const withYear = tbs.filter(t => t.year);
  const current = (missionYear && tbs.find(t => t.year === missionYear)) || withYear.sort((x, y) => y.year - x.year)[0] || (tbs.length === 1 ? tbs[0] : null);
  const notes = [];
  if (!current) return { status: 'year_unknown', trial_balances: tbs.map(t => ({ source: t.source, accounts: t.accounts.length })),
    message: 'Plusieurs balances lues, exercice de chacune non trouvé dans leur contenu : la personne indique laquelle est N.' };
  const previous = tbs.find(t => t !== current && t.year && current.year && t.year === current.year - 1) || null;
  let comparison = null;
  if (previous) comparison = compareBalances(current, previous, { threshold });
  else if (current.columns.prior) comparison = compareBalances(current, current, { threshold, priorField: 'prior' });
  else notes.push('Pas de balance N-1 reconnue : variations non calculées.');
  if (tbs.length > (previous ? 2 : 1)) notes.push(`${tbs.length} balances reconnues ; utilisées : ${[current, previous].filter(Boolean).map(t => t.source.name).join(' et ')}.`);
  return {
    status: 'computed', computed_by: 'code', notes,
    current: { source: current.source, year: current.year, accounts: current.accounts.length, skipped: current.skipped, checks: balanceChecks(current), cycles: totalsByCycle(current) },
    previous: previous ? { source: previous.source, year: previous.year, accounts: previous.accounts.length, checks: balanceChecks(previous) } : current.columns.prior ? { source: current.source, year: current.year ? current.year - 1 : null, from_columns: current.columns.prior, checks: balanceChecks(current, { field: 'prior' }) } : null,
    comparison
  };
}

// Short text for the AI: the figures it must CHECK and use, never re-derive from the files.
export function figuresForAi(f) {
  if (!f || f.status !== 'computed') return f?.message ? `CHIFFRES DU CODE : ${f.message}` : '';
  const fmt = n => (n == null ? '—' : Math.round(n).toLocaleString('fr-FR'));
  const c = f.current, lines = [];
  lines.push(`Balance N (${c.year || 'exercice non lu'}) : ${c.accounts} comptes ; débit ${fmt(c.checks.debit)} / crédit ${fmt(c.checks.credit)} ; ${c.checks.balanced ? 'équilibrée' : 'DÉSÉQUILIBRÉE de ' + fmt(c.checks.difference)} ; résultat calculé ${fmt(c.checks.result)}.`);
  if (f.previous) lines.push(`Balance N-1 (${f.previous.year || '?'}) : ${f.previous.checks.balanced ? 'équilibrée' : 'DÉSÉQUILIBRÉE de ' + fmt(f.previous.checks.difference)} ; résultat ${fmt(f.previous.checks.result)}.`);
  if (f.comparison) {
    lines.push('Par cycle (N / N-1 / variation / %) :');
    for (const [k, v] of Object.entries(f.comparison.cycles)) lines.push(`- ${k} ${v.label} : ${fmt(v.n)} / ${fmt(v.n1)} / ${fmt(v.variation)} / ${v.percent == null ? '—' : v.percent + ' %'}`);
    if (f.comparison.significant.length) { lines.push('Plus fortes variations de comptes :'); for (const x of f.comparison.significant.slice(0, 15)) lines.push(`- ${x.account} ${x.label} : ${fmt(x.n1)} → ${fmt(x.n)} (${fmt(x.variation)}${x.percent == null ? '' : ', ' + x.percent + ' %'})${x.status !== 'existant' ? ' [' + x.status + ']' : ''}`); }
  } else lines.push('Par cycle (N) : ' + Object.entries(c.cycles).map(([k, v]) => `${k} ${fmt(v)}`).join(' ; '));
  if (c.checks.unusual.length) { lines.push('Soldes de sens anormal :'); for (const u of c.checks.unusual.slice(0, 15)) lines.push(`- ${u.account} ${u.label} : ${fmt(u.balance)} — ${u.why}`); }
  for (const n of f.notes || []) lines.push(n);
  return lines.join('\n');
}
