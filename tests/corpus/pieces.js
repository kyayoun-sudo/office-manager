// Pièces d'essai construites d'après des mises en page RÉELLES (exports Sage 100 / Odoo / CSV « recherche des écritures », grand livre fait
// main ; PTBA de bailleurs — structure relevée sur le PTBA Hydromet 2025 publié, et sur celui d'un projet ivoirien : titres fusionnés,
// composantes sans montant, rubriques qui portent la somme de leurs lignes, montants en texte « 791 563,20 », en-têtes sur deux lignes).
// Aucune donnée de client : tout est inventé, seule la FORME vient des vrais fichiers. Chaque pièce dit ce que le moteur doit en tirer.
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

const fr = n => n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).replace(/ | /g, ' ');
const entries = [  // [date, journal, piece, label, debit, credit, account, accountLabel]
  ['05/01/2023', 'AC', 'FA001', 'Fournitures de bureau janvier', 150000, 0, '605300', 'Fournitures non stockables'],
  ['17/02/2023', 'AC', 'FA014', 'Cartouches imprimante', 82500, 0, '605300', 'Fournitures non stockables'],
  ['03/03/2023', 'BQ', 'VI003', 'Billet Abidjan-Dakar formation', 410000, 0, '618120', 'Transport des agents en formation'],
  ['28/04/2023', 'BQ', 'VI009', 'Billet retour', 395000, 0, '618120', 'Transport des agents en formation'],
  ['10/01/2023', 'BQ', 'RG001', 'Règlement fournisseur papeterie', 0, 150000, '521100', 'Banque SGCI projet'],
  ['12/06/2023', 'BQ', 'VR002', 'Tranche 2 bailleur', 25000000, 0, '521100', 'Banque SGCI projet'],
  ['30/12/2023', 'OD', 'OD045', 'Honoraires consultant décembre', 1200000, 0, '632400', 'Honoraires']
];
const byAccount = () => { const m = new Map(); for (const e of entries) { if (!m.has(e[6])) m.set(e[6], []); m.get(e[6]).push(e); } return [...m.entries()].sort(); };
const expectGl = { entries: entries.length, debit: entries.reduce((s, e) => s + e[4], 0), credit: entries.reduce((s, e) => s + e[5], 0), accounts: [...new Set(entries.map(e => e[6]))].sort(), years: ['2023'] };

