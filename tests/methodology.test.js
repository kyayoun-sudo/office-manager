import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocx } from './helpers/make-docx.js';
import { extractStructuredOffice } from '../lib/office-structured-reader.js';
import { parseSop, parsePopulationRow, samplingMode, loadMethodology, findProcedure, METHODOLOGY_FILE } from '../lib/methodology.js';

const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// A fictional SOP built like the firm's (summary lines, card table, numbered parts, bold numbers in the text).
const card = (obj, risk, assertion, row) => ({ table: [['Objectif', obj], ['Risque', risk], ['Assertion', assertion], ['Population / sélection', row]] });
const procedure = (code, title, c, sampling, steps, ask = ['grand livre', 'factures']) => [
  { h: 1, text: `${code} - ${title}` }, c,
  'Instruction du SOP : Exécuter la procédure conformément aux étapes ci-dessous.',
  { h: 2, text: '1. Ce qu’il faut demander' }, ...ask, 'Pièces du test',
  { h: 2, text: '2. Comment préparer la population' }, '**1. **Ouvre la population pertinente.', '**2. **Compte le nombre de lignes.',
  { h: 2, text: '3. Comment prendre l’échantillon / couvrir la population' }, ...sampling,
  { h: 2, text: '4. Pour chaque élément sélectionné / pour exécuter le test' }, ...steps,
  '**9. **Retrouve l’écriture au grand livre et vérifie compte, date, montant.', '**10. **Reporte dans le WP les attributs testés.',
  'Working Paper - colonnes minimales : Sample ID / Référence | Date | Montant | Résultat PASS/EXCEPTION',
  { h: 2, text: '5. Si ça ne correspond pas' }, 'Quantifie l’écart.',
  { h: 2, text: '6. Conclusion' }, '« Travaux exécutés conformément à ZZZ. Population : [X éléments]. »'
];
const SOP = [
  'CABINET EXEMPLE | Manuel d’exécution', 'Cycle 07 - DEP - Dépenses de démonstration',
  'Sommaire', '1. Mode d’emploi', '3. DEP-01 - Compréhension du processus', '4. DEP-02 - Test de détail', '5. DEP-03 - Doublons',
  { h: 1, text: '2. Objectif, risques et PBC du cycle' },
  'Objectif du SOP : S’assurer que les dépenses sont réelles.', 'Flux de référence : Besoin → facture → paiement',
  'PBC principale', { table: [['Document / donnée', 'Utilité'], ['Grand livre des charges', 'Population'], ['Factures', 'Vouching']] },
  ...procedure('DEP-01', 'Compréhension du processus', card('Comprendre le processus.', 'Contrôles non identifiés', 'N/A', 'N/A │ N/A │ CORE │ Niveau : Senior'),
    ['**6. **Pas d’échantillon : exécute la procédure sur l’ensemble des informations nécessaires.'], ['**7. **Faire décrire le processus de bout en bout.']),
  ...procedure('DEP-02', 'Test de détail', card('Test de détail des charges', 'Dépense fictive', 'Occurrence', 'Population des charges │ échantillon selon programme approuvé │ CORE si matériel │ Niveau : Junior'),
    ['**30. **Utilise la méthode et la taille approuvées dans le programme de mission.'], ['**33. **Pour chaque item, retrouver la facture.', '**34. **Recalculer les montants.']),
  ...procedure('DEP-03', 'Doublons', card('Lead schedule', 'Double paiement', 'Occurrence', 'Extraction │ analyse de données │ RISK-DEPENDENT │ Niveau : Manager'),
    ['**56. **Applique les critères directement liés au risque indiqué dans la procédure.'], ['**58. **Rechercher fournisseur + facture identiques.']),
  { h: 1, text: '15. Conclusion du cycle' }, 'Avant de conclure, le Senior vérifie :', 'toutes les procédures Core applicables sont exécutées ;'
];

async function readSop(blocks) { return extractStructuredOffice(await makeDocx(blocks), WORD, 400000); }

test('SYCEBNL technical references before the execution sections do not truncate the procedure', async () => {
  const blocks = procedure('PRJ-01', 'Compréhension convention',
    card('Comprendre la convention.', 'Clauses omises', 'N/A', 'N/A | N/A | CORE | Niveau : Senior'),
    ['Pas d’échantillon : examiner les informations nécessaires.'],
    ['Identifier le bailleur et la période.', 'Construire la matrice des clauses.'],
    ['convention complète', 'amendements', 'budget', 'manuel projet', 'organigramme']);
  blocks.splice(3, 0, 'Références techniques : OHADA, Guide SYCEBNL ; ISA 315.');
  blocks.push('Références techniques', 'Bibliographie finale du cycle.');
  const parsed = parseSop(await readSop(blocks));
  const p = parsed.procedures[0];
  assert.deepEqual(p.ask, ['convention complète', 'amendements', 'budget', 'manuel projet', 'organigramme']);
  assert.equal(p.population_steps.length, 2);
  assert.equal(p.sampling_mode, 'none');
  assert.deepEqual(p.steps.filter(s => !s.common).map(s => s.text),
    ['Identifier le bailleur et la période.', 'Construire la matrice des clauses.']);
  assert.equal(p.exceptions.length, 1);
  assert.equal(p.wp_columns.length, 4);
  assert.equal(p.conclusion_template, 'Travaux exécutés conformément à ZZZ. Population : [X éléments].');
  assert.ok(!parsed.issues.some(i => i.issue === 'PROCEDURE_INCOMPLETE'));
});

