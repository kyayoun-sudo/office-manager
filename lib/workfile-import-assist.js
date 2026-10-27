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
const fold = x => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const q = encodeURIComponent;
const KIND_LABEL = { gl: 'grand livre', budget: 'budget' };
const MAX_FILES = 60;

const UNDERSTAND = `Tu es l'Enhanced Auditor d'un cabinet d'audit. On doit remplir la feuille de données « {SHEET} » d'un working file ({KIND}).
L'application (le code) a déjà regardé les pièces : pour chacune tu as le nom du fichier, la feuille, les en-têtes, 3 premières lignes, les
années, l'équilibre débit / crédit et la correspondance des colonnes proposée par le code.
1. Pour chaque pièce, dis honnêtement ce que c'est (grand livre général, grand livre auxiliaire, balance, journal, budget par catégorie,
   plan de travail / PTBA par activité, autre) et si elle peut remplir CETTE feuille, d'après ce que la feuille attend (titre, consignes,
   colonnes attendues) : un document d'un autre genre ne convient pas, même s'il a des colonnes qui se ressemblent.
2. VÉRIFIE la correspondance du code : est-elle juste ? Signale toute erreur (colonne inversée, débit / crédit, période, auxiliaire au lieu
   du général, déséquilibre…). Le code n’a fourni que des indices : corrige ses correspondances si les contenus le justifient et explique chaque changement.
3. Rattache les colonnes du modèle encore SANS correspondance aux colonnes de la pièce, par leur SENS, comme une personne qui regarde les
   deux tableaux : « Libellé » remplit une catégorie, « Budget de l'exercice » un budget, « Engagement » des engagements. Une colonne
   marquée « (document) » reçoit la valeur telle qu'elle figure dans le document. Une colonne sans équivalent dans la pièce reste vide :
   dis-le. Une même colonne de la pièce peut remplir deux colonnes du modèle si leur sens est le même (budget initial = final sans amendement).
Si « learned_from_the_auditor » est donné, c'est ce que l'auditeur a montré en remplissant lui-même cette feuille : suis cette logique.
N'invente rien.
JSON STRICT : {"sources":[{"id":"","fits":true,"what":"","period":"","why":""}],"checks":[{"id":"","ok":true,"remarks":""}],
"mappings":[{"id":"","column":0,"source":0,"why":""}]}`;

function missionYears(label) {
  const ys = (String(label || '').match(/\b(19|20)\d{2}\b/g) || []).map(Number);
  if (ys.length === 2 && ys[1] - ys[0] > 1 && ys[1] - ys[0] < 6) for (let y = ys[0] + 1; y < ys[1]; y++) ys.push(y);
  return [...new Set(ys)].sort();
}

function codeMapping(preview) {
  const mapping = preview.columns.filter(c => c.suggested_source != null).map(c => ({ column: c.column, label: c.label, source: c.suggested_source, source_label: preview.source_headers[c.suggested_source], by: 'code', why: c.suggested_why || null, to_confirm: c.suggested_sure === false }));
  // A single « Montant » column in the model, a grand livre with Débit and Crédit: the amount is Débit − Crédit (said, never hidden).
  const deb = preview.source_headers.findIndex(h => columnRole(h) === 'debit'), cre = preview.source_headers.findIndex(h => columnRole(h) === 'credit');
  for (const c of preview.columns) if (c.suggested_source == null && columnRole(c.label) === 'amount' && deb >= 0 && cre >= 0)
    mapping.push({ column: c.column, label: c.label, source: deb, minus: cre, source_label: preview.source_headers[deb] + ' − ' + preview.source_headers[cre], by: 'code' });
  return mapping;
}

