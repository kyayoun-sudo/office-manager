import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readWorkpaperInstructions, mergeExecutionQuestions, questionKey, isLockedWork } from '../lib/enhanced-auditor-execution.js';

test('Enhanced Auditor reads concrete actions and questions from the actual Working Paper before the sample table', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ACH-03');
  ws.addRow(['ACH-03 — Test de détail']);
  ws.addRow(['Objectif', 'Vérifier la réalité des charges']);
  ws.addRow(['Étapes (SOP)']);
  ws.addRow(['1.', 'Vérifier la facture avec le grand livre']);
  ws.addRow(['2.', 'Demander à la direction pourquoi la facture est ancienne ?']);
  ws.addRow([]);
  ws.addRow(['Sample ID / Référence', 'Date', 'Tiers', 'Résultat PASS/EXCEPTION', 'Commentaire']);
  ws.addRow(['F1', '2026-01-02', 'Client', 'PASS', 'Cette ligne est une donnée, pas une instruction']);
  const out = await readWorkpaperInstructions(Buffer.from(await wb.xlsx.writeBuffer()), 'ACH-03');
  assert.equal(out.found, true);
  assert.equal(out.sheet, 'ACH-03');
  assert.equal(out.table_header_row, 7);
  assert.ok(out.instructions.some(x => x.kind === 'action' && /Vérifier la facture/.test(x.text)));
  assert.ok(out.instructions.some(x => x.kind === 'question' && /pourquoi la facture est ancienne/.test(x.text)));
  assert.ok(!out.instructions.some(x => /Cette ligne est une donnée/.test(x.text)), 'sample data is never executed as an instruction');
});

test('SOP and Working Paper questions are merged, deduplicated and existing answers are preserved', () => {
  const card = { ask: ['Obtenir le rapprochement bancaire', 'Confirmer avec la direction le compte ancien ?'] };
  const wp = [
    { kind: 'question', text: 'Confirmer avec la direction le compte ancien ?', address: 'CASH-01!B8' },
    { kind: 'question', text: 'Demander pourquoi le chèque reste non encaissé ?', address: 'CASH-01!B9' }
  ];
  const walkthrough = [{ q: 'Obtenir le rapprochement bancaire', a: 'Reçu le 20/10' }];
  const merged = mergeExecutionQuestions(card, wp, walkthrough);
  assert.equal(merged.length, 3);
  assert.equal(merged.filter(x => x.answered).length, 1);
  assert.equal(merged.filter(x => !x.answered).length, 2);
  assert.equal(merged.find(x => /chèque/.test(x.text)).reference, 'CASH-01!B9');
  assert.equal(questionKey('  Obtenir   le rapprochement bancaire '), questionKey('Obtenir le rapprochement bancaire'));
});

test('submitted and reviewed audit work is read-only for the background Enhanced Auditor', () => {
  assert.equal(isLockedWork({ status: 'submitted' }), true);
  assert.equal(isLockedWork({ status: 'reviewed' }), true);
  assert.equal(isLockedWork({ status: 'in_progress' }), false);
  assert.equal(isLockedWork({ status: 'returned' }), false);
});