async function xlsxOf(build) { const wb = new ExcelJS.Workbook(); build(wb); return Buffer.from(await wb.xlsx.writeBuffer()); }
const xlsOf = (sheets) => { const wb = XLSX.utils.book_new(); for (const [n, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n); return XLSX.write(wb, { type: 'buffer', bookType: 'xls' }); };

// 1. Sage 100 « Grand-livre des comptes » exporté : en-tête de société, pages répétées (titre + en-têtes de colonnes au milieu du fichier),
//    sections par compte, « A nouveau » / « Report », « Total compte », montants en texte, « Total général ».
function sageSections() {
  const head = ['Date', 'Jnl', 'N° pièce', 'Libellé écriture', 'Débit', 'Crédit', 'Solde'];
  const aoa = [['PROJET EXEMPLE — CELLULE DE COORDINATION'], ['Grand-livre des comptes'], ['Période du 01/01/2023 au 31/12/2023', null, null, null, null, null, 'Page 1'], [], head];
  let n = 0;
  for (const [acc, es] of byAccount()) {
    aoa.push([acc + '  ' + es[0][7]]);
    aoa.push([null, null, null, 'A nouveau', fr(0), fr(0), fr(0)]);
    let d = 0, c = 0;
    for (const e of es) { aoa.push([e[0], e[1], e[2], e[3], e[4] ? fr(e[4]) : null, e[5] ? fr(e[5]) : null, fr(e[4] - e[5])]); d += e[4]; c += e[5]; }
    aoa.push([null, null, null, 'Total compte ' + acc, fr(d), fr(c), fr(d - c)]);
    if (++n === 2) aoa.push([], ['Grand-livre des comptes'], ['Période du 01/01/2023 au 31/12/2023', null, null, null, null, null, 'Page 2'], [], head);   // page break
  }
  aoa.push([null, null, null, 'Total général', fr(expectGl.debit), fr(expectGl.credit), null]);
  return { name: 'GL SAGE 2023.xls', buffer: xlsOf([['Grand livre', aoa]]), kind: 'gl', expect: expectGl };
}
// 2. Odoo « Grand livre » : une ligne par compte qui PORTE les totaux du compte (au-dessus), « 601100 Achats… » code + intitulé dans une cellule.
async function odooGrouped() {
  return { name: 'Grand_livre_2023.xlsx', kind: 'gl', expect: expectGl, buffer: await xlsxOf(wb => {
    const s = wb.addWorksheet('Grand livre'); s.addRow(['Grand livre']); s.addRow(['Du 01/01/2023 au 31/12/2023']); s.addRow([]);
    s.addRow(['Date', 'Journal', 'Compte', 'Partenaire', 'Référence', 'Libellé', 'Débit', 'Crédit', 'Solde']);
    for (const [acc, es] of byAccount()) {
      const d = es.reduce((x, e) => x + e[4], 0), c = es.reduce((x, e) => x + e[5], 0);
      s.addRow([null, null, acc + ' ' + es[0][7], null, null, null, d, c, d - c]).font = { bold: true };
      for (const e of es) { const [dd, mm, yy] = e[0].split('/'); s.addRow([new Date(Date.UTC(+yy, mm - 1, +dd)), e[1], acc + ' ' + e[7], 'Tiers', e[2], e[3], e[4], e[5], e[4] - e[5]]); }
    }
    s.addRow([null, null, null, null, null, 'Total', expectGl.debit, expectGl.credit, null]);
  }) };
}
// 3. CSV « Recherche des écritures » : à plat, point-virgule, décimales à la virgule.
function csvFlat() {
  const lines = ['Date;Journal;N° compte;N° pièce;Libellé;Débit;Crédit', ...entries.map(e => [e[0], e[1], e[6], e[2], e[3], e[4] ? String(e[4]).replace('.', ',') : '', e[5] ? String(e[5]).replace('.', ',') : ''].join(';'))];
  return { name: 'ecritures_2023.csv', kind: 'gl', expect: expectGl, buffer: Buffer.from('﻿' + lines.join('\r\n'), 'utf8') };
}
// 4. Grand livre fait main : titre fusionné, un seul montant signé, dates en nombres Excel, lignes vides et « Total janvier ».
async function handmade() {
  return { name: 'GL projet.xlsx', kind: 'gl', expect: { ...expectGl, debit: null, credit: null }, buffer: await xlsxOf(wb => {
    const s = wb.addWorksheet('GL'); s.getCell('A1').value = 'GRAND LIVRE DU PROJET 2023'; s.mergeCells('A1:F1');
    s.getRow(3).values = ['Date', 'N° compte', 'Intitulé du compte', 'Libellé', 'Pièce', 'Montant'];
    let r = 4;
    for (const e of entries) { const [dd, mm, yy] = e[0].split('/'); s.getRow(r++).values = [new Date(Date.UTC(+yy, mm - 1, +dd)), Number(e[6]), e[7], e[3], e[2], e[4] - e[5]]; if (r === 6) { s.getRow(r++).values = [null, null, null, 'Total janvier', null, 0]; r++; } }
  }) };
}

// PTBA A — comme Hydromet 2025 : code dans la description, chaque parent porte la somme de ses enfants, plusieurs bailleurs, montants en texte.
function ptbaHydromet() {
  const rows = [['Description', 'AFD(AE)', 'EU', 'GCF', 'Total général'],
    ['Component 1. Capacity building', fr(212960 + 180000), fr(349320 + 1084800), fr(162000), fr(392960 + 1434120 + 162000)],
    ['1.1 Regional Climate Centre Network', fr(212960), fr(349320), null, fr(562280)],
    ['1.1.1 Develop regional frameworks', fr(81980), fr(246560), null, fr(328540)],
    ['1.1.2 Establish the legal framework', fr(130980), fr(102760), null, fr(233740)],
    ['1.3 Improved staffing capacity', fr(180000), fr(1084800), fr(162000), fr(1426800)],
    ['1.3.1 Recruit new staff', fr(120000), null, null, fr(120000)],
    ['1.3.2 Train staff', fr(60000), fr(1084800), fr(162000), fr(1306800)],
    ['Total général', fr(392960), fr(1434120), fr(162000), fr(1989080)]];
  return { name: 'PTBA2025 Hydromet.xls', kind: 'ptba', buffer: xlsOf([['Annexe 1', [['Annexe 1 : Budget des contractualisations prévues en 2025'], [], ...rows]]]),
    expect: { categories: ['1.1 Regional Climate Centre Network', '1.3 Improved staffing capacity'], amounts: [562280, 1426800] } };
}
// PTBA B — projet ivoirien : titres fusionnés, composante et sous-composante sans montant, rubrique « B . SERVICE » = somme, « B.1 » = somme.
async function ptbaMerged() {
  return { name: 'PTBA_2023_VF-APPROUVE.xlsx', kind: 'ptba', expect: { categories: ['B.1 . ASSISTANCE TECHNIQUE', 'B.2 . ETUDES', 'C.1 . FONCTIONNEMENT'], amounts: [254800, 90000, 50000] }, buffer: await xlsxOf(wb => {
    const s = wb.addWorksheet('PTBA 2023');
    s.getCell('A1').value = 'PLAN DE TRAVAIL ET BUDGET DU PROJET ANNUEL 2023'; s.mergeCells('A1:H1');
    s.getCell('A2').value = "BUDGET (en CFA '000)"; s.mergeCells('A2:H2');
    s.getRow(4).values = ['Code', 'Activités', 'Unité', 'Quantité', 'Coût unitaire', 'Montant total', 'IDA', 'Etat'];
    const rows = [
      ['COMPOSANTE I : APPUI A LA STRUCTURATION DE LA FILIERE', 'merge'], ['SOUS-COMPOSANTE I.1 : APPUI A L’INITIATIVE CACAO', 'merge'],
      ['B', 'B . SERVICE', null, null, null, 344800, 344800, 0],
      ['B.1', 'B.1 . ASSISTANCE TECHNIQUE', null, null, null, 254800, 254800, 0],
      ['B.1.1', 'Expert filière', 'h/mois', 6, 19600, 117600, 117600, 0], ['B.1.2', 'Expert qualité', 'h/mois', 7, 19600, 137200, 137200, 0],
      ['B.2', 'B.2 . ETUDES', null, null, null, 90000, 90000, 0],
      ['B.2.1', 'Étude de base', 'forfait', 1, 90000, 90000, 90000, 0],
      ['C', 'C . CHARGES', null, null, null, 50000, 0, 50000],
      ['C.1', 'C.1 . FONCTIONNEMENT', null, null, null, 50000, 0, 50000],
      ['C.1.1', 'Carburant', 'litre', 100, 300, 30000, 0, 30000], ['C.1.2', 'Fournitures de bureau', 'lot', 4, 5000, 20000, 0, 20000],
      [null, 'TOTAL GÉNÉRAL', null, null, null, 394800, 344800, 50000]];
    let r = 5;
    for (const v of rows) { if (v[1] === 'merge') { s.getCell('A' + r).value = v[0]; s.mergeCells(`A${r}:H${r}`); } else s.getRow(r).values = v; r++; }
  }) };
}
// PTBA C — en-tête sur deux lignes (« Budget 2023 » fusionné au-dessus de T1…T4 / Total), sous-totaux SOUS leurs lignes.
async function ptbaTwoRowHeader() {
  return { name: 'Budget annuel 2023.xlsx', kind: 'ptba', expect: { categories: ['Personnel', 'Fonctionnement'], amounts: [3600, 1200] }, buffer: await xlsxOf(wb => {
    const s = wb.addWorksheet('Budget'); s.getCell('A1').value = 'BUDGET ANNUEL 2023'; s.mergeCells('A1:F1');
    s.getCell('A3').value = 'Rubrique'; s.mergeCells('A3:A4'); s.getCell('B3').value = 'Budget 2023'; s.mergeCells('B3:F3');
    s.getRow(4).values = [null, 'T1', 'T2', 'T3', 'T4', 'Total'];
    const rows = [['Salaires', 600, 600, 600, 600, 2400], ['Charges sociales', 300, 300, 300, 300, 1200], ['Sous-total Personnel', 900, 900, 900, 900, 3600],
      ['Loyer', 200, 200, 200, 200, 800], ['Eau et électricité', 100, 100, 100, 100, 400], ['Sous-total Fonctionnement', 300, 300, 300, 300, 1200], ['TOTAL', 1200, 1200, 1200, 1200, 4800]];
    rows.forEach((v, i) => { s.getRow(5 + i).values = v; });
  }) };
}
// Plan de formation : un tableau de montants SANS catégories prouvées par des sommes (ce n'est pas un budget par catégorie).
async function trainingPlan() {
  return { name: 'PLAN_DE_FORMATION_2023.xls', kind: 'other', expect: { categories: [] }, buffer: xlsOf([['Plan', [['PLAN DE FORMATION 2023'], ['Thème', 'Participants', 'Durée (jours)', 'Coût'],
    ['Gestion financière', 12, 3, 1800000], ['Passation des marchés', 8, 2, 900000], ['Suivi-évaluation', 10, 2, 1000000], ['Anglais', 4, 20, 2400000], ['Excel avancé', 6, 3, 700000]]]]) };
}

export async function corpus() {
  return [sageSections(), await odooGrouped(), csvFlat(), await handmade(), ptbaHydromet(), await ptbaMerged(), await ptbaTwoRowHeader(), await trainingPlan()];
}