test('a SOP is read procedure by procedure, by code (no AI): card, PBC, steps, sampling, conclusion', async () => {
  const r = parseSop(await readSop(SOP), { name: 'SOP_DEP.docx' });
  assert.deepEqual(r.procedures.map(p => p.code), ['DEP-01', 'DEP-02', 'DEP-03'], 'the summary lines are not procedures');
  const p = r.procedures[1];
  assert.equal(p.title, 'Test de détail');
  assert.equal(p.objective, 'Test de détail des charges');
  assert.equal(p.assertion, 'Occurrence');
  assert.deepEqual([p.type, p.condition, p.level], ['CORE', 'si matériel', 'Junior']);
  assert.equal(p.population, 'Population des charges');
  assert.deepEqual(p.ask, ['grand livre', 'factures'], '« Pièces du test » is not a document to ask for');
  assert.equal(p.sampling_mode, 'programme_sample');
  assert.deepEqual(p.steps.map(s => [s.text, s.common]), [['Pour chaque item, retrouver la facture.', false], ['Recalculer les montants.', false],
    ['Retrouve l’écriture au grand livre et vérifie compte, date, montant.', true], ['Reporte dans le WP les attributs testés.', true]]);
  assert.deepEqual(p.wp_columns, ['Sample ID / Référence', 'Date', 'Montant', 'Résultat PASS/EXCEPTION']);
  assert.match(p.conclusion_template, /^Travaux exécutés conformément/);
  assert.deepEqual(r.procedures.map(x => x.sampling_mode), ['none', 'programme_sample', 'risk_targeted']);
  assert.deepEqual(r.procedures.map(x => x.type), ['CORE', 'CORE', 'RISK_DEPENDENT']);
  assert.deepEqual(r.cycle, { code: 'DEP', number: '07', title: 'Dépenses de démonstration', objective: 'S’assurer que les dépenses sont réelles.', flow: 'Besoin → facture → paiement',
    pbc: [{ document: 'Grand livre des charges', purpose: 'Population' }, { document: 'Factures', purpose: 'Vouching' }] });
  assert.ok(!r.procedures[2].steps.some(s => /Avant de conclure/.test(s.text)), 'the cycle conclusion is not a step of the last procedure');
  assert.ok(!r.issues.some(i => i.issue === 'SAME_INSTRUCTION_DIFFERENT_TITLES'), 'the same generic instruction under every title is normal');
});

test('copy errors of the Word are reported, a procedure without its card is said incomplete', () => {
  const t = { table_id: 't1', rows: [['Objectif', 'Lead schedule'], ['Population / sélection', 'x │ y │ CORE │ Niveau : Junior']] };
  const t2 = { table_id: 't2', rows: [['Objectif', 'Lead schedule'], ['Population / sélection', 'x │ y │ CORE │ Niveau : Junior']] };
  const r = parseSop({ sections: [{ text: 'AB-06 - Cut-off' }, { table_id: 't1' }, { text: 'Pour chaque élément' }, { text: 'Comparer les dates.' },
    { text: 'AB-07 - Avances' }, { table_id: 't2' }], tables: [t, t2] });
  assert.ok(r.issues.find(i => i.issue === 'SAME_OBJECTIVE_DIFFERENT_TITLES' && i.code === 'AB-06, AB-07'));
  assert.deepEqual(r.issues.find(i => i.issue === 'PROCEDURE_INCOMPLETE').missing, ['steps']);
});

test('population row and the five sampling modes', () => {
  assert.deepEqual(parsePopulationRow('Avances │ ciblage âge/importance │ CORE si applicable │ Niveau : Junior'),
    { population: 'Avances', selection: 'ciblage âge/importance', type: 'CORE', condition: 'si applicable', level: 'Junior' });
  assert.equal(parsePopulationRow('a | b | OPTIONAL | Niveau : Senior').type, 'OPTIONAL');
  assert.equal(samplingMode('Sélectionne l’opération représentative définie par la procédure.'), 'walkthrough');
  assert.equal(samplingMode('Teste ou rapproche l’ensemble de la population prévue.'), 'exhaustive');
});

