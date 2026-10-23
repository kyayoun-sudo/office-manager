// Deterministic understanding layer for audit Working Files.
// It does not execute audit work and does not write to Excel. Its only job is to understand
// the workbook as a whole before Enhanced Auditor starts an individual procedure.

const fold = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const cut = (v, n = 500) => String(v ?? '').trim().slice(0, n);

export function cellText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (value.result != null) return cellText(value.result);
    if (value.text != null) return cellText(value.text);
    if (value.richText) return value.richText.map(x => x?.text || '').join('');
    if (value.hyperlink && value.text) return cellText(value.text);
  }
  return '';
}

function rowValues(ws, rowNumber, maxCols = 30) {
  const row = ws.getRow(rowNumber);
  const out = [];
  const last = Math.min(Math.max(row.cellCount || 0, 1), maxCols);
  for (let c = 1; c <= last; c++) out.push(cut(cellText(row.getCell(c).value), 300));
  return out;
}

function nonEmpty(values) { return values.filter(x => String(x || '').trim()); }
function rowText(values) { return nonEmpty(values).join(' | '); }
function testCode(text) {
  const m = String(text || '').toUpperCase().match(/\b([A-Z]{2,6})[-_ ](\d{1,2})\b/);
  return m ? `${m[1]}-${String(Number(m[2])).padStart(2, '0')}` : null;
}
function pbcIds(text) {
  return [...new Set((String(text || '').toUpperCase().match(/\bPBC-[A-Z0-9-]+\b/g) || []))];
}

export function classifySheet(name) {
  const n = fold(name);
  if (/^(00[_ -])?guide\b|mode d.?emploi/.test(n)) return 'guide';
  if (/^(01[_ -])?(synthese|summary)\b|audit[_ -]?meta/.test(n)) return 'synthesis';
  if (/^(02[_ -])?(programme|program|pga)\b/.test(n)) return 'programme';
  if (/^(03[_ -])?(risques?|risks?)\b/.test(n)) return 'risks';
  if (/\bpbc\b|pieces? a demander|documents? requis/.test(n)) return 'pbc';
  if (/rapproch|reconcil/.test(n)) return 'reconciliation';
  if (/^d\d+[_ -]/.test(n)) return 'population';
  if (/anomal|exception/.test(n)) return 'anomalies';
  if (/revue|review/.test(n)) return 'review';
  if (/signoff|signature/.test(n)) return 'signoff';
  if (/lead/.test(n)) return 'lead';
  if (testCode(name)) return 'test';
  return 'other';
}

function usedRange(ws) {
  return {
    rows: Number(ws.actualRowCount || ws.rowCount || 0),
    columns: Number(ws.actualColumnCount || ws.columnCount || 0)
  };
}

function firstRows(ws, limit = 40) {
  const rows = [];
  const max = Math.min(ws.actualRowCount || ws.rowCount || 0, limit);
  for (let r = 1; r <= max; r++) {
    const values = rowValues(ws, r, 20);
    if (nonEmpty(values).length) rows.push({ row: r, values: nonEmpty(values).slice(0, 12), text: cut(rowText(values), 1200) });
  }
  return rows;
}

function keyValues(ws, limit = 120) {
  const out = [];
  const max = Math.min(ws.actualRowCount || ws.rowCount || 0, limit);
  const seen = new Set();
  for (let r = 1; r <= max; r++) {
    const values = rowValues(ws, r, 12);
    for (let c = 0; c < values.length - 1; c++) {
      const key = cut(values[c], 100), value = cut(values.slice(c + 1).find(Boolean), 300);
      if (!key || !value || key === value || key.length > 100) continue;
      const fk = fold(key);
      if (!/(client|exercice|periode|projet|bailleur|material|seuil|prepar|revu|manager|partner|senior|objectif|population|selection|version|date)/.test(fk)) continue;
      const signature = fk + '|' + fold(value);
      if (seen.has(signature)) continue;
      seen.add(signature);
      out.push({ label: key, value, row: r });
      if (out.length >= 50) return out;
    }
  }
  return out;
}

