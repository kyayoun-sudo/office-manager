// L'IA COMPREND ET DONNE LES ORDRES, LE CODE LIT, EXÉCUTE ET VÉRIFIE (Paul, 2026-10-26 : « le code a la capacité de lire, mais sa capacité
// de comprendre et son cerveau, c'est l'IA » ; « le SOP, c'est le working file en action : l'IA doit comprendre quels documents placer où et
// dire au code : prends x lignes, mets-les dans z »).
//
// Pour une feuille de données d'un working file :
//   1. Le CODE LIT, sans rien décider : la feuille (titre, consignes, colonnes, ce que les tests font de chaque colonne d'après les formules),
//      le SOP des tests qui la lisent, et le CONTENU des pièces de la mission, ligne par ligne, avec le vrai numéro de ligne et la lettre de
//      colonne de chaque fichier.
//   2. L'IA COMPREND et rend des ORDRES : « prends le document X, feuille Y, lignes 8 à 52 sauf 15 et 28, colonne E → colonne D de la
//      feuille », d'autres pièces alignées sur une clé, des calculs entre colonnes, des correspondances (libellé → n° de compte), le contrôle
//      de total à faire, les pièces qui manquent, les questions à l'auditeur — chaque ordre avec la raison tirée du SOP.
//   3. Le CODE EXÉCUTE ces ordres tels quels et VÉRIFIE : document de la mission, feuille, lignes et colonnes qui existent, une colonne de
//      montants ne reçoit que des montants, un n° de compte donné par l'IA existe dans la pièce qu'elle cite, total recopié = total de la
//      pièce, jamais la même colonne d'une pièce des deux côtés d'un recalcul du test. Il ne remplace jamais un ordre par son idée : un écart
//      est DIT (à l'IA, à l'auditeur), la case reste vide.
//   4. Rien n'est écrit sans « Oui, remplis » : ce sont les ordres gardés par le serveur qui sont réexécutés sur les fichiers, puis écrits par
//      l'import existant (cases de saisie vides seulement, formules gardées, relu, reçu, annulable).
import { reusableFillMethod, rememberFillMethod, knownFillMethod } from './learned-fill-method.js';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { understandSheet, forbiddenPairs, loadContext, isPdf, isSheet, extractOf } from './sheet-understanding.js';
import { fitJson } from './ai-input.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';

const fail = (code, status = 409, extra = {}) => Object.assign(new Error(code), { statusCode: status, ...extra });
const fold = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const key = v => fold(v instanceof Date ? v.toISOString().slice(0, 10) : v).replace(/[^a-z0-9]+/g, '');
const colNum = l => String(l || '').toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLet = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const LETTER = /^[A-Z]{1,3}$/;
const cut = (v, n) => String(v ?? '').slice(0, n);
export const numberOf = v => {
  if (v == null || v === '') return null; if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[\s  ]/g, ''); const neg = /^\(.*\)$/.test(s) || /^-/.test(s); s = s.replace(/[()]/g, '').replace(/^-/, '');
  if (!/^[\d.,]+$/.test(s)) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const n = Number(s); return Number.isFinite(n) ? (neg ? -n : n) : null;
};
const asDate = v => {
  if (v instanceof Date) return v;
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5);
  const t = String(v ?? '').trim(); let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(Date.UTC(+m[1], m[2] - 1, +m[3]));
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return new Date(Date.UTC(y, m[2] - 1, +m[1])); }
  return null;
};
const shown = v => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : typeof v === 'number' ? v : cut(v, 60));

// ———— 1. LIRE (code) ————

// Every sheet of a client file, as it is: the TRUE row numbers and column letters of the file (what the AI will name in its orders).
// A merged title is read once (its first cell), never repeated in every column of the merge.
export async function readPiece(doc, drive, d = {}) {
  if (d.readPiece) return d.readPiece(doc);
  const meta = await drive.getMeta(doc.id).catch(() => null);
  if (!meta || meta.trashed) return { unreadable: 'absent' };
  if (Number(meta.size || 0) > 40 * 1024 * 1024) return { unreadable: 'plus de 40 Mo' };
  const bytes = Buffer.from(await drive.downloadBuffer(doc.id));
  const sheets = [];
  if (/\.csv$/i.test(doc.name)) { const { parseClientCsv } = await import('./workfile-table-import.js'); sheets.push({ name: 'CSV', rows: parseClientCsv(bytes.toString('utf8').replace(/^﻿/, '')).map((r, i) => ({ n: i + 1, v: r })) }); }
  else if (/\.xls$/i.test(doc.name)) for (const s of (await import('./legacy-xls.js')).legacySheets(bytes)) sheets.push({ name: s.name, rows: s.rows.map((r, i) => ({ n: i + 1, v: r })).filter(r => r.v.some(x => x != null && x !== '')) });
  else if (/\.xlsx$/i.test(doc.name)) {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
    for (const ws of wb.worksheets) {
      if (ws.state !== 'visible') continue;
      const rows = [];
      ws.eachRow({ includeEmpty: false }, (row, n) => {
        if (n > 200000) return;
        const v = [];
        row.eachCell((c, i) => { if (i > 60 || (c.isMerged && c.master && c.master.address !== c.address)) return; const x = c.value; v[i - 1] = x && typeof x === 'object' && !(x instanceof Date) ? (x.result ?? x.text ?? (x.richText ? x.richText.map(t => t.text).join('') : null)) : x; });
        const arr = Array.from(v, y => y ?? null); if (arr.some(y => y != null && y !== '')) rows.push({ n, v: arr });
      });
      if (rows.length) sheets.push({ name: ws.name, rows });
    }
  } else return { unreadable: 'format non tabulaire' };
  return { sheets, modified: meta.modifiedTime || null, fingerprint: createHash('sha256').update(bytes).digest('hex').slice(0, 24) };
}

