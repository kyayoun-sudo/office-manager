// Proposals only: names guide selection, headers must confirm the document role.
const fold = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const fields = {
  date: ['date', 'date ecriture', 'date comptable', 'posting date'],
  journal: ['journal', 'code journal', 'jrnl'],
  account: ['compte', 'numero compte', 'n compte', 'compte general', 'account', 'account number'],
  debit: ['debit', 'debits', 'montant debit', 'debit amount'],
  credit: ['credit', 'credits', 'montant credit', 'credit amount'],
  amount: ['montant', 'amount', 'montant net'],
  reference: ['piece reference', 'piece', 'reference', 'ref piece', 'numero piece', 'n piece', 'piece comptable', 'document number'],
  description: ['libelle', 'libelle ecriture', 'description', 'libelle operation', 'label'],
  project: ['projet', 'code projet', 'project', 'project code'],
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
export function sourceSuggestions(sources, sheet) {
  const wanted = destinationRole(sheet);
  return sources.map(s => {
    const name = fold(s.name), role = /(^| )gl( |$)|grand livre|general ledger/.test(name) ? 'gl' : /budget|ptba/.test(name) ? 'budget' : 'unknown';
    return { ...s, proposed_role: role, recommended: wanted !== 'unknown' && role === wanted,
      incompatible: wanted !== 'unknown' && role !== 'unknown' && role !== wanted };
  }).sort((a, b) => Number(b.recommended) - Number(a.recommended) || Number(a.incompatible) - Number(b.incompatible));
}
