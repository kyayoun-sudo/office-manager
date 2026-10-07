// Orpailleur "Rangement" — pure planning logic (no I/O), fully testable.
//
// For each file, in this order:
//   1. what the firm taught (learned preferences from past decisions);
//   2. clear rules (an existing folder named after the file's client, ideally its year);
//   3. the AI, reading the file's CONTENT excerpt (never the file name alone).
// Then the mode:
//   - auto        : an EXISTING folder fits with high confidence and the Drive mapping
//                   is reviewed by the owner -> moved without asking;
//   - proposal    : lower confidence, a NEW folder is needed, or mapping not reviewed;
//   - in_place    : the file is already where it should be;
//   - needs_reading : nothing is known about its content yet (Orpailleur must read it first);
//   - unsure      : no reasonable destination.

export const AUTO_CONFIDENCE = 0.85;
export const AI_BATCH = 12;

export function norm(value) {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function extensionOf(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return m ? m[1] : '';
}

export function yearOf(file) {
  const text = [file.document_period, file.name, file.folder_path].join(' ');
  const m = String(text).match(/\b(20[0-9]{2})\b/);
  return m ? m[1] : null;
}

// Features of a file that a decision can teach about.
export function preferenceKeys(file) {
  const keys = [];
  if (file.client_name && norm(file.client_name).length >= 2) keys.push('client:' + norm(file.client_name));
  if (file.document_type && norm(file.document_type).length >= 2) keys.push('type:' + norm(file.document_type));
  const ext = extensionOf(file.name);
  if (ext && file.client_name) keys.push('client-ext:' + norm(file.client_name) + ':' + ext);
  return keys;
}

// Learned preferences: sum the weights of every matching key per destination.
export function pickPreference(file, prefs = [], folderIds = null) {
  const keys = new Set(preferenceKeys(file));
  const score = {};
  const pathOf = {};
  for (const p of prefs) {
    if (!keys.has(p.key)) continue;
    if (folderIds && !folderIds.has(p.dest_folder_id)) continue; // destination no longer exists
    score[p.dest_folder_id] = (score[p.dest_folder_id] || 0) + Number(p.weight || 0);
    pathOf[p.dest_folder_id] = p.dest_path || null;
  }
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 2) return null;
  return {
    dest_folder_id: best[0], dest_path: pathOf[best[0]],
    confidence: Math.min(0.95, 0.75 + 0.05 * best[1]),
    source: 'preference', rationale: 'Appris de vos décisions précédentes (' + best[1] + ' validation' + (best[1] > 1 ? 's' : '') + ').'
  };
}

function folderPath(f) {
  return [f.folder_path, f.name].filter(Boolean).join('/').replace(/\/+/g, '/');
}

// Rules: an existing folder named after the client; prefer one also carrying the year.
export function ruleMatch(file, folders = []) {
  const client = norm(file.client_name);
  if (client.length < 3) return null;
  const year = yearOf(file);
  const matches = folders.filter(f => {
    const n = norm(f.name);
    return n.length >= 3 && (n.includes(client) || client.includes(n));
  });
  if (!matches.length) return null;
  // Children of a client folder carrying the year are the best match.
  const clientIds = new Set(matches.map(f => f.file_id));
  const byYear = year ? folders.filter(f => norm(f.name).includes(year) && clientIds.has(f.parent_id)) : [];
  const pick = (byYear[0] || matches.sort((a, b) => folderPath(b).length - folderPath(a).length)[0]);
  return {
    dest_folder_id: pick.file_id, dest_path: folderPath(pick),
    confidence: byYear.length ? 0.9 : 0.8, source: 'rule',
    rationale: 'Dossier existant du client « ' + file.client_name + ' »' + (byYear.length ? ' pour l’année ' + year : '') + '.'
  };
}

export function decideMode(file, decision, { gateAllowed }) {
  if (!decision) {
    const known = file.excerpt || file.client_name || file.document_type;
    return known ? 'unsure' : 'needs_reading';
  }
  if (decision.dest_folder_id && decision.dest_folder_id === file.parent_id) return 'in_place';
  // A broad client rule must not flatten an existing mission folder structure.
  const current = '/' + String(file.folder_path || '').replace(/^\/+|\/+$/g, '');
  const destination = '/' + String(decision.dest_path || '').replace(/^\/+|\/+$/g, '');
  if (decision.source === 'rule' && destination !== '/' && current.startsWith(destination + '/')) return 'in_place';
  if (decision.new_folder_name) return 'proposal';
  if (gateAllowed && decision.confidence >= AUTO_CONFIDENCE) return 'auto';
  return 'proposal';
}