// What the AI sees of a sheet: every line with its number and letters when the sheet is small; else the head, some of the middle, the end,
// and how full each column is (counted, not interpreted). The AI then names lines by number or by a condition the code applies.
function sheetForAi(s, full = 300) {
  const width = Math.min(40, Math.max(0, ...s.rows.map(r => r.v.length)));
  const line = r => [r.n, ...r.v.slice(0, width).map(shown)];
  const n = s.rows.length;
  const pick = n <= full ? s.rows : [...s.rows.slice(0, 150), ...[0.25, 0.5, 0.75].flatMap(f => s.rows.slice(Math.floor(n * f), Math.floor(n * f) + 15)), ...s.rows.slice(-40)];
  const filled = Array.from({ length: width }, (_, i) => { const vs = s.rows.map(r => r.v[i]).filter(v => v != null && v !== ''); return { col: colLet(i + 1), filled: vs.length, numbers: vs.filter(v => numberOf(v) != null).length }; });
  return { sheet: s.name, rows_in_sheet: n, first_row: s.rows[0]?.n || null, last_row: s.rows[n - 1]?.n || null, columns: filled.map(c => c.col), column_fill: n > full ? filled : undefined,
    lines_format: '[n° de ligne du fichier, valeur colonne A, valeur colonne B, …]', lines: pick.map(line), shown: pick.length < n ? 'extrait : ' + pick.length + ' lignes sur ' + n : 'toutes les lignes' };
}

// The SOP of each test that reads the sheet (objective, steps, pieces), from the firm's methodology.
async function sopOf(org, codes, view, d) {
  const out = [];
  try {
    const { methodologyState, findProcedure } = await import('./methodology.js');
    const lib = await (d.methodology || methodologyState)({}, org);
    for (const c of [...new Set([view?.line?.code || view?.card?.code, ...codes].filter(Boolean))].slice(0, 8)) {
      const p = (c === view?.card?.code ? view.card : findProcedure(lib, c)) || null; if (!p) continue;
      out.push({ code: c, title: p.title || null, objective: p.objective || null, risk: p.risk || null, assertion: p.assertion || null, steps: (p.steps || []).map(x => (typeof x === 'string' ? x : x.text || '')).slice(0, 12), ask: (p.pbc || p.documents || []).slice?.(0, 10) || null });
    }
  } catch { /* the sheet and its formulas still speak */ }
  if (!out.length && view?.card) out.push({ code: view.card.code || null, title: view.card.title || null, objective: view.card.objective || null, steps: (view.card.steps || []).map(x => (typeof x === 'string' ? x : x.text || '')).slice(0, 12) });
  return out;
}

// ———— 2. COMPRENDRE (IA) ————

export const ORDERS = `Tu es l'Enhanced Auditor d'un cabinet d'audit, l'intelligence qui guide le code. Le code sait seulement lire et écrire :
il exécutera EXACTEMENT tes ordres, sans rien deviner. Tu reçois :
- "sop" : ce que les tests qui utilisent cette feuille doivent faire (objectif, étapes, pièces demandées). Le working file est le SOP en action.
- "sheet" : la feuille du working file à remplir — titre, consignes, première ligne de saisie, capacité, et pour chaque colonne de saisie ce
  que les tests en font (recopiée, additionnée, comparée à une autre, clé cherchée dans une autre feuille, définit les lignes).
- "pieces" : le CONTENU des pièces de la mission, feuille par feuille, chaque ligne avec son VRAI numéro de ligne dans le fichier et ses
  valeurs dans l'ordre des colonnes A, B, C… (un extrait pour les très longues feuilles, avec le remplissage de chaque colonne).
- "auditor_says" (si donné) : ce que l'auditeur te dit. Suis-le. "previous_orders" : tes ordres précédents qu'il a jugés faux.
- "fiche" de certaines pièces : ce qu'une lecture complète a compris d'elles (une fiche corrigée par un auditeur est la vérité).

Comprends d'abord ce que la feuille sert à prouver selon le SOP, puis ce qu'est chaque pièce par son CONTENU (jamais par son nom), puis
donne les ordres. Règles :
- Un "block" = UNE feuille d'UNE pièce et les LIGNES à prendre : "rows" avec "from" et "to" (numéros de ligne du fichier), "except" (lignes
  à écarter : titres, sous-totaux, totaux, reports, lignes vides de sens), ou "only" (liste exacte de lignes), et/ou "where" (conditions sur
  des colonnes de la pièce : not_empty, empty, number, positive, negative, equals, not_equals, contains, avec "column" = lettre de la pièce
  et "value" si besoin). Puis "columns" : pour chaque colonne de la feuille à remplir depuis ce bloc, "target" (lettre de la feuille du
  working file), "source" (lettre de la colonne de la pièce), éventuellement "minus" (lettre d'une autre colonne de la pièce à soustraire :
  débit − crédit), "transform" ("as_is", "number", "date", "negate", "text").
- Le PREMIER block donne les lignes de la feuille. Un block suivant d'une AUTRE pièce s'aligne sur elles : "align": {"target": "lettre de
  la feuille déjà remplie", "source": "lettre de la pièce qui porte la même valeur"} ; "sum_duplicates": true si plusieurs lignes de la
  pièce portent la même clé et doivent être additionnées. Un block sans "align" ajoute ses lignes à la suite (relevés de plusieurs mois).
- "computed" : une colonne qui se calcule depuis d'autres colonnes DE LA FEUILLE ("formula" : "D-B", "B+C", une seule opération).
- "lookups" : remplacer les valeurs d'une colonne par d'autres que TU as trouvées (libellé de budget → numéro de compte du grand livre,
  par le SENS) : "target", "map": [{"from": "valeur", "to": "valeur"}], "verify_in": {"document_id", "sheet", "column"} = la pièce où
  chaque "to" doit exister. N'invente aucune valeur : seulement des valeurs que tu vois dans les pièces.
- "checks" : les contrôles que le code doit faire, par exemple que la somme écrite dans une colonne égale le total de la pièce :
  {"target": "D", "document_id", "sheet", "row": 53, "column": "E"}.
- Une colonne recalculée et la colonne à laquelle le test la compare ne viennent JAMAIS de la même colonne d'une même pièce : le test
  serait juste d'office. Une information absente des pièces : la colonne reste vide, et "missing" dit quelle pièce demander.
- Une pièce PDF n'a pas de lignes numérotées : si elle contient le tableau nécessaire, mets-la dans "pdf_to_extract" (le code la
  transformera en tableau vérifié, puis tu donneras les ordres sur ce tableau).
- Chaque block et chaque colonne disent "why" : quelle étape du SOP ou quel test l'exige, en une phrase.
- Tu ne décides jamais d'une conclusion ni d'un jugement : seulement des données recopiées des pièces.
- "mission_memory" = ce que les autres agents savent déjà de la mission (faits, décisions, pièces manquantes, questions) : tiens-en compte.
JSON STRICT : {"understanding":"ce que la feuille sert à prouver","blocks":[{"document_id":"…","sheet":"…","rows":{"from":8,"to":52,
"except":[15,28],"only":null,"where":[{"column":"C","test":"not_empty"}]},"columns":[{"target":"D","source":"E","minus":null,"transform":"number",
"why":"…"}],"align":null,"sum_duplicates":false,"why":"…"}],"computed":[{"target":"C","formula":"D-B","why":"…"}],"lookups":[],"checks":[],
"missing":[{"target":"B","piece":"…","why":"…"}],"pdf_to_extract":[],"questions":["…"],"summary":"…"}`;

