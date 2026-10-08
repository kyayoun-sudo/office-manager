import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadScan, loadJsonFile, saveJsonFile } from './mapping-scan.js';
import { hrFolderId } from './people-policy.js';
import { teamKpis } from './kpi.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { fireInternal } from './agent-passes.js';
import { saveReport } from './agent-outputs.js';

// THE FIRM'S CAPABILITIES — kept by the Grand Contrôleur / Office Manager (Paul, 2026-10-08).
// Source: the HR and CV folders of the Drive (employee and consultant CVs, Management Cards,
// training certificates), the engagements each person actually worked on (app), and how they
// performed (KPI computed from the work, never from a questionnaire). The AI reads each CV and
// writes one capability profile per person: qualifications, certifications, industries, technical
// and specialist skills, languages, seniority, trainings, previous engagements.
// Used by Mission Controller for every new mission (capability check) and by the Office Manager
// to see recurring gaps. Kept in the agents' Drive memory (OFFICE_MANAGER_CAPABILITIES.json),
// refreshed in place. Staff skills in the app are completed, never removed.

export const CAP_FILE = 'OFFICE_MANAGER_CAPABILITIES.json';
export const GAPS_FILE = 'OFFICE_MANAGER_CAPABILITY_GAPS.json';
const FOLDER = 'application/vnd.google-apps.folder';
const BATCH = 5;
const CV_CHARS = 14000;
const q = encodeURIComponent;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').trim();

const READ_CV = `Tu es le Grand Contrôleur (Office Manager) d'un cabinet d'audit et de conseil. Tu lis des CV, Management Cards, fiches de formation et documents RH (en français ou en anglais).
Pour CHAQUE personne trouvée dans les documents fournis, écris son profil de capacités, uniquement avec ce qui est écrit (jamais inventé).
JSON STRICT : {"people":[{"full_name":"","email":"","kind":"employee|consultant|unknown","current_title":"","seniority":"junior|confirmé|senior|manager|associé|expert|unknown","years_experience":null,
"qualifications":[""],"certifications":[""],"industries":[""],"technical_skills":[""],"specialist_skills":[""],"languages":[""],"countries":[""],"trainings":[""],
"previous_engagements":[{"client_or_type":"","role":"","year":""}],"management_card_notes":"","source_files":[""]}]}
Règles : "specialist_skills" = compétences rares ou pointues (IFRS 9, dépréciation/impairment, évaluation minière, ESG, audit IT, fiscalité, actuariat…) ; "technical_skills" = compétences courantes (audit financier, consolidation, revue de paie…). Écris les compétences de façon courte et normalisée (ex. "IFRS 9", "Audit IT", "Évaluation d'entreprise"). Une Management Card ne contient pas de diagnostic : résume seulement ce qu'elle dit du style de travail utile au staffing, sans jugement. Si un document ne concerne pas une personne, ignore-le.`;

// Files of the HR / CV folders, from the Drive map.
export function hrFiles(items, hrRootId) {
  const folders = new Map(items.filter(i => i.mimeType === FOLDER).map(i => [i.id, i]));
  const root = hrRootId && folders.get(hrRootId);
  const hrPaths = [];
  if (root) hrPaths.push(root.path);
  // Every folder whose name says CV / RH / HR / équipe / consultants / management card.
  for (const f of folders.values()) if (/(^|[\s_\/-])(cv|rh|hr|curriculum|ressources[\s_-]*humaines|consultants?|equipe|team|management[\s_-]*cards?|formations?|trainings?)([\s_\/-]|$)/i.test(f.name || '')) hrPaths.push(f.path);
  const inside = p => hrPaths.some(h => h && String(p || '').startsWith(h + '/'));
  return items.filter(i => i.mimeType !== FOLDER && inside(i.path) && !/OFFICE_MANAGER_/.test(i.name || '') &&
    /(pdf|word|document|text|sheet|excel|presentation)/i.test(i.mimeType || '')).slice(0, 400);
}

export async function capabilityState(d = {}) {
  const { state } = await loadJsonFile(CAP_FILE, d.drive || driveAdapter, d.folder || memoryFolderId());
  return state || { status: 'none', people: [] };
}

