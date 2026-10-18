import JSZip from "jszip";
import { createHash } from "node:crypto";
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const paragraph = (s) =>
  '<w:p><w:r><w:t xml:space="preserve">' + esc(s) + "</w:t></w:r></w:p>";
export async function buildProgrammeDocument(m, p) {
  const lines = [
    "Programme de travail — " + m.name,
    "Version " + p.version,
    "Validé par " + p.validated_by + " le " + p.validated_at,
    "Matérialité : " + p.materiality.overall + " " + p.materiality.currency,
    "Revues requises : " +
      Object.keys(p.reviews || {})
        .filter((k) => p.reviews[k])
        .join(", "),
  ];
  for (const c of p.cycles) {
    lines.push(
      "",
      (c.cycle_code || "") + " — " + c.cycle_title,
      "Périmètre : " +
        c.status +
        " ; préparateur : " +
        (c.preparer || "non renseigné"),
      c.justification || "",
    );
    for (const x of c.procedures) {
      lines.push(
        x.code + " — " + x.title + " — " + (x.active ? "RETENU" : "NON RETENU"),
        "Responsable : " +
          (x.preparer || c.preparer || "") +
          " ; échantillon : " +
          (x.sample_size || "à déterminer selon procédure"),
        x.justification || "",
      );
      if (x.planning)
        lines.push(
          "Source : " +
            (x.planning.source_file_id || "discussion") +
            " ; version : " +
            (x.planning.source_version || ""),
          "Extrait : " + x.planning.quote,
          "Proposition : " + x.planning.rationale,
          "Revue : " + x.planning.reviewed_by + " — " + x.planning.review_note,
        );
    }
    for (const q of c.planning_questions || [])
      lines.push("Question : " + q.text, "Décision humaine : " + q.resolution);
  }
  lines.push(
    "Ce programme planifie les travaux ; il ne certifie pas leur exécution.",
  );
  const z = new JSZip();
  z.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  z.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  z.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      lines.map(paragraph).join("") +
      "<w:sectPr/></w:body></w:document>",
  );
  // Stable ZIP metadata: repeated export of the same validated version yields identical bytes.
  z.forEach((name, file) => {
    file.date = new Date("2000-01-01T00:00:00Z");
  });
  return z.generateAsync({ type: "nodebuffer" });
}
export async function exportProgramme(m, p, drive) {
  const fail = (code) => Object.assign(new Error(code), { statusCode: 409 });
  if (!m.drive_folder_id) throw fail("MISSION_FOLDER_NOT_KNOWN");
  const bytes = await buildProgrammeDocument(m, p),
    hash = createHash("sha256").update(bytes).digest("hex");
  const name =
    "Programme_" + m.id + "_v" + p.version + "_" + hash.slice(0, 16) + ".docx";
  const found = await drive.findFilesByExactName(name, m.drive_folder_id);
  if (found.length > 1) throw fail("PROGRAMME_DOCUMENT_DUPLICATE");
  const file =
    found[0] ||
    (await drive.createBinary({
      name,
      parentId: m.drive_folder_id,
      buffer: bytes,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }));
  const meta = await drive.getMeta(file.id);
  if (
    !meta ||
    meta.trashed ||
    !(meta.parents || []).includes(m.drive_folder_id)
  )
    throw fail("PROGRAMME_DOCUMENT_NOT_VERIFIED");
  const back = await drive.downloadBuffer(file.id);
  if (createHash("sha256").update(back).digest("hex") !== hash)
    throw fail("PROGRAMME_DOCUMENT_CHANGED");
  return {
    id: file.id,
    name,
    url:
      meta.webViewLink ||
      (/^local:/.test(file.id)
        ? null
        : "https://drive.google.com/file/d/" +
          encodeURIComponent(file.id) +
          "/view"),
    sha256: hash,
    verified_at: new Date().toISOString(),
    version: p.version,
  };
}
