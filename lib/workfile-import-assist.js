// L'agent identifie lui-même les pièces qui remplissent une feuille de données (le grand livre pour D1_GL_PROJET, le budget pour
// D2_BUDGET) et PROPOSE l'import avant de l'écrire.
//   Paul, 2026-10-25 : « il devait identifier et mettre le GL en me proposant avant ; il devait savoir c'est quoi le GL » ; puis « il n'a
//   pas compris que c'était sur 2 ans, donc 2 GL ; il en a choisi un seul, il ne m'a pas donné le choix ; c'est pour ça qu'on a pris
//   l'IA en plus du code : comprendre facilement et mieux ».
//   - Toutes les pièces candidates sont regardées (pas la première trouvée) : reconnues par leurs COLONNES (débit, crédit, compte,
//     date… = grand livre), jamais par leur nom. Les feuilles que le code ne reconnaît pas sont montrées à l'IA (en-têtes + 3 lignes),
//     qui dit ce que c'est (grand livre général, auxiliaire, balance, budget…) et la période ; son avis est marqué « selon l'IA ».
//   - Pour chaque pièce : les années couvertes (lues dans la colonne des dates), les lignes, l'équilibre débit / crédit, les lignes de
//     total mises de côté. Les pièces dont les années sont celles de la mission sont cochées ; la personne coche ou décoche.
//   - Les colonnes : d'abord le code (même en-tête, même rôle), « Montant » = Débit − Crédit ; l'IA propose les colonnes restantes,
//     vérifiées (colonne du modèle réelle, colonne de la pièce réelle) et marquées. Une colonne sans correspondance reste vide.
//   - Rien n'est écrit sans « Oui, importe » : chaque pièce cochée est importée par l'import existant (cases vides du modèle, formules
//     gardées, relu), À LA SUITE de la précédente ; l'accord donné avant l'écriture ferme le reçu de chacune.
import { rest } from './supabase.js';
import { tableImportOptions, previewTableImport, runTableImport } from './workfile-table-import.js';
import { destinationRole, columnRole, tableRole } from './client-table-understanding.js';
import { reviewWorkpaper } from './workpaper-dialogue.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';

const fail = code => Object.assign(new Error(code), { statusCode: 409 });
const q = encodeURIComponent;
const KIND_LABEL = { gl: 'grand livre', budget: 'budget' };
const MAX_FILES = 20;

const UNDERSTAND = `Tu es l'Enhanced Auditor d'un cabinet d'audit. On doit remplir la feuille de données « {SHEET} » d'un working file ({KIND}).
Pour chaque feuille de pièce ci-dessous (nom du fichier, nom de la feuille, en-têtes, 3 premières lignes), dis honnêtement ce que c'est, et
si elle peut remplir cette feuille. Puis, pour chaque pièce qui convient, rattache les colonnes du modèle encore SANS correspondance aux
colonnes de la pièce (par leur sens, pas seulement par leur nom). Ne rattache que si tu es sûr ; sinon laisse vide. N'invente rien.
JSON STRICT : {"sources":[{"id":"","fits":true,"what":"grand livre général|grand livre auxiliaire|balance|journal|budget|autre","period":"","why":""}],
"mappings":[{"id":"","column":0,"source":0,"why":""}]}`;

function missionYears(label) {
  const ys = (String(label || '').match(/\b(19|20)\d{2}\b/g) || []).map(Number);
  if (ys.length === 2 && ys[1] - ys[0] > 1 && ys[1] - ys[0] < 6) for (let y = ys[0] + 1; y < ys[1]; y++) ys.push(y);
  return [...new Set(ys)].sort();
}

function codeMapping(preview) {
  const mapping = preview.columns.filter(c => c.suggested_source != null).map(c => ({ column: c.column, label: c.label, source: c.suggested_source, source_label: preview.source_headers[c.suggested_source], by: 'code' }));
  // A single « Montant » column in the model, a grand livre with Débit and Crédit: the amount is Débit − Crédit (said, never hidden).
  const deb = preview.source_headers.findIndex(h => columnRole(h) === 'debit'), cre = preview.source_headers.findIndex(h => columnRole(h) === 'credit');
  for (const c of preview.columns) if (c.suggested_source == null && columnRole(c.label) === 'amount' && deb >= 0 && cre >= 0)
    mapping.push({ column: c.column, label: c.label, source: deb, minus: cre, source_label: preview.source_headers[deb] + ' − ' + preview.source_headers[cre], by: 'code' });
  return mapping;
}

