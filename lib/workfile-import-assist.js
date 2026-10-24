// L'agent identifie lui-même la pièce qui remplit une feuille de données (le grand livre pour D1_GL_PROJET, le budget pour D2_BUDGET)
// et PROPOSE l'import avant de l'écrire (Paul, 2026-10-25 : « il devait identifier et mettre le GL en me proposant avant ; il devait
// savoir c'est quoi le GL »).
//   - La pièce est reconnue par son CONTENU : les en-têtes de ses colonnes (débit, crédit, compte, date… = grand livre), jamais par son
//     nom ; ce que les agents ont lu de la pièce (« Grand livre ») sert à l'ordre de lecture seulement.
//   - La correspondance des colonnes est proposée par le code (même en-tête, ou même rôle de colonne et un seul candidat) ; une colonne
//     sans correspondance sûre reste vide et le dit.
//   - Rien n'est écrit sans « Oui, importe » : l'import existant (runTableImport : cases vides du modèle, formules gardées, relu) fait
//     l'écriture ; la personne ayant dit oui AVANT l'écriture, son accord ferme le reçu (comme pour les faits du SOP).
import { tableImportOptions, previewTableImport, runTableImport } from './workfile-table-import.js';
import { destinationRole, columnRole } from './client-table-understanding.js';
import { reviewWorkpaper } from './workpaper-dialogue.js';

const fold = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const KIND_LABEL = { gl: 'grand livre', budget: 'budget' };
const MAX_CANDIDATES = 6;

// Which piece fills this data sheet, read by its columns. Returns null when nothing is sure (then the agent says so).
export async function findSourceFor(org, mission, code, sheet, account, d = {}, only = null) {
  const kind = destinationRole(sheet);
  if (kind === 'unknown') return { sheet, kind, status: 'KIND_UNKNOWN' };
  const options = d.options || tableImportOptions;
  const { files = [] } = await options(org, mission, code, { sheet }, account, d);
  const hint = f => (/grand.?livre|general ledger|\bgl\b/.test(fold(f.type || f.document || '')) && kind === 'gl') || (/budget|ptba/.test(fold(f.type || f.document || '')) && kind === 'budget');
  // The person chose among several candidates: only that one (still checked by its columns).
  const pool = only ? files.filter(f => f.file_id === only) : files;
  const ordered = [...pool].sort((a, b) => Number(hint(b)) - Number(hint(a)) || Number(!!b.recommended) - Number(!!a.recommended)).slice(0, MAX_CANDIDATES);
  const found = [];
  for (const f of ordered) {
    let r; try { r = await options(org, mission, code, { sheet, source_file_id: f.file_id }, account, d); } catch { continue; }
    const sheets = (r.sheets || []).filter(s => s.role === kind);
    if (/\.csv$/i.test(f.name || '') && !(r.sheets || []).length) found.push({ file: f, source_sheet: null });
    else if (sheets.length === 1) found.push({ file: f, source_sheet: sheets[0].name });
    else if (sheets.length > 1) found.push({ file: f, source_sheet: null, ambiguous: sheets.map(s => s.name) });
  }
  const sure = found.filter(x => !x.ambiguous);
  if (sure.length !== 1) return { sheet, kind, status: sure.length ? 'SEVERAL_SOURCES' : (found.length ? 'SOURCE_SHEET_TO_CHOOSE' : 'NO_SOURCE_FOUND'), candidates: found.map(x => ({ file_id: x.file.file_id, name: x.file.name, sheets: x.ambiguous || [x.source_sheet] })) };
  return { sheet, kind, status: 'FOUND', source: sure[0] };
}

// The proposal shown to the person: source, columns, rows, totals; nothing written.
export async function proposeImport(org, mission, code, body = {}, account, d = {}) {
  const sheet = String(body.sheet || '');
  const step = Number(body.step) || 1;
  const found = await findSourceFor(org, mission, code, sheet, account, d, body.source_file_id ? String(body.source_file_id) : null);
  if (found.status !== 'FOUND') return { ...found, label: KIND_LABEL[found.kind] || null };
  const src = found.source;
  const preview = await (d.preview || previewTableImport)(org, mission, code, { sheet, step, source_file_id: src.file.file_id, source_sheet: src.source_sheet }, account, d);
  const mapping = preview.columns.filter(c => c.suggested_source != null).map(c => ({ column: c.column, label: c.label, source: c.suggested_source, source_label: preview.source_headers[c.suggested_source] }));
  // A single « Montant » column in the model, a grand livre with Débit and Crédit: the amount is Débit − Crédit (said, never hidden).
  const deb = preview.source_headers.findIndex(h => columnRole(h) === 'debit'), cre = preview.source_headers.findIndex(h => columnRole(h) === 'credit');
  for (const c of preview.columns) if (c.suggested_source == null && columnRole(c.label) === 'amount' && deb >= 0 && cre >= 0 && !mapping.some(m => m.column === c.column))
    mapping.push({ column: c.column, label: c.label, source: deb, minus: cre, source_label: preview.source_headers[deb] + ' − ' + preview.source_headers[cre] });
  mapping.sort((a, b) => a.column - b.column);
  return { sheet, kind: found.kind, label: KIND_LABEL[found.kind], status: mapping.length ? 'READY' : 'NO_COLUMN_MATCH',
    source: { file_id: src.file.file_id, name: src.file.name, sheet: src.source_sheet }, step, revision: preview.revision, rows: preview.rows,
    totals: preview.totals, gl_summary: preview.gl_summary, start_row: preview.start_row, mapping,
    unmatched: preview.columns.filter(c => !mapping.some(m => m.column === c.column)).map(c => c.label) };
}

// « Oui, importe » : the same proposal recomputed (revision checked), written by the existing import, then the receipt closed by
// the approval the person gave before the write.
export async function acceptImport(org, mission, code, body = {}, account, d = {}) {
  const p = await proposeImport(org, mission, code, body, account, d);
  if (p.status !== 'READY') throw Object.assign(new Error(p.status), { statusCode: 409 });
  if (body.revision && body.revision !== p.revision) throw Object.assign(new Error('WORK_CHANGED_PREPARE_AGAIN'), { statusCode: 409 });
  const r = await (d.run || runTableImport)(org, mission, code, { sheet: p.sheet, step: p.step, source_file_id: p.source.file_id, source_sheet: p.source.sheet, revision: p.revision,
    mapping: p.mapping.map(m => ({ column: m.column, source: m.source, ...(m.minus != null ? { minus: m.minus } : {}) })) }, account, d);
  let confirmed = false;
  if (r.verified && r.plan_id) {
    try { await (d.review || reviewWorkpaper)(org, mission, code, { plan_id: r.plan_id, decision: 'confirm', note: 'Import du ' + p.label + ' approuvé avant écriture : ' + p.source.name }, account, d); confirmed = true; } catch { confirmed = false; }
  }
  return { ...r, confirmed, source: p.source, label: p.label };
}
