// Why nothing is proposed for a data sheet (2026-11-03). When the AI gives no order at all, the screen used to say only « aucune
// correspondance n'est encore établie » — the person could not know that, say, the mission holds only SUBSIDIARY ledgers while the
// sheet needs the GENERAL one. The CODE now says what the sheet expects (its title and instructions, its columns) and what the
// mission's pieces ARE (their fiches, read in the content), and names the piece to deposit. It only explains: it never chooses a
// piece in the AI's place.
import { sheetWants, isLedgerSheet } from './sheet-understanding.js';
import { FAMILIES } from './piece-profile.js';

const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const LABEL = k => (FAMILIES[k] || String(k || '').replace(/^autre:/, '')).split(/ \(| — /)[0];

// The families a sheet needs, from what it says and how it is built (never from a file name).
export function expectedFamilies(u) {
  const w = sheetWants(u), title = fold(u.title);
  if (w.statements) return { families: ['releve_bancaire', 'avis_de_credit'], label: 'relevés bancaires ou avis de crédit' };
  if (w.tiers) return { families: ['grand_livre_auxiliaire'], label: 'grand livre auxiliaire (comptes de tiers)' };
  // The TITLE says budget (« catégorie budgétaire » in the instructions of a ledger sheet does not make it a budget sheet).
  if (/budget|ptba|\bteb\b|execution budgetaire/.test(title)) return { families: ['budget_previsionnel', 'budget_revise', 'execution_budgetaire'], label: 'budget (PTBA) ou tableau d’exécution budgétaire' };
  if (w.ledger || w.expenses || isLedgerSheet(u)) return { families: ['grand_livre_general', 'grand_livre_analytique'], label: 'grand livre général (ou analytique)' };
  return null;
}

export function explainEmptyOrders({ u, sheet, fiches = [], orders = {} }) {
  const none = !(orders.blocks || []).length && !(orders.computed || []).length && !(orders.lookups || []).length;
  if (!none) return null;
  const asked = (orders.missing || []).map(m => m.piece).filter(Boolean);
  const exp = expectedFamilies(u);
  const counts = {};
  for (const f of fiches) if (f.family) counts[f.family] = (counts[f.family] || 0) + 1;
  const have = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => LABEL(k) + (n > 1 ? ' ×' + n : '')).join(', ');
  if (exp) {
    const fit = fiches.filter(f => exp.families.includes(f.family));
    if (fit.length) return `${sheet} : aucun ordre de remplissage, alors que « ${fit[0].name} » est un ${LABEL(fit[0].family)} — relancez « Refaire » ; si cela recommence, dites dans la phrase ci-dessous quelle pièce utiliser.`;
    const near = exp.families.includes('grand_livre_general') && counts.grand_livre_auxiliaire ? ' Comme grand livre, il n’y a que des grands livres auxiliaires (comptes de tiers) : ils ne contiennent pas toutes les écritures.' : '';
    return `${sheet} attend un ${exp.label} : aucune des ${fiches.length} pièce(s) lues de la mission n’en est un${have ? ' (il y a : ' + have + ')' : ''}.${near} Déposez ${asked.length ? asked.join(', ') : 'cette pièce'} dans les pièces reçues, puis « Refaire ».`;
  }
  return `${sheet} : aucune pièce lue de la mission ne contient ses colonnes (${(u.columns || []).slice(0, 5).map(c => c.header).join(', ')}…)${asked.length ? ' — pièce(s) demandée(s) par l’agent : ' + asked.join(', ') : ''}. Déposez la pièce qui les contient, ou dites dans la phrase ci-dessous laquelle utiliser.`;
}