// Narrow content-backed rule, never a filename shortcut. Example budgets belong
// with reusable working-paper templates, subject to owner review. Ambiguous
// destinations and real client budgets are left to the existing workflow.
export function contentRuleMatch(file, folders = []) {
  const text = norm(file.excerpt);
  if (!/\bbudget\b/.test(text) || !/\baudit\b/.test(text) ||
      !/\b(exemple|fictif|fictive)\b/.test(text) || !/\b(heures|honoraires)\b/.test(text)) return null;
  const candidates = folders.filter(f => norm(f.name).replace(/^\d+ /, '') === 'working paper templates');
  if (candidates.length !== 1) return null;
  const folder = candidates[0];
  return { dest_folder_id: folder.file_id, dest_path: folderPath(folder), source: 'rule', confidence: 0.8,
    rationale: 'Le contenu décrit un budget d’audit d’exemple. Classement proposé parmi les modèles de feuilles de travail, à valider.' };
}

// ---- AI on content ----

export function buildAiRequest(files, folders, instructions) {
  const folderList = folders.slice(0, 150).map(f => f.file_id + ' | ' + folderPath(f)).join('\n');
  const fileList = files.map(f => [
    'file_id: ' + f.file_id,
    'nom: ' + f.name,
    'dossier actuel: ' + (f.folder_path || '?'),
    f.client_name ? 'client: ' + f.client_name : null,
    f.document_type ? 'type: ' + f.document_type : null,
    f.document_period ? 'période: ' + f.document_period : null,
    'extrait du contenu: ' + (f.excerpt ? f.excerpt.slice(0, 400).replace(/\s+/g, ' ') : '(aucun)')
  ].filter(Boolean).join('\n')).join('\n---\n');
  const system = [
    'Tu es l’Orpailleur, l’archiviste d’un cabinet d’audit. Tu ranges des fichiers dans le Google Drive du cabinet.',
    'Décide d’après le CONTENU (extrait), le client et la période. Le nom du fichier seul ne suffit jamais : sans extrait ni client ni type, réponds folder_id null.',
    'Choisis de préférence un dossier EXISTANT de la liste (son identifiant exact). Si aucun ne convient, propose un nouveau dossier : new_folder_parent_id (un dossier existant) et new_folder_name.',
    'Ne supprime rien, ne renomme rien. Sois prudent : en cas de doute, confidence faible.',
    'Réponds UNIQUEMENT par un tableau JSON, un objet par fichier : {"file_id":"…","folder_id":"…ou null","new_folder_parent_id":"…ou null","new_folder_name":"…ou null","confidence":0.0,"rationale":"phrase courte en français"}.'
  ].join('\n');
  const input = 'Consignes de l’utilisateur : ' + (instructions || '(aucune)') +
    '\n\nDOSSIERS EXISTANTS (id | chemin) :\n' + folderList + '\n\nFICHIERS À RANGER :\n' + fileList;
  return { instructions: system, input };
}

export function parseAiDecisions(text, folders, files) {
  const ids = new Set(folders.map(f => f.file_id));
  const pathOf = Object.fromEntries(folders.map(f => [f.file_id, folderPath(f)]));
  const wanted = new Set(files.map(f => f.file_id));
  let arr = [];
  try {
    const m = String(text || '').match(/\[[\s\S]*\]/);
    arr = m ? JSON.parse(m[0]) : [];
  } catch { arr = []; }
  const out = {};
  for (const d of Array.isArray(arr) ? arr : []) {
    if (!d || !wanted.has(d.file_id)) continue;
    const conf = Math.max(0, Math.min(1, Number(d.confidence) || 0));
    const rationale = String(d.rationale || '').slice(0, 300);
    if (d.folder_id && ids.has(d.folder_id)) {
      out[d.file_id] = { dest_folder_id: d.folder_id, dest_path: pathOf[d.folder_id], confidence: conf, source: 'ai', rationale };
    } else if (d.new_folder_name && d.new_folder_parent_id && ids.has(d.new_folder_parent_id)) {
      const name = String(d.new_folder_name).replace(/[\/\\]/g, '-').trim().slice(0, 120);
      if (name) out[d.file_id] = {
        dest_folder_id: null, dest_path: pathOf[d.new_folder_parent_id] + '/' + name,
        new_folder_parent_id: d.new_folder_parent_id, new_folder_name: name,
        confidence: Math.min(conf, 0.8), source: 'ai', rationale
      };
    }
    // An unknown folder id from the AI is ignored (never trusted).
  }
  return out;
}
