// L'Enhanced Auditor apprend en regardant l'auditeur remplir le working file dans Excel (Paul, 2026-10-25 : « l'IA doit apprendre à
// utiliser l'Excel pour cette mission ; on va travailler dans le working file, sans travailler ici, et l'Enhanced Auditor devra comprendre
// la logique ; il saisit bien le PTBA mais n'arrive pas à placer les choses dans les bonnes colonnes »).
//
//   1. « Je remplis dans Excel — regarde-moi » : l'application note, pour chaque colonne à remplir du fichier, quelles lignes sont déjà
//      remplies et une empreinte de leur contenu (aucune valeur gardée : référence d'abord).
//   2. La personne travaille dans le fichier Excel (le même, dans le Drive), comme d'habitude.
//   3. « J'ai fini — apprends » : le CODE trouve les cases remplies depuis, puis cherche chaque valeur dans les pièces de la mission
//      (tableaux Excel / CSV) : pour chaque colonne de la feuille, de quelle colonne de quelle pièce viennent les valeurs, et quelles
//      lignes de la pièce ont été prises. L'IA lit ces constats et écrit la LOGIQUE (« Catégorie ← colonne Rubrique du PTBA, seulement
//      les lignes de rubrique B.x ; Budget initial ← colonne 2023 ; les lignes SOUS-COMPOSANTE ne sont pas recopiées »), sans valeurs.
//   4. La personne dit « Oui, c'est ça — retiens » ou corrige la règle. Seule une leçon validée sert ensuite, pour CE modèle de working
//      file (clé du modèle) : la correspondance apprise passe avant celle que le code devine, et la règle est donnée à l'IA.
// Mémoire : OFFICE_MANAGER_WORKFILE_LESSONS.json dans la mémoire des agents (une par Drive), par modèle et par feuille ; aucune donnée
// du client n'y est gardée (en-têtes, règles, nombres de cases seulement).
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, saveJsonFile } from './mapping-scan.js';
import { procedureView, patch } from './procedure-work.js';
import { mapWorkingFile, cellText, colNumber } from './workfile-map.js';
import { stepSources } from './step-runner.js';
import { clientTable, tableImportOptions } from './workfile-table-import.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { audit } from './audit-log.js';

const FILE = 'OFFICE_MANAGER_WORKFILE_LESSONS.json';
const fail = (code, status = 409) => Object.assign(new Error(code), { statusCode: status });
const hash = x => createHash('sha256').update(String(x)).digest('hex').slice(0, 16);
const fold = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const ROLES = ['data', 'test', 'lead', 'reconciliation', 'programme', 'synthesis', 'anomalies', 'pbc'];

// A value as it can be compared between a piece and the working file (number, date, text).
export function norm(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : 'd:' + v.toISOString().slice(0, 10);
  if (typeof v === 'object') return norm(v.result ?? v.text ?? (v.richText ? v.richText.map(t => t.text).join('') : null));
  if (typeof v === 'number') return Number.isFinite(v) ? 'n:' + Math.round(v * 100) / 100 : null;
  const s = String(v).trim();
  const dm = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dm) return 'd:' + dm[3] + '-' + dm[2].padStart(2, '0') + '-' + dm[1].padStart(2, '0');
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return 'd:' + s.slice(0, 10);
  const n = /^[-+(]?[\d\s .,]+\)?$/.test(s) && /\d/.test(s) ? Number(s.replace(/[\s ]/g, '').replace(/\((.*)\)/, '-$1').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '')) : NaN;
  if (Number.isFinite(n)) return 'n:' + Math.round(n * 100) / 100;
  const t = fold(s);
  return t.length >= 2 ? 't:' + t : null;
}

const ranges = rows => { const out = []; let a = null, b = null; for (const r of [...rows].sort((x, y) => x - y)) { if (a == null) { a = b = r; } else if (r === b + 1) b = r; else { out.push(a === b ? String(a) : a + '-' + b); a = b = r; } } if (a != null) out.push(a === b ? String(a) : a + '-' + b); return out.join(','); };
const unrange = s => { const out = new Set(); for (const p of String(s || '').split(',').filter(Boolean)) { const [a, b] = p.split('-').map(Number); for (let r = a; r <= (b || a); r++) out.add(r); } return out; };

