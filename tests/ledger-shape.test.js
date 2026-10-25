// Paul, 2026-10-25 : « il a copié le grand livre sans identifier les numéros de compte ; il met les reports comme lignes aussi ».
import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenLedger } from '../lib/ledger-shape.js';

test('a grand livre presented by account: the number goes on every entry, reports and totals are never entries', () => {
  const rows = [
    ['GRAND LIVRE DES COMPTES — 2024'], [],
    ['Date', 'Journal', 'N° pièce', 'Libellé', 'Débit', 'Crédit', 'Solde'],
    ['605300 Fournitures non stockables – Autres énergies'],
    [null, null, null, 'Report à nouveau', 1000, null, 1000],
    ['03/01/2024', 'BQ', 'P1', 'Carburant groupe', 182500, null, 183500],
    ['15/02/2024', 'BQ', 'P2', 'Gasoil', 50000, null, 233500],
    [null, null, null, 'Total compte 605300', 232500, 0, 233500],
    ['Compte : 618120 TRANSPORT DES AGENTS EN FORMATION A L\'ETRANGER'],
    ['10/03/2024', 'BQ', 'P9', 'Billet Dakar', 5470200, null, 5470200],
    ['31/12/2024', 'OD', 'R1', 'Report', 1, null, 1],
    [null, null, null, 'Total général', 1, 1, 1]];
  const f = flattenLedger(rows, 2);
  assert.deepEqual(f.rows[0].slice(-2), ['Compte', 'Intitulé du compte']);
  assert.equal(f.rows.length, 4);                                                // 3 entries + header
  assert.deepEqual(f.rows.slice(1).map(r => [r[3], r.at(-2)]), [['Carburant groupe', '605300'], ['Gasoil', '605300'], ['Billet Dakar', '618120']]);
  assert.match(f.rows[3].at(-1), /TRANSPORT DES AGENTS/);
  assert.equal(f.flattened.sections, 2); assert.equal(f.flattened.skipped, 4);
  assert.deepEqual(f.lines, [6, 7, 10]);                                         // provenance: the real line of each entry
});

test('an account column filled only on the first line of each group is filled down; a flat ledger is left as it is', () => {
  const grouped = [['Compte', 'Date', 'Libellé', 'Débit', 'Crédit'], ['411000', '01/01/2024', 'Vente', 10, null], [null, '02/01/2024', 'Vente 2', 20, null]];
  assert.deepEqual(flattenLedger(grouped, 0).rows.map(r => r[0]), ['Compte', '411000', '411000']);
  const flat = [['Compte', 'Date', 'Libellé', 'Débit', 'Crédit'], ['411000', '01/01/2024', 'Vente', 10, null], ['512000', '02/01/2024', 'Banque', null, 10]];
  assert.equal(flattenLedger(flat, 0), null);
});
