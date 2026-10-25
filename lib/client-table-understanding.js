// Proposals only: names guide selection, headers must confirm the document role.
const fold = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const fields = {
  date: ['date', 'date ecriture', 'date comptable', 'posting date'],
  journal: ['journal', 'code journal', 'jrnl', 'jnl', 'jal', 'code jnl'],
  account: ['compte', 'numero compte', 'n compte', 'compte general', 'account', 'account number', 'cpte', 'n cpte', 'no cpte', 'no compte', 'num compte', 'compte n'],
  debit: ['debit', 'debits', 'montant debit', 'debit amount'],
  credit: ['credit', 'credits', 'montant credit', 'credit amount'],
  amount: ['montant', 'amount', 'montant net'],
  reference: ['piece reference', 'piece', 'reference', 'ref piece', 'numero piece', 'n piece', 'piece comptable', 'document number'],
  description: ['libelle', 'libelle ecriture', 'description', 'libelle operation', 'label'],
  project: ['projet', 'code projet', 'project', 'project code', 'projet sous projet'],
  party: ['tiers', 'fournisseur', 'partenaire', 'beneficiaire', 'fournisseur beneficiaire', 'client', 'partner', 'nom du tiers', 'compte tiers'],
  category: ['categorie budgetaire', 'categorie', 'rubrique', 'ligne budgetaire', 'budget category']
};
export function columnRole(label) {
  const key = fold(label).split(' ').filter(w=>!['de','du','des','l'].includes(w)).join(' ');
  return Object.keys(fields).find(role => fields[role].includes(key)) || null;
}
export function suggestColumn(label, headers) {
  const exact = headers.map((h, i) => fold(h) === fold(label) ? i : -1).filter(i => i >= 0);
  if (exact.length === 1) return exact[0];
  const role = columnRole(label);
  const matches = role ? headers.map((h, i) => columnRole(h) === role ? i : -1).filter(i => i >= 0) : [];
  return matches.length === 1 ? matches[0] : null;
}
export function tableRole(headers) {
  const roles = new Set(headers.map(columnRole).filter(Boolean));
  const labels = headers.map(fold).join(' ');
  if (roles.has('debit') && roles.has('credit') && (roles.has('account') || roles.has('date') || roles.has('journal'))) return 'gl';
  if (/budget|prevision|allocation/.test(labels) && !roles.has('debit') && !roles.has('credit')) return 'budget';
  return 'unknown';
}
export function destinationRole(sheet) {
  const s = fold(sheet);
  return /(^| )gl( |$)|grand livre/.test(s) ? 'gl' : /budget/.test(s) ? 'budget' : 'unknown';
}
export function headerRow(rows) {
  const candidates = rows.slice(0, 40).map((row, i) => ({ i, score: new Set(row.map(columnRole).filter(Boolean)).size, strings: row.filter(v => typeof v === 'string' && v.trim()).length }));
  candidates.sort((a, b) => b.score - a.score || a.i - b.i);
  if (candidates[0]?.score >= 2) return candidates[0].i;
  return Math.max(0, rows.slice(0, 15).findIndex(row => row.filter(v => typeof v === 'string' && v.trim() && !/^[\d\s,.()-]+$/.test(v)).length >= 3));
}
// Column titles written on TWO rows (« Rubrique » merged over two rows, « Budget 2023 » over « T1 … Total »): the row above the header gives the
// missing titles and the group title, when it is a real header row (two titles at least — a single title line is the document's title).
export function combineHeaderRows(rows, h) {
  const own = (rows[h] || []).map(v => (v == null ? '' : String(v).trim())), above = h > 0 ? (rows[h - 1] || []).map(v => (v == null ? '' : String(v).trim())) : [];
  if (above.filter(Boolean).length < 2 || above.some(v => v.length > 50 || /\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}|\bpage\s*\d/i.test(v))) return rows;
  // only when the row above fills a missing title, or spans several titles below it (a group title followed by empty cells)
  const fills = own.some((v, i) => !v && above[i]), spans = above.some((v, i) => v && !above[i + 1] && own[i + 1]);
  if (!fills && !spans) return rows;
  const width = Math.max(own.length, above.length), filled = []; let last = '';
  for (let i = 0; i < width; i++) { if (above[i]) last = above[i]; else if (own[i] && !above[i] && i > 0 && filled[i - 1]) { /* under a group title */ } else last = above[i] || ''; filled[i] = above[i] || (own[i] && last) || ''; }
  const out = Array.from({ length: width }, (_, i) => (own[i] ? (filled[i] && filled[i] !== own[i] && !own[i].includes(filled[i]) ? filled[i] + ' ' + own[i] : own[i]) : above[i] || ''));
  const copy = rows.slice(); copy[h] = out; return copy;
}
export function sourceSuggestions(sources, sheet) {
  const wanted = destinationRole(sheet);
  return sources.map(s => {
    const name = fold(s.name), role = /(^| )gl( |$)|grand livre|general ledger/.test(name) ? 'gl' : /budget|ptba/.test(name) ? 'budget' : 'unknown';
    return { ...s, proposed_role: role, recommended: wanted !== 'unknown' && role === wanted,
      incompatible: wanted !== 'unknown' && role !== 'unknown' && role !== wanted };
  }).sort((a, b) => Number(b.recommended) - Number(a.recommended) || Number(a.incompatible) - Number(b.incompatible));
}

