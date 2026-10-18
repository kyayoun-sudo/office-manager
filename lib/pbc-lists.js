// RECOGNISING A PBC LIST WHATEVER ITS NAME (Paul, 2026-10-18 : « je veux que le code puisse reconnaître seul la liste
// des PBC même si le nom diffère »). A file name is not evidence (principle 1): the list is recognised by what it is.
//   1. Identity — the firm's own models carry a machine signature: hidden sheet AUDIT_META (Document_Type =
//      PBC_MASTER_CHECKLIST) and/or file keywords DOCUMENT_TYPE=PBC_MASTER_CHECKLIST. Certain, renamed or not.
//   2. Content — any other format (client list, old model, Word, PDF, CSV): a header row with the columns of a request
//      list (document requested + reference / status / received / due / request date) and rows that are documents.
//      Pure code, no AI. A degree of certainty, never 100 %: a person confirms once.
//   3. Memory by ID — once recognised, the list is kept in the shared document index (OFFICE_MANAGER_FILE_INDEX.json,
//      `pbc_lists`) by its Drive ID: found again even renamed or moved, never searched by name again. A file judged
//      not to be a list is not re-read until its content changes (`pbc_not_lists`, keyed by version).
// Read-only on the documents: nothing is moved, renamed or written in a client file here.

import { FILE_INDEX } from './file-index.js';

export const PBC_DOCUMENT_TYPE = 'PBC_MASTER_CHECKLIST';
const IDENTITY_TYPE = /^PBC_(MASTER_)?CHECK_?LIST$|^PBC_LIST$|^LISTE_PBC$/i;
export const PBC_CONFIRM_THRESHOLD = 60; // below: not proposed as a list at all

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

