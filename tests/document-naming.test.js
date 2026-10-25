import test from 'node:test';
import assert from 'node:assert/strict';
import { isGeneric, preciseTitle, contentName, checkProposedName, meaninglessName, resolveName } from '../lib/document-naming.js';
import { pieceName } from '../lib/deposit-analysis.js';
import { filedName } from '../lib/pbc-loop.js';

test('a generic word alone is never a name', () => {
  for (const t of ['Tableau', 'tableau 2023', 'Document', 'Fichier', 'Pièce jointe', 'Scan', 'Export', 'Feuil1']) assert.equal(isGeneric(t), true, t);
  for (const t of ['Tableau budgétaire PTBA', 'Balance générale', 'Grand livre auxiliaire', 'Convention de financement']) assert.equal(isGeneric(t), false, t);
});

test('the « tableau budgétaire » is named from what was read, not « TABLEAU »', () => {
  const u = { name: 'tableau.xlsx', type: 'Tableau', summary: 'Tableau budgétaire du projet PAGFIC : budget par composante et catégorie pour 2023.', period: '2023' };
  assert.equal(preciseTitle(u), 'Tableau budgétaire du projet PAGFIC');
  assert.equal(pieceName(u, 'MINADER'), 'TABLEAU_BUDGETAIRE_DU_PROJET_PAGFIC_MINADER_2023.xlsx');
  // Nothing precise known: the name is kept (null), never « TABLEAU_2023 ».
  assert.equal(pieceName({ name: 'x.xlsx', type: 'Tableau', summary: 'Tableau.' }, 'C'), null);
});

test('a name proposed by an AI is refused when generic; a meaningless current name is replaced from what was read', () => {
  assert.equal(checkProposedName('TABLEAU_2023.xlsx', 'scan01.xlsx').reason, 'GENERIC_NAME_REFUSED');
  assert.equal(checkProposedName('PTBA_2023.pdf', 'scan01.xlsx').reason, 'EXTENSION_CHANGED');
  assert.equal(meaninglessName('IMG_2231.jpg'), true);
  assert.equal(meaninglessName('Releve_SGCI_2024-12.pdf'), false);
  // The AI only moved the file and gave no name, but the name says nothing: built from what it read.
  assert.equal(resolveName({ action: 'move', doc_type: 'Relevé bancaire SGCI', client: 'ONG X', period: '2024-12' }, 'IMG_2231.jpg', false), 'RELEVE_BANCAIRE_SGCI_ONG_X_2024_12.jpg');
  // A meaningful name is not touched when the AI did not ask to rename.
  assert.equal(resolveName({ action: 'move', doc_type: 'Relevé bancaire' }, 'Releve_SGCI_2024-12.pdf', false), null);
  // The AI asked to rename with a generic name: the code builds a precise one instead.
  assert.equal(resolveName({ action: 'rename', new_name: 'Document.pdf', doc_type: 'Convention de financement', client: 'FAD' }, 'scan.pdf', true), 'CONVENTION_DE_FINANCEMENT_FAD.pdf');
});

test('a confirmed PBC piece is filed under what it is', () => {
  assert.equal(filedName({ cycle_code: 'PRJ', ref: 'PBC-GEN-09', document: 'amendements', period_label: '2023' }, 'scan.pdf', { type: 'Aide-mémoire de mission du bailleur', period: '2023' }),
    'PRJ_PBC_PBC_GEN_09_Aide_memoire_de_mission_du_bailleur_2023.pdf');
  assert.equal(filedName({ cycle_code: 'PRJ', ref: 'PBC-GEN-09', document: 'amendements', period_label: '2023' }, 'scan.pdf', null), 'PRJ_PBC_PBC_GEN_09_amendements_2023.pdf');
});