// 1. The spreadsheets of the mission that may fill this sheet (quick: no file opened yet). Pieces the agents READ as a grand livre /
//    budget come first (their content, not their name, put them there); the others follow.
export async function importCandidates(org, mission, code, body = {}, account, d = {}) {
  const sheet = String(body.sheet || ''), kind = destinationRole(sheet);
  if (kind === 'unknown') return { sheet, kind, status: 'KIND_UNKNOWN', files: [] };
  const { files = [] } = await (d.options || tableImportOptions)(org, mission, code, { sheet }, account, d);
  const hint = f => { const t = String(f.document || f.type || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); return kind === 'gl' ? /grand.?livre|general ledger|ledger/.test(t) : /budget|ptba|execution|teb\b/.test(t); };
  // The pieces the working file names for this sheet, found in the mission's memory, come first (2026-10-25).
  const prefer = new Set((Array.isArray(body.prefer) ? body.prefer : []).map(String));
  // What a PERSON chose for this sheet comes before anything guessed (Paul, 2026-10-25: « les TEB sont là pour remplir D2 »).
  const chosen = new Set(await (d.chosenFor || (await import('./workfile-sources.js')).chosenFor)(mission, sheet, d).catch(() => []));
  const ordered = [...files].sort((x, y) => Number(chosen.has(y.file_id)) - Number(chosen.has(x.file_id)) || Number(prefer.has(y.file_id)) - Number(prefer.has(x.file_id)) || Number(hint(y)) - Number(hint(x)));
  // The mission's PDFs too: they cannot be imported as they are, but can be turned into a verified table first.
  let pdfs = [];
  try {
    const all = await (d.sources || (await import('./step-runner.js')).stepSources)(org, mission, { ...d, strictSources: false });
    pdfs = all.filter(f => /\.pdf$/i.test(f.name || '')).sort((x, y) => Number(chosen.has(y.file_id)) - Number(chosen.has(x.file_id)) || Number(hint({ document: (y.document || '') + ' ' + y.name })) - Number(hint({ document: (x.document || '') + ' ' + x.name })))
      .slice(0, 40).map(f => ({ file_id: f.file_id, name: f.name, read_as: f.document || null, chosen: chosen.has(f.file_id) }));
  } catch { pdfs = []; }
  return { sheet, kind, label: KIND_LABEL[kind], chosen: [...chosen], pdfs,
    files: ordered.slice(0, MAX_FILES).map(f => ({ file_id: f.file_id, name: f.name, read_as: f.document || null, chosen: chosen.has(f.file_id) })), more: Math.max(0, ordered.length - MAX_FILES) };
}

// 2. One file looked at by the CODE: its sheets, the ones that are this kind of table (by their columns), their rows, years, balance,
//    lines set aside and the columns matched. One file per call: 90 pieces never make one request too long.
export async function inspectImportFile(org, mission, code, body = {}, account, d = {}) {
  const sheet = String(body.sheet || ''), step = Number(body.step) || 1, kind = destinationRole(sheet), fileId = String(body.file_id || '');
  const options = d.options || tableImportOptions, preview = d.preview || previewTableImport;
  let r; try { r = await options(org, mission, code, { sheet, source_file_id: fileId }, account, d); } catch (e) { return { file_id: fileId, items: [], error: String(e.message || e).slice(0, 80) }; }
  const file = (r.files || []).find(f => f.file_id === fileId) || { file_id: fileId, name: body.name || fileId };
  const csv = r.format === 'csv' || /\.csv$/i.test(file.name || '') && !(r.sheets || []).length;
  const sheets = csv ? [{ name: null, role: 'unknown', headers: [] }] : (r.sheets || []);
  const worth = x => x.role === kind || csv || (body.chosen === true && (x.headers || []).filter(Boolean).length >= 2) || (x.role === 'unknown' && (x.headers || []).filter(Boolean).length >= 3 && (x.headers || []).some(h => /montant|debit|d[ée]bit|credit|cr[ée]dit|solde|amount|date|compte|budget|prevision/i.test(String(h || ''))));
  const items = [];
  for (const x of sheets) {
    try {
      const p = await preview(org, mission, code, { sheet, step, source_file_id: fileId, source_sheet: x.name }, account, d);
      items.push({ id: fileId + '|' + (x.name || ''), file: { file_id: fileId, name: file.name }, sheet: x.name, by: x.role === kind || tableRole(p.source_headers) === kind ? 'code' : null,
        p: { source_headers: p.source_headers, sample_rows: (p.sample_rows || []).map(row => row.slice(0, 20)), years: p.years || {}, rows: p.rows, gl_summary: p.gl_summary || null, set_aside: p.set_aside || null,
          columns: p.columns.map(c => ({ column: c.column, label: c.label })), start_row: p.start_row, last_row: p.last_row || null }, mapping: codeMapping(p) });
    } catch (e) { if (x.role === kind) items.push({ id: fileId + '|' + (x.name || ''), file: { file_id: fileId, name: file.name }, sheet: x.name, by: 'code', error: String(e.message || e).slice(0, 80) }); }
  }
  return { file_id: fileId, items };
}

