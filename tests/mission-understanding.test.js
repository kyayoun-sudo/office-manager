// NEURONE 6 — the comprehension sheet of a mission (2026-11-05). INVENTED data; the real missions studied stay with the firm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { understandMission, cycleOf } from '../lib/mission-understanding.js';
import { runChecks, classify, missionQualityPass } from '../lib/shadow-quality-checks.js';
import { opinionReading } from '../lib/audit-chain.js';

const schema = JSON.parse(readFileSync(new URL('../docs/neurones/FORMAT_COMPREHENSION_MISSION.schema.json', import.meta.url)));
const enumOf = ref => schema.$defs[ref].enum;
const mission = { id: '11111111-2222-3333-4444-555555555555', name: 'CAC 2025 ALPHA INDUSTRIES SAHEL', client_name: 'Alpha Industries Sahel', period_label: 'Exercice 2025' };
const txt = (id, name, text) => ({ id, name, text });
const wb = (id, name, sheets) => ({ id, name, sheets, text: '' });
const docs = [
  txt('n', 'Note de synthèse.docx', 'RAPPORT DU COMMISSAIRE AUX COMPTES — NOTE DE SYNTHÈSE DE MISSION — exercice 2025\nRéférentiel : SYSCOHADA révisé.\nSeuil de signification : 25 000 000 FCFA\nRisque significatif : la séparation des exercices sur les ventes de décembre.\nPOINTS SUSCEPTIBLES D’AVOIR UN EFFET SUR L’OPINION\nLe BIC de l’exercice de 48 000 000 FCFA n’a pas été comptabilisé.\nLe procès-verbal d’inventaire des stocks de 175 300 120 FCFA ne nous a pas été communiqué.'),
  wb('w', 'Tests.xlsx', [
    { name: 'ACH-02', rows: [['CLIENT : Alpha Industries'], ['Objectif'], ['S’assurer de la réalité des achats'], ['N°', 'Date', 'Montant', 'Résultat'], ['S01', new Date('2025-04-02'), 1200000, 'PASS'], ['S02', new Date('2025-05-02'), 900000, 'EXCEPTION'], ['Conclusion :'], ['Aucune exception relevée.']] },
    { name: 'TRE-01', rows: [['Objectif'], ['Rapprocher les soldes bancaires des relevés'], ['Banque', 'Solde'], ['B1', 3000000]] }
  ])
];

test('NEURONE 6 — the sheet follows the format: entity, mandate, materiality, procedures, misstatements, limitations, cycles, opinion, broken links, map', async () => {
  const findings = await runChecks({ mission, docs }, { ai: false });
  const read = docs.map(d => ({ ...d, roles: classify(d) }));
  const u = understandMission({ mission, docs: read, findings, opinion: opinionReading(read, findings, mission) });
  for (const k of schema.required) assert.ok(k in u, k);
  assert.equal(u.version, '1');
  assert.equal(u.mission.entite.type, 'societe'); assert.equal(u.mission.mandat.type, 'commissariat_aux_comptes');
  assert.equal(u.mission.referentiel, 'SYSCOHADA révisé'); assert.equal(u.mission.materialite.globale, 25000000);
  assert.deepEqual([u.mission.periode.debut, u.mission.periode.fin], ['2025-01-01', '2025-12-31']);
  const ach = u.procedures.find(p => p.id === 'ACH-02'), tre = u.procedures.find(p => p.id === 'TRE-01');
  assert.equal(ach.cycle, 'achats_fournisseurs'); assert.equal(ach.statut, 'faite'); assert.equal(ach.constats[0].resultat, 'exception');
  assert.equal(tre.cycle, 'tresorerie'); assert.equal(tre.nature, 'rapprochement'); assert.equal(tre.statut, 'partielle', 'no written conclusion');
  assert.ok(u.anomalies.some(a => /BIC/.test(a.description) && a.montant === 48000000));
  assert.ok(u.limitations.some(l => /inventaire/.test(l.description)));
  const achCycle = u.conclusions_cycle.find(c => c.cycle === 'achats_fournisseurs');
  assert.equal(achCycle.coherente, false, 'C12: « aucune exception » with an EXCEPTION line'); assert.equal(achCycle.conclusion_logique, 'anomalie');
  assert.ok(u.maillons_casses.some(m => m.regle === 'R01_conclusion_contraire_aux_constats'));
  assert.ok(u.risques.some(r => r.niveau === 'significatif'));
  assert.equal(u.opinion.decision, 'Associé'); assert.equal(u.opinion.proposee, 'avec_reserve_limitation');
  // Every closed value belongs to the format.
  assert.ok(u.maillons_casses.every(m => enumOf('regle').includes(m.regle)));
  assert.ok(u.conclusions_cycle.every(c => enumOf('cycle').includes(c.cycle)));
  assert.ok(u.procedures.every(p => enumOf('cycle').includes(p.cycle) && p.assertions.every(a => enumOf('assertion').includes(a))));
  assert.ok(schema.properties.opinion.properties.proposee.enum.includes(u.opinion.proposee));
  assert.deepEqual(u.carte.map(c => c.notion), schema.properties.carte.items.properties.notion.enum);
  assert.equal(u.carte.find(c => c.notion === 'materialite').trouvee, true);
});

test('NEURONE 6 — without materiality every cycle stays « impossible sans matérialité » and no opinion is proposed; nothing is invented', () => {
  const read = [txt('n', 'Note.docx', 'NOTE DE SYNTHÈSE\nPOINTS BLOQUANTS\nLe BIC de 48 000 000 FCFA n’a pas été comptabilisé.'), docs[1]].map(d => ({ ...d, roles: classify(d) }));
  const u = understandMission({ mission, docs: read, findings: [{ check: 'C9', title: 'Aucune matérialité', documents: [] }], opinion: opinionReading(read, [], mission) });
  assert.equal(u.mission.materialite, null);
  assert.ok(u.conclusions_cycle.every(c => c.conclusion_logique === 'impossible_sans_materialite'));
  assert.equal(u.opinion.proposee, 'aucune'); assert.equal(u.opinion.proposable, false);
  assert.ok(u.maillons_casses.some(m => m.regle === 'R10_materialite_absente'));
  assert.deepEqual(u.mission.mandat.exigences, []); assert.equal(u.mission.entite.activite, null);
});

test('the cycle of a test comes from its own words; the quality pass keeps the sheet', async () => {
  assert.equal(cycleOf('TEST DES DOTATIONS', 'dotations aux amortissements'), 'immobilisations');
  assert.equal(cycleOf('PRJ-05', 'éligibilité des dépenses du projet'), 'projet_bailleur');
  assert.equal(cycleOf('Feuil1', 'rien de reconnaissable'), 'autre');
  let lab = {};
  const r = await missionQualityPass('org', mission.id, 'Paul', { mission, ai: false, missionMemory: async () => docs.map(d => ({ id: d.id, name: d.name })),
    readDoc: async m => docs.find(d => d.id === m.id), changeLab: async fn => { lab = fn(lab); return lab; }, audit: async () => null });
  assert.equal(r.understanding.version, '1'); assert.equal(lab.quality[0].understanding.opinion.decision, 'Associé');
});