function detectHeader(ws) {
  let best = null;
  const max = Math.min(ws.actualRowCount || ws.rowCount || 0, 25);
  for (let r = 1; r <= max; r++) {
    const values = rowValues(ws, r, 40);
    const filled = nonEmpty(values);
    const score = filled.length + filled.filter(v => /date|compte|montant|debit|credit|ref|piece|projet|bailleur|budget|tiers|fournisseur/i.test(v)).length * 2;
    if (filled.length >= 2 && (!best || score > best.score)) best = { row: r, score, headers: values.map(cut).filter(Boolean).slice(0, 40) };
  }
  return best;
}

function extractProgramme(ws) {
  if (!ws) return [];
  const out = [], seen = new Set();
  const max = Math.min(ws.actualRowCount || ws.rowCount || 0, 500);
  for (let r = 1; r <= max; r++) {
    const values = rowValues(ws, r, 24), text = rowText(values), code = testCode(text);
    if (!code || seen.has(code + ':' + r)) continue;
    const f = fold(text);
    const explicitlyOff = /non applicable|not applicable|inactive|desactive|disabled|n\/a/.test(f);
    const explicitlyOn = /\bcore\b|obligatoire|\bactive\b|\bactif\b|\boui\b|\byes\b/.test(f);
    const riskDependent = /risk[- ]?dependent|dependant du risque|lie au risque/.test(f);
    const level = /\bpartner\b/.test(f) ? 'Partner' : /\bmanager\b/.test(f) ? 'Manager' : /\bsenior\b/.test(f) ? 'Senior' : /\bjunior\b/.test(f) ? 'Junior' : null;
    const title = values.find(v => v && !testCode(v) && !/^(core|oui|yes|non|no|active|inactif)$/i.test(v)) || null;
    out.push({ code, row: r, title: cut(title, 240), active: explicitlyOff ? false : explicitlyOn ? true : null, risk_dependent: riskDependent, level, text: cut(text, 1000) });
    seen.add(code + ':' + r);
  }
  return out;
}

function extractRisks(ws) {
  if (!ws) return [];
  const out = [];
  const max = Math.min(ws.actualRowCount || ws.rowCount || 0, 400);
  for (let r = 1; r <= max; r++) {
    const values = rowValues(ws, r, 20), text = rowText(values), f = fold(text);
    const riskCode = (String(text).match(/\b(?:RISK|RISQUE|R)[-_ ]?\d{1,4}\b/i) || [])[0] || null;
    if (!riskCode && !/\brisque\b|\brisk\b/.test(f)) continue;
    out.push({ row: r, code: riskCode ? riskCode.toUpperCase().replace(/[_ ]/g, '-') : null, text: cut(text, 1000), procedures: [...new Set((String(text).toUpperCase().match(/\b[A-Z]{2,6}-\d{1,2}\b/g) || []))] });
    if (out.length >= 120) break;
  }
  return out;
}

function extractPbc(ws) {
  if (!ws) return [];
  const out = [];
  const max = Math.min(ws.actualRowCount || ws.rowCount || 0, 500);
  for (let r = 1; r <= max; r++) {
    const values = rowValues(ws, r, 24), text = rowText(values), ids = pbcIds(text), f = fold(text);
    if (!ids.length && !/(document|piece|preuve|recu|received|attente|pending|manquant|missing)/.test(f)) continue;
    const status = /recu|received|disponible|available/.test(f) ? 'received' : /attente|pending|manquant|missing|non recu/.test(f) ? 'missing_or_pending' : null;
    out.push({ row: r, ids, status, text: cut(text, 900) });
    if (out.length >= 180) break;
  }
  return out;
}

function testSheet(ws, allPopulationNames) {
  const code = testCode(ws.name);
  const rows = firstRows(ws, 140);
  const text = rows.map(r => r.text).join('\n');
  const f = fold(text);
  const labels = [];
  for (const r of rows) {
    if (/objectif|population|selection|comprehension|comment faire|ce qu.il faut demander|instruction|risque|assertion/i.test(r.text)) labels.push({ row: r.row, text: cut(r.text, 500) });
    if (labels.length >= 30) break;
  }
  const dependencies = allPopulationNames.filter(name => fold(text).includes(fold(name)));
  return {
    code,
    sheet: ws.name,
    objective_hint: (rows.find(r => /objectif/i.test(r.text)) || {}).text || null,
    population_hint: (rows.find(r => /population/i.test(r.text)) || {}).text || null,
    required_evidence: pbcIds(text),
    population_dependencies: dependencies,
    instructions: labels,
    mentions_pass_exception: /pass|exception/.test(f),
    range: usedRange(ws)
  };
}

