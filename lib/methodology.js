import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, updateJsonFile } from './mapping-scan.js';
import { configuredDriveId } from './google-drive.js';
import { extractStructuredOffice } from './office-structured-reader.js';
import { audit } from './audit-log.js';
// Firm settings: strict read, change applied on the current row (audit 2026-10-30).
const changeSettings = async (...a) => (await import('./firm-settings-store.js')).changeFirmSettings(...a);

// THE FIRM'S METHODOLOGY LIBRARY (Paul, 2026-10-12: « on a les SOP par cycle… le Mission Controller proposera les
// tests à faire avec leurs nomenclatures dans les SOP »). The firm's SOP (Word) are read procedure by procedure, by
// CODE, not by AI: every procedure of a SOP has the same card (code, objective, risk, assertion, population /
// selection │ type │ level, « ce qu'il faut demander », how to prepare the population, how to sample, steps, WP
// columns, conclusion). The library is the firm's own (another firm loads its own SOP — nothing about TATY here);
// it is kept in the agents' Drive memory (OFFICE_MANAGER_METHODOLOGY.json, one per Drive) with the source file id,
// its name and its modification time (reference first: the Word stays in the firm's Drive). What cannot be read is
// said (« je ne peux pas encore le lire »), never guessed.

export const METHODOLOGY_FILE = 'OFFICE_MANAGER_METHODOLOGY.json';
const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const FOLDER = 'application/vnd.google-apps.folder';
const READ_LIMIT = 400000;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const clean = s => String(s ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const fold = s => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").toLowerCase();

// A procedure title: « ACH-03 - Test de détail des charges », « 5. PRJ-03 - Budget… », « CASH-01 : … ».
const PROC = /^(?:\d+\.\s*)?([A-Z][A-Z0-9_]{1,7}-\d{1,3}[A-Z]?)\s*[-–—:]\s*(.+)$/;
// Sub-parts of a procedure card (number optional: Word auto-numbering is not in the text).
const PARTS = [
  ['ask', /^(?:\d+\.\s*)?ce qu'il faut demander/],
  ['population', /^(?:\d+\.\s*)?comment preparer la population/],
  ['sampling', /^(?:\d+\.\s*)?comment prendre (l'echantillon|la selection)/],
  ['steps', /^(?:\d+\.\s*)?(pour chaque element|pour chacun|ce qu'il faut faire)/],
  ['exceptions', /^(?:\d+\.\s*)?si (ca|cela) ne correspond pas/],
  ['conclusion', /^(?:\d+\.\s*)?conclusion$/]
];
const END_OF_PROCEDURES = /^(?:\d+\.\s*)?conclusion du cycle/;
const TECHNICAL_REFERENCES = /^(?:\d+\.\s*)?references techniques\b/;
const COMMON_STEP = /^(retrouve l'ecriture au grand livre|reporte dans le wp)/;
// Two card layouts exist (SYCEBNL: Objectif / Risque / Assertion / Population │ sélection │ type │ niveau;
// general audit: Objectif / Risque / assertions / Population / sélection / Type / niveau SOP).
const LABELS = { objectif: 'objective', risque: 'risk', assertion: 'assertion', assertions: 'assertion', 'risque / assertions': 'risk_row',
  'population / selection': 'population_row', 'population/selection': 'population_row', 'type / niveau sop': 'type_row', 'type / niveau': 'type_row' };

// The five ways the SOP take a sample (the same sentences in every SOP).
export function samplingMode(text) {
  const t = fold(text);
  if (!t) return null;
  if (/pas d'echantillon/.test(t)) return 'none';
  if (/aleatoire/.test(t)) return 'random';
  if (/representative|transaction representative|operation representative/.test(t)) return 'walkthrough';
  if (/methode et la taille approuvees|isa 530|taille approuvee|selon (le )?programme/.test(t)) return 'programme_sample';
  if (/criteres directement lies au risque|criteres de risque|basee? sur (le )?risque|cible|motif de selection/.test(t)) return 'risk_targeted';
  if (/ensemble de la population|exhaustiv|toute la population/.test(t)) return 'exhaustive';
  return 'other';
}
export const SAMPLING_LABELS = { none: 'Pas d’échantillon', walkthrough: '1 transaction dirigée (walkthrough)', exhaustive: 'Toute la population', risk_targeted: 'Ciblage par risque', programme_sample: 'Échantillon du programme (taille fixée par le Manager)', random: 'Échantillon aléatoire', other: 'Autre (voir le SOP)' };

const TYPE_RE = /\b(MANDATORY|CORE|RISK[- ]?DEPENDENT|OPTIONAL|OPTIONNEL(LE)?)\b/i;
function typeOf(raw) {
  const type = /RISK[- ]?DEPENDENT/i.test(raw) ? 'RISK_DEPENDENT' : /OPTION/i.test(raw) ? 'OPTIONAL' : /CORE|MANDATORY/i.test(raw) ? 'CORE' : null;
  const condition = clean(String(raw).replace(/\b(MANDATORY\s*\/\s*CORE|MANDATORY|CORE|RISK[- ]?DEPENDENT|OPTIONAL|OPTIONNEL(LE)?)\b/ig, '')) || null;
  return { type, condition };
}
// A sample size written in the SOP (« Échantillon aléatoire (25 items) », « 25 virements aléatoires »).
export function sampleSize(text) {
  const m = /\((\d{1,4})\s*(?:items?|elements?)\)|\b(\d{1,4})\s+(?:items?|elements?|\w+)\s+aleatoires?/.exec(fold(text));
  return m ? Number(m[1] || m[2]) : null;
}

// « Population des charges │ échantillon selon programme approuvé │ CORE si matériel │ Niveau : Junior »
export function parsePopulationRow(value) {
  const parts = String(value || '').split(/\s*[│|]\s*/).map(clean).filter(Boolean);
  const raw = parts.find(p => TYPE_RE.test(p)) || '';
  const { type, condition } = typeOf(raw);
  const levelPart = parts.find(p => /niveau\s*:/i.test(p)) || '';
  const level = clean(levelPart.replace(/^.*niveau\s*:\s*/i, '')) || null;
  const rest = parts.filter(p => p !== raw && p !== levelPart);
  return { population: rest[0] || null, selection: rest[1] || null, type, condition, level };
}

// sections: [{ text, heading_level?, table_id? }] in document order; tables: [{ table_id, rows: [[cell…]] }]
// (the shape returned by extractStructuredOffice). Returns the cycle and its procedures, and what is missing.
export function parseSop({ sections = [], tables = [] }, file = {}) {
  const tableById = new Map(tables.map(t => [t.table_id, t]));
  const blocks = sections.map(s => s.table_id ? { table: tableById.get(s.table_id)?.rows || [] } : { text: clean(s.text), level: s.heading_level || null });
  // A procedure starts at a title followed by its card table (the summary lines are followed by another title).
  const starts = [];
  for (let i = 0; i < blocks.length; i++) {
    const m = blocks[i].text && PROC.exec(blocks[i].text);
    if (!m) continue;
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocks[j].text && PROC.test(blocks[j].text)) break;
      if (blocks[j].table && blocks[j].table.some(r => /^objectif$/.test(fold(r[0])))) { starts.push({ i, code: m[1], title: clean(m[2]) }); break; }
    }
  }
  const procedures = [];
  const issues = [];
  for (let k = 0; k < starts.length; k++) {
    const { i, code, title } = starts[k];
    let end = k + 1 < starts.length ? starts[k + 1].i : blocks.length;
    for (let j = i + 1; j < end; j++) {
      if (!blocks[j].text) continue;
      const heading = fold(blocks[j].text);
      // SYCEBNL puts references BEFORE the execution sections. Only a terminal
      // bibliography ends the card; references followed by card sections do not.
      const terminalReferences = TECHNICAL_REFERENCES.test(heading) &&
        !blocks.slice(j + 1, end).some(b => b.text && PARTS.some(([, re]) => re.test(fold(b.text))));
      if (END_OF_PROCEDURES.test(heading) || terminalReferences) { end = j; break; }
    }
    const p = { code, title, objective: null, risk: null, assertion: null, population: null, selection: null, type: null, condition: null, level: null,
      instruction: null, sample_size: null, ask: [], population_steps: [], sampling: [], sampling_mode: null, steps: [], exceptions: [], wp_columns: [], conclusion_template: null };
    let part = null;
    for (let j = i + 1; j < end; j++) {
      const b = blocks[j];
      if (b.table) {
        for (const row of b.table) {
          const key = LABELS[fold(row[0])];
          if (!key) continue;
          const value = clean(row.slice(1).join(' │ '));
          const cells = row.slice(1).join(' │ ').split(/\s*[│|]\s*/).map(clean).filter(Boolean);
          if (key === 'population_row') { const r = parsePopulationRow(row.slice(1).join(' │ ')); for (const [k, v] of Object.entries(r)) if (v != null || p[k] == null) p[k] = v ?? p[k]; }
          else if (key === 'risk_row') { p.risk = cells[0] || null; p.assertion = cells.slice(1).join(' ; ') || null; }
          else if (key === 'type_row') { Object.assign(p, typeOf(cells.find(c => TYPE_RE.test(c)) || '')); p.level = cells.find(c => !TYPE_RE.test(c)) || null; }
          else p[key] = value || null;
        }
        // The general SOP put the conclusion model in a one-cell table (« Conclusion - modèle court « … » »).
        const first = clean(b.table[0]?.[0]);
        if (/^conclusion/.test(fold(first)) && !p.conclusion_template) p.conclusion_template = clean((/[«"](.+)[»"]/.exec(first) || [, first.replace(/^[^«"]*/, '')])[1]) || null;
        continue;
      }
      const t = b.text; const f = fold(t);
      if (!t) continue;
      const hit = PARTS.find(([, re]) => re.test(f));
      if (hit) { part = hit[0]; continue; }
      if (/^instruction du sop\s*:/.test(f)) { p.instruction = clean(t.replace(/^[^:]*:\s*/, '')); continue; }
      if (TECHNICAL_REFERENCES.test(f)) { part = null; continue; }
      if (/^working paper\s*-?\s*colonnes/.test(f)) { p.wp_columns = t.replace(/^[^:]*:\s*/, '').split('|').map(clean).filter(Boolean); continue; }
      const item = clean(t.replace(/^\d+\.\s*/, ''));
      if (part === 'ask') { if (!/^pieces du test\.?$/.test(fold(item))) p.ask.push(item); }
      else if (part === 'population') p.population_steps.push(item);
      else if (part === 'sampling') p.sampling.push(item);
      else if (part === 'steps') p.steps.push({ text: item, common: COMMON_STEP.test(fold(item)) });
      else if (part === 'exceptions') p.exceptions.push(item);
      else if (part === 'conclusion') p.conclusion_template = clean(item.replace(/^[«"]\s*|\s*[»"]$/g, ''));
    }
    const fromText = samplingMode(p.sampling.join(' '));
    p.sampling_mode = fromText && fromText !== 'other' ? fromText : (samplingMode(p.selection) || fromText);
    p.sample_size = sampleSize([p.selection, ...p.sampling].join(' '));
    const missing = ['objective', 'type', 'level'].filter(key => !p[key]);
    if (!p.steps.some(s => !s.common)) missing.push('steps');
    if (missing.length) issues.push({ code, issue: 'PROCEDURE_INCOMPLETE', missing });
    procedures.push(p);
  }
  // Copy errors the firm should fix in its Word (Paul's SOP had some): same instruction or same objective under two
  // different titles. Information only — the screen shows what the Word says.
  for (const field of ['instruction', 'objective']) {
    const seen = new Map();
    for (const p of procedures) if (p[field] && !(field === 'instruction' && /conformement aux etapes/.test(fold(p[field])))) (seen.get(fold(p[field])) || seen.set(fold(p[field]), []).get(fold(p[field]))).push(p);
    for (const list of seen.values()) if (list.length > 1 && new Set(list.map(p => fold(p.title))).size > 1 && list.some(p => fold(p.title) !== fold(p[field]))) {
      issues.push({ code: list.map(p => p.code).join(', '), issue: field === 'instruction' ? 'SAME_INSTRUCTION_DIFFERENT_TITLES' : 'SAME_OBJECTIVE_DIFFERENT_TITLES', text: list[0][field] });
    }
  }
  return { cycle: cycleOf(blocks, procedures, file), procedures, issues };
}

// The cycle: « Cycle 02 - ACH - Achats / … », « Transversal 01 - PRJ - … », else the procedures' prefix and the file name.
function cycleOf(blocks, procedures, file) {
  const prefixes = [...new Set(procedures.map(p => p.code.split('-')[0]))];
  let title = null, number = null, code = prefixes.length === 1 ? prefixes[0] : null;
  for (const b of blocks.slice(0, 40)) {
    const m = b.text && /^(cycle|transversal|sop)\s*(\d+)\s*[-–—]\s*([A-Z][A-Z_]{1,7})\s*[-–—]\s*(.+)$/i.exec(b.text);
    if (m) { number = m[2]; code = code || m[3].toUpperCase(); title = clean(m[4]); break; }
  }
  if (!title) title = clean(String(file.name || '').replace(/\.docx$/i, '').replace(/[_]+/g, ' ')) || code;
  const text = blocks.filter(b => b.text).map(b => b.text);
  const after = re => { const i = text.findIndex(t => re.test(fold(t))); return i >= 0 ? clean(text[i].replace(/^[^:]*:\s*/, '')) : null; };
  const pbc = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].text && /^pbc principale/.test(fold(blocks[i].text))) {
      const table = blocks.slice(i + 1, i + 4).find(b => b.table)?.table || [];
      for (const row of table.slice(1)) if (clean(row[0])) pbc.push({ document: clean(row[0]), purpose: clean(row[1]) || null });
      break;
    }
  }
  return { code, number, title, objective: after(/^objectif du sop\s*:/), flow: after(/^flux de reference\s*:/), pbc };
}

// ---- Loading from the firm's Drive -------------------------------------------------------------

// The SOP Word files under a folder (sub-folders included, 3 levels, 120 files at most).
export async function listSopFiles(folderId, drive = driveAdapter, depth = 0, path = '') {
  if (!folderId) throw fail('METHODOLOGY_FOLDER_REQUIRED');
  const children = await drive.listChildren(folderId);
  const out = [];
  for (const c of children || []) {
    if (out.length >= 120) break;
    if (c.mimeType === FOLDER && depth < 3) out.push(...await listSopFiles(c.id, drive, depth + 1, path ? path + '/' + c.name : c.name));
    else if (c.mimeType === WORD && !/^~\$/.test(c.name || '')) out.push({ id: c.id, name: c.name, family: path || null, modified_time: c.modifiedTime || null });
  }
  return out.slice(0, 120);
}

export async function readSopFile(file, drive = driveAdapter) {
  try {
    const buffer = await drive.downloadBuffer(file.id);
    const read = await extractStructuredOffice(Buffer.from(buffer), WORD, READ_LIMIT);
    const parsed = parseSop(read, file);
    const status = !parsed.procedures.length ? 'NO_PROCEDURE_FOUND' : read.truncated ? 'PARTIAL' : 'READ';
    return { file_id: file.id, file_name: file.name, family: file.family || null, modified_time: file.modified_time || null, status, ...parsed };
  } catch (e) {
    return { file_id: file.id, file_name: file.name, family: file.family || null, modified_time: file.modified_time || null, status: 'NOT_READ', error: String(e.message || e).slice(0, 120), procedures: [], issues: [] };
  }
}

const currentDrive = d => { try { return d.driveId !== undefined ? d.driveId : configuredDriveId(); } catch { return null; } };

// THE LIBRARY NEVER DISAPPEARS (Paul, 2026-10-19 : « j'ai mis le lien de la méthodologie, il a tout lu ; je reviens, elle a
// disparu » — trois fois). The library lives in the agents' memory folder of the Drive; that folder can change (memory moved
// home, Drive re-chosen, a cache that has not loaded the Drive yet) and the old « drive_id » check hid a library that was
// there. Now the firm's settings keep a small pointer (the library file's ID, the SOP folder, when) — an ID, never the SOP:
//   1. the library in the current memory folder → shown;
//   2. otherwise the pointed file, wherever it now is (not in the bin) → shown, and copied back into the current memory;
//   3. otherwise the SOP folder is known → « reload » (the page relaunches the reading by itself, nothing to paste again).
async function pointer(orgId, d) {
  if (!orgId) return null;
  const rows = await (d.fetchRows || (await import('./supabase.js')).rest)('office_firm_settings?org_id=eq.' + encodeURIComponent(orgId) + '&select=settings&limit=1').catch(() => null);
  return rows?.[0]?.settings?.methodology || null;
}
export async function rememberPointer(orgId, patch, d = {}) {
  if (!orgId) return null;
  const fetchRows = d.fetchRows || (await import('./supabase.js')).rest;
  // A failed read used to become {} and the write then erased every other setting of the firm (audit 2026-10-30).
  const saved = await changeSettings(orgId, settings => ({ ...settings, methodology: { ...(settings.methodology || {}), ...patch, updated_at: new Date().toISOString() } }), { fetchRows }).catch(() => null);
  return saved?.methodology || null;
}

export async function methodologyState(d = {}, orgId = null) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const here = folder ? await loadJsonFile(METHODOLOGY_FILE, drive, folder).catch(() => ({ state: null })) : { state: null };
  const ptr = await pointer(orgId, d);
  // The file found in THIS Drive's memory is the proof it belongs here (one memory per Drive): no other check hides it.
  if (here.state?.sops) {
    if (orgId && here.fileId && ptr?.file_id !== here.fileId && here.state.status === 'ready') await rememberPointer(orgId, { file_id: here.fileId, source_folder_id: here.state.source_folder_id || ptr?.source_folder_id || null }, d);
    return here.state;
  }
  if (ptr?.file_id) {
    const meta = await drive.getMeta(ptr.file_id).catch(() => null);
    if (meta && !meta.trashed) {
      let state = null;
      try { state = JSON.parse(Buffer.from(await drive.downloadBuffer(ptr.file_id)).toString('utf8')); } catch { state = null; }
      if (state?.sops) {
        // Brought back into the current memory folder (a copy; the original is left where it is, never deleted).
        if (folder && !(meta.parents || []).includes(folder)) {
          const saved = await updateJsonFile(METHODOLOGY_FILE, cur => cur?.sops?.length ? null : state, { drive, folder }).catch(() => null);
          if (saved?.fileId && saved.written) await rememberPointer(orgId, { file_id: saved.fileId }, d);
        }
        return { ...state, recovered: true };
      }
    }
  }
  if (ptr?.source_folder_id) return { status: 'none', sops: [], source_folder_id: ptr.source_folder_id, reload: true };
  return { status: 'none', sops: [] };
}

// What the screens need: per SOP its cycle and the count of procedures, and what could not be read.
export function librarySummary(state) {
  const sops = state?.sops || [];
  return { status: state?.status || 'none', source_folder_id: state?.source_folder_id || null, loaded_at: state?.loaded_at || null, loaded_by: state?.loaded_by || null,
    reload: Boolean(state?.reload), recovered: Boolean(state?.recovered),
    sops: sops.map(s => ({ file_id: s.file_id, file_name: s.file_name, family: s.family, status: s.status, error: s.error || null, cycle: s.cycle || null,
      procedures: (s.procedures || []).length, issues: s.issues || [] })),
    left: (state?.pending || []).length,
    procedures: sops.reduce((n, s) => n + (s.procedures || []).length, 0) };
}

// Step 1 (« Charger les SOP ») lists the files; step 2 reads them a few at a time (the page calls again until done).
export async function loadMethodology(orgId, body = {}, account = null, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const folderId = String(body.folder_id || '').match(/[-\w]{20,}/)?.[0] || null;
  if (body.action === 'list') {
    const files = await listSopFiles(folderId, drive);
    if (!files.length) throw fail('NO_SOP_FOUND_IN_FOLDER', 404);
    await updateJsonFile(METHODOLOGY_FILE, () => ({ status: 'loading', drive_id: currentDrive(d), source_folder_id: folderId, loaded_by: account?.email || null,
      started_at: new Date().toISOString(), pending: files, sops: [] }), { drive, folder });
    await rememberPointer(orgId, { source_folder_id: folderId, started_at: new Date().toISOString() }, d);
    return { status: 'loading', files: files.length };
  }
  if (body.action === 'step') {
    const { state } = await loadJsonFile(METHODOLOGY_FILE, drive, folder);
    if (!state || state.status !== 'loading') return librarySummary(state);
    const batch = (state.pending || []).slice(0, Math.max(1, Math.min(6, Number(body.batch) || 4)));
    const read = [];
    for (const f of batch) read.push(await readSopFile(f, drive));
    const done = new Set(batch.map(f => f.id));
    const r = await updateJsonFile(METHODOLOGY_FILE, s => {
      const next = s || {};
      next.sops = [...(next.sops || []).filter(x => !done.has(x.file_id)), ...read];
      next.pending = (next.pending || []).filter(f => !done.has(f.id));
      if (!next.pending.length) { next.status = 'ready'; next.loaded_at = new Date().toISOString(); delete next.pending; }
      return next;
    }, { drive, folder });
    if (r.state.status === 'ready') await rememberPointer(orgId, { file_id: r.fileId, source_folder_id: r.state.source_folder_id, loaded_at: r.state.loaded_at, sops: r.state.sops.length }, d);
    if (r.state.status === 'ready') await (d.audit || audit)(orgId, { agent: 'mission-controller', action_type: 'METHODOLOGY_LOADED', approved_by: account?.email || null,
      source_ref: r.state.source_folder_id, output_ref: `${r.state.sops.length} SOP, ${r.state.sops.reduce((n, s) => n + (s.procedures || []).length, 0)} procédures, ${r.state.sops.filter(s => s.status === 'NOT_READ').length} non lus` }).catch(() => null);
    return { ...librarySummary(r.state), left: (r.state.pending || []).length };
  }
  throw fail('UNKNOWN_ACTION');
}

// One procedure, for the programme and the auditor's screen.
export function findProcedure(state, code, sourceId = null) {
  for (const s of state?.sops || []) {
    if (sourceId && s.file_id !== sourceId) continue;
    for (const p of s.procedures || []) if (p.code === code) return { ...p, sop_file_id: s.file_id, sop_file_name: s.file_name, sop_modified_time: s.modified_time || null, cycle: s.cycle };
  }
  return null;
}

// Use the SOP selected in this programme, and refresh a changed source before planning.
export async function currentProcedure(state, code, sourceId, d = {}) {
  const card = findProcedure(state, code, sourceId);
  if (!card?.sop_file_id) return card;
  const drive = d.drive || driveAdapter;
  const meta = await drive.getMeta(card.sop_file_id);
  if (!meta || meta.trashed) throw fail('SOP_SOURCE_UNAVAILABLE', 409);
  if (meta.modifiedTime && meta.modifiedTime !== card.sop_modified_time) {
    const fresh = await readSopFile({ id: card.sop_file_id, name: meta.name || card.sop_file_name, modified_time: meta.modifiedTime }, drive);
    if (fresh.status !== 'READ') throw fail('SOP_SOURCE_INCOMPLETE', 409);
    const updated = findProcedure({ sops: [fresh] }, code, card.sop_file_id);
    if (!updated) throw fail('PROCEDURE_REMOVED_FROM_SOP', 409);
    return updated;
  }
  return card;
}
