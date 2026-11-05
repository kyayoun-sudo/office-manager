// Neurones 4 and 5 — the audit chain and the opinion the file supports (2026-11-05). INVENTED data reproducing defects
// found in the study of completed missions (the real files stay with the firm, never in this public repository).
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMateriality, checkDatesOutsidePeriod, checkConfirmations, checkConclusionAgainstLines, opinionReading, materialityOf } from '../lib/audit-chain.js';
import { runChecks, classify, missionQualityPass, CHECKS } from '../lib/shadow-quality-checks.js';

const mission = { id: '11111111-2222-3333-4444-555555555555', name: 'CAC 2025 ALPHA INDUSTRIES SAHEL', client_name: 'Alpha Industries Sahel', period_label: 'Exercice 2025' };
const txt = (id, name, text) => ({ id, name, text });
const sheet = (name, rows) => ({ name, rows });
const wb = (id, name, sheets) => ({ id, name, sheets, text: '' });
const withRoles = docs => docs.map(d => ({ ...d, roles: classify(d) }));
const fiche = (id, body) => txt(id, 'C - Trésorerie.docx', 'SYNTHÈSE DES TRAVAUX SUR LE COMPOSANT\nObjectifs : S’assurer de l’existence des soldes bancaires.\nTravaux à effectuer | Réf. | Commentaires\n' + body);
const note = (id, body) => txt(id, 'Note de synthèse.docx', 'NOTE DE SYNTHÈSE DE MISSION — exercice 2025\n' + body);
const report = (id, opinion) => txt(id, 'Rapport.docx', 'RAPPORT DU COMMISSAIRE AUX COMPTES SUR LES ETATS FINANCIERS ANNUELS — exercice clos le 31 décembre 2025\nOpinion\n' + opinion);
const CLEAN = 'A notre avis, les états financiers sont réguliers et sincères et donnent une image fidèle du résultat des opérations de l’exercice 2025.';

test('C9 — materiality: written with an amount = nothing; cited without an amount = to complete; absent = high; given by the programme = nothing', () => {
  const ok = withRoles([note('n', 'Seuil de signification : 25 000 000 FCFA (2 % du total des produits).\nPOINTS BLOQUANTS — À LEVER AVANT ÉMISSION DE L’OPINION\nRien.')]);
  assert.equal(checkMateriality(ok, mission).length, 0);
  assert.equal(materialityOf(ok, mission).amount, 25000000);
  const vague = withRoles([note('n', 'La matérialité sera déterminée par le manager.\nPOINTS BLOQUANTS\nRien.')]);
  const v = checkMateriality(vague, mission); assert.equal(v[0].check, 'C9'); assert.equal(v[0].severity, 'moyenne');
  const none = withRoles([fiche('f', 'Obtenir les relevés | | Relevés obtenus et rapprochés.')]);
  assert.equal(checkMateriality(none, mission)[0].severity, 'haute');
  assert.equal(checkMateriality(none, { ...mission, materiality: { overall: 30000000 } }).length, 0);
  // A firm that has no worked document yet is not told anything.
  assert.equal(checkMateriality(withRoles([txt('x', 'Statuts.pdf', 'Statuts de la société')]), mission).length, 0);
});

test('C10 — items dated outside the audited year are reported; January of the next year and old-balance tests are not', () => {
  const book = wb('w', 'Tests achats.xlsx', [
    sheet('ACH-02', [['CLIENT : Alpha Industries'], ['Objectif'], ['S’assurer de la réalité des achats de l’exercice'], ['Date', 'Fournisseur', 'Montant', 'Résultat'],
      [new Date('2025-04-02'), 'F1', 1200000, 'PASS'], ['15/06/2023', 'F2', 800000, 'PASS'], [new Date('2026-01-10'), 'F3', 50000, 'PASS'], ['Conclusion : achats justifiés']]),
    sheet('CLI-04', [['Objectif'], ['Apprécier l’ancienneté des créances clients (balance âgée)'], ['Date', 'Client', 'Montant'], ['12/03/2021', 'C1', 400000]])
  ]);
  const f = checkDatesOutsidePeriod(withRoles([book]), mission);
  assert.equal(f.length, 1); assert.equal(f[0].check, 'C10'); assert.match(f[0].detail, /ACH-02 : 1 sur 3/); assert.doesNotMatch(f[0].detail, /CLI-04/);
});

test('C11 — a confirmation left without reply and without alternative procedure is a limitation; an alternative procedure or a mere instruction is not', () => {
  const silent = withRoles([fiche('f', 'Envoyer les confirmations bancaires. | | Les confirmations envoyées aux cinq banques sont restées sans réponse à la date du rapport.')]);
  const f = checkConfirmations(silent); assert.equal(f.length, 1); assert.equal(f[0].severity, 'haute'); assert.match(f[0].quotes[0].text, /sans réponse/);
  const alt = withRoles([fiche('f', 'Les confirmations sont restées sans réponse. Procédure alternative : règlements postérieurs vérifiés sur les relevés de janvier.')]);
  assert.equal(checkConfirmations(alt).length, 0);
  const instruction = withRoles([fiche('f', 'Relancer les confirmations sans réponse avant le 15 février.')]);
  assert.equal(checkConfirmations(instruction).length, 0);
});

