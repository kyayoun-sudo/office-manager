import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { runAI } from './ai.js';
import { loadScan, loadJsonFile, saveJsonFile } from './mapping-scan.js';

// « Comprendre le cabinet », part of the FIRST SCAN (2026-10-07, Paul: « pourquoi il ne lit et ne
// comprend pas le cabinet une fois ? »). Right after the Drive walk, the Orpailleur reads the
// documents that describe the firm — the team spreadsheet (HR / CV folders), each person's CV,
// the organisation, client portfolio, engagement letters, budgets, plannings, work programmes —
// and understands: the firm, its team and each person's profile, its clients, its missions and
// which ones are audits (with their type: CAC, AUC, due diligence…), who works on what.
// What it understood is written to its memory in the Drive (00_OFFICE_MANAGER /
// FIRM_KNOWLEDGE.json) and goes straight into the application (Équipe, missions, KPIs), as Paul
// chose. The owner corrects afterwards; nothing is ever deleted by this step.

const FILE = 'OFFICE_MANAGER_FIRM_KNOWLEDGE.json';
const FOLDER = 'application/vnd.google-apps.folder';
const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });

const READABLE = /google-apps\.(document|spreadsheet|presentation)|pdf|wordprocessingml|spreadsheetml|msword|ms-excel|text\/plain|csv/;
const TEAM_RE = /(organigramme|annuaire|équipe|equipe|collaborateur|personnel|staff|effectif|trombinoscope|\brh\b|\bhr\b|ressources humaines|salari|employ|team|contacts?\b)/i;
const CV_RE = /(\bcv\b|curriculum|resume|résumé)/i;
const SHEET_RE = /spreadsheet|ms-excel|csv/;
const SIGNALS = [
  [TEAM_RE, 6],
  [CV_RE, 3],
  [/(présentation du cabinet|presentation du cabinet|plaquette|brochure|profil du cabinet|about|qui sommes)/i, 6],
  [/(portefeuille|liste des clients|clients?\b|client list)/i, 4],
  [/(lettre de mission|engagement letter|mandat|proposition (technique|financière|commerciale)|offre)/i, 4],
  [/(budget|planning|plan de charge|affectation|staffing|timesheet|feuille de temps|honoraires)/i, 4],
  [/(programme de travail|work ?programme|pbc|rapport|\bcac\b|commissariat|audit|revue limitée|due diligence)/i, 2]
];