// The input columns of the workbook (by the map), each with the rows that hold something and a fingerprint of their content.
export function snapshot(wb, map) {
  const out = {};
  for (const s of map.sheets.filter(x => ROLES.includes(x.role) && x.tables?.length)) {
    const ws = wb.getWorksheet(s.name); if (!ws) continue;
    const cols = {};
    for (const t of s.tables) for (const c of t.columns.filter(c => ['fact', 'free', 'judgment'].includes(c.role))) {
      const rows = [], parts = [];
      for (let r = t.first_row; r <= t.last_row; r++) { const v = cellText(ws.getCell(c.col + r).value).trim(); if (v) { rows.push(r); parts.push(r + '=' + v); } }
      cols[c.col] = { header: c.header, filled: ranges(rows), fp: hash(parts.join('\n')) };
    }
    for (const f of s.fields || []) { const v = cellText(ws.getCell(f.address).value).trim(); cols['@' + f.address] = { header: f.label, filled: v ? '1' : '', fp: hash(v) }; }
    out[s.name] = cols;
  }
  return out;
}

async function loadWorkbook(view, d) {
  const fileId = view.workpaper?.file_id; if (!fileId) throw fail('NO_WORKPAPER_FOR_CYCLE');
  const drive = d.drive || driveAdapter, meta = await drive.getMeta(fileId);
  if (Number(meta?.size || 0) > 20 * 1024 * 1024) throw fail('WORKBOOK_TOO_LARGE', 413);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await drive.downloadBuffer(fileId)));
  return { wb, meta, fileId, map: mapWorkingFile(wb) };
}
const activeWatch = view => [...(view.work?.walkthrough || [])].reverse().find(r => r.kind === 'learning-watch' && r.status === 'watching' && r.file_id === view.workpaper?.file_id) || null;

export async function startWatch(org, mission, code, body = {}, account, d = {}) {
  const view = await (d.view || procedureView)(org, mission, code, account, d);
  if (view.editable === false) throw fail('NOT_PREPARER', 403);
  const { wb, meta, fileId, map } = await loadWorkbook(view, d);
  const rec = { kind: 'learning-watch', id: 'watch-' + Date.now().toString(36), status: 'watching', file_id: fileId, template: map.key, modified_at: meta?.modifiedTime || null,
    by: account?.email || null, at: new Date().toISOString(), cols: snapshot(wb, map) };
  const others = (view.work.walkthrough || []).map(r => (r.kind === 'learning-watch' && r.status === 'watching' ? { ...r, status: 'replaced', cols: undefined } : r));
  await (d.save || patch)(org, view.work, { walkthrough: [...others, rec] }, account, d.fetchRows || rest);
  return { watching: true, id: rec.id, at: rec.at, url: view.workpaper?.url || null };
}

export async function cancelWatch(org, mission, code, body = {}, account, d = {}) {
  const view = await (d.view || procedureView)(org, mission, code, account, d);
  const w = activeWatch(view); if (!w) return { watching: false };
  await (d.save || patch)(org, view.work, { walkthrough: view.work.walkthrough.map(r => (r.id === w.id ? { ...r, status: 'cancelled', cols: undefined } : r)) }, account, d.fetchRows || rest);
  return { watching: false };
}

// The cells filled since the watch began, per sheet: [{ col, header, row, value }] (values kept in memory for this request only).
export function changesSince(wb, map, cols) {
  const out = {};
  for (const [sheet, before] of Object.entries(cols || {})) {
    const ws = wb.getWorksheet(sheet), s = map.sheets.find(x => x.name === sheet); if (!ws || !s) continue;
    const now = snapshot(wb, { sheets: [s] })[sheet] || {};
    const cells = [], modified = [];
    for (const [col, b] of Object.entries(before)) {
      const n = now[col]; if (!n || n.fp === b.fp) continue;
      const was = unrange(b.filled), added = [...unrange(n.filled)].filter(r => !was.has(r));
      if (col.startsWith('@')) { cells.push({ col, header: b.header, row: null, value: cellText(ws.getCell(col.slice(1)).value).trim() }); continue; }
      for (const r of added) cells.push({ col, header: b.header, row: r, value: ws.getCell(col + r).value });
      if (!added.length) modified.push(b.header);
    }
    if (cells.length || modified.length) out[sheet] = { cells, modified };
  }
  return out;
}