const TESTS = ['not_empty', 'empty', 'number', 'positive', 'negative', 'equals', 'not_equals', 'contains'];
const TRANSFORMS = ['as_is', 'number', 'date', 'negate', 'text'];
// The orders as the code will run them: only known documents, letters, line numbers, operations from the closed list. Nothing else passes.
export function cleanOrders(raw, u, docIds) {
  const targets = new Set(u.columns.map(c => c.col)), known = new Set(docIds);
  const L = v => { const s = String(v ?? '').trim().toUpperCase(); return LETTER.test(s) ? s : null; };
  const rowNo = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 200000 ? n : null; };
  const why = v => cut(v, 300) || null, problems = [];
  const blocks = [];
  for (const b of (Array.isArray(raw?.blocks) ? raw.blocks : []).slice(0, 12)) {
    const id = String(b?.document_id || '');
    if (!known.has(id)) { problems.push('ordre ignoré : pièce inconnue dans la mission (' + cut(id, 40) + ')'); continue; }
    const r = b.rows || {};
    const rows = { from: rowNo(r.from), to: rowNo(r.to), except: (Array.isArray(r.except) ? r.except : []).map(rowNo).filter(Boolean).slice(0, 5000),
      only: Array.isArray(r.only) ? r.only.map(rowNo).filter(Boolean).slice(0, 20000) : null,
      where: (Array.isArray(r.where) ? r.where : []).map(w => ({ column: L(w?.column), test: TESTS.includes(w?.test) ? w.test : null, value: w?.value == null ? null : cut(w.value, 120) })).filter(w => w.column && w.test).slice(0, 6) };
    const columns = (Array.isArray(b.columns) ? b.columns : []).map(c => ({ target: L(c?.target), source: L(c?.source), minus: L(c?.minus), transform: TRANSFORMS.includes(c?.transform) ? c.transform : 'as_is', why: why(c?.why) }))
      .filter(c => { if (c.target && targets.has(c.target) && c.source) return true; problems.push('colonne ignorée : ' + (c.target || '?') + ' n’est pas une colonne de saisie de la feuille, ou la colonne de la pièce manque'); return false; });
    if (!columns.length) { problems.push('ordre ignoré : aucune colonne valable pour ' + cut(id, 40)); continue; }
    const align = b.align && L(b.align.target) && L(b.align.source) ? { target: L(b.align.target), source: L(b.align.source) } : null;
    blocks.push({ document_id: id, sheet: b.sheet == null ? null : cut(b.sheet, 120), rows, columns, align, sum_duplicates: b.sum_duplicates === true, why: why(b.why) });
  }
  const computed = (Array.isArray(raw?.computed) ? raw.computed : []).map(c => { const m = /^\s*([A-Z]{1,3})\s*([-+])\s*([A-Z]{1,3})\s*$/.exec(String(c?.formula || (c?.a && c?.b && ['+', '-'].includes(c?.op) ? c.a + c.op + c.b : '')).toUpperCase()); return m && targets.has(L(c?.target)) && targets.has(m[1]) && targets.has(m[3]) ? { target: L(c.target), a: m[1], op: m[2], b: m[3], why: why(c.why) } : null; }).filter(Boolean).slice(0, 10);
  const lookups = (Array.isArray(raw?.lookups) ? raw.lookups : []).map(x => ({ target: L(x?.target), map: (Array.isArray(x?.map) ? x.map : []).map(m => ({ from: cut(m?.from, 200), to: m?.to == null ? null : cut(m.to, 120) })).filter(m => m.from).slice(0, 600),
    verify_in: x?.verify_in && known.has(String(x.verify_in.document_id || '')) && L(x.verify_in.column) ? { document_id: String(x.verify_in.document_id), sheet: x.verify_in.sheet == null ? null : cut(x.verify_in.sheet, 120), column: L(x.verify_in.column) } : null, why: why(x?.why) }))
    .filter(x => x.target && targets.has(x.target) && x.map.length).slice(0, 6);
  const checks = (Array.isArray(raw?.checks) ? raw.checks : []).map(c => ({ target: L(c?.target), document_id: String(c?.document_id || ''), sheet: c?.sheet == null ? null : cut(c.sheet, 120), row: rowNo(c?.row), column: L(c?.column) }))
    .filter(c => c.target && targets.has(c.target) && known.has(c.document_id) && c.row && c.column).slice(0, 10);
  const missing = (Array.isArray(raw?.missing) ? raw.missing : []).map(m => ({ target: L(m?.target), piece: cut(m?.piece, 160) || null, why: why(m?.why) })).filter(m => m.target || m.piece).slice(0, 30);
  const pdfs = (Array.isArray(raw?.pdf_to_extract) ? raw.pdf_to_extract : []).map(String).filter(id => known.has(id)).slice(0, 4);
  return { understanding: cut(raw?.understanding, 600) || null, blocks, computed, lookups, checks, missing, pdf_to_extract: pdfs,
    questions: (Array.isArray(raw?.questions) ? raw.questions : []).map(q => cut(q, 300)).filter(Boolean).slice(0, 6), summary: cut(raw?.summary, 600) || null, problems };
}