// Every candidate piece for this data sheet, with what the code (and the AI, when it answers) understood of it. Nothing written.
export async function proposeImport(org, mission, code, body = {}, account, d = {}) {
  const sheet = String(body.sheet || ''), step = Number(body.step) || 1, kind = destinationRole(sheet);
  if (kind === 'unknown') return { sheet, kind, status: 'KIND_UNKNOWN' };
  const options = d.options || tableImportOptions, preview = d.preview || previewTableImport;
  const { files = [] } = await options(org, mission, code, { sheet }, account, d);
  const sure = [], maybe = [];
  for (const f of files.slice(0, MAX_FILES)) {
    let r; try { r = await options(org, mission, code, { sheet, source_file_id: f.file_id }, account, d); } catch { continue; }
    const sheets = /\.csv$/i.test(f.name || '') && !(r.sheets || []).length ? [{ name: null, role: 'unknown' }] : (r.sheets || []);
    for (const s of sheets) (s.role === kind ? sure : (s.role === 'unknown' ? maybe : [])).push({ id: f.file_id + '|' + (s.name || ''), file: f, sheet: s.name, by: s.role === kind ? 'code' : null, headers: s.headers || [], csv: s.name === null });
  }
  // Previews (rows, years, balance, sample rows) of everything that may fit.
  const items = [];
  // Unknown sheets worth a look: tables with amount, date or account columns (not every cover page of every file), at most 8.
  const worth = maybe.filter(c => c.csv || c.headers.filter(Boolean).length >= 3 && c.headers.some(h => /montant|debit|d[ée]bit|credit|cr[ée]dit|solde|amount|date|compte|budget|prevision/i.test(String(h || '')))).slice(0, 8);
  for (const c of [...sure, ...worth].slice(0, 24)) {
    try {
      const p = await preview(org, mission, code, { sheet, step, source_file_id: c.file.file_id, source_sheet: c.sheet }, account, d);
      items.push({ ...c, by: c.by || (tableRole(p.source_headers) === kind ? 'code' : null), p, mapping: codeMapping(p) });
    } catch (e) { if (c.by === 'code') items.push({ ...c, error: String(e.message || e).slice(0, 80) }); }
  }
  // The AI understands what the code could not: what each unknown sheet is, and the columns still without a match.
  let ai = 'not_needed';
  const unclear = items.filter(x => x.p && (!x.by || x.p.columns.some(col => !x.mapping.some(m => m.column === col.column))));
  if (unclear.length) {
    try {
      const input = JSON.stringify({ destination_columns: unclear[0].p.columns.map(col => ({ column: col.column, label: col.label })),
        pieces: unclear.map(x => ({ id: x.id, file: x.file.name, sheet: x.sheet, headers: x.p.source_headers, first_rows: (x.p.sample_rows || []).map(r => r.slice(0, 20)),
          already_matched: x.mapping.map(m => m.column), years: x.p.years })) }).slice(0, 30000);
      const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: UNDERSTAND.replace('{SHEET}', sheet).replace('{KIND}', KIND_LABEL[kind]), input, maxTokens: 2500 });
      const out = parseJsonLoose(r.text) || {};
      ai = r.provider || 'ai';
      for (const x of unclear) {
        const s = (out.sources || []).find(o => o.id === x.id);
        if (s) x.understood = { what: String(s.what || '').slice(0, 60), period: String(s.period || '').slice(0, 30), why: String(s.why || '').slice(0, 300), fits: s.fits === true };
        if (!x.by && x.understood?.fits) x.by = 'ia';
        for (const m of (out.mappings || []).filter(o => o.id === x.id)) {
          const col = x.p.columns.find(cc => cc.column === Number(m.column)), src = Number(m.source);
          if (!col || x.mapping.some(mm => mm.column === col.column) || !Number.isInteger(src) || src < 0 || src >= x.p.source_headers.length) continue;
          x.mapping.push({ column: col.column, label: col.label, source: src, source_label: x.p.source_headers[src], by: 'ia', why: String(m.why || '').slice(0, 200) });
        }
      }
    } catch (e) { ai = 'unavailable'; }
  }
  const fitting = items.filter(x => x.by);
  if (!fitting.length) return { sheet, kind, label: KIND_LABEL[kind], status: 'NO_SOURCE_FOUND', ai };
  const m = (await (d.fetchRows || rest)(`office_missions?org_id=eq.${q(org)}&id=eq.${q(mission)}&select=period_label&limit=1`).catch(() => []))?.[0];
  const years = missionYears(m?.period_label);
  const list = fitting.map(x => {
    const ys = Object.keys(x.p?.years || {}).map(Number);
    const inMission = years.length && ys.length ? ys.some(y => years.includes(y)) : null;
    x.mapping.sort((a, b) => a.column - b.column);
    return { file_id: x.file.file_id, name: x.file.name, sheet: x.sheet, by: x.by, understood: x.understood || null, error: x.error || null,
      rows: x.p?.rows || 0, years: x.p?.years || {}, gl_summary: x.p?.gl_summary || null, set_aside: x.p?.set_aside || null,
      mapping: x.mapping, unmatched: x.p ? x.p.columns.filter(c => !x.mapping.some(mm => mm.column === c.column)).map(c => c.label) : [],
      in_mission_period: inMission, recommended: !x.error && x.mapping.length > 0 && inMission !== false };
  });
  // Two pieces for the same years: both shown, only the larger one ticked (a copy is never imported twice without a person).
  for (const a of list) for (const b of list) if (a !== b && a.recommended && b.recommended && Object.keys(a.years).length && Object.keys(a.years).join() === Object.keys(b.years).join()) {
    const loser = a.rows < b.rows || (a.rows === b.rows && a.name > b.name) ? a : b; loser.recommended = false; loser.same_period_as = (loser === a ? b : a).name;
  }
  list.sort((a, b) => Number(b.recommended) - Number(a.recommended) || (Math.min(...Object.keys(a.years).map(Number), 9999) - Math.min(...Object.keys(b.years).map(Number), 9999)));
  return { sheet, kind, label: KIND_LABEL[kind], status: 'READY', step, mission_years: years, ai, items: list };
}