export async function startCapabilityRefresh(orgId, req, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const { state: scan } = await loadScan(drive, folder);
  const files = hrFiles(scan?.items || [], await (d.hrFolderId || hrFolderId)({ drive, folder }).catch(() => null));
  const cur = await loadJsonFile(CAP_FILE, drive, folder);
  const prev = cur.state || {};
  const st = { status: files.length ? 'reading' : 'done', started_at: new Date().toISOString(), files: files.map(f => ({ id: f.id, name: f.name, path: f.path, modifiedTime: f.modifiedTime || null })),
    done: 0, people: prev.people || [], read_versions: prev.read_versions || {}, updated_at: new Date().toISOString(),
    note: files.length ? null : 'Aucun dossier RH / CV trouvé dans la carte du Drive : lancez d’abord le premier scan.' };
  await saveJsonFile(CAP_FILE, drive, folder, cur.fileId, st);
  if (files.length) await (d.fire || fireInternal)(req, '/api/app?route=capabilities-step', {});
  return { started: Boolean(files.length), files: files.length };
}

// Merges one AI profile into the list (same e-mail, or same name).
export function mergePerson(list, p) {
  const key = x => norm(x.email) || norm(x.full_name);
  const k = key(p);
  if (!k) return list;
  const i = list.findIndex(x => (norm(x.email) && norm(x.email) === norm(p.email)) || norm(x.full_name) === norm(p.full_name));
  const union = (a, b) => [...new Map([...(a || []), ...(b || [])].filter(Boolean).map(v => [norm(typeof v === 'string' ? v : JSON.stringify(v)), v])).values()];
  if (i < 0) { list.push(p); return list; }
  const o = list[i];
  for (const f of ['qualifications', 'certifications', 'industries', 'technical_skills', 'specialist_skills', 'languages', 'countries', 'trainings', 'previous_engagements', 'source_files']) o[f] = union(o[f], p[f]);
  for (const f of ['email', 'current_title', 'kind', 'seniority', 'years_experience', 'management_card_notes']) if (!o[f] || o[f] === 'unknown') o[f] = p[f];
  return list;
}

export async function capabilityStep(orgId, req, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId(), fetchRows = d.fetchRows || rest;
  const cur = await loadJsonFile(CAP_FILE, drive, folder);
  const st = cur.state;
  if (!st || st.status !== 'reading') return st || { status: 'none' };
  const save = async s => { const c = await loadJsonFile(CAP_FILE, drive, folder); await saveJsonFile(CAP_FILE, drive, folder, c.fileId, s); };
  // Unchanged files already read are skipped (the database improves in place).
  let batch = [];
  while (st.done < st.files.length && batch.length < BATCH) {
    const f = st.files[st.done++];
    if (f.modifiedTime && st.read_versions[f.id] === f.modifiedTime) continue;
    batch.push(f);
  }
  if (batch.length) {
    const read = d.readText || ((id, o) => drive.readText(id, o));
    const docs = [];
    for (const f of batch) {
      try { const t = await read(f.id, { maxChars: CV_CHARS }); docs.push('### ' + f.path + '\n' + String(t?.text ?? t ?? '').slice(0, CV_CHARS)); } catch { /* unreadable: skipped */ }
    }
    if (docs.length) {
      try {
        const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: READ_CV, input: docs.join('\n\n'), maxTokens: 8000 });
        for (const p of parseJsonLoose(r.text).people || []) mergePerson(st.people, p);
      } catch (e) { st.last_error = String(e.message || e).slice(0, 200); }
    }
    for (const f of batch) if (f.modifiedTime) st.read_versions[f.id] = f.modifiedTime;
  }
  st.updated_at = new Date().toISOString();
  if (st.done >= st.files.length) {
    st.status = 'done'; st.finished_at = st.updated_at;
    st.applied = await applyCapabilities(orgId, st.people, { fetchRows }).catch(e => ({ error: String(e.message || e).slice(0, 200) }));
    st.index = capabilityIndex(st.people);
  }
  await save(st);
  if (st.status === 'reading') await (d.fire || fireInternal)(req, '/api/app?route=capabilities-step', {});
  return { status: st.status, done: st.done, total: st.files.length, people: st.people.length };
}