// Where the new values come from: for each column of the sheet, the column of a piece that holds most of them, and the piece's rows used.
export function traceColumns(cells, tables) {
  const index = new Map();
  for (const t of tables) t.rows.forEach((row, i) => (row || []).forEach((v, c) => { const k = norm(v); if (!k) return; if (!index.has(k)) index.set(k, []); index.get(k).push({ t, c, r: i }); }));
  const byCol = {};
  for (const cell of cells) { (byCol[cell.col] ||= { header: cell.header, cells: [] }).cells.push(cell); }
  const out = [];
  for (const [col, x] of Object.entries(byCol)) {
    const counts = new Map(), rowsUsed = new Map();
    let usable = 0;
    for (const cell of x.cells) {
      const k = norm(cell.value); if (!k) continue; usable++;
      const seen = new Set();
      for (const h of index.get(k) || []) { const key = h.t.id + '#' + h.c; if (seen.has(key)) continue; seen.add(key); counts.set(key, (counts.get(key) || 0) + 1); if (!rowsUsed.has(key)) rowsUsed.set(key, new Set()); rowsUsed.get(key).add(h.r); }
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best || !usable) { out.push({ col, header: x.header, filled: x.cells.length, source: null }); continue; }
    const [key, n] = best, at = key.lastIndexOf('#'), tid = key.slice(0, at), c = key.slice(at + 1), t = tables.find(y => y.id === tid);
    out.push({ col, header: x.header, filled: x.cells.length, support: n + '/' + usable, sure: n / usable >= 0.6,
      source: { file_id: t.file_id, name: t.name, sheet: t.sheet, column: Number(c), header: t.headers[Number(c)] ?? null }, rows_used: [...rowsUsed.get(key)].sort((a, b) => a - b) });
  }
  return out;
}

const EXPLAIN = `Tu es l'Enhanced Auditor d'un cabinet d'audit. Un auditeur vient de remplir lui-même la feuille « {SHEET} » du working file dans Excel.
Le code a comparé avant / après et a cherché d'où viennent les valeurs dans les pièces de la mission. À partir de ces constats, écris la
LOGIQUE qu'il a suivie, pour que tu saches la refaire seul la prochaine fois sur ce modèle : pour chaque colonne remplie, d'où vient la
valeur (pièce, colonne), quelle transformation (copie, somme, différence, constante, lue dans un document, autre), et QUELLES LIGNES de la
pièce sont prises ou laissées (ex. seulement les lignes de rubrique, pas les sous-totaux ni les titres de composante). N'invente rien : ce
que les constats ne montrent pas, pose-le en question. N'écris AUCUNE valeur chiffrée du client dans les règles.
JSON STRICT : {"summary":"","rules":[{"column":"","from":"","transform":"copy|sum|difference|constant|from_document|other","rows":"","note":""}],"questions":[""]}`;

async function lessons(d) { return (d.loadJsonFile || loadJsonFile)(FILE, d.drive || driveAdapter, d.folder || memoryFolderId()); }
export async function templateLessons(templateKey, d = {}) { const { state } = await lessons(d).catch(() => ({ state: null })); return state?.templates?.[templateKey] || {}; }

