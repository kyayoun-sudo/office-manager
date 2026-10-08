import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, loadScan } from './mapping-scan.js';
import { loadFileIndex } from './file-index.js';
import { canonicalStatus, isLive } from './mission-status.js';
import { sanitizeQuery } from './global-search.js';

// SEARCH (2026-10-08, « optimiser complètement la recherche »). Optional filters: status
// (active / en cours / terminée / toutes) and mission; the mission name is NEVER required.
// « grand livre BLE TRANSIT » → the words that name a client or a mission (BLE TRANSIT) select
// the mission(s); the other words (grand livre) describe the document, with their usual
// synonyms (GL, general ledger…). Each document is scored on what the agents READ in it
// (type, client, period, summary, first words of the content — file index, mission documents,
// deposits) and on its name and location. Read-only, no AI call: fast.
// Result: name, mission, type, location, summary, direct link to the file and to its folder.

const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'un', 'une', 'et', 'ou', 'en', 'pour', 'sur', 'au', 'aux', 'a', 'the', 'of', 'and', 'for', 'in', 'on', 'mission', 'client', 'document', 'documents', 'fichier', 'fichiers', 'file', 'trouve', 'trouver', 'cherche', 'chercher', 'moi']);
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const words = s => norm(s).split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w) && (w.length > 1 || /\d/.test(w)));

// Audit vocabulary: each group = the same document, in French, English and short forms.
const SYNONYMS = [
  ['grand livre', 'general ledger', 'gl', 'grand-livre', 'ledger'],
  ['balance generale', 'trial balance', 'tb', 'balance'],
  ['balance agee', 'aged balance', 'ageing', 'aging', 'balance agee clients', 'balance agee fournisseurs'],
  ['etats financiers', 'financial statements', 'ef', 'bilan', 'compte de resultat', 'fs'],
  ['lettre de mission', 'engagement letter', 'lettre mission'],
  ['programme de travail', 'audit programme', 'audit program', 'work programme', 'programme'],
  ['releve bancaire', 'bank statement', 'releves bancaires', 'banque'],
  ['rapprochement bancaire', 'bank reconciliation', 'rapprochement'],
  ['proces verbal', 'pv', 'minutes', 'proces-verbal'],
  ['facture', 'invoice', 'factures', 'invoices'],
  ['contrat', 'contract', 'agreement', 'convention'],
  ['termes de reference', 'tdr', 'terms of reference', 'tor', 'appel d offres', 'rfp'],
  ['inventaire', 'stock count', 'inventory', 'stocks'],
  ['paie', 'payroll', 'salaires', 'livre de paie'],
  ['immobilisations', 'fixed assets', 'fixed asset register', 'tableau des immobilisations'],
  ['confirmation', 'circularisation', 'confirmations', 'circularization'],
  ['rapport', 'report', 'opinion'],
  ['cv', 'curriculum', 'resume'],
  ['budget', 'budget temps', 'time budget'],
  ['management letter', 'lettre de recommandations', 'lettre de controle interne'],
  ['pbc', 'prepared by client', 'liste des documents demandes']
].map(g => g.map(norm));

// The query's phrases → groups of alternatives (each group must be found once).
export function documentTerms(rest) {
  let text = ' ' + rest.join(' ') + ' ';
  const groups = [];
  for (const g of SYNONYMS) {
    const hit = [...g].sort((a, b) => b.length - a.length).find(p => text.includes(' ' + p + ' '));
    if (hit) { groups.push({ label: hit, alts: g }); text = text.replace(' ' + hit + ' ', ' '); }
  }
  for (const w of text.split(' ').filter(Boolean)) groups.push({ label: w, alts: [w] });
  return groups;
}

// Words of the query that name a mission or a client (all of them in its name).
export function missionTerms(qWords, missions) {
  const used = new Set(), picked = [];
  for (const m of missions) {
    const mw = new Set([...words(m.name), ...words(m.mission_code), ...words(m.client_name)]);
    const common = qWords.filter(w => mw.has(w) && !/^(19|20)\d\d$/.test(w));
    // A client / mission is named when at least 2 of its words, or its only distinctive word (≥ 4 letters), are in the query.
    const distinctive = [...mw].filter(w => w.length >= 4 && !/^(audit|revue|mission|legal|contractuel|cac|projet|review)$/.test(w));
    if (common.length >= 2 || (common.length === 1 && distinctive.length === 1 && distinctive[0] === common[0])) {
      const years = qWords.filter(w => /^(19|20)\d\d$/.test(w));
      if (years.length && !years.some(y => mw.has(y))) continue;      // « 2024 » asked, mission of 2025: not this one
      picked.push({ mission: m, words: common });
      common.forEach(w => used.add(w)); years.forEach(y => used.add(y));
    }
  }
  return { missions: picked.map(p => p.mission), used };
}

const STATUS = {
  active: s => ['opportunity', 'acceptance', 'planning'].includes(canonicalStatus(s)),
  en_cours: s => ['fieldwork', 'review', 'partner_review', 'report_issued'].includes(canonicalStatus(s)),
  terminee: s => ['closed', 'archived'].includes(canonicalStatus(s)),
  toutes: () => true
};
export const statusFilter = v => STATUS[v] || STATUS.toutes;