// Staff skills in the app completed from the CVs (never removed); consultants stay in the database.
export async function applyCapabilities(orgId, people, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const staff = await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&active=eq.true&select=id,full_name,email,skills&limit=300') || [];
  let completed = 0;
  for (const p of people) {
    const s = staff.find(x => (p.email && norm(x.email) === norm(p.email)) || norm(x.full_name) === norm(p.full_name));
    if (!s) continue;
    const add = [...(p.specialist_skills || []), ...(p.technical_skills || []), ...(p.certifications || []), ...(p.industries || []).map(i => 'Secteur : ' + i)];
    const have = new Set((s.skills || []).map(norm));
    const next = [...(s.skills || []), ...add.filter(x => x && !have.has(norm(x)))].slice(0, 60);
    if (next.length !== (s.skills || []).length) {
      await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&id=eq.' + q(s.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ skills: next }) }).catch(() => null);
      completed++;
    }
  }
  return { staff_completed: completed };
}

// competency → people who have it (from the profiles).
export function capabilityIndex(people) {
  const idx = {};
  for (const p of people || []) {
    for (const [kind, list] of [['spécialiste', p.specialist_skills], ['technique', p.technical_skills], ['certification', p.certifications], ['qualification', p.qualifications], ['secteur', p.industries], ['langue', p.languages]]) {
      for (const c of list || []) {
        const k = String(c).trim(); if (!k) continue;
        (idx[k] ||= { capability: k, kind, people: [] }).people.push(p.full_name);
      }
    }
  }
  return Object.values(idx).sort((a, b) => b.people.length - a.people.length).slice(0, 400);
}

// What Mission Controller receives for a capability check: each person's capabilities, current
// load and recent delivery facts (KPI from the work, never a judgement).
export async function capabilityContext(orgId, d = {}) {
  const st = await (d.capabilityState || capabilityState)(d).catch(() => ({ people: [] }));
  const fetchRows = d.fetchRows || rest;
  const staff = await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&active=eq.true&select=id,full_name,email,role_title,grade_title,department,skills&limit=300') || [];
  const kpi = await (d.teamKpis || teamKpis)(orgId, fetchRows).catch(() => ({ people: [] }));
  const byName = new Map((kpi.people || []).map(k => [norm(k.name), k]));
  const people = staff.map(s => {
    const cv = (st.people || []).find(p => (p.email && norm(p.email) === norm(s.email)) || norm(p.full_name) === norm(s.full_name)) || {};
    const k = byName.get(norm(s.full_name)) || {};
    return { full_name: s.full_name, email: s.email, kind: 'employee', title: s.role_title || cv.current_title || null, grade: s.grade_title || null, seniority: cv.seniority || null,
      years_experience: cv.years_experience ?? null, specialist_skills: cv.specialist_skills || [], technical_skills: [...new Set([...(cv.technical_skills || []), ...(s.skills || [])])].slice(0, 40),
      qualifications: cv.qualifications || [], certifications: cv.certifications || [], industries: cv.industries || [], languages: cv.languages || [], trainings: cv.trainings || [],
      previous_engagements: (cv.previous_engagements || []).slice(0, 15), load_pct: k.load_pct ?? null, missions_active: k.missions_active ?? null,
      on_time_rate: k.on_time_rate ?? null, actions_overdue: k.actions_overdue ?? null };
  });
  // Consultants and people with a CV but no account in the app.
  for (const p of st.people || []) {
    if (people.some(x => (p.email && norm(x.email) === norm(p.email)) || norm(x.full_name) === norm(p.full_name))) continue;
    people.push({ ...p, kind: p.kind === 'employee' ? 'cv_only' : (p.kind || 'consultant'), load_pct: null });
  }
  return { people, cv_database: { status: st.status || 'none', updated_at: st.updated_at || null, profiles: (st.people || []).length } };
}

// ---- Capability gaps: sent back to the Office Manager, which learns from recurring ones ----

