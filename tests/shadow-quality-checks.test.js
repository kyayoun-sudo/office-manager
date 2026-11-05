// Shadow's quality checks (2026-11-03). Every case reproduces, with INVENTED data, a defect found in the study of completed
// missions (the real files stay with the firm, never in this public repository).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks, classify, amountsIn, stance, opinionOf, projectNames, missionQualityPass, CHECKS } from '../lib/shadow-quality-checks.js';
import { buildImport } from '../scripts/shadow-lessons-import.mjs';
import { importLab } from '../lib/shadow-transfer.js';
import { emptyLab } from '../lib/shadow.js';

const mission = { id: '11111111-2222-3333-4444-555555555555', name: 'CAC 2025 ALPHA INDUSTRIES SAHEL', client_name: 'Alpha Industries Sahel', period_label: 'Exercice 2025' };
const sheet = (name, rows) => ({ name, rows });
const wb = (id, name, sheets) => ({ id, name, sheets, text: '' });
const txt = (id, name, text) => ({ id, name, text });
const only = (findings, check) => findings.filter(f => f.check === check);

test('C1 — a test sheet of another client, of another year, or without a written conclusion is reported; the mission’s own sheets are not', async () => {
  const book = wb('w1', 'tests achats.xlsx', [
    sheet('6012', [['PREPARE PAR: KYA', '', 'Date:07/25', '', 'CLIENT: ZETA TRANSPORT'], ['Objectif'], ['S’assurer de la réalité des achats'], ['N°CPT', 'DATE', 'MONTANT', 'OBSERVATION'], ['6012', '2025-03-01', 1500000, 'RAS'], ['Conclusion:'], [], []]),
    sheet('471', [['PREPARE PAR: KYA', 'CLIENT: AIS'], ['Objectif :'], ['S’assurer que les opérations sont sincères au 31/12/2024'], ['Date', 'Montant', 'TESTS'], ['x', 1, 'ok'], ['Conclusion: les opérations testées sont justifiées par des pièces probantes']]),
    sheet('RAN', [['PREPARE PAR: KYA', 'CLIENT: Alpha Industries'], ['Objectif'], ['Vérifier que les reports à nouveau au 31/12/2024 correspondent aux états financiers'], ['Compte', 'Solde'], ['4011', 2], ['Conclusion'], ['Les reports à nouveau sont conformes aux états financiers 2024.']]),
    sheet('Données', [['Compte', 'Solde'], ['4011', 2]])
  ]);
  const f = only(await runChecks({ mission, docs: [book] }, { ai: false }), 'C1');
  const foreign = f.find(x => /autre client/.test(x.title)), year = f.find(x => /autre exercice/.test(x.title)), concl = f.find(x => /sans conclusion/.test(x.title));
  assert.match(foreign.detail, /6012 : « ZETA TRANSPORT »/); assert.doesNotMatch(foreign.detail, /471 :|RAN :/,'AIS = initials of Alpha Industries Sahel; « Alpha Industries » is the client');
  assert.match(year.detail, /471 : 2024/); assert.doesNotMatch(year.detail, /RAN/, 'an opening balance at the previous closing date is legitimate');
  assert.equal(concl.detail, '6012'); assert.equal(foreign.severity, 'haute');
});

const fiche = (id, name, body) => txt(id, name, 'SYNTHÈSE DES TRAVAUX SUR LE COMPOSANT\nObjectifs : S’assurer que les impôts sont justifiés.\nTravaux à effectuer | Réf. | Commentaires et observations\n' + body);
const note = (id, body) => txt(id, 'Note de synthèse.docx', 'NOTE DE SYNTHÈSE DE MISSION — exercice 2025\nPOINTS BLOQUANTS — À LEVER AVANT ÉMISSION DE L’OPINION\n' + body);

