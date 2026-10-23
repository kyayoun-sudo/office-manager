import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { classifySheet, understandWorkingFile } from '../lib/working-file-understanding.js';

test('classifies the main Working File sheets', () => {
  assert.equal(classifySheet('00_GUIDE'), 'guide');
  assert.equal(classifySheet('01_SYNTHESE'), 'synthesis');
  assert.equal(classifySheet('02_PROGRAMME'), 'programme');
  assert.equal(classifySheet('03_RISQUES'), 'risks');
  assert.equal(classifySheet('D1_GL_PROJET'), 'population');
  assert.equal(classifySheet('R_RAPPROCHEMENTS'), 'reconciliation');
  assert.equal(classifySheet('PRJ-05'), 'test');
  assert.equal(classifySheet('PRJ05'), 'test');
  assert.equal(classifySheet('PBC'), 'pbc');
});

test('understands guide, programme, populations and current procedure before execution', () => {
  const wb = new ExcelJS.Workbook();
  let ws = wb.addWorksheet('00_GUIDE');
  ws.addRow(['Mode d’emploi', 'Lire le guide avant toute sélection']);
  ws.addRow(['Règle', 'Un PASS exige une preuve']);

  ws = wb.addWorksheet('01_SYNTHESE');
  ws.addRow(['Client', 'Client Test']);
  ws.addRow(['Exercice', '2026']);

  ws = wb.addWorksheet('02_PROGRAMME');
  ws.addRow(['Code', 'Procédure', 'Activation', 'Niveau']);
  ws.addRow(['PRJ01', 'Compréhension convention', 'CORE', 'Senior']);
  ws.addRow(['PRJ05', 'Éligibilité dépenses', 'CORE', 'Senior']);

  ws = wb.addWorksheet('03_RISQUES');
  ws.addRow(['RISK-01', 'Dépenses non éligibles', 'PRJ05']);

  ws = wb.addWorksheet('PBC');
  ws.addRow(['PBC-PRJ-01', 'Convention complète', 'Reçu']);
  ws.addRow(['PBC-PRJ-04', 'No-objection', 'Non reçu']);

  ws = wb.addWorksheet('D1_GL_PROJET');
  ws.addRow(['Date', 'Compte', 'Référence', 'Montant', 'Projet', 'Bailleur']);
  ws.addRow(['2026-01-15', '601000', 'INV-1', 1000, 'P1', 'UE']);

  ws = wb.addWorksheet('R_RAPPROCHEMENTS');
  ws.addRow(['Contrôle', 'Source', 'Résultat']);
  ws.addRow(['RC01', 'GL vs balance', 'OK']);

  ws = wb.addWorksheet('PRJ05');
  ws.addRow(['Objectif', 'Vérifier l’éligibilité des dépenses']);
  ws.addRow(['Population', 'D1_GL_PROJET']);
  ws.addRow(['Pièce', 'PBC-PRJ-01']);

  const u = understandWorkingFile(wb, {
    procedureCode: 'PRJ-05',
    sopSteps: [{ n: 1, text: 'Vérifier date, nature, catégorie et plafond', source: 'sop' }],
    sources: [{ file_id: 'f1', name: 'Convention.pdf', document: 'Convention', status: 'mission' }]
  });

  assert.equal(u.foundation.guide.sheet, '00_GUIDE');
  assert.equal(u.foundation.programme.sheet, '02_PROGRAMME');
  assert.equal(u.foundation.programme.procedures.find(p => p.code === 'PRJ-05').active, true);
  assert.equal(u.foundation.pbc.items.find(x => x.ids.includes('PBC-PRJ-04')).status, 'missing_or_pending');
  assert.equal(u.populations[0].sheet, 'D1_GL_PROJET');
  assert.equal(u.populations[0].likely_ledger, true);
  assert.equal(u.active_procedure.code, 'PRJ-05');
  assert.equal(u.active_procedure.working_file.sheet, 'PRJ05');
  assert.deepEqual(u.active_procedure.working_file.population_dependencies, ['D1_GL_PROJET']);
  assert.deepEqual(u.active_procedure.working_file.required_evidence, ['PBC-PRJ-01']);
  assert.equal(u.active_procedure.sop_steps[0].text, 'Vérifier date, nature, catégorie et plafond');
  assert.equal(u.ready_to_plan, true);
});
