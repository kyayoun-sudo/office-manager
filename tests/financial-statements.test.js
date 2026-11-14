import test from 'node:test';
import assert from 'node:assert/strict';
import { readTrialBalance, cycleOfAccount, balanceChecks, compareBalances, analyticalFigures, figuresForAi, amountOf } from '../lib/financial-statements.js';

// Balance à six colonnes (ouverture / mouvements / clôture), titre avec l'exercice, lignes de classe et de total à écarter.
const tb2024 = [
  ['SOCIETE EXEMPLE SA'], ['Balance générale au 31/12/2024'], [],
  ['N° compte', 'Intitulé', 'Solde ouverture débit', 'Solde ouverture crédit', 'Mouvements débit', 'Mouvements crédit', 'Solde clôture débit', 'Solde clôture crédit'],
  ['10', 'Capital (classe)', '', '', '', '', '', '1 000 000'],
  ['101000', 'Capital social', '', '1 000 000', '', '', '', '1 000 000'],
  ['401100', 'Fournisseurs', '', '200 000', '900 000', '1 000 000', '', '300 000'],
  ['401200', 'Fournisseur X', '', '', '50 000', '', '50 000', ''],
  ['411100', 'Clients', '400 000', '', '2 000 000', '1 900 000', '500 000', ''],
  ['411200', 'Client Partenaire', '', '', '', '120 000', '', '120 000'],
  ['471000', 'Compte d\'attente', '', '', '35 000', '', '35 000', ''],
  ['521000', 'Banque A', '300 000', '', '1 500 000', '1 000 000', '800 000', ''],
  ['571000', 'Caisse', '', '', '10 000', '15 000', '', '5 000'],
  ['601000', 'Achats de marchandises', '', '', '1 000 000', '', '1 000 000', ''],
  ['661000', 'Salaires', '', '', '240 000', '', '240 000', ''],
  ['701000', 'Ventes', '', '', '', '2 000 000', '', '2 000 000'],
  ['TOTAL', '', '', '', '', '', '2 125 000', '3 425 000']
];

test('reads a six-column trial balance: closing balances, detailed accounts only, year from the title', () => {
  const tb = readTrialBalance(tb2024);
  assert.equal(tb.year, 2024);
  assert.equal(tb.accounts.length, 11, 'class line « 10 » dropped (detailed 101000 exists), total line skipped');
  assert.equal(tb.skipped.group_lines, 1);
  assert.equal(tb.skipped.totals, 1);
  assert.equal(tb.accounts.find(a => a.account === '411100').balance, 500000);
  assert.equal(tb.accounts.find(a => a.account === '701000').balance, -2000000);
  assert.equal(tb.accounts.find(a => a.account === '701000').cycle, 'REV');
});

test('default cycles follow the chart of accounts', () => {
  assert.equal(cycleOfAccount('521000'), 'CASH');
  assert.equal(cycleOfAccount('401100'), 'PUR');
  assert.equal(cycleOfAccount('661000'), 'PAY');
  assert.equal(cycleOfAccount('681100'), 'FA');
  assert.equal(cycleOfAccount('891000'), 'TAX');
  assert.equal(cycleOfAccount('abc'), null);
});

test('checks: imbalance is reported, never corrected; unusual balances explained', () => {
  const c = balanceChecks(readTrialBalance(tb2024));
  assert.equal(c.balanced, false, 'this example does not balance');
  assert.equal(c.result, 760000);
  const why = Object.fromEntries(c.unusual.map(u => [u.account, u.why]));
  assert.match(why['411200'], /client au crédit/);
  assert.match(why['401200'], /fournisseur au débit/);
  assert.match(why['571000'], /caisse au crédit/);
  assert.match(why['471000'], /attente/);
});

test('N / N-1 from two files: variations by cycle, new and gone accounts, N chosen by the audited year', () => {
  const tb2023 = [['Balance au 31/12/2023'], ['Compte', 'Libellé', 'Solde débiteur', 'Solde créditeur'],
    ['411100', 'Clients', 100000, ''], ['521000', 'Banque A', 300000, ''], ['701000', 'Ventes', '', 1500000], ['605000', 'Eau électricité', 20000, '']];
  const f = analyticalFigures([{ id: 'b', name: 'b.xlsx', rows: tb2023 }, { id: 'a', name: 'a.xlsx', rows: tb2024 }], { missionYear: 2024 });
  assert.equal(f.status, 'computed');
  assert.equal(f.current.source.id, 'a');
  assert.equal(f.previous.year, 2023);
  assert.equal(f.comparison.cycles.REV.variation, -500000 + 380000 - 100000 + 0); // clients + ventes moved
  assert.ok(f.comparison.new_accounts.some(x => x.account === '601000'));
  assert.ok(f.comparison.gone_accounts.some(x => x.account === '605000'));
  const text = figuresForAi(f);
  assert.match(text, /DÉSÉQUILIBRÉE/);
  assert.match(text, /Plus fortes variations/);
});

test('one file with N and N-1 columns compares itself', () => {
  const rows = [['Compte', 'Intitulé', 'Solde N', 'Solde N-1'], ['521000', 'Banque', 800, 300], ['101000', 'Capital', -800, -300]];
  const f = analyticalFigures([{ id: 'x', name: 'x', rows }]);
  assert.equal(f.status, 'computed');
  assert.equal(f.comparison.cycles.CASH.variation, 500);
});

test('not a trial balance → said, nothing invented', () => {
  const f = analyticalFigures([{ id: 'p', name: 'plan', rows: [['Activité', 'Responsable', 'Date'], ['Formation', 'X', '2024-01-01']] }]);
  assert.equal(f.status, 'no_trial_balance');
  assert.equal(amountOf('(1 200,50)'), -1200.5);
});