// (Paul, 2026-10-25 : « à vue d'œil on sait où mettre chacun ») — what a column MEANS, read in its title like a person reads it:
// « Budget de l'exercice » is a budget, « Engagement » what was committed, « Crédit disponible » what is left, « Libellé » the line's name.
// A source column feeds a model column only when both mean the same thing AND its values have the right kind (amounts for an amount).
const CONCEPTS = [
  ['rate', /(^| )(taux|pourcentage|pct)( |$)|%/],
  ['available', /disponible|reste a|solde budget|ecart/],
  ['amendment', /amendement|reallocation|revision budget|virement|modification/],
  ['disbursed', /decaiss|paiement|paye|regle/],
  ['committed', /engag/],
  ['realised', /realis|execut|depense|consomm/],
  ['label', /categorie|libelle|rubrique|intitule|designation|description|poste|nature|ligne budgetaire|activite|composante/],
  ['code', /^(code|n|no|num|numero|ref|reference|identifiant|id)( |$)/],
  ['budget', /budget|prevision|dotation|allocation|ptba/],
];
const AMOUNT_CONCEPTS = new Set(['rate', 'available', 'amendment', 'disbursed', 'committed', 'realised', 'budget']);
const CONCEPT_WORD = { rate: 'un taux', available: 'ce qui reste disponible', amendment: 'les amendements / réallocations', disbursed: 'ce qui a été décaissé',
  committed: 'ce qui a été engagé', realised: 'ce qui a été réalisé', label: 'le nom de la ligne', code: 'le code de la ligne', budget: 'le budget' };
