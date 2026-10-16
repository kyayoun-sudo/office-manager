import JSZip from "jszip";
import { writeCells } from "./acceptance-workbook.js";
import ExcelJS from "exceljs";
const fold = (x) =>
  String(x || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const text = (c) => (typeof c.value === "string" ? c.value : "");
function listValues(wb, validation, cachedCells) {
  const formula = String(validation?.formulae?.[0] || "").replace(/^=/, "");
  if (/^".*"$/.test(formula))
    return formula
      .slice(1, -1)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const m =
    /^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(
      formula,
    );
  if (!m || m[3] !== m[5] || +m[6] - +m[4] > 500) return null;
  const ws = wb.getWorksheet((m[1] || m[2]).replace(/''/g, "'"));
  if (!ws) return null;
  const values = [];
  for (let row = +m[4]; row <= +m[6]; row++) {
    const c = ws.getCell(m[3] + row);
    const value = c.formula
      ? typeof c.result === "string"
        ? c.result.trim()
        : ""
      : text(c).trim();
    if (value) {
      values.push(value);
      if (c.formula) {
        const formula = String(c.formula);
        const stripped = formula
          .replace(/"(?:[^"]|"")*"/g, "")
          .replace(/\b(?:IF|TRIM|CONCAT|CONCATENATE|UPPER|LOWER)\s*\(/gi, "(")
          .replace(/\$?[A-Z]{1,3}\$?\d+/gi, "")
          .replace(/[0-9\s()+\-*\/&,=<>.;:]/g, "");
        const refs =
          formula
            .replace(/"(?:[^"]|"")*"/g, "")
            .match(/\$?[A-Z]{1,3}\$?\d+/gi) || [];
        if (
          !stripped &&
          !/[!\[]/.test(formula) &&
          refs.every((ref) => !ws.getCell(ref.replace(/\$/g, "")).formula)
        )
          cachedCells.push({ sheet: ws.name, cell: c.address });
      }
    }
  }
  return [...new Set(values)];
}
// Pricing models do not need the acceptance workbook's legend. Only discover the team
// input area from its labels + dropdowns, never the reference/rate tables or formula cells.
export async function describeQuotationInputs(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = [],
    cachedCells = [];
  for (const ws of wb.worksheets) {
    const nameLabels = [],
      roleLabels = [];
    ws.eachRow((row) =>
      row.eachCell((c) => {
        if (c.isMerged && c.master.address !== c.address) return;
        const t = fold(text(c));
        if (
          /^(collaborateur|nom du collaborateur|team member|staff name)$/.test(
            t,
          )
        )
          nameLabels.push(c);
        if (/^(role sur la mission|role de mission|mission role)$/.test(t))
          roleLabels.push(c);
      }),
    );
    if (nameLabels.length !== 1 || roleLabels.length !== 1) continue;
    const nameLabel = nameLabels[0],
      roleLabel = roleLabels[0];
    if (nameLabel.col !== roleLabel.col || roleLabel.row !== nameLabel.row + 1)
      continue;
    const protectedSheet = Boolean(ws.sheetProtection?.sheet),
      rows = [],
      slots = [];
    const allowed = (c) =>
      !c.formula &&
      (!c.isMerged || c.master.address === c.address) &&
      (!protectedSheet || c.protection?.locked === false);
    for (
      let col = nameLabel.col + 1;
      col <= Math.min(ws.columnCount, nameLabel.col + 40);
      col++
    ) {
      const nc = ws.getCell(nameLabel.row, col),
        rc = ws.getCell(roleLabel.row, col);
      const names = listValues(wb, nc.dataValidation, cachedCells),
        roles = listValues(wb, rc.dataValidation, cachedCells);
      if (!allowed(nc) || !allowed(rc) || !names?.length || !roles?.length)
        continue;
      slots.push({ name: nc.address, role: rc.address });
      rows.push({
        row: nameLabel.row,
        label: "Collaborateur — emplacement " + slots.length,
        fields: [
          { cell: nc.address, type: "list", options: names, kind: "team_name" },
        ],
      });
      rows.push({
        row: roleLabel.row,
        label: "Rôle sur la mission — emplacement " + slots.length,
        fields: [
          { cell: rc.address, type: "list", options: roles, kind: "team_role" },
        ],
      });
    }
    if (slots.length) sheets.push({ name: ws.name, rows, team_slots: slots });
  }
  return {
    sheets,
    pricing_mapping: true,
    cached_list_cells: [
      ...new Map(cachedCells.map((x) => [x.sheet + "!" + x.cell, x])).values(),
    ],
  };
}
export function teamInputWrites(structure, opportunity, current) {
  const writes = [],
    questions = [];
  if (opportunity.team?.status !== "validated")
    return {
      writes,
      questions: ["Validez l’équipe avant de renseigner les noms du budget."],
    };
  for (const sheet of structure.sheets) {
    const slots = sheet.team_slots || [],
      fields = new Map(
        sheet.rows.flatMap((r) => r.fields).map((f) => [f.cell, f]),
      );
    const members = opportunity.team.members || [];
    const roleAliases = {
      partner: ["associe", "engagement partner"],
      owner: ["associe", "engagement partner"],
      auditor: ["auditeur", "auditeur junior", "auditeur assistant"],
      senior: ["senior", "auditeur senior"],
      manager: ["manager", "engagement manager"],
      supervisor: ["superviseur", "supervisor"],
    };
    members.forEach((m, i) => {
      const slot = slots[i];
      if (!slot) {
        questions.push(
          "L’équipe comporte plus de membres que les emplacements disponibles dans le budget.",
        );
        return;
      }
      const nameField = fields.get(slot.name),
        roleField = fields.get(slot.role);
      const hits = nameField.options.filter((x) => fold(x) === fold(m.name));
      if (hits.length !== 1) {
        questions.push("Nom à confirmer dans la liste du budget : " + m.name);
        return;
      }
      const existing = current[sheet.name + "!" + slot.name];
      if (
        existing != null &&
        String(existing).trim() &&
        fold(existing) !== fold(hits[0])
      ) {
        questions.push(
          "Équipe différente dans " +
            sheet.name +
            "!" +
            slot.name +
            " : vérifiez cette cellule avant remplacement.",
        );
        return;
      }
      if (!String(existing || "").trim())
        writes.push({
          sheet: sheet.name,
          cell: slot.name,
          value: hits[0],
          source: "Équipe validée : " + m.name,
        });
      const candidates = [fold(m.role), ...(roleAliases[fold(m.role)] || [])];
      const roleHits = roleField.options.filter((x) =>
        candidates.includes(fold(x)),
      );
      const roleCurrent = current[sheet.name + "!" + slot.role];
      if (!String(roleCurrent || "").trim() && roleHits.length === 1)
        writes.push({
          sheet: sheet.name,
          cell: slot.role,
          value: roleHits[0],
          source: "Rôle dans l’équipe validée : " + m.role,
        });
      else if (!String(roleCurrent || "").trim() && roleHits.length !== 1)
        questions.push(
          "Rôle à confirmer dans la liste du budget pour " +
            m.name +
            " : " +
            m.role,
        );
    });
  }
  return { writes, questions: [...new Set(questions)] };
}

// Preserve cached names only for simple local text formulas over unchanged literal cells.
// All dependent pricing formula caches are invalidated by the existing writer.
export async function writeQuotationInputs(raw, writes, structure) {
  const result = await writeCells(raw, writes);
  if (!structure.cached_list_cells?.length) return result;
  const original = await JSZip.loadAsync(raw),
    patched = await JSZip.loadAsync(result);
  const xml = await original.file("xl/workbook.xml").async("string");
  const rels = await original
    .file("xl/_rels/workbook.xml.rels")
    .async("string");
  for (const item of structure.cached_list_cells) {
    if (writes.some((w) => w.sheet === item.sheet)) continue;
    const escaped = item.sheet.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const sheet = [
      ...xml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g),
    ].find((m) => m[1] === escaped);
    if (!sheet) continue;
    const relation =
      [
        ...rels.matchAll(
          /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g,
        ),
      ].find((m) => m[1] === sheet[2]) ||
      [
        ...rels.matchAll(
          /<Relationship\b[^>]*\bTarget="([^"]+)"[^>]*\bId="([^"]+)"/g,
        ),
      ]
        .filter((m) => m[2] === sheet[2])
        .map((m) => [m[0], m[2], m[1]])[0];
    if (!relation) continue;
    const path = "xl/" + relation[2].replace(/^\/?xl\//, "");
    const before = await original.file(path).async("string"),
      after = await patched.file(path).async("string");
    const pattern = new RegExp(
      '<c\\b[^>]*\\br="' + item.cell + '"[^>]*>[\\s\\S]*?</c>',
    );
    const cell = before.match(pattern);
    if (cell)
      patched.file(
        path,
        after.replace(pattern, () => cell[0]),
      );
  }
  return patched.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