test('« Charger les SOP »: the folder is listed, the Word files read a few at a time, the library kept in the Drive memory', async () => {
  const docx = await makeDocx(SOP);
  const files = new Map(); let audited = null;
  const drive = {
    listChildren: async id => id === 'FOLDER11111111111111111' ? [{ id: 'sub', name: '02_SYCEBNL', mimeType: 'application/vnd.google-apps.folder' }, { id: 'tmp', name: '~$SOP.docx', mimeType: WORD }]
      : id === 'sub' ? [{ id: 'w1', name: 'SOP_DEP.docx', mimeType: WORD }, { id: 'w2', name: 'casse.docx', mimeType: WORD }] : [],
    downloadBuffer: async id => { if (id === 'w1') return docx; if (id === 'w2') throw new Error('READER_CORRUPTED'); const f = files.get(id); return Buffer.from(f); },
    findFilesByExactName: async name => files.has(name) ? [{ id: name, modifiedTime: 't' }] : [],
    getMeta: async () => ({ modifiedTime: 't' }),
    createBinary: async ({ name, buffer }) => { files.set(name, buffer); return { id: name }; },
    updateBinary: async (id, { buffer }) => { files.set(id, buffer); }
  };
  const d = { drive, folder: 'mem', driveId: 'D1', audit: async (org, e) => { audited = e; } };
  await assert.rejects(loadMethodology('org', { action: 'list', folder_id: 'nothing-here-1234567890' }, null, d), /NO_SOP_FOUND_IN_FOLDER/);
  const listed = await loadMethodology('org', { action: 'list', folder_id: 'https://drive.google.com/drive/folders/FOLDER11111111111111111' }, { email: 'm@c.ci' }, d);
  assert.equal(listed.files, 2, 'Word lock files (~$) are not SOP');
  const r = await loadMethodology('org', { action: 'step', batch: 4 }, { email: 'm@c.ci' }, d);
  assert.equal(r.status, 'ready'); assert.equal(r.left, 0); assert.equal(r.procedures, 3);
  assert.deepEqual(r.sops.map(s => [s.file_name, s.status, s.family]), [['SOP_DEP.docx', 'READ', '02_SYCEBNL'], ['casse.docx', 'NOT_READ', '02_SYCEBNL']]);
  const state = JSON.parse(files.get(METHODOLOGY_FILE));
  assert.equal(state.drive_id, 'D1');
  assert.equal(findProcedure(state, 'DEP-03').level, 'Manager');
  assert.equal(findProcedure(state, 'DEP-03').sop_file_id, 'w1');
  assert.equal(audited.action_type, 'METHODOLOGY_LOADED');
});

test('the general-audit SOP layout is read too (Risque / assertions, Type / niveau SOP, size in the SOP, conclusion in a table)', async () => {
  const r = parseSop(await readSop([
    'SOP 01 - TRS - Trésorerie',
    'TRS-03 - Contrôle interne - autorisation des virements',
    { table: [['Objectif', 'Tester l’autorisation des paiements'], ['Risque / assertions', 'Paiements non autorisés │ Existence, Droits et obligations'],
      ['Population / sélection', 'Virements de l’exercice │ Échantillon aléatoire (25 items)'], ['Type / niveau SOP', 'MANDATORY / CORE │ Senior']] },
    '1. Ce qu’il faut demander', 'Listing complet des virements.',
    '3. Comment prendre l’échantillon', 'Le SOP demande 25 virements aléatoires.',
    '4. Pour chacun des 25 virements, faire ceci', 'Retrouve l’ordre de virement.', 'Compare montant et bénéficiaire.',
    'Working Paper - colonnes recommandées : Date | Bénéficiaire | Montant | Conclusion',
    { table: [['Conclusion - modèle court « [X] virements testés ; exceptions : [●]. »']] },
    'TRS-12 - Fraude - virements à risque',
    { table: [['Objectif', 'Évaluer le risque de détournement'], ['Risque / assertions', 'Virements frauduleux │ Existence'],
      ['Population / sélection', 'Virements │ Sélection basée sur critères de risque (CAAT)'], ['Type / niveau SOP', 'RISK-DEPENDENT │ Manager']] },
    '3. Comment prendre la sélection basée sur le risque', 'Filtre les montants ronds selon le paramètre fixé par le Manager.',
    '4. Ce qu’il faut faire concrètement', 'Recherche les bénéficiaires absents du fichier tiers.'
  ]), { name: 'SOP_01_TRS.docx' });
  const [a, b] = r.procedures;
  assert.deepEqual([a.code, a.risk, a.assertion, a.type, a.condition, a.level, a.sampling_mode, a.sample_size],
    ['TRS-03', 'Paiements non autorisés', 'Existence, Droits et obligations', 'CORE', null, 'Senior', 'random', 25]);
  assert.equal(a.conclusion_template, '[X] virements testés ; exceptions : [●].');
  assert.deepEqual(a.steps.map(s => s.text), ['Retrouve l’ordre de virement.', 'Compare montant et bénéficiaire.']);
  assert.deepEqual([b.type, b.level, b.sampling_mode], ['RISK_DEPENDENT', 'Manager', 'risk_targeted']);
  assert.equal(r.cycle.code, 'TRS');
  assert.equal(r.cycle.title, 'Trésorerie');
});
