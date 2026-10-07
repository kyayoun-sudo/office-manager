import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { runAI } from './ai.js';
import { loadScan, loadJsonFile, saveJsonFile } from './mapping-scan.js';

// « Apprendre le cabinet » (2026-10-07, Paul: « il ne sait rien de l'équipe, de l'entreprise »).
// After the Drive walk, the Orpailleur reads the documents that describe the firm (team lists,
// organisation charts, client portfolio, engagement letters, budgets, plannings…) and proposes
// what it understood: the firm, its team, its clients, its missions — each with the file it
// comes from. Nothing enters the application before the owner ticks and saves it.

const FILE = 'OFFICE_MANAGER_FIRM_KNOWLEDGE.json';
const FOLDER = 'application/vnd.google-apps.folder';
const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });

const READABLE = /google-apps\.(document|spreadsheet|presentation)|pdf|wordprocessingml|spreadsheetml|msword|ms-excel|text\/plain|csv/;
const TEAM_RE = /(organigramme|annuaire|équipe|equipe|collaborateur|personnel|staff|effectif|trombinoscope|\brh\b|\bhr\b|\bcv\b|curriculum|ressources humaines|salari|employ|team|contacts?\b)/i;
const SHEET_RE = /spreadsheet|ms-excel|csv/;
const SIGNALS = [
  [TEAM_RE, 6],
  [/(présentation du cabinet|presentation du cabinet|plaquette|brochure|profil du cabinet|about|qui sommes)/i, 6],
  [/(portefeuille|liste des clients|clients?\b|client list)/i, 4],
  [/(lettre de mission|engagement letter|mandat|proposition (technique|financière|commerciale)|offre)/i, 4],
  [/(budget|planning|plan de charge|affectation|staffing|timesheet|feuille de temps|honoraires)/i, 3],
  [/(programme de travail|work ?programme|pbc|rapport|cac|audit)/i, 1]
];