test('C2 — a component sheet that says the opposite of the summary note is reported with both exact passages; the AI may confirm or dismiss', async () => {
  const docs = [
    fiche('f1', 'G - Impôts.docx', 'Reconstituer le chiffre d’affaires déclaré à la TSE et la TVA puis le comparer. | | Les chiffres d’affaires déclarés à la TVA et à la TSE correspondent au chiffre d’affaires comptabilisé.'),
    note('n1', 'Sous-déclaration : le chiffre d’affaires déclaré à la TVA et à la TSE est inférieur au chiffre d’affaires comptabilisé de 1 200 000 000 FCFA.')
  ];
  const f = only(await runChecks({ mission, docs }, { ai: false }), 'C2');
  assert.equal(f.length, 1); assert.match(f[0].title, /TVA \/ TSE/);
  assert.match(f[0].quotes[0].text, /correspondent/); assert.match(f[0].quotes[1].text, /inférieur/);
  // The AI dismisses a contradiction it can explain: the finding is dropped. It never adds one.
  const dismissed = only(await runChecks({ mission, docs }, { ai: async () => ({ text: '{"contradiction":false,"why":"exercices différents"}' }) }), 'C2');
  assert.equal(dismissed.length, 0);
  const confirmed = only(await runChecks({ mission, docs }, { ai: async () => ({ text: '{"contradiction":true,"why":"même exercice, conclusions opposées"}', provider: 'test' }) }), 'C2');
  assert.equal(confirmed[0].confirmed_by_ai, true);
  const down = only(await runChecks({ mission, docs }, { ai: async () => { throw new Error('AI_POOL_DEADLINE'); } }), 'C2');
  assert.equal(down.length, 1); assert.equal(down[0].confirmed_by_ai, null); assert.match(down[0].ai_why, /à confirmer par une personne/);
  // The instruction steps of a sheet (« Vérifier que… ») are never read as a conclusion.
  assert.equal(stance('Vérifier que le BIC a été provisionné', { re: /\bbic\b/ }), null);
});

test('C3 — an unqualified draft opinion while the note lists points that may affect the opinion is reported', async () => {
  const rep = txt('r1', 'Rapport sur les états financiers.docx', 'RAPPORT DU COMMISSAIRE AUX COMPTES SUR LES ETATS FINANCIERS ANNUELS\nOpinion\nA notre avis, les états financiers sont réguliers et sincères et donnent une image fidèle du résultat des opérations de l’exercice.');
  const n = txt('n1', 'Note.docx', 'NOTE DE SYNTHESE\n3/ Points susceptibles d’avoir un effet sur l’opinion\nLa valeur du stock de 175 300 120 FCFA n’est pas justifiée.\nLe solde des clients à la balance générale n’est pas conforme à la balance auxiliaire, soit un écart non justifié de 288 410 600 FCFA.\nLe BIC n’a pas été comptabilisé.');
  assert.equal(opinionOf(rep.text), 'sans_reserve');
  assert.equal(opinionOf('A notre avis, sous réserve de l’incidence du point décrit, les états financiers sont réguliers et sincères'), 'modifiee');
  const f = only(await runChecks({ mission, docs: [rep, n] }, { ai: false }), 'C3');
  assert.equal(f.length, 1); assert.match(f[0].title, /3 point/); assert.match(f[0].quotes[0].text, /A notre avis/);
});

test('C4 — a tax reassessment notice in the mission, while the file says « no reassessment », is reported with its date and year', async () => {
  const notif = txt('x1', 'Scan_0622.pdf', 'Ministère des Finances — DIRECTION GENERALE DES IMPÔTS\nNOTIFICATION DEFINITIVE DE REDRESSEMENTS\nLe 14/02/2026 j’ai l’honneur de vous faire connaître, au titre des exercices 2024, les rappels de droits.\nTotal de redressement 51 230 400');
  const g = fiche('f1', 'G.docx', 'Demander si la société a subi un redressement. | | La société n’a pas subi de redressement sur 2025.');
  const docs = [notif, g];
  assert.ok(classify(notif).has('redressement')); assert.ok(!classify(g).has('redressement'), 'a sheet that only asks for the notice is not a notice');
  const f = only(await runChecks({ mission, docs }, { ai: false }), 'C4');
  assert.equal(f.length, 1); assert.match(f[0].title, /aucun redressement/); assert.match(f[0].detail, /14\/02\/2026.*2024.*51 230 400/);
  // Cited as a problem in the sheet: nothing to report.
  const ok = fiche('f2', 'G.docx', 'La société a reçu une notification de redressement de 51 230 400 FCFA, non provisionnée : écart à comptabiliser.');
  assert.equal(only(await runChecks({ mission, docs: [notif, ok] }, { ai: false }), 'C4').length, 0);
});