// ———— 3. EXÉCUTER ET VÉRIFIER (code) ————

const pass = (v, w) => {
  const t = w.test, n = numberOf(v), e = v == null || String(v).trim() === '';
  if (t === 'not_empty') return !e; if (t === 'empty') return e; if (t === 'number') return n != null; if (t === 'positive') return n != null && n > 0;
  if (t === 'negative') return n != null && n < 0; if (t === 'equals') return key(v) === key(w.value); if (t === 'not_equals') return key(v) !== key(w.value);
  if (t === 'contains') return fold(v).includes(fold(w.value)); return true;
};
function pickSheet(piece, name) {
  const ss = piece?.sheets || [];
  return (name != null ? ss.find(s => s.name === name) || ss.find(s => fold(s.name) === fold(name)) : null) || (ss.length === 1 ? ss[0] : null);
}
function selectRows(sheet, rows) {
  const ex = new Set(rows.except || []), only = rows.only ? new Set(rows.only) : null;
  return sheet.rows.filter(r => (only ? only.has(r.n) : (rows.from == null || r.n >= rows.from) && (rows.to == null || r.n <= rows.to)) && !ex.has(r.n)
    && (rows.where || []).every(w => pass(r.v[colNum(w.column) - 1], w)));
}

// The orders run on the pieces as they are now. Returns the table to write (one column per input column of the sheet), the provenance of
// every cell, and what the code checked and found wrong — never a value the orders did not give.
export async function executeOrders(ctx, orders, d = {}) {
  const { u } = ctx, report = { problems: [...(orders.problems || [])], checks: [], unmatched: [], refused: 0, written_by: [] };
  const pieces = {}, read = async id => (pieces[id] ||= await readPiece(ctx.docs.find(x => x.id === id) || { id, name: '' }, ctx.drive, d).catch(e => ({ unreadable: String(e.message || e).slice(0, 80) })));
  const at = Object.fromEntries(u.columns.map((c, i) => [c.col, i]));
  const colInfo = Object.fromEntries(u.columns.map(c => [c.col, c]));
  const rows = [], prov = [];
  // Hard rule: the same column of the same piece never on both sides of a test's recomputation.
  const origin = {};
  for (const b of orders.blocks) for (const c of b.columns) origin[c.target] = b.document_id + '|' + (b.sheet || '') + '|' + c.source + '|' + (c.minus || '');
  const dropped = new Set();
  for (const [a, b2, k] of forbiddenPairs(u)) if (origin[a] && origin[a] === origin[b2]) { const drop = k.left.length >= k.right.length ? (k.left.includes(a) ? a : b2) : (k.left.includes(a) ? b2 : a); dropped.add(drop); report.problems.push(colInfo[drop].header + ' : même colonne de la même pièce que l’autre côté du recalcul de ' + k.test + ' (le test serait juste d’office) — laissée vide'); }
  const value = (c, r, info) => {
    let v = r.v[colNum(c.source) - 1] ?? null;
    if (c.minus) { const a = numberOf(v), b = numberOf(r.v[colNum(c.minus) - 1]); v = a == null && b == null ? null : Math.round(((a || 0) - (b || 0)) * 100) / 100; }
    if (c.transform === 'negate') { const n = numberOf(v); v = n == null ? v : -n; }
    if (c.transform === 'date') { const dt = v == null || v === '' ? null : asDate(v); if (dt) v = dt; }
    if (c.transform === 'text' && v != null) v = String(v instanceof Date ? v.toISOString().slice(0, 10) : v);
    if (c.transform === 'number' || info.amount) { if (v == null || v === '') return { v: null }; const n = numberOf(v); if (n == null) return { v: null, refused: true }; v = n; }
    return { v };
  };
  for (const [bi, b] of orders.blocks.entries()) {
    const piece = await read(b.document_id), doc = ctx.docs.find(x => x.id === b.document_id);
    if (piece.unreadable) { report.problems.push('« ' + (doc?.name || b.document_id) + ' » illisible : ' + piece.unreadable); continue; }
    const sh = pickSheet(piece, b.sheet);
    if (!sh) { report.problems.push('« ' + (doc?.name || b.document_id) + ' » : feuille « ' + (b.sheet || '?') + ' » introuvable'); continue; }
    const sel = selectRows(sh, b.rows);
    const cols = b.columns.filter(c => !dropped.has(c.target));
    const src = (c, r) => ({ file_id: doc?.id || b.document_id, name: doc?.name || '', heading: sh.name + ' ' + c.source + (c.minus ? ' − ' + c.minus : ''), line: r.n });
    report.written_by.push({ document: doc?.name || b.document_id, sheet: sh.name, rows: sel.length, columns: cols.map(c => c.target + '←' + c.source + (c.minus ? '−' + c.minus : '')) });
    if (!sel.length) { report.problems.push('« ' + (doc?.name || '') + ' », feuille ' + sh.name + ' : aucune ligne ne correspond à l’ordre (lignes ' + (b.rows.from || '?') + '–' + (b.rows.to || '?') + ')'); continue; }
    if (bi === 0 || !b.align) {
      for (const r of sel) {
        const row = Array(u.columns.length).fill(null), pv = Array(u.columns.length).fill(null);
        for (const c of cols) { const x = value(c, r, colInfo[c.target]); if (x.refused) { report.refused++; continue; } row[at[c.target]] = x.v; if (x.v != null) pv[at[c.target]] = src(c, r); }
        if (row.some(v => v != null && v !== '')) { rows.push(row); prov.push(pv); }
      }
      continue;
    }
    // Aligned on a key the first pieces already wrote: each line of the sheet takes the line(s) of this piece with the same key.
    const idx = new Map();
    for (const r of sel) { const k = key(r.v[colNum(b.align.source) - 1]); if (!k) continue; (idx.get(k) || idx.set(k, []).get(k)).push(r); }
    const missed = [];
    for (let i = 0; i < rows.length; i++) {
      const k = key(rows[i][at[b.align.target]]); const hit = k ? idx.get(k) : null;
      if (!hit) { if (k) missed.push(String(rows[i][at[b.align.target]]).slice(0, 40)); continue; }
      if (hit.length > 1 && !b.sum_duplicates) { report.problems.push('« ' + (doc?.name || '') + ' » : ' + hit.length + ' lignes pour « ' + String(rows[i][at[b.align.target]]).slice(0, 40) + ' » (lignes ' + hit.map(h => h.n).join(', ') + ') — laissé vide'); continue; }
      for (const c of cols) {
        let v = null, refused = false;
        if (hit.length === 1) { const x = value(c, hit[0], colInfo[c.target]); v = x.v; refused = x.refused; }
        else { const xs = hit.map(h => value(c, h, colInfo[c.target])); refused = xs.some(x => x.refused); v = refused ? null : Math.round(xs.reduce((t, x) => t + (numberOf(x.v) || 0), 0) * 100) / 100; }
        if (refused) { report.refused++; continue; }
        if (rows[i][at[c.target]] == null) { rows[i][at[c.target]] = v; if (v != null) prov[i][at[c.target]] = { ...src(c, hit[0]), line: hit[0].n, ...(hit.length > 1 ? { heading: sh.name + ' ' + c.source + ' (somme des lignes ' + hit.map(h => h.n).join(', ') + ')' } : {}) }; }
      }
    }
    if (missed.length) report.unmatched.push({ document: doc?.name || '', count: missed.length, sample: missed.slice(0, 6) });
  }
  // Lookups given by the AI, each value checked in the piece it cites.
  for (const lk of orders.lookups) {
    let allowed = null;
    if (lk.verify_in) { const p = await read(lk.verify_in.document_id), sh = p.unreadable ? null : pickSheet(p, lk.verify_in.sheet); if (sh) allowed = new Set(sh.rows.map(r => key(r.v[colNum(lk.verify_in.column) - 1])).filter(Boolean)); else report.problems.push('correspondances de ' + lk.target + ' : pièce de vérification illisible — non appliquées'); }
    if (!allowed) continue;
    const m = new Map(lk.map.map(x => [key(x.from), x.to])); let applied = 0; const bad = [];
    for (let i = 0; i < rows.length; i++) {
      const cur = rows[i][at[lk.target]], k = key(cur); if (!k || !m.has(k)) continue;
      const to = m.get(k); if (to == null) continue;
      if (!allowed.has(key(to))) { bad.push(String(cur).slice(0, 40) + ' → ' + to); continue; }
      rows[i][at[lk.target]] = /^\d+$/.test(String(to)) ? String(to) : to; prov[i][at[lk.target]] = { ...(prov[i][at[lk.target]] || {}), heading: 'correspondance donnée par l’IA (« ' + String(cur).slice(0, 40) + ' » → ' + to + '), vérifiée dans la pièce' }; applied++;
    }
    report.checks.push({ what: 'correspondances ' + colInfo[lk.target].header, ok: !bad.length, detail: applied + ' appliquée(s)' + (bad.length ? ', ' + bad.length + ' refusée(s) car absentes de la pièce : ' + bad.slice(0, 4).join(' ; ') : '') });
  }
  // Computations between columns of the sheet.
  for (const c of orders.computed) for (let i = 0; i < rows.length; i++) {
    const a = numberOf(rows[i][at[c.a]]), b = numberOf(rows[i][at[c.b]]);
    if (a == null || b == null || rows[i][at[c.target]] != null) continue;
    rows[i][at[c.target]] = Math.round((c.op === '-' ? a - b : a + b) * 100) / 100; prov[i][at[c.target]] = { file_id: null, name: 'calcul', heading: c.a + ' ' + (c.op === '-' ? '−' : '+') + ' ' + c.b, line: 0 };
  }
  // Totals: what is written against the total the AI pointed at in the piece.
  for (const k of orders.checks) {
    const p = await read(k.document_id), sh = p.unreadable ? null : pickSheet(p, k.sheet), r = sh?.rows.find(x => x.n === k.row);
    const expected = r ? numberOf(r.v[colNum(k.column) - 1]) : null;
    const got = Math.round(rows.reduce((t, x) => t + (numberOf(x[at[k.target]]) || 0), 0) * 100) / 100;
    report.checks.push({ what: 'total ' + colInfo[k.target].header, ok: expected != null && Math.abs(got - expected) < 0.5, detail: expected == null ? 'total introuvable dans la pièce (ligne ' + k.row + ', colonne ' + k.column + ')' : 'écrit ' + got.toLocaleString('fr-FR') + ' / pièce ' + expected.toLocaleString('fr-FR') + (Math.abs(got - expected) < 0.5 ? '' : ' — écart ' + (Math.round((got - expected) * 100) / 100).toLocaleString('fr-FR')) });
  }
  const fingerprint = createHash('sha256').update(JSON.stringify([orders.blocks, orders.lookups, orders.computed, Object.values(pieces).map(p => p.fingerprint || null)])).digest('hex');
  const headers = u.columns.map(c => c.header || c.col);
  const driver = orders.blocks[0]?.document_id || null;
  return { source_reads: pieces, rows, provenance: prov, report, table: rows.length ? { meta: { id: driver, name: 'Pièces de la mission → ' + ctx.sheet, source_sheet: null, modifiedTime: null, fingerprint }, rows: [headers, ...rows], header_row: 0, provenance: prov } : null, driver };
}

