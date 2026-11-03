// When the agent proposes nothing for a data sheet, the screen says what the sheet expects and what the pieces are (2026-11-03).
// Seen on a real mission: the analytical expense ledger sheet stayed empty because the mission held only SUBSIDIARY ledgers;
// the screen said only « aucune correspondance ». Data below are invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { explainEmptyOrders, expectedFamilies } from '../lib/fill-explain.js';

const D1 = { title: 'D1 — GL analytique des projets (dépenses)', instructions: ['Toutes les dépenses codées par projet / sous-projet / bailleur / catégorie budgétaire (extraction analytique complète).'],
  columns: [{ col: 'B', header: 'Date' }, { col: 'E', header: 'Compte' }, { col: 'F', header: 'Libellé' }, { col: 'H', header: 'Montant', amount: true }] };
const empty = { blocks: [], computed: [], lookups: [], missing: [] };

test('only subsidiary ledgers in the mission: the screen names the general ledger to deposit', () => {
  const fiches = [{ name: 'GL AUXIL.2023.xls', family: 'grand_livre_auxiliaire' }, { name: 'GL AUXIL.2024.xls', family: 'grand_livre_auxiliaire' }, { name: 'PTBA_2023.xlsx', family: 'budget_previsionnel' }];
  const m = explainEmptyOrders({ u: D1, sheet: 'D1_GL_PROJET', fiches, orders: empty });
  assert.match(m, /D1_GL_PROJET attend un grand livre général/);
  assert.match(m, /aucune des 3 pièce\(s\)/); assert.match(m, /grand livre auxiliaire \/ de tiers ×2/);
  assert.match(m, /que des grands livres auxiliaires/); assert.match(m, /Déposez cette pièce dans les pièces reçues/);
  assert.deepEqual(expectedFamilies(D1).families, ['grand_livre_general', 'grand_livre_analytique'], '« catégorie budgétaire » in the instructions does not make it a budget sheet');
});

test('the right piece is there but the AI gave no order: ask to redo, naming the piece', () => {
  const m = explainEmptyOrders({ u: D1, sheet: 'D1_GL_PROJET', fiches: [{ name: 'GRAND_LIVRE_GENERAL_2023.xls', family: 'grand_livre_general' }], orders: empty });
  assert.match(m, /« GRAND_LIVRE_GENERAL_2023\.xls » est un grand livre général — relancez « Refaire »/);
});

test('a sheet with orders, or of another kind, gets the right explanation or none', () => {
  assert.equal(explainEmptyOrders({ u: D1, sheet: 'D1', fiches: [], orders: { ...empty, blocks: [{}] } }), null);
  const D3 = { title: 'D3 — Fonds reçus (relevés bancaires et avis de crédit)', instructions: [], columns: [{ col: 'A', header: 'Date' }] };
  assert.match(explainEmptyOrders({ u: D3, sheet: 'D3', fiches: [], orders: empty }), /D3 attend un relevés bancaires ou avis de crédit/);
  const D2 = { title: 'D2 — Budget du projet', instructions: ['Catégorie = compte du grand livre'], columns: [{ col: 'A', header: 'Catégorie' }] };
  assert.match(explainEmptyOrders({ u: D2, sheet: 'D2', fiches: [], orders: { ...empty, missing: [{ target: 'B', piece: 'PTBA initial' }] } }), /attend un budget \(PTBA\).*Déposez PTBA initial/);
  const X = { title: 'Feuille libre', instructions: [], columns: [{ col: 'A', header: 'Nom' }, { col: 'B', header: 'Fonction' }] };
  assert.match(explainEmptyOrders({ u: X, sheet: 'X', fiches: [], orders: empty }), /ne contient ses colonnes \(Nom, Fonction…\)/);
});