// « Oui, importe » : the ticked pieces, in order, each with the column choice the person saw. Each one is previewed again (rows and
// totals must be those shown), written below the previous one, read back, and its receipt closed by the approval given before.
export async function acceptImport(org, mission, code, body = {}, account, d = {}) {
  const sheet = String(body.sheet || ''), step = Number(body.step) || 1;
  const chosen = (Array.isArray(body.items) ? body.items : []).slice(0, 10);
  if (!chosen.length) throw fail('CHOOSE_SOURCES');
  // Never a part only: before anything is written, all the ticked pieces must fit (or the person asked to make the table larger).
  if (body.extend !== true) {
    let need = 0, room = null;
    for (const it of chosen) {
      const p = await (d.preview || previewTableImport)(org, mission, code, { sheet, step, source_file_id: String(it.file_id), source_sheet: it.sheet || null }, account, d);
      need += p.rows; if (room == null && p.last_row) room = p.last_row - p.start_row + 1;
    }
    if (room != null && need > room) throw Object.assign(fail('TABLE_TOO_SMALL'), { needed: need, room });
  }
  const done = [];
  for (const it of chosen) {
    const mapping = (Array.isArray(it.mapping) ? it.mapping : []).map(m => ({ column: Number(m.column), source: Number(m.source), ...(m.minus != null ? { minus: Number(m.minus) } : {}) }));
    const p = await (d.preview || previewTableImport)(org, mission, code, { sheet, step, source_file_id: String(it.file_id), source_sheet: it.sheet || null }, account, d);
    if (it.rows != null && Number(it.rows) !== p.rows) throw Object.assign(fail('WORK_CHANGED_PREPARE_AGAIN'), { done });
    const r = await (d.run || runTableImport)(org, mission, code, { sheet, step, source_file_id: String(it.file_id), source_sheet: it.sheet || null, revision: p.revision, mapping, extend: body.extend === true }, account, d);
    let confirmed = false;
    if (r.verified && r.plan_id) {
      try { await (d.review || reviewWorkpaper)(org, mission, code, { plan_id: r.plan_id, decision: 'confirm', note: 'Import approuvé avant écriture : ' + (p.source_name || it.file_id) }, account, d); confirmed = true; } catch { confirmed = false; }
    }
    done.push({ file_id: it.file_id, name: p.source_name, rows: r.rows, set_aside: r.set_aside || 0, start_row: r.start_row, extended: r.extended || null, confirmed });
    if (!confirmed) break; // the next import waits until this receipt is confirmed
  }
  return { sheet, done, rows: done.reduce((n, x) => n + (x.rows || 0), 0), verified: true };
}