// ———— Les actions ————

async function askAi(ctx, org, body, d) {
  const { u, docs } = ctx;
  const usable = docs.filter(x => isSheet(x.name) || isPdf(x.name)).slice(0, 60);
  const pieces = [];
  for (let i = 0; i < usable.length; i += 5) await Promise.all(usable.slice(i, i + 5).map(async x => {
    // a PDF already turned into a verified table is given as that table
    const ex = isPdf(x.name) ? extractOf(docs, x.id) : null;
    if (ex) { const p = await readPiece(ex, ctx.drive, d).catch(() => null); pieces.push({ document_id: ex.id, name: ex.name + ' (tableau extrait de « ' + x.name + ' »)', fiche: ex.profile || x.profile || null, sheets: (p?.sheets || []).map(s => sheetForAi(s)) }); return; }
    if (isPdf(x.name)) {
      const t = await (d.pdfText || (async id => { const b = Buffer.from(await ctx.drive.downloadBuffer(id)); return (await import('./pdf-reading.js')).extractPdfText(b, { limit: 6000 }); }))(x.id).catch(() => null);
      const text = String(t?.text || '').replace(/\s+/g, ' ').trim();
      pieces.push({ document_id: x.id, name: x.name, format: 'pdf', fiche: x.profile || null, text: text.length > 80 ? text.slice(0, 4000) : null, scan: text.length <= 80 });
      return;
    }
    const p = await readPiece(x, ctx.drive, d).catch(e => ({ unreadable: String(e.message || e).slice(0, 60) }));
    pieces.push({ document_id: x.id, name: x.name, fiche: x.profile ? { family: x.profile.family, what: x.profile.what, period: x.profile.period, corrected_by_an_auditor: x.profile.corrected_by || null } : null, unreadable: p.unreadable || undefined, sheets: (p.sheets || []).slice(0, 6).map(s => sheetForAi(s)) });
  }));
  const sop = await sopOf(org, u.tests.map(t => t.code), ctx.view, d);
  const prev = (ctx.view.work?.walkthrough || []).filter(r => r.kind === 'fill-orders' && r.sheet === ctx.sheet).at(-1);
  // What the other agents already know of this mission (shared memory): pieces identified, decisions, what is missing, open questions.
  const mid = ctx.view.mission_id || ctx.view.mission?.id || null;
  const memory = !mid ? null : await (d.missionBrief || (await import('./mission-brief.js')).missionBrief)(org, mid, 'enhanced-auditor', d).catch(() => null);
  const learnedRecipe = await (d.recipeFor || (await import('./fill-recipes.js')).recipeFor)(ctx.map.key, ctx.sheet, d).catch(() => null);
  const knownMethod = knownFillMethod(learnedRecipe, org, mid);
  const payload = {
    sop,
    sheet: { name: ctx.sheet, title: u.title, instructions: u.instructions, first_input_row: u.first_row, capacity_rows: Math.max(0, u.last_row - u.first_row + 1),
      columns: u.columns.map(c => ({ col: c.col, header: c.header, what_the_tests_do: c.says, amount: c.amount, key: c.key })), tests: u.tests.map(t => ({ code: t.code, title: t.title, how: t.how })), pieces_the_file_asks: u.pieces },
    period_of_the_mission: ctx.view?.mission?.period_label || null,
    mission_memory: memory ? { open: memory.open, settled: memory.settled, documents: memory.documents } : null,
    auditor_says: body.hint ? cut(body.hint, 1000) : null,
    previous_orders: body.hint && prev ? { blocks: prev.orders.blocks, computed: prev.orders.computed, lookups: (prev.orders.lookups || []).map(l => ({ target: l.target, count: l.map.length })) } : null,
    pieces,
    previously_validated_method: knownMethod?.org === org && knownMethod.mission === mid ? { understanding: knownMethod.orders.understanding, orders: knownMethod.orders, validated_by: knownMethod.validated_by, note: 'La méthode a déjà été validée. Les sources ou le contexte ont changé : adapter les ordres aux contenus actuels sans supposer les anciennes données valables.' } : null,
    learned_column_meanings: learnedRecipe?.columns || null
  };
  const input = fitJson(payload, 160000, [
    o => o.pieces.forEach(p => (p.sheets || []).forEach(s => { if (s.lines.length > 120) { s.lines = [...s.lines.slice(0, 80), ...s.lines.slice(-25)]; s.shown = 'extrait : ' + s.lines.length + ' lignes sur ' + s.rows_in_sheet; } })),
    o => o.pieces.forEach(p => { if (p.text) p.text = p.text.slice(0, 1500); }),
    o => o.pieces.forEach(p => (p.sheets || []).forEach(s => { if (s.lines.length > 60) { s.lines = [...s.lines.slice(0, 45), ...s.lines.slice(-12)]; s.shown = 'extrait : ' + s.lines.length + ' lignes sur ' + s.rows_in_sheet; } })),
    o => o.pieces.forEach(p => (p.sheets || []).forEach(s => { s.lines = s.lines.map(l => l.map(v => (typeof v === 'string' ? v.slice(0, 30) : v))); }))
  ]);
  const ask = inp => (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: ORDERS, input: inp, maxTokens: 8000 });
  let r, retried = null;
  try { r = await ask(input); }
  catch (e) { retried = String(e?.message || e).slice(0, 120); r = await ask(fitJson(JSON.parse(input), 70000, [o => o.pieces.forEach(p => (p.sheets || []).forEach(s => { s.lines = [...s.lines.slice(0, 30), ...s.lines.slice(-8)]; }))])); }
  const raw = parseJsonLoose(r?.text ?? r);
  if (!raw) throw fail('AI_ORDERS_UNREADABLE', 502);
  return { orders: cleanOrders(raw, u, docs.map(x => x.id)), provider: r?.provider || 'ai', retried };
}

