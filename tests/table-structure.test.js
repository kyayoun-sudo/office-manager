import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { tableStructure } from '../lib/table-structure.js';
import { describeTable, peekDocument } from '../lib/sheet-understanding.js';
import { fitJson } from '../lib/ai-input.js';

// A PTBA whose category lines carry NO word « total »: a title line above its activities, the amount = their sum.
const headers = ['N°', 'Activité / rubrique', 'Responsable', 'Budget 2024'];
const ptba = [
  ['1', 'FONCTIONNEMENT', '', 450000],
  ['1.1', 'Fournitures de bureau', 'Admin', 150000],
  ['1.2', 'Carburant', 'Logistique', 300000],
  ['2', 'FORMATIONS', '', 1200000],
  ['2.1', 'Atelier régional', 'Projet', 700000],
  ['2.2', 'Formation des agents', 'Projet', 500000],
  ['3', 'INVESTISSEMENTS', '', 2000000],
  ['3.1', 'Véhicule', 'Logistique', 2000000 - 400000],
  ['3.2', 'Ordinateurs', 'Admin', 400000],
  ['', 'TOTAL GÉNÉRAL', '', 3650000]
];

test('the categories of a budget are PROVED by their sums, whatever their words', () => {
  const s = tableStructure(headers, ptba);
  assert.equal(s.style, 'above');
  assert.deepEqual(s.categories.map(c => c.label), ['FONCTIONNEMENT', 'FORMATIONS', 'INVESTISSEMENTS']);
  assert.deepEqual(s.categories.map(c => c.amount), [450000, 1200000, 2000000]);
});

test('sub-totals BELOW their lines, nested in sections, and a grand total', () => {
  const rows = [
    ['Salaires', 100], ['Charges', 50], ['Sous-total Personnel', 150],
    ['Loyer', 30], ['Eau', 20], ['Total Fonctionnement', 50],
    ['Total général', 200]
  ];
  const s = tableStructure(['Libellé', 'Montant'], rows);
  assert.equal(s.style, 'below');
  assert.deepEqual(s.categories.map(c => c.label), ['Personnel', 'Fonctionnement']);
  assert.equal(s.grand_total.amount, 200);
});

test('detail lines that only look like totals are not categories when the sums do not prove it', () => {
  const s = tableStructure(['Libellé', 'Montant'], [['A', 10], ['B', 20], ['C', 7], ['D', 4]]);
  assert.equal(s.categories.length, 0);
});

test('a grand livre exported as .xls with an odd name is recognised by its columns, and the PTBA by its proved categories', async () => {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['SOCIETE X — Export du 03/02/2025'], ['Date', 'Journal', 'Compte', 'Libellé', 'Débit', 'Crédit'],
    ['05/01/2024', 'AC', '605300', 'Fournitures', 150000, 0], ['06/01/2024', 'BQ', '521000', 'Règlement', 0, 150000], ['10/03/2024', 'AC', '622000', 'Loyer', 500000, 0]]), 'Feuil1');
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xls' });
  const drive = { getMeta: async () => ({ size: bytes.length }), downloadBuffer: async () => bytes };
  const p = await peekDocument({ id: 'x', name: 'export_compta_final(2).xls' }, drive);
  assert.match(p.sheets[0].shape.looks_like, /grand livre/);
  assert.deepEqual(p.sheets[0].shape.years, ['2024']);
  const t = describeTable('PTBA', [['PLAN DE TRAVAIL ET BUDGET ANNUEL 2024'], headers, ...ptba]);
  assert.equal(t.shape.categories_proved_by_sum.length, 3);
  assert.deepEqual(t.title_lines, [['PLAN DE TRAVAIL ET BUDGET ANNUEL 2024']]);
});

test('an AI input is made smaller without being cut: still valid JSON, and the last document (the one just deposited) is still there', () => {
  const docs = Array.from({ length: 90 }, (_, i) => ({ id: 'd' + i, name: 'piece' + i + '.pdf', content: { text: 'x'.repeat(3000) } }));
  docs.push({ id: 'GL', name: 'GL.xlsx', content: { sheets: [{ headers: ['Date', 'Compte', 'Débit', 'Crédit'], first_lines: [] }] } });
  const s = fitJson({ documents: docs }, 60000, [o => o.documents.forEach(x => { if (x.content.text) x.content.text = x.content.text.slice(0, 300); })]);
  const o = JSON.parse(s);
  assert.ok(s.length <= 60000);
  assert.equal(o.documents.at(-1).id, 'GL');
});