// Column roles of a request list (French and English). Matching is on the normalised header label.
const ROLES = {
  document: [/\bdocuments?\b/, /\bpieces?\b/, /\bdescription\b/, /\belements? demandes?\b/, /\binformations? (demandees?|requises?|requested)\b/, /\blibelle\b/, /\brequested items?\b/, /\bitems? requested\b/, /\brequest\b/, /\bnature\b/, /\bintitule\b/],
  reference: [/^(ref|reference|ref pbc|reference pbc|n|no|n o|num|numero|code|code pbc|id|pbc|pbc id|pbc ref|item|#)$/, /^ref\b/, /^reference\b/],
  status: [/^(statut|status|etat|avancement)\b/, /\bstatut\b/, /\bstatus\b/],
  received: [/\brecus?\b/, /\breception\b/, /\breceived\b/, /\bfournis?\b/, /\bprovided\b/, /\bdate de reception\b/],
  due: [/\becheance\b/, /\bdate limite\b/, /\bdue\b/, /\bdeadline\b/, /\bdate butoir\b/, /\bdelai\b/],
  requested_date: [/\bdate (de )?demande\b/, /\bdemande le\b/, /\brequested on\b/, /\b(date requested|request date)\b/],
  responsible: [/\bresponsable\b/, /\bowner\b/, /\bcontact\b/, /\binterlocuteur\b/, /\bpreparer\b/],
  cycle: [/^(cycle|section|domaine|area|rubrique)s?\b/, /\bcycles?\b/]
};
const WEIGHT = { document: 30, reference: 15, status: 15, received: 15, due: 12, requested_date: 12, responsible: 6, cycle: 5 };
const TRACKING = ['status', 'received', 'due', 'requested_date'];
// Words of the documents an auditor asks a client for: a row that names them is a request, not anything else.
const AUDIT_WORDS = /releve|bancaire|balance|grand livre|contrat|facture|etat|rapprochement|confirmation|statuts|proces verbal|\bpv\b|inventaire|budget|bulletin|declaration|tableau|liasse|journal|convention|organigramme|registre|attestation|bank|statement|ledger|invoice|payroll|agreement|minutes|reconciliation|listing|extrait|justificatif|piece/;
const LIST_TITLE = /\bpbc\b|prepared by (the )?client|provided by (the )?client|documents? a fournir|liste des documents|documents demandes|pieces a fournir|request list|document request/;

function roleOf(cell) {
  const n = norm(cell);
  if (!n || n.length > 60) return null;
  // Order matters: a « Date de demande » column is a request date, not a document; « Reçu ? » is not a reference.
  for (const r of ['requested_date', 'due', 'received', 'status', 'reference', 'responsible', 'cycle', 'document'])
    if (ROLES[r].some(re => re.test(n))) return r;
  return null;
}

// Splits a text (what the reader extracted from xlsx, Google Sheets, CSV, Word, PDF) into rows of cells.
export function textRows(text) {
  return String(text || '').split(/\r?\n/).map(line => {
    if (line.includes('\t')) return line.split('\t');
    if ((line.match(/\|/g) || []).length >= 2) return line.split('|');
    if ((line.match(/;/g) || []).length >= 2) return line.split(';');
    if ((line.match(/,/g) || []).length >= 3) return line.split(',');
    const wide = line.split(/\s{2,}/);
    return wide.length >= 3 ? wide : [line];
  }).map(r => r.map(c => String(c).trim())).filter(r => r.some(Boolean));
}

// Best header row among the rows of one table, and how well what follows looks like requests.
export function analyzeRows(rows, { maxHeaderRow = 25 } = {}) {
  let best = null;
  for (let i = 0; i < Math.min(rows.length, maxHeaderRow); i++) {
    const columns = {};
    rows[i].forEach((cell, c) => { const r = roleOf(cell); if (r && columns[r] == null) columns[r] = c; });
    if (columns.document == null) continue;
    const tracking = TRACKING.filter(r => columns[r] != null).length;
    if (tracking + (columns.reference != null ? 1 : 0) < 2) continue;
    const headerScore = Object.keys(columns).reduce((s, r) => s + WEIGHT[r], 0);
    if (!best || headerScore > best.headerScore) best = { header_row: i, columns, headerScore, tracking };
  }
  if (!best) return { score: 0, evidence: ['aucune ligne d’en-tête de liste de demandes'] };
  const docs = [];
  for (const row of rows.slice(best.header_row + 1, best.header_row + 400)) {
    const cell = String(row[best.columns.document] ?? '').trim();
    if (cell.length > 3 && !roleOf(cell)) docs.push(cell);
  }
  const auditShare = docs.length ? docs.filter(x => AUDIT_WORDS.test(norm(x))).length / docs.length : 0;
  let score = Math.min(100, best.headerScore) * 0.8 + Math.round(auditShare * 10) + Math.min(10, docs.length);
  // Few rows yet (a list just started): a full request header still says what the file is, with less certainty.
  if (docs.length < 2) score *= best.tracking >= 3 ? 0.75 : 0.6;
  const header = rows[best.header_row];
  return {
    score: Math.round(Math.min(95, score)), header_row: best.header_row, data_rows: docs.length,
    columns: Object.fromEntries(Object.entries(best.columns).map(([r, c]) => [r, { index: c, label: String(header[c] || '').slice(0, 60) }])),
    evidence: ['en-tête : ' + header.filter(Boolean).slice(0, 8).join(' | ').slice(0, 200), docs.length + ' ligne(s) de demande', Math.round(auditShare * 100) + ' % de pièces d’audit reconnues']
  };
}

// Machine signature of the firm's own models (AUDIT_META key/value rows, or file keywords).
export function identityOf(text, keywords = '') {
  const meta = {};
  for (const row of textRows(text)) {
    const cells = row.filter(Boolean);
    if (cells.length >= 2 && /^[A-Za-z][A-Za-z_ ]{2,40}$/.test(cells[0])) {
      const k = norm(cells[0]).replace(/ /g, '_');
      if (['document_type', 'mission_code', 'code_mission', 'mission', 'famille', 'family', 'version', 'engagement_id'].includes(k) && meta[k] == null) meta[k] = String(cells[1]).slice(0, 80);
    }
  }
  const kw = String(keywords || '').match(/DOCUMENT_TYPE=([A-Z0-9_]+)/i)?.[1];
  const type = meta.document_type || kw || null;
  if (!type) return null;
  const mission = meta.mission_code || meta.code_mission || meta.engagement_id || meta.mission || null;
  return { document_type: type, is_pbc_list: IDENTITY_TYPE.test(type), mission_code: mission && !/^\[|^<|^—?$|a completer/i.test(mission) ? mission : null, family: meta.famille || meta.family || null };
}

// One file's verdict from its extracted text (pure code).
export function recognizePbcText(text, { keywords = '' } = {}) {
  const id = identityOf(text, keywords);
  if (id) return id.is_pbc_list
    ? { is_pbc_list: true, level: 'identity', confidence: 100, scope: id.mission_code ? 'mission' : 'firm', mission_code: id.mission_code, family: id.family, evidence: ['signature : Document_Type = ' + id.document_type] }
    // Another model of the firm (a Working File has a PBC sheet, but it is not the list): its own signature says so.
    : { is_pbc_list: false, level: 'identity', confidence: 100, document_type: id.document_type, evidence: ['signature : Document_Type = ' + id.document_type] };
  const rows = textRows(text);
  const a = analyzeRows(rows);
  if (a.score && LIST_TITLE.test(norm(rows.slice(0, Math.max(3, (a.header_row || 0) + 1)).flat().join(' ')))) { a.score = Math.min(95, a.score + 5); a.evidence.push('titre de liste de demandes'); }
  return { is_pbc_list: a.score >= PBC_CONFIRM_THRESHOLD, level: 'content', confidence: a.score, header_row: a.header_row ?? null, columns: a.columns || null, data_rows: a.data_rows || 0, evidence: a.evidence };
}

// ---------------------------------------------------------------------------------------------------------------
// Memory: the shared document index (one file per Drive) keeps what was recognised, by Drive ID.
// ---------------------------------------------------------------------------------------------------------------
async function io(d) {
  if (d.pbcRegistry) return d.pbcRegistry;
  const { loadJsonFile, updateJsonFile } = await import('./mapping-scan.js');
  const drive = d.drive || (await import('./drive-adapter.js')).driveAdapter;
  const folder = d.folder || (await import('./memory-runtime.js')).memoryFolderId();
  return {
    load: async () => (await loadJsonFile(FILE_INDEX, drive, folder)).state || {},
    update: fn => updateJsonFile(FILE_INDEX, st => fn(st || { files: {} }), { drive, folder })
  };
}
const versionOf = f => String(f?.modifiedTime || f?.version || f?.md5Checksum || '') || null;
// Files worth an EXTRA reading to find a list (a plain-text note is judged only when it is read anyway).
const READABLE = /spreadsheet|excel|sheet|csv|wordprocessing|msword|google-apps\.document|pdf|\.(xlsx|xlsm|xls|csv|docx|pdf)$/i;
const FOLDER = 'application/vnd.google-apps.folder';
const dirOf = p => String(p || '').split('/').slice(0, -1).join('/');
const lists = st => st?.pbc_lists || {};

// The lists that matter for these files, found by ID first, then by reading the few unjudged files near them.
// items = the Drive inventory (id, name, path, mimeType, modifiedTime); batch = the files being decided now.
export async function findPbcLists(items, batch, read, d = {}) {
  const reg = await io(d).catch(() => null);
  const st = reg ? await reg.load().catch(() => ({})) : {};
  const known = lists(st), notLists = st.pbc_not_lists || {};
  const files = (items || []).filter(i => i && i.id && i.mimeType !== FOLDER && !/ENTRAINEMENT|ZZ_/i.test(i.path || ''));
  const byId = new Map(files.map(f => [f.id, f]));
  // Where to look first: the folder of each file being decided and the one above (…/MISSION/04_PBC/x.pdf → …/MISSION).
  const roots = new Set();
  for (const f of batch || []) { const parts = String(f.path || '').split('/'); for (let k = 1; k <= 2 && parts.length - k > 1; k++) roots.add(parts.slice(0, parts.length - k).join('/')); }
  const near = f => [...roots].some(r => r && String(f.path || '').startsWith(r + '/'));
  // Which list belongs to the files being decided: its folder holds them, or it sits in a request sub-folder
  // (…/MISSION/04_PBC/list.xlsx) of a folder that holds them. A folder name only scopes the context; the content
  // already proved the file is a list.
  const covers = f => {
    const dir = dirOf(f.path), up = dirOf(dir);
    return (batch || []).some(b => { const p = String(b.path || '');
      return (dir && p.startsWith(dir + '/')) || (up && /pbc|demande|request|liste|checklist/i.test(dir.split('/').pop() || '') && p.startsWith(up + '/')); });
  };
  // The firm's models, renamed anywhere in the Drive: the Drive's own full-text search for their signature gives
  // LEADS (at most once a day while no firm list is known); each lead is still read and proved below.
  const leads = new Set();
  const firmKnown = Object.values(known).some(r => r.scope === 'firm' && r.status !== 'rejected');
  const lastSearch = Date.parse(st.pbc_signature_search_at || '') || 0;
  let searched = false;
  if (!firmKnown && Date.now() - lastSearch > 86400000) {
    try {
      const search = d.pbcSearch || (async q => ((d.drive || (await import('./drive-adapter.js')).driveAdapter).searchFiles({ query: q, limit: 20 })));
      const r = await search(PBC_DOCUMENT_TYPE);
      for (const f of (Array.isArray(r) ? r : r?.files || [])) if (f?.id) leads.add(f.id);
      searched = true;
    } catch { /* no search available: the lists near the files are still recognised */ }
  }
  // Name and place are only an ORDER of reading (cheapest first), never the evidence.
  const hint = f => (/pbc|check ?list|liste|documents?|demande|request|programme/i.test(f.name || '') ? 0 : 1);
  const rank = f => (leads.has(f.id) ? 0 : near(f) ? 1 : 2);
  const fresh = f => !known[f.id] && !(f.id in notLists && notLists[f.id] === versionOf(f));
  // What the Orpailleur has just read in this batch is judged for free (no second reading).
  const already = d.pbcKnownTexts instanceof Map ? d.pbcKnownTexts : new Map();
  const free = files.filter(f => fresh(f) && typeof already.get(f.id) === 'string' && already.get(f.id).length >= 40 && already.get(f.id) !== '(illisible)');
  const extra = files.filter(f => fresh(f) && !already.has(f.id) && READABLE.test((f.mimeType || '') + ' ' + (f.name || '')))
    .filter(f => leads.has(f.id) || near(f) || hint(f) === 0)
    .sort((a, b) => (rank(a) - rank(b)) || (hint(a) - hint(b)) || String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')))
    .slice(0, d.pbcReadsPerCall ?? 3);
  const judged = {}, texts = new Map();
  for (const f of [...free, ...extra]) {
    let text = already.get(f.id) || '';
    if (!text) { try { const r = await read(f.id, { maxChars: d.pbcRecognitionChars || 20000 }); text = typeof r === 'string' ? r : r?.text || ''; } catch { continue; } }
    if (!text.trim()) continue;
    const v = recognizePbcText(text, { keywords: f.properties?.keywords || f.description || '' });
    judged[f.id] = { file: f, verdict: v };
    texts.set(f.id, text);
  }
  const now = new Date().toISOString();
  if (reg && (Object.keys(judged).length || searched)) await reg.update(s => {
    s.pbc_lists ||= {}; s.pbc_not_lists ||= {};
    if (searched) s.pbc_signature_search_at = now;
    for (const [id, { file, verdict }] of Object.entries(judged)) {
      if (verdict.is_pbc_list) s.pbc_lists[id] = { file_id: id, name: file.name || null, path: file.path || null, version: versionOf(file), level: verdict.level, confidence: verdict.confidence,
        scope: verdict.scope || null, mission_code: verdict.mission_code || null, family: verdict.family || null, columns: verdict.columns || null, header_row: verdict.header_row ?? null,
        evidence: verdict.evidence, status: verdict.level === 'identity' ? 'identified' : 'to_confirm', recognized_at: now };
      else s.pbc_not_lists[id] = versionOf(file);
    }
    const keys = Object.keys(s.pbc_not_lists);
    if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete s.pbc_not_lists[k];
    return s;
  }).catch(() => null);
  const all = { ...known };
  for (const [id, { file, verdict }] of Object.entries(judged)) if (verdict.is_pbc_list) all[id] = { file_id: id, name: file.name, level: verdict.level, confidence: verdict.confidence, scope: verdict.scope, mission_code: verdict.mission_code, columns: verdict.columns, status: verdict.level === 'identity' ? 'identified' : 'to_confirm' };
  const out = { master: [], missions: [], texts };
  for (const rec of Object.values(all)) {
    if (rec.status === 'rejected') continue;
    const f = byId.get(rec.file_id); // its CURRENT place in the Drive: a moved or renamed list is still found
    if (!f) continue;
    const entry = { ...rec, name: f.name, path: f.path, file: f };
    if (covers(f) && rec.scope !== 'firm') out.missions.push(entry);
    else if (rec.scope === 'firm' || (!rec.mission_code && rec.level === 'identity')) out.master.push(entry);
  }
  out.master.sort((a, b) => String(b.file.modifiedTime || '').localeCompare(String(a.file.modifiedTime || '')));
  out.missions = out.missions.slice(0, 3);
  return out;
}

export function describeRecognition(rec) {
  if (rec.status === 'confirmed') return 'liste PBC confirmée par ' + (rec.confirmed_by || 'une personne');
  if (rec.level === 'identity') return 'liste PBC reconnue par sa signature';
  return 'liste PBC reconnue par son contenu (certitude ' + rec.confidence + ' %, à confirmer par l’auditeur)';
}

// ---------------------------------------------------------------------------------------------------------------
// The person confirms once (« c'est bien la liste PBC de la mission ABC ») or says no; never asked again for that file.
// ---------------------------------------------------------------------------------------------------------------
export async function pbcListsToConfirm(d = {}) {
  const st = await (await io(d)).load().catch(() => ({}));
  return Object.values(lists(st)).filter(r => r.status === 'to_confirm');
}

const DECIDERS = ['owner', 'partner', 'quality_reviewer', 'manager', 'supervisor', 'senior', 'auditor'];
export async function decidePbcList(orgId, input, account, d = {}) {
  const err = (code, status = 400) => Object.assign(new Error(code), { statusCode: status });
  if (!account?.email || !DECIDERS.includes(account.role)) throw err('ROLE_NOT_ALLOWED', 403);
  const id = String(input.file_id || '').trim(), decision = input.decision;
  if (!id) throw err('FILE_REQUIRED');
  if (!['confirm', 'reject'].includes(decision)) throw err('DECISION_REQUIRED');
  let rec = null;
  const now = new Date().toISOString();
  await (await io(d)).update(s => {
    const cur = s.pbc_lists?.[id];
    if (!cur) return null;
    rec = { ...cur, status: decision === 'confirm' ? 'confirmed' : 'rejected', mission_id: input.mission_id || cur.mission_id || null, decided_by: account.email, decided_at: now,
      ...(decision === 'confirm' ? { confirmed_by: account.email } : {}) };
    s.pbc_lists[id] = rec;
    // A « no » is remembered as a non-list for this version: the file is not read again for this purpose.
    if (decision === 'reject') { (s.pbc_not_lists ||= {})[id] = cur.version || null; }
    return s;
  });
  if (!rec) throw err('PBC_LIST_NOT_FOUND', 404);
  // A human correction is traced and visible to Shadow (« la correction devient une leçon »).
  const emit = d.emit || (await import('./event-bus.js')).emit;
  const event = await emit(orgId, { type: decision === 'confirm' ? 'PBC_LIST_CONFIRMED' : 'PBC_LIST_REJECTED', agent: 'orpailleur', actor: account.email, engagement_id: rec.mission_id,
    object_type: 'pbc_list', object_id: id, idempotency_key: 'pbc-list:' + id + ':' + decision + ':' + (rec.version || ''), source: id,
    payload: { name: rec.name, level: rec.level, confidence: rec.confidence } }, d).catch(e => ({ error: e.message }));
  await (d.audit || (await import('./audit-log.js')).audit)(orgId, { agent: 'orpailleur', action_type: decision === 'confirm' ? 'PBC_LIST_CONFIRMED' : 'PBC_LIST_REJECTED', status: 'succeeded',
    decision: decision === 'confirm' ? 'liste PBC confirmée' : 'pas une liste PBC', reviewer: account.email, output_ref: (rec.name || id) + ' (' + id + ')' }).catch(() => null);
  return { ...rec, event };
}