export function pickCandidates(items, max = 24) {
  const scored = [];
  for (const it of items || []) {
    if (it.mimeType === FOLDER || !READABLE.test(String(it.mimeType || ''))) continue;
    const hay = (it.path || it.name || '');
    let score = 0;
    for (const [re, w] of SIGNALS) if (re.test(hay)) score += w;
    if (!score) continue;
    // A team list in a spreadsheet (e.g. « Équipe HR CV / équipe.xlsx ») is THE source for the team.
    if ((TEAM_RE.test(hay) || CV_RE.test(hay)) && SHEET_RE.test(String(it.mimeType || ''))) score += 20;
    const depth = hay.split('/').length;
    score += Math.max(0, 4 - depth / 2);
    const age = (Date.now() - Date.parse(it.modifiedTime || 0)) / 86400000;
    if (age < 400) score += 1;
    scored.push({ it, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max).map(x => x.it);
}

// Each person's CV (a document whose path says CV), apart from the spreadsheets already chosen.
export function pickCvs(items, chosen, max = 15) {
  const ids = new Set(chosen.map(c => c.id));
  return (items || []).filter(i => i.mimeType !== FOLDER && !ids.has(i.id) && CV_RE.test(i.path || i.name || '') &&
    READABLE.test(String(i.mimeType || '')) && !SHEET_RE.test(String(i.mimeType || ''))).slice(0, max);
}

export function folderOutline(items, maxLines = 300) {
  const folders = (items || []).filter(i => i.mimeType === FOLDER && (i.path || '').split('/').length <= 5).map(i => i.path);
  return folders.sort().slice(0, maxLines).join('\n');
}

const INSTRUCTIONS = `Tu es l'Orpailleur, l'agent documentaire d'un cabinet (audit, commissariat aux comptes, expertise comptable, conseil…).
On te donne : l'arborescence de son Google Drive, des extraits de ses documents et des CV.
Ta tâche : COMPRENDRE le cabinet, uniquement à partir de ces sources.
Réponds en JSON STRICT, sans texte autour, avec exactement cette forme :
{"firm":{"name":"","activity":"","summary":"","sources":[""]},
 "team":[{"full_name":"","role_title":"","grade_title":"","email":"","department":"","skills":[""],"years_experience":"","education":"","source":""}],
 "clients":[{"name":"","sector":"","source":""}],
 "missions":[{"name":"","client":"","kind":"audit|conseil|expertise|juridique|autre","type":"","year":"","planned_start":"","planned_end":"","status":"active|completed|unknown","team":[{"person":"","role":""}],"source":""}],
 "questions":[""]}
Règles :
- si un tableur liste l'équipe, CHAQUE personne doit apparaître dans "team" ; complète son profil avec son CV (grade, compétences, années d'expérience, formation) ;
- une mission d'audit : "kind":"audit" et "type" précis (CAC, audit contractuel / AUC, revue limitée, due diligence, audit interne, attestation…) — déduis-le des dossiers et documents (lettre de mission, programme de travail, rapport) ;
- les dossiers clients comptent comme sources pour "clients" et "missions" ; dates au format AAAA-MM-JJ seulement si elles sont écrites ;
- "team" d'une mission : seulement les personnes nommées dans un budget, un planning ou une lettre de mission ;
- n'invente rien, laisse "" ce qui n'est pas écrit ; "source" = chemin du fichier ou dossier ;
- "questions" = ce que le propriétaire doit confirmer (au plus 8). Au plus 80 personnes, 150 clients, 150 missions.`;

function parseJson(text) {
  const t = String(text || '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw fail('FIRM_LEARNING_UNREADABLE', 502);
  return JSON.parse(t.slice(a, b + 1));
}

async function readSome(drive, files, maxFor, budgetEnd) {
  const out = [];
  for (const f of files) {
    if (Date.now() > budgetEnd) break;
    const max = maxFor(f);
    try {
      const text = await drive.readText(f.id, { maxChars: max });
      out.push('### ' + f.path + '\n' + String(text?.text ?? text ?? '').slice(0, max));
    } catch (e) { out.push('### ' + f.path + '\n(illisible : ' + String(e.message || e).slice(0, 80) + ')'); }
  }
  return out;
}

export async function learnFirm(orgId, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const t0 = Date.now(), budgetEnd = t0 + (d.budgetMs ?? 170000);
  const { state: scan } = await loadScan(drive, folder);
  if (!scan?.items?.length) throw fail('MAPPING_FIRST', 409);
  const save = async state => { const cur = await loadJsonFile(FILE, drive, folder); await saveJsonFile(FILE, drive, folder, cur.fileId, state); };
  const now = new Date().toISOString();
  await save({ status: 'learning', started_at: now });
  const picked = pickCandidates(scan.items, d.max ?? 24);
  const cvs = pickCvs(scan.items, picked, d.maxCv ?? 15);
  const docs = await readSome(drive, picked, f => (TEAM_RE.test(f.path || '') || CV_RE.test(f.path || '')) && SHEET_RE.test(String(f.mimeType || '')) ? 30000 : 6000, budgetEnd);
  const cvText = await readSome(drive, cvs, () => 3500, budgetEnd);
  const input = 'ARBORESCENCE DU DRIVE (dossiers) :\n' + folderOutline(scan.items) + '\n\nEXTRAITS DE DOCUMENTS :\n' + docs.join('\n\n') +
    (cvText.length ? '\n\nCV :\n' + cvText.join('\n\n') : '');
  const ask = d.runAI || runAI;
  let k = null, lastError = null;
  for (const provider of ['auto', 'openai', 'anthropic']) {
    try {
      const ai = await ask({ agentKey: 'orpailleur', instructions: INSTRUCTIONS, input: input.slice(0, 150000), provider, maxTokens: 16000 });
      k = parseJson(ai.text); break;
    } catch (e) { lastError = e; }
  }
  const filesRead = [...picked, ...cvs].map(f => f.path);
  if (!k) {
    await save({ status: 'failed', started_at: now, error: String(lastError?.message || lastError).slice(0, 200), files_read: filesRead });
    throw lastError || fail('FIRM_LEARNING_FAILED', 502);
  }
  const knowledge = { status: 'understood', started_at: now, finished_at: new Date().toISOString(), files_read: filesRead,
    firm: k.firm || {}, team: (k.team || []).slice(0, 80), clients: (k.clients || []).slice(0, 150),
    missions: (k.missions || []).slice(0, 150), questions: (k.questions || []).slice(0, 8) };
  // Straight into the application (Équipe, missions, KPIs): Paul's choice.
  knowledge.applied = await applyKnowledge(orgId, knowledge, { fetchRows: d.fetchRows, items: scan.items });
  knowledge.status = 'applied'; knowledge.applied_at = new Date().toISOString();
  await save(knowledge);
  return knowledge;
}

export async function firmKnowledge(d = {}) {
  const { state } = await loadJsonFile(FILE, d.drive || driveAdapter, d.folder || memoryFolderId());
  return state || { status: 'none' };
}

const low = v => String(v || '').trim().toLowerCase();
const isoDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null;

// Team → office_staff_profiles (new people added, missing profile details filled, nothing removed);
// missions → office_missions; named people on a dated mission → proposed assignments.
export async function applyKnowledge(orgId, k, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const byPath = new Map((d.items || []).map(i => [i.path, i]));
  const staffNow = await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&select=id,full_name,email,role_title,grade_title,skills') || [];
  const findStaff = p => staffNow.find(s => (p.email && low(s.email) === low(p.email)) || low(s.full_name) === low(p.full_name || p.person));
  let added = 0, completed = 0;
  for (const p of k.team || []) {
    if (!p.full_name) continue;
    const cv = byPath.get(p.source);
    const profile = { role_title: p.role_title || null, grade_title: p.grade_title || null,
      skills: Array.isArray(p.skills) ? p.skills.filter(Boolean).slice(0, 30).map(s => String(s).slice(0, 80)) : [],
      ...(cv && /cv|curriculum/i.test(p.source || '') ? { cv_drive_file_id: cv.id, cv_url: cv.webViewLink || null } : {}) };
    const s = findStaff(p);
    if (!s) {
      const [row] = await fetchRows('office_staff_profiles', { method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{ org_id: orgId, full_name: String(p.full_name).slice(0, 120), email: p.email ? low(p.email).slice(0, 254) : null,
          department: p.department || null, active: true, profile_status: 'needs_review', ...profile }]) }) || [];
      if (row) staffNow.push(row);
      added++;
    } else {
      // Only fills what is empty: what the owner wrote is never overwritten.
      const patch = {};
      if (!s.role_title && profile.role_title) patch.role_title = profile.role_title;
      if (!s.grade_title && profile.grade_title) patch.grade_title = profile.grade_title;
      if (!(s.skills || []).length && profile.skills.length) patch.skills = profile.skills;
      if (profile.cv_drive_file_id) Object.assign(patch, { cv_drive_file_id: profile.cv_drive_file_id, cv_url: profile.cv_url });
      if (Object.keys(patch).length) { await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&id=eq.' + q(s.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) }); completed++; }
    }
  }
  const missionsNow = await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&select=id,name') || [];
  let missionsAdded = 0, assignments = 0;
  for (const m of k.missions || []) {
    const name = String(m.name || [m.client, m.type, m.year].filter(Boolean).join(' ')).trim().slice(0, 200);
    if (!name) continue;
    let row = missionsNow.find(x => low(x.name) === low(name));
    if (!row) {
      const code = [m.type, m.year].filter(Boolean).join('-').slice(0, 40) || null;
      [row] = await fetchRows('office_missions', { method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify([{ org_id: orgId, name, mission_code: code, status: m.status === 'completed' ? 'completed' : 'active',
          planned_start: isoDate(m.planned_start), planned_end: isoDate(m.planned_end) }]) }) || [];
      if (row) { missionsNow.push(row); missionsAdded++; }
    }
    const start = isoDate(m.planned_start), end = isoDate(m.planned_end);
    if (!row || !start || !end || end < start) continue;
    const already = await fetchRows('office_mission_assignments?org_id=eq.' + q(orgId) + '&office_mission_id=eq.' + q(row.id) + '&select=staff_profile_id') || [];
    const onIt = new Set(already.map(a => a.staff_profile_id));
    for (const t of m.team || []) {
      const s = findStaff(t);
      if (!s || onIt.has(s.id)) continue;
      onIt.add(s.id);
      await fetchRows('office_mission_assignments', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([{ org_id: orgId, office_mission_id: row.id, staff_profile_id: s.id, mission_role: String(t.role || 'membre').slice(0, 80),
          planned_start: start, planned_end: end, allocation_pct: 100, status: 'proposed', responsibility_scope: 'Lu par l’Orpailleur dans ' + String(m.source || '').slice(0, 200) }]) })
        .then(() => { assignments++; }, () => null);
    }
  }
  return { team_added: added, team_completed: completed, missions_added: missionsAdded, assignments_proposed: assignments };
}
