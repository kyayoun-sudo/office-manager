import ExcelJS from 'exceljs';

// Measuring the agent on a real, finished mission (audit 2026-10-30: the filling of working files is tested on
// invented pieces and a simulated AI only). The auditor's own working file is the reference; the one the
// Enhanced Auditor filled is the candidate. Cell by cell, on the values people type (formula cells are the file's
// own work and are left out): same, different, missing (the auditor filled it, the agent did not), extra (the
// agent filled a cell the auditor left empty). Nothing is written anywhere.

const isFormula = v => v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v);
const NUMBER_TEXT = /^[-+(]?\s*\d[\d\s.,']*\)?\s*$/;

function plain(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return v.result ?? null;
    if ('error' in v) return null;
  }
  return v;
}

// Same meaning, whatever the presentation: « 1 234,50 », « 1234.5 » and 1234.5 are one amount; dates compared by day.
export function normalise(v) {
  v = plain(v);
  if (v == null) return null;
  if (v instanceof Date) return { kind: 'date', value: v.toISOString().slice(0, 10) };
  if (typeof v === 'number') return Number.isFinite(v) ? { kind: 'number', value: v } : null;
  if (typeof v === 'boolean') return { kind: 'text', value: v ? 'oui' : 'non' };
  const text = String(v).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (NUMBER_TEXT.test(text)) {
    const negative = /^\(.*\)$/.test(text) || text.startsWith('-');
    let digits = text.replace(/[()+\-\s']/g, '');
    if (/,\d{1,2}$/.test(digits)) digits = digits.replace(/\./g, '').replace(',', '.');
    else digits = digits.replace(/,/g, '');
    const n = Number(digits);
    if (Number.isFinite(n)) return { kind: 'number', value: negative ? -n : n };
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/) || text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (iso) return { kind: 'date', value: iso[1].length === 4 ? `${iso[1]}-${iso[2]}-${iso[3]}` : `${iso[3]}-${iso[2]}-${iso[1]}` };
  return { kind: 'text', value: text.toLowerCase() };
}

function sameValue(a, b, tolerance) {
  if (a.kind === 'number' && b.kind === 'number') return Math.abs(a.value - b.value) <= tolerance;
  return a.kind === b.kind && a.value === b.value;
}

function typedCells(ws) {
  const out = new Map();
  ws.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
    if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
    if (isFormula(cell.value)) { out.set(cell.address, { formula: true }); return; }
    const n = normalise(cell.value);
    if (n) out.set(cell.address, { value: n, shown: String(plain(cell.value) instanceof Date ? n.value : plain(cell.value)).slice(0, 80) });
  }));
  return out;
}

export async function compareWorkbooks(referenceBuffer, candidateBuffer, { sheets = null, tolerance = 0.5, maxListed = 300 } = {}) {
  const ref = new ExcelJS.Workbook(), cand = new ExcelJS.Workbook();
  await ref.xlsx.load(referenceBuffer); await cand.xlsx.load(candidateBuffer);
  const wanted = sheets && sheets.length ? sheets : ref.worksheets.map(w => w.name);
  const report = { sheets: [], totals: { same: 0, different: 0, missing: 0, extra: 0, formulas_left_out: 0 }, differences: [] };
  for (const name of wanted) {
    const r = ref.getWorksheet(name), c = cand.getWorksheet(name);
    if (!r) { report.sheets.push({ sheet: name, status: 'absent_from_reference' }); continue; }
    if (!c) { report.sheets.push({ sheet: name, status: 'absent_from_candidate' }); continue; }
    const rc = typedCells(r), cc = typedCells(c);
    const s = { sheet: name, status: 'compared', same: 0, different: 0, missing: 0, extra: 0, formulas_left_out: 0 };
    for (const address of new Set([...rc.keys(), ...cc.keys()])) {
      const a = rc.get(address), b = cc.get(address);
      if (a?.formula || b?.formula) { s.formulas_left_out++; continue; }
      let kind;
      if (a && b) kind = sameValue(a.value, b.value, tolerance) ? 'same' : 'different';
      else kind = a ? 'missing' : 'extra';
      s[kind]++;
      if (kind !== 'same' && report.differences.length < maxListed) report.differences.push({ sheet: name, cell: address, kind, reference: a?.shown ?? null, candidate: b?.shown ?? null });
    }
    const expected = s.same + s.different + s.missing;
    s.accuracy = expected ? Math.round((s.same / expected) * 1000) / 10 : null;
    for (const k of ['same', 'different', 'missing', 'extra', 'formulas_left_out']) report.totals[k] += s[k];
    report.sheets.push(s);
  }
  const t = report.totals, expected = t.same + t.different + t.missing;
  t.accuracy = expected ? Math.round((t.same / expected) * 1000) / 10 : null;
  return report;
}

export function reportMarkdown(report, { reference = 'référence', candidate = 'candidat' } = {}) {
  const pct = v => (v == null ? '—' : v + ' %');
  const lines = [
    '# Comparaison de working files', '',
    `Référence (rempli par l'auditeur) : ${reference}`, `Candidat (rempli par l'agent) : ${candidate}`, '',
    `**Justesse : ${pct(report.totals.accuracy)}** des cases que l'auditeur a remplies (formules du fichier non comptées).`, '',
    '| Feuille | Justes | Différentes | Oubliées par l\'agent | Ajoutées par l\'agent | Justesse |', '|---|---|---|---|---|---|'
  ];
  for (const s of report.sheets) {
    if (s.status !== 'compared') { lines.push(`| ${s.sheet} | — | — | — | — | ${s.status === 'absent_from_candidate' ? 'absente du candidat' : 'absente de la référence'} |`); continue; }
    lines.push(`| ${s.sheet} | ${s.same} | ${s.different} | ${s.missing} | ${s.extra} | ${pct(s.accuracy)} |`);
  }
  const t = report.totals;
  lines.push(`| **Total** | **${t.same}** | **${t.different}** | **${t.missing}** | **${t.extra}** | **${pct(t.accuracy)}** |`, '');
  if (report.differences.length) {
    const label = { different: 'différente', missing: 'oubliée', extra: 'ajoutée' };
    lines.push('## Cases à regarder', '', '| Feuille | Case | Écart | Auditeur | Agent |', '|---|---|---|---|---|');
    for (const d of report.differences) lines.push(`| ${d.sheet} | ${d.cell} | ${label[d.kind]} | ${d.reference ?? ''} | ${d.candidate ?? ''} |`.replace(/\n/g, ' '));
  }
  return lines.join('\n') + '\n';
}
