import test from 'node:test';
import assert from 'node:assert/strict';
import { locatePbcSheet, loadPbcItem, writePbcEvaluation, planPbcItemApplicability, pbcRange } from '../lib/mission-engine.js';
import { pbcRowsToSummary } from '../lib/agent-tool-helpers.js';
import { findOverduePbcItems, pbcLifecycleState, pbcColumnsFromHeader } from '../lib/pbc-lifecycle.js';

// Audit 2026-10-30: the PBC engine read a sheet named « PBC_MASTER », its header on row 4, the reference in column A and
// the cycles in column E. A list on another model (another firm, a client list, a renamed sheet) was read at the wrong place.

const SHEET = 'Liste des pièces';
// Another model: title row, header on row 2, columns in another order, no « Applicable » column.
const GRID = [
  ['Liste des pièces demandées — Mission X'],
  ['Document demandé', 'Cycles utilisateurs', 'Référence PBC', 'Critique', 'Reçu ?', 'Complet ?', 'Échéance', 'Commentaire', 'Date réception', 'Lien Drive'],
  ['Grand livre 2024', 'ACH', 'GL-01', 'Oui', 'Non', '', '2024-01-10', '', '', ''],
  ['Relevés bancaires', 'TRE', 'BQ-02', 'Non', 'Oui', 'Oui', '2024-01-10', 'reçu en janvier', '', '']
];
const colLetter = n => String.fromCharCode(65 + n);
function fakeDrive(grid = GRID, sheet = SHEET, formulas = []) {
  const writes = [];
  return {
    writes,
    getFormulaMap: async (id, name) => ({ sheetNames: ['Paramètres', sheet], sheetName: name || sheet, formulaCells: name === sheet ? formulas : [] }),
    getValues: async (id, range) => {
      const m = range.match(/^'?(.+?)'?!A(\d+):/);
      if (!m || m[1].replace(/''/g, "'") !== sheet) return [['Paramètre', 'Valeur']];
      return grid.slice(Number(m[2]) - 1);
    },
    updateValues: async (id, range, rows) => { writes.push({ range, value: rows[0][0] }); }
  };
}

test('the PBC list is found by its columns, whatever the sheet name and the header row', async () => {
  const layout = await locatePbcSheet(fakeDrive(), 'S');
  assert.equal(layout.found, true);
  assert.equal(layout.sheet, SHEET);
  assert.equal(layout.header_row, 2);
  assert.equal(layout.columns.reference, 2);
  assert.equal(pbcRange(layout), "'Liste des pièces'!A2:AB1000");
  const none = await locatePbcSheet({ getFormulaMap: async () => ({ sheetNames: ['Feuil1'] }), getValues: async () => [['Nom', 'Montant']] }, 'S');
  assert.equal(none.found, false); assert.equal(none.reason, 'PBC_SHEET_NOT_FOUND');
});

test('an item is read on its own row and written in its own sheet, at the right cells', async () => {
  const drive = fakeDrive();
  const item = await loadPbcItem(drive, 'S', 'GL-01');
  assert.equal(item.found, true);
  assert.equal(item.row_number, 3, 'header on row 2, first request on row 3');
  assert.equal(item.sheet, SHEET);
  const out = await writePbcEvaluation(drive, 'S', item, { final_state: 'RECEIVED', received_date: '2024-01-12', evaluated_at: '2024-01-12T10:00:00Z', evidence_file_id: 'F1', rationale: 'GL lu' });
  assert.ok(out.written.length >= 2);
  // « Reçu ? » is column E (index 4) in this model — not column P of the pilot's model.
  assert.ok(drive.writes.some(w => w.range === "'Liste des pièces'!E3" && w.value === 'Oui'), JSON.stringify(drive.writes));
  assert.ok(drive.writes.every(w => w.range.startsWith("'Liste des pièces'!")));
});

test('a formula cell of that sheet is never written over', async () => {
  const drive = fakeDrive(GRID, SHEET, ['E3']);
  const item = await loadPbcItem(drive, 'S', 'GL-01');
  const out = await writePbcEvaluation(drive, 'S', item, { final_state: 'RECEIVED', evaluated_at: '2024-01-12T10:00:00Z', evidence_file_id: 'F1', rationale: 'x' });
  assert.ok(!drive.writes.some(w => w.range.endsWith('!E3')));
  assert.ok(out.skipped.some(s => s.reason === 'TARGET_IS_FORMULA'));
});

test('summary, lifecycle and reminders read the list by its header (no « PBC- » prefix, no Applicable column needed)', () => {
  const rows = GRID.slice(1);
  const s = pbcRowsToSummary(rows);
  assert.equal(s.total_rows, 2);
  assert.equal(s.applicable_rows, 2, 'no Applicable column: every request applies');
  assert.deepEqual(s.critical_missing.map(x => x.reference), ['GL-01']);
  assert.equal(s.critical_missing[0].document, 'Grand livre 2024');
  const cols = pbcColumnsFromHeader(rows[0]);
  assert.equal(pbcLifecycleState(rows[2], cols), 'RECEIVED');
  const { overdue } = findOverduePbcItems(rows, new Date('2024-02-01T00:00:00Z'));
  assert.deepEqual(overdue.map(o => o.reference), ['GL-01']);
});

test('applicability plan: the reference and the cycles are read in their own columns', () => {
  const rows = GRID.slice(1);
  const quote = 'Le grand livre général de l’exercice 2024 est demandé pour le cycle achats';
  const plan = planPbcItemApplicability({ rows, headerRow: 2, columns: { reference: 2, cycles: 1 }, retainedCycles: ['ACH'],
    decisions: [{ pbc_reference: 'GL-01', applicable: true, source_evidence_excerpt: quote, programme_procedure: 'ACH-01' }], programmeText: 'Programme. ' + quote + '.' });
  assert.equal(plan[0].status, 'PLANNED');
  assert.equal(plan[0].row_number, 3);
  assert.deepEqual(plan[0].item_cycles, ['ACH']);
});