// 3. The AI reads what the code found: says what each table is, matches the columns still empty, and CHECKS the code's choice
//    (« l'application importe, l'IA vérifie »). Then the pieces of the mission's years are ticked. Nothing written.
export async function finishImport(org, mission, code, body = {}, account, d = {}) {
  const sheet = String(body.sheet || ''), step = Number(body.step) || 1, kind = destinationRole(sheet);
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40).map(x => ({ ...x, mapping: (x.mapping || []).slice(0, 60) }));
  // What the auditor SHOWED for this sheet of this model (validated lesson) comes first: its column choices, then its rule for the AI.
  let lesson = null;
  if (body.profile?.template_key) { try { const t = await (d.templateLessons || (await import('./workfile-learn.js')).templateLessons)(String(body.profile.template_key), d); lesson = t?.[sheet]?.status === 'validated' ? t[sheet] : null; } catch { lesson = null; } }
  if (lesson) for (const x of items.filter(y => y.p)) {
    for (const lm of lesson.mappings || []) {
      const col = x.p.columns.find(c => fold(c.label) === fold(lm.dest_header)), src = x.p.source_headers.findIndex(h => fold(h) === fold(lm.source_header));
      if (!col || src < 0) continue;
      x.mapping = x.mapping.filter(m => m.column !== col.column);
      x.mapping.push({ column: col.column, label: col.label, source: src, source_label: x.p.source_headers[src], by: 'appris', why: 'comme vous l’avez fait dans Excel' });
    }
  }
  let ai = 'not_needed';
  const readable = items.filter(x => x.p);
  if (readable.length) {
    try {
      const input = JSON.stringify({ destination_sheet: { name: sheet, title: body.profile?.title || null, instructions: (body.profile?.instructions || []).slice(0, 3), expected_columns: (body.profile?.columns || []).slice(0, 40) }, destination_columns: readable[0].p.columns,
        pieces: readable.map(x => ({ id: x.id, file: x.file?.name, sheet: x.sheet, recognised_by_code: x.by === 'code', headers: x.p.source_headers, first_rows: x.p.sample_rows, years: x.p.years,
          rows: x.p.rows, balance: x.p.gl_summary, learned_from_the_auditor: lesson ? { rules: lesson.logic?.rules || [], person_rule: lesson.person_rule || null } : null, code_mapping: x.mapping.map(m => ({ column: m.column, label: m.label, source: m.source, source_label: m.source_label })) })) }).slice(0, 40000);
      const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: UNDERSTAND.replace('{SHEET}', sheet).replace('{KIND}', KIND_LABEL[kind]), input, maxTokens: 3000 });
      const out = parseJsonLoose(r.text) || {};
      ai = r.provider || 'ai';
      for (const x of readable) {
        const src = (out.sources || []).find(o => o.id === x.id);
        if (src) x.understood = { what: String(src.what || '').slice(0, 60), period: String(src.period || '').slice(0, 30), why: String(src.why || '').slice(0, 300), fits: src.fits === true };
        if (x.by !== 'personne' && x.understood) x.by = x.understood.fits ? 'ia' : null;
        const chk = (out.checks || []).find(o => o.id === x.id);
        if (chk) x.check = { ok: chk.ok === true, remarks: String(chk.remarks || '').slice(0, 400) };
        for (const m of (out.mappings || []).filter(o => o.id === x.id)) {
          const col = x.p.columns.find(cc => cc.column === Number(m.column)), srcIdx = Number(m.source);
          if (!col || !Number.isInteger(srcIdx) || srcIdx < 0 || srcIdx >= x.p.source_headers.length) continue;
          x.mapping = x.mapping.filter(mm => mm.column !== col.column || mm.by === 'personne');
          if (x.mapping.some(mm => mm.column === col.column && mm.by === 'personne')) continue;
          x.mapping.push({ column: col.column, label: col.label, source: srcIdx, source_label: x.p.source_headers[srcIdx], by: 'ia', why: String(m.why || '').slice(0, 200) });
        }
      }
    } catch (e) { ai = 'unavailable'; }
  }
  const picked = new Set(await (d.chosenFor || (await import('./workfile-sources.js')).chosenFor)(mission, sheet, d).catch(() => []));
  for (const x of items) if (!x.by && x.p && picked.has(x.file?.file_id)) x.by = 'personne';
  const fitting = items.filter(x => x.by === 'ia' || x.by === 'personne');
  if (!fitting.length) return { sheet, kind, label: KIND_LABEL[kind], status: ai === 'unavailable' ? 'AI_UNAVAILABLE' : 'UNRESOLVED', ai, items: [] };
  const m = (await (d.fetchRows || rest)(`office_missions?org_id=eq.${q(org)}&id=eq.${q(mission)}&select=period_label&limit=1`).catch(() => []))?.[0];
  const years = missionYears(m?.period_label);
  const chosen = new Set(await (d.chosenFor || (await import('./workfile-sources.js')).chosenFor)(mission, sheet, d).catch(() => []));
  const list = fitting.map(x => {
    const ys = Object.keys(x.p?.years || {}).map(Number);
    const inMission = years.length && ys.length ? ys.some(y => years.includes(y)) : null;
    x.mapping.sort((a, b) => a.column - b.column);
    return { file_id: x.file.file_id, name: x.file.name, sheet: x.sheet, by: x.by, understood: x.understood || null, check: x.check || null, error: x.error || null,
      rows: x.p?.rows || 0, years: x.p?.years || {}, gl_summary: x.p?.gl_summary || null, set_aside: x.p?.set_aside || null,
      mapping: x.mapping, unmatched: x.p ? x.p.columns.filter(c => !x.mapping.some(mm => mm.column === c.column)).map(c => c.label + (c.suggested_source == null && c.suggested_why ? ' (' + c.suggested_why + ')' : '')) : [],
      in_mission_period: inMission,
      // What share of the sheet's columns this piece fills (code + AI): a document of another kind fills few of them.
      coverage: x.p?.columns?.length ? Math.round(100 * x.mapping.length / x.p.columns.length) : 0,
      chosen: chosen.has(x.file.file_id),
      // The person's choice wins over the code's and the AI's guesses; when the person chose, only what they chose is ticked.
      recommended: chosen.size ? chosen.has(x.file.file_id) && !x.error && x.mapping.length > 0 : !x.error && x.mapping.length > 0 && inMission !== false && !(x.check && !x.check.ok) && x.understood?.fits !== false && (!x.p?.columns?.length || x.mapping.length / x.p.columns.length >= 0.4) };
  });
  // Two pieces for the same years: both shown, only the larger one ticked (a copy is never imported twice without a person).
  for (const a of list) for (const b of list) if (a !== b && a.recommended && b.recommended && !(a.chosen && b.chosen) && Object.keys(a.years).length && Object.keys(a.years).join() === Object.keys(b.years).join()) {
    const loser = a.rows < b.rows || (a.rows === b.rows && a.name > b.name) ? a : b; loser.recommended = false; loser.same_period_as = (loser === a ? b : a).name;
  }
  list.sort((a, b) => Number(b.recommended) - Number(a.recommended) || (Math.min(...Object.keys(a.years).map(Number), 9999) - Math.min(...Object.keys(b.years).map(Number), 9999)));
  return { sheet, kind, label: KIND_LABEL[kind], status: 'READY', step, mission_years: years, ai, learned: Boolean(lesson), items: list };
}

// The three steps at once (small missions, tests).
export async function proposeImport(org, mission, code, body = {}, account, d = {}) {
  const c = await importCandidates(org, mission, code, body, account, d);
  if (c.status === 'KIND_UNKNOWN') return c;
  const items = [];
  for (const f of c.files) items.push(...(await inspectImportFile(org, mission, code, { ...body, file_id: f.file_id, name: f.name }, account, d)).items);
  return finishImport(org, mission, code, { ...body, items }, account, d);
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