// What the screen shows (same shape as before, so « Ma procédure » keeps working): one entry per column of the sheet, the cells in the sheet.
function forScreen(ctx, orders, ex, extra = {}) {
  const { u, docs, sheet } = ctx, name = id => docs.find(x => x.id === id)?.name || id;
  const plan = u.columns.map(c => {
    const b = orders.blocks.find(x => x.columns.some(y => y.target === c.col)), oc = b?.columns.find(y => y.target === c.col);
    const comp = orders.computed.find(x => x.target === c.col), miss = orders.missing.find(x => x.target === c.col);
    if (oc) return { col: c.col, header: c.header, document_id: b.document_id, document: name(b.document_id), heading: (b.sheet ? b.sheet + ', ' : '') + 'colonne ' + oc.source + (oc.minus ? ' − ' + oc.minus : '') + ', lignes ' + (b.rows.only ? b.rows.only.length + ' choisies' : (b.rows.from || '…') + '–' + (b.rows.to || '…')) + (b.rows.except.length ? ' sauf ' + b.rows.except.join(', ') : ''),
      status: 'sure', by: 'ia', why: [oc.why || b.why, b.align ? 'aligné sur ' + b.align.target : null].filter(Boolean).join(' — '), missing: null };
    if (comp) return { col: c.col, header: c.header, document_id: null, compute: comp.a + '-' + comp.b, status: 'sure', by: 'ia', why: comp.why || 'calcul' };
    return { col: c.col, header: c.header, document_id: null, heading: null, status: 'missing', by: 'ia', why: miss?.why || null, missing: miss?.piece || null };
  });
  const cells = [];
  (ex?.rows || []).forEach((row, r) => u.columns.forEach((c, k) => {
    const v = row[k]; if (v == null || v === '' || cells.length >= 3000) return;
    const pv = ex.provenance[r]?.[k];
    cells.push({ sheet, address: c.col + (u.first_row + r), value: v instanceof Date ? v.toISOString().slice(0, 10) : v, label: c.header, source: pv ? (pv.name ? pv.name + ' — ' : '') + pv.heading + (pv.line ? ', ligne ' + pv.line : '') : 'pièce de la mission' });
  }));
  const rep = ex?.report || { problems: orders.problems || [], checks: [] };
  const orderLines = orders.blocks.map(b => 'Prendre « ' + name(b.document_id) + ' »' + (b.sheet ? ', feuille ' + b.sheet : '') + ', ' + (b.rows.only ? 'lignes ' + b.rows.only.slice(0, 12).join(', ') + (b.rows.only.length > 12 ? '…' : '') : 'lignes ' + (b.rows.from || 'début') + ' à ' + (b.rows.to || 'fin')) + (b.rows.except.length ? ' sauf ' + b.rows.except.slice(0, 15).join(', ') : '') + (b.rows.where.length ? ' où ' + b.rows.where.map(w => w.column + ' ' + w.test + (w.value ? ' « ' + w.value + ' »' : '')).join(' et ') : '') + ' → ' + b.columns.map(c => c.target + ' ← ' + c.source + (c.minus ? ' − ' + c.minus : '')).join(', ') + (b.align ? ' (aligné : ' + b.align.target + ' = ' + b.align.source + ')' : '') + (b.why ? ' — ' + b.why : ''))
    .concat(orders.computed.map(c => c.target + ' = ' + c.a + ' ' + (c.op === '-' ? '−' : '+') + ' ' + c.b + (c.why ? ' — ' + c.why : '')))
    .concat(orders.lookups.map(l => l.target + ' : ' + l.map.length + ' correspondance(s) données par l’IA' + (l.why ? ' — ' + l.why : '')));
  return { sheet, mode: 'orders', cells, plan, orders, order_lines: orderLines, understanding_by_ai: orders.understanding, summary: orders.summary, questions: orders.questions,
    checks: rep.checks, problem: [...rep.problems, ...(rep.refused ? [rep.refused + ' valeur(s) refusée(s) : pas un montant là où la feuille attend un montant'] : [])].join(' ; ') || null,
    preview: { rows: ex?.rows?.length || 0, capacity: Math.max(0, u.last_row - u.first_row + 1), unmatched: Object.fromEntries((rep.unmatched || []).map(x => [x.document, x.sample])) },
    doubts: [], recognised: { fiches: docs.filter(x => x.profile).map(x => ({ id: x.id, name: x.name, family: x.profile.family, what: x.profile.what, corrected_by: x.profile.corrected_by || null })) },
    missing: plan.filter(p => !p.document_id && !p.compute).map(p => ({ col: p.col, header: p.header, piece: p.missing || null, why: p.why || null })), ...extra };
}