export function columnConcept(label) {
  const raw = String(label || ''), f = fold(raw);
  if (/%/.test(raw)) return 'rate';
  return (CONCEPTS.find(([, re]) => re.test(f)) || [null])[0];
}
function budgetQualifier(label) {
  const f = fold(label);
  return /initial|origine|primitif/.test(f) ? 'initial' : /final|revise|definitif|approuve|actuel|modifie/.test(f) ? 'final' : 'plain';
}
const asNumber = v => typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && /^\s*-?[\d\s.,]+\s*%?\s*$/.test(v) && /\d/.test(v);
function kindOf(rows, i) {
  const vals = (rows || []).slice(0, 60).map(r => r?.[i]).filter(v => v != null && v !== '');
  if (!vals.length) return 'empty';
  const n = vals.filter(asNumber).length / vals.length;
  return n >= 0.6 ? 'number' : n <= 0.4 ? 'text' : 'mixed';
}
// One proposal per model column: {source, sure, why}. Never two model columns guessed from nothing; « sure » false = to confirm.
export function proposeColumn(label, headers, rows, opts = {}) {
  const H = (headers || []).map(String);
  const exact = H.map((h, i) => fold(h) && fold(h) === fold(label) ? i : -1).filter(i => i >= 0);
  if (exact.length === 1) return { source: exact[0], sure: true, why: 'même titre' };
  const role = columnRole(label);
  if (role) { const m = H.map((h, i) => columnRole(h) === role ? i : -1).filter(i => i >= 0); if (m.length === 1) return { source: m[0], sure: true, why: 'même rôle (' + role + ')' }; }
  // Méthode du cabinet (Paul, 2026-10-25) : dans une pièce comptable, la catégorie budgétaire est le NUMÉRO DE COMPTE — c'est aussi ce que
  // l'autre feuille (le budget) reçoit, pour que les tests rapprochent les deux.
  if (role === 'category') { const acc = H.findIndex(h => columnRole(h) === 'account'); if (acc >= 0 && !H.some(h => columnRole(h) === 'category')) return { source: acc, sure: true, why: 'catégorie = numéro de compte (méthode du cabinet)' }; }
  const concept = columnConcept(label);
  // An amount column of the model that the document has no title for: its MAIN amount column (the one that carries the most money —
  // « Total général », « Montant total »), named by the AI for this document, to confirm.
  const main = opts.main != null && opts.main >= 0 ? { source: opts.main, sure: false, why: '« ' + H[opts.main] + ' » : la colonne principale des montants de ce document' } : null;
  if (!concept) return main && opts.amount ? main : { source: null, sure: false, why: 'sens de la colonne non reconnu' };
  const amount = AMOUNT_CONCEPTS.has(concept);
  const cands = H.map((h, i) => ({ h, i, c: columnConcept(h), k: kindOf(rows, i) }))
    .filter(x => x.c === concept && (amount ? x.k !== 'text' : concept === 'label' ? x.k !== 'number' : true));
  if (!cands.length) return concept === 'budget' && main ? main : { source: null, sure: false, why: 'le document n’a pas de colonne pour ' + CONCEPT_WORD[concept] };
  if (concept === 'budget' && main && cands.length > 1 && cands.some(x => x.i === main.source)) { const m = cands.find(x => x.i === main.source); cands.splice(cands.indexOf(m), 1); cands.unshift(m); }
  if (concept === 'budget') {
    const q = budgetQualifier(label), rank = x => { const s = budgetQualifier(x.h); return q === 'initial' ? (s === 'initial' ? 0 : s === 'plain' ? 1 : 2) : (s === q ? 0 : s === 'plain' ? 1 : 2); };
    cands.sort((a, b) => rank(a) - rank(b));
    const best = cands[0], r = rank(best), alone = cands.filter(x => rank(x) === r).length === 1;
    // Never the same budget for « initial » and « final »: a test recomputes initial + amendments = final, a copied value would make it
    // pass by construction (Paul, 2026-10-25). The initial budget comes from its own document (convention, first PTBA).
    if (q === 'initial' && r > 0) return { source: null, sure: false, why: 'le document ne donne que « ' + best.h + ' » ; le budget initial vient de la convention ou du premier budget approuvé — le recopier ici rendrait le recalcul initial + amendements = final juste d’office' };
    return { source: best.i, sure: alone && r < 2, why: '« ' + best.h + ' » est ' + CONCEPT_WORD.budget + ' du document' };
  }
  if (concept === 'label' && cands.length > 1) {
    const distinct = i => new Set((rows || []).map(r => r?.[i]).filter(v => typeof v === 'string' && v.trim())).size;
    cands.sort((a, b) => Number(/libelle|categorie/.test(fold(b.h))) - Number(/libelle|categorie/.test(fold(a.h))) || distinct(b.i) - distinct(a.i));
  }
  return { source: cands[0].i, sure: cands.length === 1 || concept === 'label', why: '« ' + cands[0].h + ' » donne ' + CONCEPT_WORD[concept] };
}