export async function learnFromPerson(org, mission, code, body = {}, account, d = {}) {
  const view = await (d.view || procedureView)(org, mission, code, account, d);
  const w = activeWatch(view); if (!w) throw fail('NO_ACTIVE_WATCH');
  const { wb, map } = await loadWorkbook(view, d);
  const changes = changesSince(wb, map, w.cols);
  if (!Object.keys(changes).length) return { learned: [], nothing_changed: true, note: 'Aucune case remplie depuis « regarde-moi » : enregistrez le fichier dans Excel, attendez que le Drive le synchronise, puis réessayez.' };
  // The tables of the mission's pieces (spreadsheets), every visible sheet: where the values may come from.
  const sources = (await (d.sources || stepSources)(org, mission, d).catch(() => [])).filter(s => /\.(xlsx|xls|csv)$/i.test(s.name || '') && s.file_id !== view.workpaper.file_id).slice(0, 10);
  const tables = [];
  for (const s of sources) {
    let sheets = [null];
    try { const o = await (d.options || tableImportOptions)(org, mission, code, { sheet: '', source_file_id: s.file_id }, account, d); if ((o.sheets || []).length) sheets = o.sheets.map(x => x.name); } catch { /* single table */ }
    for (const sh of sheets.slice(0, 4)) {
      try { const t = await (d.readTable || clientTable)(s.file_id, d.drive || driveAdapter, sh); tables.push({ id: s.file_id + '|' + (sh || ''), file_id: s.file_id, name: s.name, sheet: sh, headers: (t.rows[t.header_row] || []).map(x => String(x ?? '')), rows: t.rows }); } catch { /* unreadable */ }
    }
  }
  const learned = [];
  for (const [sheet, ch] of Object.entries(changes)) {
    const s = map.sheets.find(x => x.name === sheet);
    const traces = traceColumns(ch.cells.filter(c => c.row != null), tables);
    // What the AI reads: the headers and the rules found, a few rows taken and left in the piece (to see which lines were chosen).
    const main = traces.filter(t => t.source).sort((a, b) => b.filled - a.filled)[0];
    const tbl = main && tables.find(t => t.file_id === main.source.file_id && t.sheet === main.source.sheet);
    const used = main ? new Set(main.rows_used) : new Set();
    const sample = tbl ? { headers: tbl.headers, taken: tbl.rows.map((r, i) => ({ i, r })).filter(x => used.has(x.i)).slice(0, 8).map(x => x.r.slice(0, 12)),
      left: tbl.rows.map((r, i) => ({ i, r })).filter(x => !used.has(x.i) && x.i > 0 && (x.r || []).some(v => v != null && v !== '')).slice(0, 8).map(x => x.r.slice(0, 12)) } : null;
    let ai = null, provider = null;
    try {
      const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: EXPLAIN.replace('{SHEET}', sheet), maxTokens: 2000,
        input: JSON.stringify({ sheet: { name: sheet, title: s?.title, instructions: (s?.instructions || []).map(i => i.text).slice(0, 3) }, filled_cells: ch.cells.length, modified_columns: ch.modified,
          columns: traces.map(t => ({ column: t.header, filled: t.filled, from: t.source ? { piece: t.source.name, sheet: t.source.sheet, column: t.source.header, support: t.support } : null })),
          rows_of_the_piece: sample }).slice(0, 30000) });
      ai = parseJsonLoose(r.text) || null; provider = r.provider || null;
    } catch { ai = null; }
    learned.push({ sheet, filled: ch.cells.length, modified: ch.modified,
      mappings: traces.filter(t => t.source).map(t => ({ dest_header: t.header, source_header: t.source.header, source_name: t.source.name, support: t.support, sure: t.sure })),
      unmatched: traces.filter(t => !t.source).map(t => t.header),
      logic: ai ? { summary: String(ai.summary || '').slice(0, 800), rules: (ai.rules || []).slice(0, 30).map(x => ({ column: String(x.column || '').slice(0, 80), from: String(x.from || '').slice(0, 200), transform: String(x.transform || '').slice(0, 30), rows: String(x.rows || '').slice(0, 300), note: String(x.note || '').slice(0, 300) })), questions: (ai.questions || []).slice(0, 6).map(q => String(q).slice(0, 300)), by: provider } : null });
  }
  // Remembered as « to confirm » (headers and rules only, no client values), per template and sheet.
  const L = await lessons(d).catch(() => ({ state: null, fileId: null }));
  const all = L.state || { templates: {} }; all.templates ||= {};
  const t = (all.templates[map.key] ||= {});
  for (const x of learned) t[x.sheet] = { ...x, status: 'to_confirm', mission_id: mission, by: account?.email || null, at: new Date().toISOString(), history: [...(t[x.sheet]?.history || []).slice(-5), t[x.sheet] ? { status: t[x.sheet].status, at: t[x.sheet].at } : null].filter(Boolean) };
  await (d.saveJsonFile || saveJsonFile)(FILE, d.drive || driveAdapter, d.folder || memoryFolderId(), L.fileId, all);
  await (d.save || patch)(org, view.work, { walkthrough: view.work.walkthrough.map(r => (r.id === w.id ? { ...r, status: 'learned', cols: undefined, learned_at: new Date().toISOString(), sheets: learned.map(x => x.sheet) } : r)) }, account, d.fetchRows || rest);
  await (d.audit || audit)(org, { agent: 'enhanced-auditor', mission_id: mission, action_type: 'WORKFILE_LOGIC_LEARNED', status: 'succeeded', approved_by: account?.email || null,
    decision: learned.map(x => x.sheet + ' : ' + x.mappings.length + ' colonne(s) tracée(s)').join(' ; ').slice(0, 900) }).catch(() => null);
  return { template: map.key, learned };
}