// Prepare: the AI reads and gives the orders, the code runs them and shows the result IN the sheet. Nothing is written.
export async function fillOrdersPlan(org, mission, code, body = {}, account, d = {}) {
  const ctx = await loadContext(org, mission, code, body, account, d);
  // A PDF the AI asked for (or the screen asks to extract): turned into a verified table first, then the AI gives orders on that table.
  if (body.extract) {
    try { await (d.extractPdf || (await import('./workfile-sources.js')).extractPdfTable)(org, mission, code, { sheet: ctx.sheet, file_id: String(body.extract) }, account, d); }
    catch (e) { return forScreen(ctx, cleanOrders({}, ctx.u, []), null, { ai: 'ai', ai_error: null, problem: 'PDF non transformé en tableau : ' + String(e.message || e).slice(0, 120) }); }
    Object.assign(ctx, await loadContext(org, mission, code, body, account, d));
  }
  let got;
  try {
    if (!body.hint && !body.extract && body.reanalyse !== true) got = await reusableFillMethod(ctx, org, mission, readPiece, d);
    if (!got) got = await askAi(ctx, org, body, d);
  }
  catch (e) { return forScreen(ctx, cleanOrders({}, ctx.u, []), null, { ai: 'unavailable', ai_error: String(e?.message || e).slice(0, 200) }); }
  const { orders } = got;
  // PDFs to turn into tables first: shown as such; the screen asks for them one by one, then prepares again.
  const extra = { ai: got.provider, ai_retried: got.retried, ai_error: null, reused_method: got.method ? { validated_by: got.method.validated_by, at: got.method.validated_at } : null };
  const ex = orders.blocks.length ? await executeOrders(ctx, orders, got.readCache ? { ...d, readPiece: doc => got.readCache[doc.id] || readPiece(doc, ctx.drive, d) } : d) : null;
  const out = forScreen(ctx, orders, ex, extra);
  for (const id of orders.pdf_to_extract) out.plan.push({ col: null, header: 'PDF', document_id: id, document: ctx.docs.find(x => x.id === id)?.name || id, status: 'needs_extraction', pdf: id, why: 'tableau à extraire du PDF' });
  // The orders are kept server-side: « Oui, remplis » runs exactly these, on the files as they are then.
  try {
    const { patch } = await import('./procedure-work.js'), { rest } = await import('./supabase.js');
    const keep = (ctx.view.work?.walkthrough || []).filter(r => !(r.kind === 'fill-orders' && r.sheet === ctx.sheet));
    await (d.save || patch)(org, ctx.view.work, { walkthrough: [...keep, { kind: 'fill-orders', sheet: ctx.sheet, orders, fingerprint: ex?.table?.meta.fingerprint || null, by: account?.email || null, at: new Date().toISOString() }] }, account, d.fetchRows || rest);
  } catch { out.problem = (out.problem ? out.problem + ' ; ' : '') + 'ordres non gardés : refaites la préparation avant de remplir'; }
  return out;
}

