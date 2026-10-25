// A working file shaped like NL-T01 (D1 GL, D2 budget, PRJ-03 recomputation, PRJ-11 execution) — built here, nothing of the real file.
import ExcelJS from 'exceljs';
export const Y = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7CC' } }, DK = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
export function head(ws, row, titles) { titles.forEach((h, i) => { const c = ws.getCell(row, i + 1); c.value = h; c.fill = DK; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; }); }

// A working file shaped like NL-T01 (D2 budget, D1 GL, PRJ-03 recomputation, PRJ-11 execution) — built here, nothing of the real file.
export async function workingFile() {
  const w = new ExcelJS.Workbook();
  const d1 = w.addWorksheet('D1_GL_PROJET'); d1.getCell('A1').value = 'D1 — Grand livre analytique du projet';
  head(d1, 10, ['ID ligne', 'Date', 'Libellé', 'Montant', 'Catégorie budgétaire']);
  for (let r = 11; r <= 30; r++) for (let c = 1; c <= 5; c++) d1.getCell(r, c).fill = Y;
  [['L1', '2024-02-01', 'Salaire janvier', 300, 'Salaires'], ['L2', '2024-03-01', 'Loyer', 100, 'Loyers']].forEach((v, i) => v.forEach((x, j) => { d1.getCell(11 + i, j + 1).value = x; }));
  const d2 = w.addWorksheet('D2_BUDGET'); d2.getCell('A1').value = 'D2 — Budget approuvé par catégorie';
  d2.getCell('A2').value = 'Budget de la convention : initial, amendements / réallocations, final approuvé (document du bailleur).';
  d2.getCell('D5').value = { formula: 'SUM(D2_BUDGET!$D$11:$D$30)' };
  head(d2, 10, ['Catégorie budgétaire', 'Budget initial', 'Amendements / réallocations (net)', 'Budget final approuvé (document)', 'Engagements au 31/12', 'Élig PRJ-03', 'N° PRJ-03']);
  for (let r = 11; r <= 30; r++) { for (let c = 1; c <= 5; c++) d2.getCell(r, c).fill = Y; d2.getCell(r, 6).value = { formula: `IF(AND(LEN(A${r})>0),1,0)` }; d2.getCell(r, 7).value = { formula: `IF(F${r}=1,COUNTIF(F$11:F${r},1),"")` }; }
  const p3 = w.addWorksheet('PRJ-03'); p3.getCell('A1').value = 'PRJ-03 — Budget initial, amendements et réallocations';
  p3.getCell('A3').value = 'Comment faire : budget initial + amendements = budget final (recalcul).';
  head(p3, 10, ['N°', '_ligne', 'Catégorie budgétaire', 'Budget initial', 'Amendements', 'Budget final recalculé', 'Budget final approuvé (document)', 'Écart', 'Résultat']);
  for (let r = 11; r <= 15; r++) {
    p3.getCell(r, 1).value = r - 10;
    p3.getCell(r, 2).value = { formula: `IFERROR(MATCH(A${r},D2_BUDGET!$G$11:$G$30,0),"")` };
    p3.getCell(r, 3).value = { formula: `IF(B${r}="","",INDEX(D2_BUDGET!$A$11:$A$30,B${r})&"")` };
    p3.getCell(r, 4).value = { formula: `IF(B${r}="","",INDEX(D2_BUDGET!$B$11:$B$30,B${r}))` };
    p3.getCell(r, 5).value = { formula: `IF(B${r}="","",INDEX(D2_BUDGET!$C$11:$C$30,B${r}))` };
    p3.getCell(r, 6).value = { formula: `IF(C${r}="","",N(D${r})+N(E${r}))` };
    p3.getCell(r, 7).value = { formula: `IF(B${r}="","",INDEX(D2_BUDGET!$D$11:$D$30,B${r}))` };
    p3.getCell(r, 8).value = { formula: `IF(OR(C${r}="",G${r}=""),"",F${r}-G${r})` };
    p3.getCell(r, 9).value = { formula: `IF(C${r}="","",IF(ABS(N(H${r}))>0,"EXCEPTION","PASS"))` };
  }
  const p11 = w.addWorksheet('PRJ-11'); p11.getCell('A1').value = 'PRJ-11 — Tableau d’exécution budgétaire';
  head(p11, 10, ['N°', '_ligne', 'Catégorie budgétaire', 'Budget final approuvé', 'Réalisé selon GL analytique', 'Résultat']);
  for (let r = 11; r <= 15; r++) {
    p11.getCell(r, 1).value = r - 10;
    p11.getCell(r, 2).value = { formula: `IFERROR(MATCH(A${r},D2_BUDGET!$G$11:$G$30,0),"")` };
    p11.getCell(r, 3).value = { formula: `IF(B${r}="","",INDEX(D2_BUDGET!$A$11:$A$30,B${r})&"")` };
    p11.getCell(r, 4).value = { formula: `IF(B${r}="","",INDEX(D2_BUDGET!$D$11:$D$30,B${r}))` };
    p11.getCell(r, 5).value = { formula: `IF(C${r}="","",SUMIFS(D1_GL_PROJET!$D$11:$D$30,D1_GL_PROJET!$E$11:$E$30,C${r}))` };
    p11.getCell(r, 6).value = { formula: `IF(C${r}="","",IF(E${r}>N(D${r}),"EXCEPTION","PASS"))` };
  }
  const d3 = w.addWorksheet('D3_FONDS_RECUS'); d3.getCell('A1').value = 'D3 — Fonds reçus (bailleurs, contrepartie, autres)';
  d3.getCell('A2').value = 'Reporter les crédits des relevés bancaires et les avis de crédit.';
  head(d3, 10, ['ID ligne', 'Date', 'Pièce / référence', 'Bailleur / contributeur', 'Montant', 'Élig PRJ-07']);
  for (let r = 11; r <= 30; r++) { for (let c = 1; c <= 5; c++) d3.getCell(r, c).fill = Y; d3.getCell(r, 6).value = { formula: `IF(AND(LEN(A${r})>0),1,0)` }; }
  const p7 = w.addWorksheet('PRJ-07'); p7.getCell('A1').value = 'PRJ-07 — Fonds reçus';
  head(p7, 10, ['N°', 'Montant reçu']); p7.getCell('B11').value = { formula: 'SUM(D3_FONDS_RECUS!$E$11:$E$30)' };
  return w;
}

