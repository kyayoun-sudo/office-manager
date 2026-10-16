import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import {
  makeFixture,
  scanFixture,
  ORGANISATIONS,
} from "../lib/audit-sandbox-fixtures.js";
const out = path.resolve(process.argv[2] || "/tmp/office-audit-sandbox"),
  seed = Number(process.argv[3] || 1);
await mkdir(out, { recursive: true });
const zip = new JSZip(),
  report = [];
for (const org of ORGANISATIONS) {
  const f = makeFixture(org.id, seed),
    root = "ORGANISATIONS/" + org.id + "/";
  const wb = new ExcelJS.Workbook(),
    sheet = wb.addWorksheet("GL");
  const cols = [
    "line_id",
    "id",
    "date",
    "account",
    "vendor",
    "invoice",
    "debit",
    "credit",
    "evidence",
  ];
  sheet.addRow(cols);
  for (const row of f.gl) sheet.addRow(cols.map((c) => row[c]));
  zip.file(root + org.pbc + "/Grand_livre.xlsx", await wb.xlsx.writeBuffer());
  const csv = [
    cols.join(","),
    ...f.gl.map((r) =>
      cols.map((c) => '"' + String(r[c]).replaceAll('"', '""') + '"').join(","),
    ),
  ].join("\n");
  zip.file(root + org.pbc + "/Grand_livre.csv", csv);
  const balances = new Map();
  for (const r of f.gl)
    balances.set(
      r.account,
      (balances.get(r.account) || 0) + r.debit - r.credit,
    );
  zip.file(
    root + org.pbc + "/Balance.csv",
    "account,balance\n" + [...balances].map((r) => r.join(",")).join("\n"),
  );
  const wp = new ExcelJS.Workbook();
  wp.addWorksheet("Tests").addRow([
    "Écriture",
    "Risque",
    "Assertion",
    "Procédure",
    "Source",
    "Résultat proposé",
    "Revue humaine",
  ]);
  zip.file(root + org.wp + "/WP_Achats.xlsx", await wp.xlsx.writeBuffer());
  for (const file of f.files)
    if (file.text) zip.file(root + file.path, file.text);
  zip.file(
    "EVALUATEUR_NE_PAS_DONNER_A_L_AGENT/" + org.id + ".json",
    JSON.stringify(f.truth, null, 2),
  );
  const scan = scanFixture(f);
  report.push({
    organisation: org.id,
    journals: f.rows.length,
    lines: f.gl.length,
    debit: scan.debit,
    credit: scan.credit,
    balanced: scan.balanced,
    planted_findings: f.truth.length,
    reference_checks: scan.candidates.length,
    agent_run: false,
  });
}
zip.file(
  "README.txt",
  "DONNÉES ENTIÈREMENT FICTIVES — ne pas importer dans une vraie mission. Cinq systèmes documentaires virtuels indépendants, 6000 opérations/12000 lignes par organisation, sept points ciblés chacune. Les corrigés sont réservés à l’évaluateur. Les contrôles de référence ne constituent pas des performances IA. Les secteurs et les plans comptables sont simplifiés pour les exercices.",
);
await writeFile(
  path.join(out, "audit-sandbox-five-organisations.zip"),
  await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  }),
);
await writeFile(
  path.join(out, "reference-controls.json"),
  JSON.stringify(
    { seed, organisations: report, agent_results: "NOT_RUN" },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ out, journals: 30000, lines: 60000, reference: report }),
);