// « Oui, remplis » : the kept orders are run again on the files, then written by the existing import. The person's approval was given on
// exactly these cells; a piece changed since = prepare again.
export async function acceptFillOrders(org, mission, code, body = {}, account, d = {}) {
  if (!account?.email) throw fail('HUMAN_IDENTITY_REQUIRED');
  const ctx = await loadContext(org, mission, code, body, account, d);
  const kept = (ctx.view.work?.walkthrough || []).filter(r => r.kind === 'fill-orders' && r.sheet === ctx.sheet).at(-1);
  if (!kept?.orders) throw fail('PREPARE_AGAIN');
  const orders = cleanOrders(kept.orders, ctx.u, ctx.docs.map(x => x.id));
  const ex = await executeOrders(ctx, orders, d);
  if (!ex.table) throw fail('POPULATION_EMPTY');
  if (kept.fingerprint && ex.table.meta.fingerprint !== kept.fingerprint) throw fail('WORK_CHANGED_PREPARE_AGAIN');
  const hasValues = i => ex.table.rows.slice(1).some(r => r[i] != null && r[i] !== '');
  const cols = ctx.u.columns.map((c, i) => ({ c, i })).filter(({ i }) => hasValues(i));
  const imp = await import('./workfile-table-import.js');
  const base = { sheet: ctx.sheet, step: Number(body.step) || 1, source_file_id: ex.driver, source_sheet: null };
  const dd = { ...d, combined: true, readTable: async () => ex.table, sources: async () => [{ file_id: ex.driver, name: ex.table.meta.name }], view: async () => ctx.view };
  const p = await (d.preview || imp.previewTableImport)(org, mission, code, base, account, dd);
  const mapping = cols.map(({ c, i }) => ({ column: colNum(c.col), source: i })).filter(m => p.columns.some(x => x.column === m.column));
  if (!mapping.length) throw fail('COLUMN_MAPPING_REQUIRED');
  const r = await (d.run || imp.runTableImport)(org, mission, code, { ...base, revision: p.revision, mapping, extend: body.extend === true }, account, dd);
  const note = d.noteMissionEvent || (await import('./mission-files.js')).noteMissionEvent;
  for (const b of orders.blocks) await note(org, mission, b.document_id, { agent: 'enhanced-auditor', what: 'remplit le working file sur ordre de l’IA', detail: ctx.sheet + ' ← ' + (b.sheet || '') + ' ' + b.columns.map(c => c.target + '←' + c.source).join(', '), by: account.email,
    uses: b.columns.map(c => ({ what: 'colonne', where: ctx.sheet + '!' + c.target, heading: (b.sheet ? b.sheet + ' ' : '') + c.source, by: account.email, at: new Date().toISOString(), active: true })) }, d).catch(() => null);
  let confirmed = false;
  if (r?.verified && r.plan_id) { try { await (d.review || (await import('./workpaper-dialogue.js')).reviewWorkpaper)(org, mission, code, { plan_id: r.plan_id, decision: 'confirm', note: 'Remplissage de ' + ctx.sheet + ' approuvé avant écriture (« Oui, remplis »), sur les ordres de l’IA' }, account, d); confirmed = true; } catch { confirmed = false; } }
  let methodLearned = false;
  if (r?.verified && confirmed) {
    try { methodLearned = Boolean(await rememberFillMethod(ctx, orders, { org, mission, account, readPiece, readCache: ex.source_reads }, d)); } catch { /* The verified write survives a memory outage; learning is reported separately. */ }
  }
  const name = id => ctx.docs.find(x => x.id === id)?.name || id;
  // The shared memory of the mission learns what was filled, from which pieces, and what is still missing — for every agent.
  if (r?.verified) await (d.noteMission || (await import('./mission-brief.js')).noteMission)(org, mission, [
    { agent: 'enhanced-auditor', kind: 'fait', about: ctx.sheet, by: account.email, source: 'working file', text: ctx.sheet + ' rempli (' + (ex.rows.length) + ' lignes) depuis ' + [...new Set(orders.blocks.map(b => name(b.document_id)))].join(', ') + ', validé par ' + account.email },
    ...orders.missing.filter(m => m.piece).map(m => ({ agent: 'enhanced-auditor', kind: 'manquant', about: ctx.sheet + (m.target ? '!' + m.target : ''), for: ['mission-controller', 'enhanced-auditor'], by: account.email, text: 'Pièce à obtenir : ' + m.piece + (m.why ? ' — ' + m.why : '') }))
  ], d).catch(() => null);
  return { ...r, confirmed, method_learned: methodLearned, checks: ex.report.checks, unmatched: Object.fromEntries(ex.report.unmatched.map(x => [x.document, x.sample])),
    filled: orders.blocks.flatMap(b => b.columns.map(c => ({ col: c.target, header: ctx.u.columns.find(x => x.col === c.target)?.header, document: name(b.document_id), heading: (b.sheet ? b.sheet + ' ' : '') + c.source }))),
    left_empty: ctx.u.columns.filter((c, i) => !hasValues(i)).map(c => ({ col: c.col, header: c.header })) };
}