const driveUrl = id => id ? 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view' : null;
const folderUrl = id => id ? 'https://drive.google.com/drive/folders/' + encodeURIComponent(id) : null;

// Pure ranking, testable offline.
export function rankDocuments(docs, groups, targetMissions, opts = {}) {
  const targetIds = new Set(targetMissions.map(m => m.id));
  const clientWords = targetMissions.map(m => words(m.client_name || m.name).filter(w => !/^(19|20)\d\d$/.test(w) && !/^(audit|revue|mission|legal|contractuel|cac|projet|review)$/.test(w)));
  const out = [];
  for (const d of docs) {
    const f = { name: ' ' + words(d.name).join(' ') + ' ', type: ' ' + words(d.doc_type).join(' ') + ' ', path: ' ' + words(d.path).join(' ') + ' ',
      text: ' ' + words([d.summary, d.excerpt, d.client, d.period, (d.key_facts || []).join(' ')].join(' ')).join(' ') + ' ' };
    let score = 0, found = 0;
    const why = [];
    for (const g of groups) {
      let best = 0, where = null;
      for (const a of g.alts) {
        const p = ' ' + a + ' ';
        if (f.name.includes(p) && best < 4) { best = 4; where = 'nom'; }
        if (f.type.includes(p) && best < 3.5) { best = 3.5; where = 'type'; }
        if (f.text.includes(p) && best < 2) { best = 2; where = 'contenu lu'; }
        if (f.path.includes(p) && best < 1.5) { best = 1.5; where = 'emplacement'; }
      }
      if (best) { found++; score += best; why.push(g.label + ' (' + where + ')'); }
    }
    let inMission = false;
    if (targetIds.size) {
      if (d.mission_id && targetIds.has(d.mission_id)) inMission = true;
      else if (clientWords.some(cw => cw.length && cw.every(w => f.path.includes(' ' + w + ' ') || f.text.includes(' ' + w + ' ') || f.name.includes(' ' + w + ' ')))) inMission = true;
      if (!inMission) continue;
      score += 3;
    }
    if (groups.length && !found) continue;
    if (groups.length && found < groups.length) score -= 2 * (groups.length - found);
    if (opts.allowedMission && !opts.allowedMission(d)) continue;
    out.push({ ...d, score: Math.round(score * 10) / 10, complete: found === groups.length, why });
  }
  return out.sort((a, b) => Number(b.complete) - Number(a.complete) || b.score - a.score || String(b.modified_at || '').localeCompare(String(a.modified_at || '')));
}