// The person confirms (« Oui, c'est ça — retiens »), corrects (her rule kept, it wins over the AI's), or refuses.
export async function confirmLesson(org, mission, code, body = {}, account, d = {}) {
  await (d.view || procedureView)(org, mission, code, account, d);
  const L = await lessons(d); const t = L.state?.templates?.[String(body.template || '')]; const x = t?.[String(body.sheet || '')];
  if (!x) throw fail('LESSON_NOT_FOUND', 404);
  const decision = ['validated', 'rejected'].includes(body.decision) ? body.decision : null; if (!decision) throw fail('DECISION_REQUIRED', 400);
  x.status = decision; x.decided_by = account?.email || null; x.decided_at = new Date().toISOString();
  if (body.note) x.person_rule = String(body.note).slice(0, 2000);
  await (d.saveJsonFile || saveJsonFile)(FILE, d.drive || driveAdapter, d.folder || memoryFolderId(), L.fileId, L.state);
  await (d.audit || audit)(org, { agent: 'enhanced-auditor', mission_id: mission, action_type: 'WORKFILE_LESSON_' + decision.toUpperCase(), status: 'succeeded', approved_by: account?.email || null, decision: body.template + ' / ' + body.sheet + (body.note ? ' — règle corrigée' : '') }).catch(() => null);
  return { template: body.template, sheet: body.sheet, status: decision };
}

// For the screen: the watch in progress and what was learned for this template.
export async function learningState(view, templateKey, d = {}) {
  const w = activeWatch(view);
  const t = await templateLessons(templateKey, d);
  return { watch: w ? { id: w.id, at: w.at, by: w.by } : null, template: templateKey,
    lessons: Object.entries(t).map(([sheet, x]) => ({ sheet, status: x.status, filled: x.filled, mappings: x.mappings, unmatched: x.unmatched, logic: x.logic, person_rule: x.person_rule || null, at: x.at, by: x.by })) };
}

// From Excel (the add-in): which procedures of the mission work in this file (its cycle's working paper), the person's first.
export async function proceduresForFile(org, body = {}, account, d = {}) {
  const missionId = String(body.mission_id || ''), fileId = String(body.file_id || '');
  if (!missionId || !fileId) return { procedures: [] };
  const q = encodeURIComponent, fetchRows = d.fetchRows || rest;
  const prog = (await fetchRows(`office_work_programmes?org_id=eq.${q(org)}&office_mission_id=eq.${q(missionId)}&status=eq.validated&select=cycles,workpapers&order=version.desc&limit=1`).catch(() => []))?.[0];
  const cycles = new Set((prog?.workpapers || []).filter(w => w.file_id === fileId).map(w => w.cycle_code));
  const me = [account?.email, account?.display_name].filter(Boolean).map(x => String(x).toLowerCase());
  const out = [];
  for (const c of prog?.cycles || []) if (cycles.has(c.cycle_code)) for (const p of c.procedures || []) if (p.active)
    out.push({ code: p.code, title: p.title || p.name || p.code, mine: me.includes(String(p.preparer || c.preparer || '').toLowerCase()) });
  out.sort((a, b) => Number(b.mine) - Number(a.mine));
  return { procedures: out };
}