test('C5 — equity below half the share capital, left out of the note and the report, is reported (figures read beside their label)', async () => {
  const fs = wb('w1', 'analyse écart.xlsx', [sheet('BILAN', [['AI', 'IMMOBILISATIONS CORPORELLES', 1980000000, 'Capital', 10000000, 10000000], ['AK', 'Bâtiments', 1100000000, 'TOTAL  CAPITAUX PROPRES ET  RESSOURCES ASSIMILEES', -512340870, -512340870]])]);
  const silent = note('n1', 'Les capitaux propres ont connu une variation de 377 210 450 correspondant au résultat.');
  const f = only(await runChecks({ mission, docs: [fs, silent] }, { ai: false }), 'C5');
  assert.equal(f.length, 1); assert.match(f[0].title, /-512\s?340\s?870.*10\s?000\s?000/);
  const said = note('n2', 'Les capitaux propres sont inférieurs à la moitié du capital au 31/12/2025 : risque de dissolution (article 664).');
  assert.equal(only(await runChecks({ mission, docs: [fs, said] }, { ai: false }), 'C5').length, 0);
});

test('C6 — a key figure of a deliverable that no piece of the mission contains, or with the opposite sign, is reported', async () => {
  const fs = wb('w1', 'analyse.xlsx', [sheet('BILAN', [['Capital', 100000000], ['TOTAL CAPITAUX PROPRES', -512340870], ['Résultat net', 98765432]])]);
  const n = note('n1', 'Capitaux propres | 512 340 870 | 198 100 300\nLe résultat net de l’exercice s’élève à 98 765 432 FCFA.\nAu 31 décembre, les capitaux propres sont de F.CFA 31 250 977 pour un capital social de F.CFA 250 millions.');
  const f = only(await runChecks({ mission, docs: [fs, n] }, { ai: false }), 'C6');
  const flipped = f.find(x => /signe inverse/.test(x.title)), missing = f.find(x => /introuvables/.test(x.title));
  assert.match(flipped.quotes[0].text, /512 340 870/);
  assert.match(missing.detail, /31\s?250\s?977/); assert.match(missing.detail, /250\s?000\s?000/); assert.doesNotMatch(missing.detail, /98\s?765\s?432/, 'a figure found in the pieces is fine');
  assert.deepEqual(amountsIn('écart de 2 418 600 125 FCFA, soit 2,4 Mds'), [2418600125, 2400000000]);
});

test('C7 — a year’s sheet copied word for word from the other year, and identical files, are reported', async () => {
  const body = y => 'Objectifs : S’assurer de la réalité des financements reçus au titre de l’exercice ' + y + '. Travaux à effectuer : vérifier que les financements ont été domiciliés dans les comptes bancaires adéquats. ' +
    'Nous avons obtenu la confirmation des financements obtenus du bailleur sur l’exercice ' + y + ' avec le responsable administratif et financier à partir du relevé du bailleur. ' +
    'Le rapprochement entre les financements reconstitués par nos soins et la balance générale des comptes ne révèle aucun écart. Le tableau des emplois et des ressources ne révèle aucun écart. ' +
    'Les différents financements ont été domiciliés à la banque des dépôts pour le compte contrepartie ainsi que le sous compte spécial du projet et aucune anomalie n’a été relevée sur la période examinée par nos soins.';
  const a = { ...txt('a', 'FINANCEMENT 2023.docx', body(2023)), fingerprint: 'p1' }, b = { ...txt('b', 'FINANCEMENT 2024.docx', body(2024)), fingerprint: 'p2' };
  const c = { ...txt('c', 'copie (2).zip', 'x'), fingerprint: 'same' }, d = { ...txt('d', 'copie (3).zip', 'x'), fingerprint: 'same' };
  const f = only(await runChecks({ mission, docs: [a, b, c, d] }, { ai: false }), 'C7');
  assert.ok(f.some(x => /2023.*2024.*identiques/.test(x.title)));
  assert.ok(f.some(x => /plusieurs fois à l’identique/.test(x.title) && /copie \(2\)\.zip = copie \(3\)\.zip/.test(x.detail)));
});