export async function smartSearch(orgId, input = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const query = sanitizeQuery(input.q);
  if (query.length < 2) throw Object.assign(new Error('QUERY_TOO_SHORT'), { statusCode: 400 });
  const status = ['active', 'en_cours', 'terminee', 'toutes'].includes(input.status) ? input.status : 'toutes';
  const scope = ['all', 'documents', 'missions', 'people'].includes(input.scope) ? input.scope : 'all';
  const org = 'org_id=eq.' + encodeURIComponent(orgId);
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const safe = p => Promise.resolve(p).catch(() => null);

  let missions = await safe(fetchRows('office_missions?' + org + '&select=id,name,mission_code,status,planned_start,planned_end,client_name&limit=1000'));
  if (!missions) missions = await safe(fetchRows('office_missions?' + org + '&select=id,name,mission_code,status,planned_start,planned_end&limit=1000')) || [];
  missions = missions.filter(m => canonicalStatus(m.status) !== 'cancelled');
  const inStatus = statusFilter(status);
  const allowed = missions.filter(m => inStatus(m.status));
  const qWords = words(query);
  // The mission chosen in the filter, or the one(s) named in the query.
  let target = [];
  if (input.mission_id) target = missions.filter(m => m.id === input.mission_id);
  const named = missionTerms(qWords, allowed.length ? allowed : missions);
  if (!target.length) target = named.missions;
  const docWords = qWords.filter(w => !named.used.has(w) && !(input.mission_id && target.some(m => words(m.name).includes(w))));
  const groups = documentTerms(docWords);

  const results = { documents: [], missions: [], people: [] };
  const unavailable = [];
  if (scope === 'all' || scope === 'documents') {
    // What the agents know about each file, from every source, merged by file id.
    const [index, missionFiles, deposits, scan, inventory] = await Promise.all([
      safe((d.loadFileIndex || loadFileIndex)({ drive, folder })),
      safe(loadJsonFile('OFFICE_MANAGER_MISSION_FILES.json', drive, folder).then(r => r.state?.missions || {})),
      safe(loadJsonFile('OFFICE_MANAGER_DEPOSITS.json', drive, folder).then(r => r.state?.deposits || {})),
      safe((d.loadScan || loadScan)(drive, folder).then(r => r.state?.items || [])),
      safe(fetchRows('orpailleur_inventory?' + org + '&is_folder=eq.false&select=file_id,name,folder_path,parent_id,web_url,mime_type,modified_at,document_type,client_name,office_mission_id&order=modified_at.desc&limit=5000'))
    ]);
    const byId = new Map();
    const put = (id, x) => { if (!id) return; const cur = byId.get(id) || { file_id: id }; for (const [k, v] of Object.entries(x)) if (v != null && v !== '' && (cur[k] == null || cur[k] === '')) cur[k] = v; byId.set(id, cur); };
    for (const [mid, m] of Object.entries(missionFiles || {})) for (const doc of m.documents || []) put(doc.id, { name: doc.name, path: doc.path, url: doc.url, doc_type: doc.type || doc.role, summary: doc.summary, key_facts: doc.key_facts, period: doc.period, mission_id: mid, source: 'mission' });
    for (const dep of Object.values(deposits || {})) for (const doc of dep.documents || []) put(doc.id || doc.file_id, { name: doc.name, path: doc.path, url: doc.url, doc_type: doc.type || doc.role, summary: doc.summary, client: doc.client, period: doc.period, mission_id: doc.mission_id || null, source: 'dépôt' });
    for (const f of Object.values(index || {})) put(f.id, { name: f.name, path: f.path, url: f.url, parent: f.parent, doc_type: f.doc_type, client: f.client, period: f.period, summary: f.summary, excerpt: f.excerpt, mission_id: f.mission_id, source: 'lu par l’Orpailleur' });
    for (const r of inventory || []) put(r.file_id, { name: r.name, path: r.folder_path ? r.folder_path + '/' + r.name : r.name, url: r.web_url, parent: r.parent_id, doc_type: r.document_type, client: r.client_name, mission_id: r.office_mission_id, modified_at: r.modified_at });
    for (const i of (scan || []).filter(i => i.mimeType !== 'application/vnd.google-apps.folder')) put(i.id, { name: i.name, path: i.path, url: i.webViewLink, parent: (i.parents || [])[0], modified_at: i.modifiedTime });
    if (!index && !inventory && !scan) unavailable.push('documents');
    const docs = [...byId.values()].filter(x => x.name && !/^OFFICE_MANAGER_|CLIENT_MEMORY\.json$/.test(x.name));
    // Status filter without a mission named: documents of missions in that status only.
    const allowedIds = new Set(allowed.map(m => m.id));
    const allowedMission = status === 'toutes' || target.length ? null : x => {
      if (x.mission_id) return allowedIds.has(x.mission_id);
      const p = ' ' + words(x.path).join(' ') + ' ';
      return allowed.some(m => { const cw = words(m.client_name || m.name).filter(w => w.length >= 3 && !/^(19|20)\d\d$/.test(w) && !/^(audit|revue|mission|legal|contractuel|cac|projet|review)$/.test(w)); return cw.length && cw.every(w => p.includes(' ' + w + ' ')); });
    };
    const mName = new Map(missions.map(m => [m.id, m.name]));
    results.documents = rankDocuments(docs, groups, target, { allowedMission }).slice(0, 30).map(x => ({
      file_id: x.file_id, name: x.name, mission: mName.get(x.mission_id) || (target.length === 1 ? target[0].name : null), mission_id: x.mission_id || (target.length === 1 ? target[0].id : null),
      type: x.doc_type || null, location: x.path ? String(x.path).replace(/\/[^/]*$/, '') || '/' : null, summary: x.summary || null, period: x.period || null,
      web_url: /^https:\/\//.test(x.url || '') ? x.url : driveUrl(x.file_id), folder_url: folderUrl(x.parent), source: x.source || 'inventaire du Drive',
      score: x.score, complete: x.complete, why: x.why,
      // Older screens read these fields.
      folder_path: x.path ? String(x.path).replace(/\/[^/]*$/, '') : null, document_type: x.doc_type || null }));
  }
  if (scope === 'all' || scope === 'missions') {
    const mw = qWords;
    results.missions = (target.length ? target : allowed.filter(m => { const n = new Set([...words(m.name), ...words(m.mission_code), ...words(m.client_name)]); return mw.some(w => n.has(w)); }))
      .filter(m => inStatus(m.status)).slice(0, 20).map(m => ({ ...m, status_label: canonicalStatus(m.status), live: isLive(m.status) }));
  }
  if (scope === 'all' || scope === 'people') {
    const term = qWords.filter(w => w.length >= 2)[0];
    const or = qWords.slice(0, 4).map(w => ['full_name', 'role_title', 'department'].map(c => c + '.ilike.' + encodeURIComponent('*' + w + '*')).join(',')).join(',');
    results.people = term ? await safe(fetchRows('office_staff_profiles?' + org + '&active=eq.true&or=(' + or + ')&select=id,full_name,role_title,grade_title,department&order=full_name.asc&limit=20')) || [] : [];
  }
  const total = Object.values(results).reduce((n, r) => n + r.length, 0);
  return { query, scope, status, mission_id: input.mission_id || null, understood: { missions: target.map(m => m.name), document: groups.map(g => g.label) }, total, results, unavailable, read_only: true };
}