test('C12 — a sheet concluding « no exception » while its lines show exceptions is reported with both passages; an honest conclusion is not', () => {
  const rows = conclusion => [['Objectif'], ['Vérifier que les dépenses sont éligibles'], ['N°', 'Montant', 'Pièce', 'Résultat'],
    ['S01', 1500000, 'Facture 12', 'PASS'], ['S02', 900000, 'aucune pièce', 'EXCEPTION'], ['Conclusion :'], [conclusion]];
  const bad = checkConclusionAgainstLines(withRoles([wb('w', 'PRJ.xlsx', [sheet('PRJ-05', rows('Aucune exception relevée : les dépenses testées sont éligibles.'))])]));
  assert.equal(bad.length, 1); assert.equal(bad[0].check, 'C12'); assert.match(bad[0].quotes[0].text, /Aucune exception/); assert.match(bad[0].quotes[1].text, /EXCEPTION/);
  const honest = checkConclusionAgainstLines(withRoles([wb('w', 'PRJ.xlsx', [sheet('PRJ-05', rows('Une exception relevée (S02, 900 000 sans pièce) reportée à la note de synthèse.'))])]));
  assert.equal(honest.length, 0);
});

const POINTS = 'POINTS SUSCEPTIBLES D’AVOIR UN EFFET SUR L’OPINION\nLe BIC de l’exercice de 48 000 000 FCFA n’a pas été comptabilisé.\nLe procès-verbal d’inventaire des stocks de 175 300 120 FCFA ne nous a pas été communiqué.\nUn écart de 1 200 000 FCFA sur les frais bancaires reste à régulariser.';

test('NEURONE 5 — with materiality, significant disagreement and limitation lead to a PROPOSED qualified opinion; the partner decides; an unqualified report is flagged', () => {
  const docs = withRoles([note('n', 'Seuil de signification : 25 000 000 FCFA\n' + POINTS), report('r', CLEAN)]);
  const o = opinionReading(docs, [], mission);
  assert.equal(o.decision, 'Associé'); assert.equal(o.proposable, true);
  assert.equal(o.proposed.kind, 'avec_reserve'); assert.equal(o.conclusion_logic, 'limitation');
  assert.equal(o.points.find(p => /BIC/.test(p.text)).type, 'desaccord');
  assert.equal(o.points.find(p => /inventaire/.test(p.text)).type, 'limitation');
  assert.equal(o.points.find(p => /frais bancaires/.test(p.text)).significant, false, '1,2 M is under the 25 M threshold');
  assert.ok(o.reasoning.some(r => /ISA 705 §7a/.test(r)) && o.reasoning.some(r => /ISA 705 §7b/.test(r)));
  assert.equal(o.in_file.kind, 'sans_reserve'); assert.equal(o.coherent_with_file, false);
});

test('NEURONE 5 — without materiality the opinion is not proposable; no point and a threshold = unqualified; points under the threshold = unqualified; going concern adds its section', () => {
  const noM = opinionReading(withRoles([note('n', POINTS)]), [], mission);
  assert.equal(noM.proposable, false); assert.equal(noM.proposed, null); assert.equal(noM.conclusion_logic, 'impossible_sans_materialite');
  assert.ok(noM.missing.some(m => /seuil de signification/.test(m)));
  const clean = opinionReading(withRoles([note('n', 'Seuil de signification : 25 000 000 FCFA\nPOINTS BLOQUANTS\nAucun point à signaler.'), report('r', CLEAN)]), [], mission);
  assert.equal(clean.proposed.kind, 'sans_reserve'); assert.equal(clean.proposable, true); assert.equal(clean.coherent_with_file, true);
  const small = opinionReading(withRoles([note('n', 'Seuil de signification : 25 000 000 FCFA\nPOINTS BLOQUANTS\nUn écart de 1 200 000 FCFA sur les frais bancaires reste à régulariser.')]), [], mission);
  assert.equal(small.proposed.kind, 'sans_reserve');
  const gc = opinionReading(withRoles([note('n', 'Seuil de signification : 25 000 000 FCFA\nPOINTS BLOQUANTS\nAucun point.')]), [{ check: 'C5', title: 'capitaux propres' }], mission);
  assert.equal(gc.proposed.going_concern_section, true); assert.ok(gc.reasoning.some(r => /ISA 570/.test(r)));
  // An unanswered confirmation found by the chain becomes a limitation of the opinion.
  const lim = opinionReading(withRoles([note('n', 'Seuil de signification : 25 000 000 FCFA\nPOINTS BLOQUANTS\nAucun point.')]), [{ check: 'C11', title: 'Confirmation sans réponse', quotes: [{ doc: 'C.docx' }] }], mission);
  assert.equal(lim.proposed.kind, 'avec_reserve'); assert.equal(lim.points[0].type, 'limitation');
});

test('the chain checks run with Shadow’s checks, and the quality pass keeps the proposed opinion', async () => {
  for (const k of ['C9', 'C10', 'C11', 'C12']) assert.ok(CHECKS[k], k);
  const docs = [fiche('f', 'Les confirmations bancaires sont restées sans réponse.'), note('n', POINTS)];
  const found = await runChecks({ mission, docs }, { ai: false });
  assert.ok(found.some(f => f.check === 'C9')); assert.ok(found.some(f => f.check === 'C11'));
  let lab = {};
  const r = await missionQualityPass('org', mission.id, 'Paul', { mission, ai: false, missionMemory: async () => docs.map(d => ({ id: d.id, name: d.name })),
    readDoc: async m => docs.find(d => d.id === m.id), changeLab: async fn => { lab = fn(lab); return lab; }, audit: async () => null });
  assert.equal(r.opinion.decision, 'Associé'); assert.equal(r.opinion.proposable, false, 'no materiality in this file');
  assert.equal(lab.quality[0].opinion.conclusion_logic, 'impossible_sans_materialite');
});