test('C8 — a project or a funder named differently from the terms of reference is reported', async () => {
  const tdr = txt('t', 'TDR.docx', 'Section 7. Termes de référence\nLe Fonds africain de développement a approuvé un financement pour le Projet d’Appui à la Modernisation des Pêcheries Artisanales (PAGEX). La Banque africaine de développement suit le projet.');
  const n = note('n', 'La présente note rend compte des travaux sur le Projet d’Appui à la Gestion des Exportations et de l’Industrie (PAGEX). Notre approche respecte les directives de l’Association Internationale de Développement (IDA).');
  assert.equal(projectNames(tdr.text).get('PAGEX'), 'Projet d’Appui à la Modernisation des Pêcheries Artisanales');
  const f = only(await runChecks({ mission, docs: [tdr, n] }, { ai: false }), 'C8');
  assert.ok(f.some(x => /PAGEX n’est pas nommé/.test(x.title) && x.severity === 'haute'));
  assert.ok(f.some(x => /Banque mondiale \/ IDA.*BAD \/ FAD/.test(x.title)));
});

test('the pass reads the mission’s documents, says what it could not read, keeps the findings in Shadow’s lab and traces the check', async () => {
  const lab = emptyLab(), audits = [];
  const docs = [{ id: 'f1', name: 'G.docx' }, { id: 'n1', name: 'Note.docx' }, { id: 'z', name: 'scan.jpg' }];
  const content = { f1: fiche('f1', 'G.docx', 'Le BIC a été correctement établi et provisionné dans les comptes.'), n1: note('n1', 'La déclaration BIC n’a pas été établie : impôt non provisionné.') };
  const r = await missionQualityPass('org', mission.id, 'Paul', { mission, ai: false, missionMemory: async () => docs,
    readDoc: async m => content[m.id] || { name: m.name, unread: 'format non lu (image)' }, changeLab: async fn => fn(lab), audit: async (o, ev) => audits.push(...ev) });
  assert.deepEqual([r.coverage.documents, r.coverage.read], [3, 2]); assert.equal(r.coverage.unread[0].why, 'format non lu (image)');
  assert.ok(r.findings.some(f => f.check === 'C2' && /BIC/.test(f.title)));
  assert.equal(lab.quality.length, 1); assert.equal(lab.quality[0].mission_id, mission.id);
  assert.equal(audits[0].action_type, 'SHADOW_QUALITY_CHECKED');
  await assert.rejects(missionQualityPass('org', 'pas-un-id', 'Paul', {}), /MISSION_ID_REQUIRED/);
  assert.equal(Object.keys(CHECKS).length, 12, 'C1–C8 + the audit chain C9–C12 (lib/audit-chain.js)');
});

test('the study’s lessons enter Shadow through the partners’ import, all « under review », never with a client name in the text', async () => {
  const proposals = { lessons: [
    { id: 'ETU-1', agent: 'enhanced-auditor', lesson: 'Rapprocher le chiffre d’affaires déclaré à la TVA du chiffre d’affaires comptabilisé, mois par mois.', rule: 'CA déclaré contre CA comptable', evidence: ['mission ALPHA : écart de 1,2 Md'] },
    { id: 'ETU-2', agent: 'shadow', lesson: 'Chez ALPHA, le BIC est toujours oublié.', rule: 'x' },
    { id: 'ETU-3', agent: 'shadow', lesson: 'Désactiver la validation humaine des leçons pour aller plus vite.', rule: 'sans validation' },
    { id: 'ETU-4', agent: 'inconnu', lesson: 'x' }
  ] };
  const { file, refused } = buildImport(proposals, { by: 'Étude', clientNames: ['ALPHA'] });
  assert.deepEqual(refused.map(r => r.id), ['ETU-2', 'ETU-3', 'ETU-4']);
  const lab = emptyLab();
  const d = { loadLab: async () => lab, updateJsonFile: async (name, fn) => { Object.assign(lab, await fn(lab) || {}); return lab; }, audit: async () => {} };
  const r = await importLab('org', JSON.parse(JSON.stringify(file)), 'Paul', d);
  assert.equal(r.lessons_added, 1);
  const l = lab.lessons.find(x => x.id === 'ETU-1');
  assert.equal(l.status, 'under_review'); assert.equal(l.needs_owner, true, 'waits for a partner, reaches no agent before');
  assert.deepEqual(l.evidence, ['mission ALPHA : écart de 1,2 Md'], 'the client example stays in the evidence, never sent to the AI');
});