export function pickCandidates(items, max = 20) {
  const scored = [];
  for (const it of items || []) {
    if (it.mimeType === FOLDER || !READABLE.test(String(it.mimeType || ''))) continue;
    const hay = (it.path || it.name || '');
    let score = 0;
    for (const [re, w] of SIGNALS) if (re.test(hay)) score += w;
    if (!score) continue;
    // A team list in a spreadsheet (e.g. « Équipe HR CV / équipe.xlsx ») is THE source for the team.
    if (TEAM_RE.test(hay) && SHEET_RE.test(String(it.mimeType || ''))) score += 20;
    // Recent and shallow files describe the firm better.
    const depth = hay.split('/').length;
    score += Math.max(0, 4 - depth / 2);
    const age = (Date.now() - Date.parse(it.modifiedTime || 0)) / 86400000;
    if (age < 400) score += 1;
    scored.push({ it, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map(x => x.it);
}

export function folderOutline(items, maxLines = 250) {
  const folders = (items || []).filter(i => i.mimeType === FOLDER && (i.path || '').split('/').length <= 5).map(i => i.path);
  return folders.sort().slice(0, maxLines).join('\n');
}

const INSTRUCTIONS = `Tu es l'Orpailleur, l'agent documentaire d'un cabinet (audit, expertise comptable, conseil…).
On te donne : l'arborescence de son Google Drive et des extraits de documents choisis.
Ta tâche : dire ce que tu as COMPRIS du cabinet, uniquement à partir de ces sources.
Réponds en JSON STRICT, sans texte autour, avec exactement cette forme :
{"firm":{"name":"","activity":"","summary":"","sources":[""]},
 "team":[{"full_name":"","role_title":"","email":"","department":"","source":""}],
 "clients":[{"name":"","sector":"","source":""}],
 "missions":[{"name":"","client":"","type":"","year":"","status":"active|completed|unknown","source":""}],
 "questions":[""]}
Règles : si un tableur liste l'équipe, CHAQUE ligne de personne doit apparaître dans "team" ; n'invente rien ; une personne n'apparaît que si son nom figure dans une source ; laisse "" ce qui n'est pas écrit ;
"source" = le chemin du fichier ou du dossier d'où vient l'information ; les noms de dossiers clients comptent comme source pour "clients" et "missions" ;
"questions" = ce que le propriétaire doit confirmer (au plus 8). Au plus 80 personnes, 150 clients, 150 missions.`;

function parseJson(text) {
  const t = String(text || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw fail('FIRM_LEARNING_UNREADABLE', 502);
  return JSON.parse(t.slice(a, b + 1));
}

export async function learnFirm(orgId, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const budget = d.budgetMs ?? 150000, t0 = Date.now();
  const { state: scan } = await loadScan(drive, folder);
  if (!scan?.items?.length) throw fail('MAPPING_FIRST', 409);
  const { fileId } = await loadJsonFile(FILE, drive, folder);
  const now = new Date().toISOString();
  await saveJsonFile(FILE, drive, folder, fileId, { status: 'learning', started_at: now });
  const picked = pickCandidates(scan.items, d.max ?? 20);
  const extracts = [];
  for (const f of picked) {
    if (Date.now() - t0 > budget) break;
    try {
      // Team spreadsheets are read in full (up to 30 000 characters): every row is a person.
      const big = TEAM_RE.test(f.path || f.name || '') && SHEET_RE.test(String(f.mimeType || ''));
      const max = big ? 30000 : 6000;
      const text = await drive.readText(f.id, { maxChars: max });
      extracts.push('### ' + f.path + '\n' + String(text?.text ?? text ?? '').slice(0, max));
    } catch (e) { extracts.push('### ' + f.path + '\n(illisible : ' + String(e.message || e).slice(0, 80) + ')'); }
  }
  const input = 'ARBORESCENCE DU DRIVE (dossiers) :\n' + folderOutline(scan.items) + '\n\nEXTRAITS DE DOCUMENTS :\n' + extracts.join('\n\n');
  const ask = d.runAI || runAI;
  let k = null, lastError = null;
  // A long answer (the whole team, clients, missions): room for it, and the other AI if one fails.
  for (const provider of ['auto', 'openai', 'anthropic']) {
    try {
      const ai = await ask({ agentKey: 'orpailleur', instructions: INSTRUCTIONS, input: input.slice(0, 120000), provider, maxTokens: 12000 });
      k = parseJson(ai.text); break;
    } catch (e) { lastError = e; }
  }
  if (!k) {
    const again = await loadJsonFile(FILE, drive, folder);
    await saveJsonFile(FILE, drive, folder, again.fileId, { status: 'failed', started_at: now, error: String(lastError?.message || lastError).slice(0, 200), files_read: picked.map(f => f.path) });
    throw lastError || fail('FIRM_LEARNING_FAILED', 502);
  }
  const out = { status: 'proposed', started_at: now, finished_at: new Date().toISOString(), files_read: picked.map(f => f.path),
    firm: k.firm || {}, team: (k.team || []).slice(0, 80), clients: (k.clients || []).slice(0, 150),
    missions: (k.missions || []).slice(0, 150), questions: (k.questions || []).slice(0, 8) };
  const again = await loadJsonFile(FILE, drive, folder);
  await saveJsonFile(FILE, drive, folder, again.fileId, out);
  return out;
}

export async function firmKnowledge(d = {}) {
  const { state } = await loadJsonFile(FILE, d.drive || driveAdapter, d.folder || memoryFolderId());
  return state || { status: 'none' };
}

// Owner saves what is right: team → office_staff_profiles, missions → office_missions.
export async function applyKnowledge(orgId, body = {}, d = {}) {
  const fetchRows = d.fetchRows || rest, drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const { fileId, state } = await loadJsonFile(FILE, drive, folder);
  if (!state || !['proposed', 'applied'].includes(state.status)) throw fail('NOTHING_TO_APPLY', 409);
  const team = (body.team || []).map(i => state.team[i]).filter(Boolean);
  const missions = (body.missions || []).map(i => state.missions[i]).filter(Boolean);
  const staffNow = await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&select=full_name,email') || [];
  const known = new Set(staffNow.flatMap(s => [String(s.full_name || '').toLowerCase(), String(s.email || '').toLowerCase()]).filter(Boolean));
  const newStaff = team.filter(p => p.full_name && !known.has(p.full_name.toLowerCase()) && !(p.email && known.has(p.email.toLowerCase())))
    .map(p => ({ org_id: orgId, full_name: String(p.full_name).slice(0, 120), email: p.email ? String(p.email).toLowerCase().slice(0, 254) : null,
      role_title: p.role_title || null, department: p.department || null, active: true, profile_status: 'needs_review' }));
  if (newStaff.length) await fetchRows('office_staff_profiles', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(newStaff) });
  const missionsNow = await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&select=name') || [];
  const knownM = new Set(missionsNow.map(m => String(m.name || '').toLowerCase()));
  const newMissions = missions.map(m => ({ org_id: orgId, name: String(m.name || (m.client + ' ' + (m.type || '') + ' ' + (m.year || '')).trim()).slice(0, 200),
    status: m.status === 'completed' ? 'completed' : 'active' })).filter(m => m.name && !knownM.has(m.name.toLowerCase()));
  if (newMissions.length) await fetchRows('office_missions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(newMissions) });
  state.status = 'applied'; state.applied_at = new Date().toISOString();
  state.applied = { team: newStaff.length, missions: newMissions.length };
  await saveJsonFile(FILE, drive, folder, fileId, state);
  return { saved_team: newStaff.length, saved_missions: newMissions.length };
}