export function understandWorkingFile(workbook, options = {}) {
  const sheets = workbook.worksheets || [];
  const inventory = sheets.map((ws, index) => ({ index, name: ws.name, role: classifySheet(ws.name), ...usedRange(ws) }));
  const byRole = role => sheets.filter(ws => classifySheet(ws.name) === role);
  const first = role => byRole(role)[0] || null;
  const guide = first('guide'), synthesis = first('synthesis'), programmeSheet = first('programme'), risksSheet = first('risks'), pbcSheet = first('pbc');
  const populationSheets = byRole('population');
  const reconciliationSheets = byRole('reconciliation');
  const testSheets = byRole('test');
  const populationNames = populationSheets.map(w => w.name);

  const populations = populationSheets.map(ws => {
    const header = detectHeader(ws);
    const range = usedRange(ws);
    return {
      sheet: ws.name,
      rows: range.rows,
      columns: range.columns,
      header_row: header?.row || null,
      headers: header?.headers || [],
      likely_ledger: (header?.headers || []).some(h => /compte|account/i.test(h)) && (header?.headers || []).some(h => /debit|credit|montant|amount/i.test(h)),
      likely_budget: /budget/i.test(ws.name) || (header?.headers || []).some(h => /budget/i.test(h))
    };
  });

  const programme = extractProgramme(programmeSheet);
  const tests = testSheets.map(ws => testSheet(ws, populationNames));
  const procedureCode = String(options.procedureCode || '').toUpperCase();
  const activeTest = tests.find(t => t.code === procedureCode) || null;
  const programmeEntry = programme.find(p => p.code === procedureCode) || null;
  const sources = (options.sources || []).map(s => ({ file_id: s.file_id, name: s.name, document: s.document, status: s.status }));

  const readOrder = [guide, synthesis, programmeSheet, risksSheet, pbcSheet, ...populationSheets, ...reconciliationSheets]
    .filter(Boolean).map(ws => ws.name);
  const missingFoundation = [];
  if (!guide) missingFoundation.push('GUIDE');
  if (!programmeSheet) missingFoundation.push('PROGRAMME/PGA');

  return {
    version: 1,
    principle: 'PGA/programme -> SOP -> Working File -> mission evidence -> execution -> human review',
    workbook: { sheet_count: sheets.length, inventory },
    read_order: readOrder,
    foundation: {
      guide: guide ? { sheet: guide.name, preview: firstRows(guide, 45), rules_detected: firstRows(guide, 120).filter(r => /ordre|regle|preuve|pass|exception|jaune|gris|bleu|sign|revue|population|rapproch/i.test(r.text)).slice(0, 30) } : null,
      synthesis: synthesis ? { sheet: synthesis.name, context: keyValues(synthesis, 180) } : null,
      programme: programmeSheet ? { sheet: programmeSheet.name, procedures: programme } : null,
      risks: risksSheet ? { sheet: risksSheet.name, items: extractRisks(risksSheet) } : null,
      pbc: pbcSheet ? { sheet: pbcSheet.name, items: extractPbc(pbcSheet) } : null
    },
    populations,
    reconciliations: reconciliationSheets.map(ws => ({ sheet: ws.name, range: usedRange(ws), preview: firstRows(ws, 40) })),
    tests,
    active_procedure: {
      code: procedureCode || null,
      programme: programmeEntry,
      working_file: activeTest,
      sop_steps: (options.sopSteps || []).map(s => ({ n: s.n, text: cut(s.text || s, 600), source: s.source || 'sop' }))
    },
    mission_sources: sources,
    missing_foundation: missingFoundation,
    ready_to_plan: missingFoundation.length === 0,
    start_message: guide
      ? `Lire d'abord ${guide.name}, puis le programme de travail${programmeSheet ? ` (${programmeSheet.name})` : ''}, les risques/PBC et les populations avant d'exécuter ${procedureCode || 'une procédure'}.`
      : 'Le guide du Working File n’a pas été identifié ; ne pas exécuter automatiquement avant clarification.'
  };
}