export async function recordGaps(entry, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const cur = await loadJsonFile(GAPS_FILE, drive, folder);
  const st = cur.state || { gaps: [], recommendations: null };
  st.gaps = st.gaps.filter(g => g.mission_id !== entry.mission_id);   // latest analysis of a mission replaces its previous one
  for (const g of entry.gaps || []) st.gaps.push({ mission_id: entry.mission_id, mission: entry.mission, at: new Date().toISOString(), capability: g.capability, category: g.category || g.capability, severity: g.severity || null, external_suggestions: (g.external_specialists || []).map(x => x.name || x).slice(0, 5) });
  st.updated_at = new Date().toISOString();
  await saveJsonFile(GAPS_FILE, drive, folder, cur.fileId, st);
  return st;
}

export function recurringGaps(gaps) {
  const by = {};
  for (const g of gaps || []) {
    const k = norm(g.category || g.capability); if (!k) continue;
    const e = (by[k] ||= { category: g.category || g.capability, count: 0, missions: [], capabilities: new Set() });
    e.count++; if (!e.missions.includes(g.mission)) e.missions.push(g.mission); e.capabilities.add(g.capability);
  }
  return Object.values(by).map(e => ({ ...e, capabilities: [...e.capabilities], strategic: e.missions.length >= 2 })).sort((a, b) => b.count - a.count);
}

const STRATEGY = `Tu es le Grand Contrôleur (Office Manager) d'un cabinet d'audit et de conseil. On te donne les manques de compétences relevés par Mission Controller sur les dernières missions et les capacités actuelles de l'équipe.
Pour chaque manque RÉCURRENT (au moins deux missions), recommande au(x) associé(s) ce qui convient le mieux : formation, recrutement, développement d'un collaborateur existant (dis lequel et pourquoi, d'après ses compétences voisines), réseau d'experts externes, partenariat. Sois concret (durée, coût relatif, délai), factuel et bref.
JSON STRICT : {"recommendations":[{"category":"","missions":0,"recommendation":"formation|recrutement|développement|réseau externe|partenariat","detail":"","candidate_to_develop":"","priority":"haute|moyenne|basse"}]}`;

export async function capabilityInsights(orgId, { refresh = false } = {}, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const cur = await loadJsonFile(GAPS_FILE, drive, folder);
  const st = cur.state || { gaps: [] };
  const recurring = recurringGaps(st.gaps);
  if (refresh && recurring.some(r => r.strategic)) {
    const ctx = await capabilityContext(orgId, d).catch(() => ({ people: [] }));
    const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: STRATEGY,
      input: 'MANQUES : ' + JSON.stringify(recurring) + '\n\nÉQUIPE : ' + JSON.stringify(ctx.people.map(p => ({ name: p.full_name, title: p.title, specialist: p.specialist_skills, technical: p.technical_skills.slice(0, 15), certifications: p.certifications }))).slice(0, 60000), maxTokens: 4000 });
    st.recommendations = { at: new Date().toISOString(), items: parseJsonLoose(r.text).recommendations || [] };
    await saveJsonFile(GAPS_FILE, drive, folder, cur.fileId, st);
  }
  const cap = await capabilityState(d).catch(() => ({ people: [] }));
  return { status: cap.status === 'reading' ? 'reading' : 'done', recurring, recent: (st.gaps || []).slice(-30).reverse(), recommendations: st.recommendations || null,
    database: { status: cap.status, people: (cap.people || []).length, updated_at: cap.updated_at || null, done: cap.done || 0, total: (cap.files || []).length, index: (cap.index || []).slice(0, 80) } };
}

// A readable copy of the capability matrix in the agents' folder (for the partners).
export async function capabilityReport(orgId, d = {}) {
  const ctx = await capabilityContext(orgId, d);
  const lines = ['Capacités disponibles au ' + new Date().toLocaleDateString('fr-FR') + ', lues dans les CV, Management Cards et missions passées.', '',
    '| Personne | Statut | Compétences spécialistes | Secteurs | Langues | Certifications |', '| --- | --- | --- | --- | --- | --- |',
    ...ctx.people.map(p => '| ' + [p.full_name, p.kind === 'employee' ? (p.title || 'Collaborateur') : 'Consultant / externe', (p.specialist_skills || []).join(', '), (p.industries || []).join(', '), (p.languages || []).join(', '), (p.certifications || []).join(', ')].map(x => String(x || '–').replace(/\|/g, '/')).join(' | ') + ' |')];
  return saveReport('capabilities', 'Matrice des capacités du cabinet', lines.join('\n'), d);
}
