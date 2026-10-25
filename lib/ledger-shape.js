// Un grand livre tel que les logiciels le sortent (Paul, 2026-10-25 : « il a copié le grand livre sans identifier les numéros de compte ;
// il met les reports comme lignes aussi »). Beaucoup de grands livres sont présentés PAR COMPTE : une ligne d'en-tête « 605300 Fournitures
// non stockables » (ou « Compte : 605300 … »), les écritures dessous sans numéro de compte, puis « Total compte », « Report », « Solde ».
// `flattenLedger` en fait un tableau d'écritures : le numéro et l'intitulé du compte reportés sur chaque écriture, les lignes de report,
// à-nouveau, total, sous-total, solde et cumul écartées (comptées, jamais copiées). Un grand livre déjà à plat est rendu tel quel.
import { columnRole } from './client-table-understanding.js';

const fold = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const NOT_ENTRY = /^(sous[- ]?)?totaux?\b|^total\b|^report|^a reporter|^a nouveau|^an\b|^solde|^cumul|^report a nouveau|^reports?\b|^nouveau solde|^solde (anterieur|precedent|initial|final)/;
const ACCOUNT_HEAD = /^(?:compte(?:\s*(?:general|n[°o]?|numero))?\s*[:\-]?\s*)?(\d{4,12})(?:\s*[-–:]\s*|\s+)?(.*)$/i;
const hasValue = v => v != null && v !== '';
const isDate = v => v instanceof Date || (typeof v === 'number' && v > 20000 && v < 80000) || /^\s*\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\s*$|^\s*\d{4}-\d{2}-\d{2}/.test(String(v ?? ''));
const isAmount = v => typeof v === 'number' || /^\s*-?[\d\s.,]+\s*$/.test(String(v ?? '')) && /\d/.test(String(v ?? ''));

export function flattenLedger(rows, headerRow) {
  const headers = (rows[headerRow] || []).map(v => String(v ?? '').trim());
  const roles = headers.map(columnRole);
  const dateCol = roles.indexOf('date'), accCol = roles.indexOf('account');
  const amountCols = roles.map((r, i) => (['debit', 'credit', 'amount'].includes(r) ? i : -1)).filter(i => i >= 0);
  const isLedger = amountCols.length > 0 && (dateCol >= 0 || roles.includes('journal'));
  if (!isLedger) return null;
  const out = [], lines = [];
  let current = null, sections = 0, filled = 0, skipped = 0;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const cells = row.map(v => (typeof v === 'string' ? v.trim() : v));
    if (!cells.some(hasValue)) continue;
    const texts = cells.filter(v => typeof v === 'string' && v);
    const label = fold(texts.join(' '));
    const dated = dateCol >= 0 ? isDate(cells[dateCol]) : false;
    // A report / total / balance line, whatever its date: never an entry.
    if (texts.some(t => NOT_ENTRY.test(fold(t)))) { skipped++; continue; }
    // A section header: no date, an account number at the start of a cell, no amount (or only the section's opening balance).
    if (!dated) {
      for (const v of cells.slice(0, 4)) {
        const m = typeof v === 'string' ? ACCOUNT_HEAD.exec(v) : typeof v === 'number' && v >= 1000 && Number.isInteger(v) ? [null, String(v), ''] : null;
        if (!m) continue;
        const rest = (m[2] || cells.filter(x => typeof x === 'string' && x && x !== v).join(' ')).trim();
        current = { number: m[1], label: rest.slice(0, 160) }; sections++; break;
      }
      if (current && !cells.some((v, i) => amountCols.includes(i) && isAmount(v) && Number(String(v).replace(/[^\d.-]/g, '')) !== 0)) { continue; }
      if (!label && !amountCols.some(i => hasValue(cells[i]))) continue;
    }
    if (!dated && dateCol >= 0) { skipped++; continue; }  // no date in a dated ledger: not an entry
    const entry = [...cells];
    if (accCol >= 0 && hasValue(entry[accCol])) current = { number: String(entry[accCol]).trim(), label: current?.number === String(entry[accCol]).trim() ? current.label : '' };
    else if (accCol >= 0 && current) { entry[accCol] = current.number; filled++; }
    out.push({ entry, account: current });
    lines.push(r + 1);
  }
  if (!sections && !filled && !skipped) return null;
  const addCols = accCol < 0 && sections > 0;
  const newHeaders = addCols ? [...headers, 'Compte', 'Intitulé du compte'] : headers;
  const width = headers.length;
  const newRows = [newHeaders, ...out.map(({ entry, account }) => (addCols ? [...Array.from({ length: width }, (_, i) => entry[i] ?? null), account?.number ?? null, account?.label ?? null] : entry))];
  return { rows: newRows, header_row: 0, lines, flattened: { sections, filled, skipped, entries: out.length } };
}
