import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadScan, loadJsonFile, saveJsonFile } from './mapping-scan.js';
import { firstAvailable, deepResearch, parseJsonLoose } from './ai-plus.js';
import { fileForAI, saveReport } from './agent-outputs.js';
import { capabilityContext, recordGaps } from './capabilities.js';
import { fireInternal } from './agent-passes.js';
import { PEOPLE_RULES } from './people-intelligence.js';

// ENGAGEMENT PREPARATION — Mission Controller, for the Grand Contrôleur / Office Manager
// (Paul, 2026-10-08). For an active mission or a mission not yet started:
//   1. the AI READS the TDR (terms of reference, RFP, contract…), pictures and scans included;
//   2. DEEP RESEARCH on the web (Claude, ChatGPT or Gemini with web search, sources kept): the
//      client, its industry and country, the rules that apply, what this kind of work requires;
//   3. CAPABILITY CHECK: competencies, specialist competencies, qualifications, industry
//      experience, languages, seniority and technical capabilities required, compared with the
//      firm's people (CVs, past engagements, current load):
//         required capability → available internally → person(s) available → gap;
//   4. GAPS: research of external specialists who could cover each gap, with why; every gap is
//      sent back to the Office Manager (recurring gaps → training, recruitment, partnership…);
//   5. a PROPOSED team — only with people who actually have the capabilities (a proposal: a
//      manager decides, R009–R012 apply);
//   6. an INDUSTRY RISK BRIEFING saved in the risk assessment (Drive, EVALUATION_DES_RISQUES),
//      later used by the Enhanced Auditor, and the whole preparation saved as a Google Doc.
// One step per server call (deep research takes time); progress kept in the agents' Drive memory.

const FILE = 'OFFICE_MANAGER_ENGAGEMENTS.json';
const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORDER = ['anthropic', 'openai', 'gemini'];
const CLOSED = ['cancelled', 'canceled', 'closed', 'archived', 'completed'];
const NOT_STARTED = ['planned', 'proposal', 'prospect', 'draft', 'to_start', 'pending', 'won', 'tender'];

// Active missions and missions not yet started (never cancelled, closed or finished).
export async function engagementMissions(orgId, d = {}) {
  const rows = await (d.fetchRows || rest)('office_missions?org_id=eq.' + q(orgId) + '&status=not.in.(' + CLOSED.join(',') + ')&select=id,name,mission_code,status,planned_start,planned_end&order=planned_start.asc.nullsfirst&limit=300') || [];
  const today = new Date().toISOString().slice(0, 10);
  return rows.filter(m => !/entra[iî]nement|training/i.test(m.name || ''))
    .map(m => ({ ...m, phase: NOT_STARTED.includes(String(m.status || '').toLowerCase()) || (m.planned_start && m.planned_start > today) ? 'not_started' : 'active' }))
    .sort((a, b) => (a.phase === b.phase ? 0 : a.phase === 'not_started' ? -1 : 1));
}

const words = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !/^(audit|mission|missions|des|les|pour|and|the|20\d\d)$/.test(w));
const TDR = /(tdr|t\.d\.r|termes?[\s_-]*de[\s_-]*r[ée]f|terms?[\s_-]*of[\s_-]*ref|\btor\b|cahier[\s_-]*des[\s_-]*charges|appel[\s_-]*d.?offres?|\brfp\b|\bdao\b|request[\s_-]*for[\s_-]*proposal|avis[\s_-]*(de[\s_-]*)?manifestation|lettre[\s_-]*de[\s_-]*mission|engagement[\s_-]*letter|contrat|contract|proposition|proposal|offre[\s_-]*technique)/i;

// Candidate TDR files for a mission, from the Drive map: TDR-like documents, those mentioning the
// mission's words first.
export async function tdrCandidates(orgId, missionId, d = {}) {
  const [mission] = await (d.fetchRows || rest)('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId) + '&select=id,name,mission_code&limit=1') || [];
  if (!mission) throw fail('MISSION_NOT_FOUND', 404);
  const { state } = await loadScan(d.drive || driveAdapter, d.folder || memoryFolderId());
  // Documents deposited for this mission and recognised as TDR / contract come first.
  const deposited = (await (d.missionDocuments || (await import('./mission-files.js')).missionDocuments)(missionId, d).catch(() => []))
    .filter(x => ['tdr', 'contrat', 'lettre_de_mission'].includes(x.role)).map(x => ({ id: x.id, name: x.name, path: 'Déposé : ' + (x.path || x.name), mimeType: null, modifiedTime: x.at, score: 100 }));
  const mw = words(mission.name + ' ' + (mission.mission_code || ''));
  return (state?.items || []).filter(i => i.mimeType !== 'application/vnd.google-apps.folder' && TDR.test((i.name || '') + ' ' + (i.path || '')) && !/OFFICE_MANAGER_/.test(i.name || ''))
    .map(i => { const iw = new Set(words(i.path)); const hit = mw.filter(w => iw.has(w)).length; return { id: i.id, name: i.name, path: i.path, mimeType: i.mimeType, modifiedTime: i.modifiedTime || null, score: hit * 10 + (/(tdr|termes|terms|\btor\b|cahier|rfp|dao)/i.test(i.name || '') ? 5 : 0) }; })
    .filter(x => x.score > 0).concat(deposited).sort((a, b) => b.score - a.score).filter((x, i, all) => all.findIndex(y => y.id === x.id) === i).slice(0, 20);
}

async function loadAll(d) { return loadJsonFile(FILE, d.drive || driveAdapter, d.folder || memoryFolderId()); }
async function saveOne(missionId, st, d) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const cur = await loadAll(d);
  const all = cur.state || { engagements: {} };
  st.updated_at = new Date().toISOString();
  all.engagements[missionId] = st;
  await saveJsonFile(FILE, drive, folder, cur.fileId, all);
  return st;
}

export async function engagementState(missionId, d = {}) {
  const st = (await loadAll(d)).state?.engagements?.[missionId];
  return st || { status: 'none' };
}

export async function startEngagementPrep(orgId, req, body = {}, d = {}) {
  const missionId = String(body.mission_id || '');
  if (!ID.test(missionId)) throw fail('VALID_MISSION_ID_REQUIRED');
  const missions = await engagementMissions(orgId, d);
  const mission = missions.find(m => m.id === missionId);
  if (!mission) throw fail('MISSION_NOT_ACTIVE_OR_UPCOMING', 409);
  const files = (Array.isArray(body.tdr_file_ids) ? body.tdr_file_ids : []).map(String).filter(Boolean).slice(0, 6);
  if (!files.length) throw fail('TDR_REQUIRED');
  const st = { status: 'running', stage: 'read_tdr', mission: { id: mission.id, name: mission.name, code: mission.mission_code, phase: mission.phase, planned_start: mission.planned_start, planned_end: mission.planned_end },
    tdr_files: files, notes: String(body.notes || '').slice(0, 3000), requested_by: body.requested_by || null, started_at: new Date().toISOString(), log: [] };
  await saveOne(missionId, st, d);
  await (d.fire || fireInternal)(req, '/api/app?route=engagement-step', { mission_id: missionId });
  return { started: true, mission: st.mission };
}

const READ_TDR = `Tu es Mission Controller, dans un cabinet d'audit, d'expertise et de conseil. Tu lis les termes de référence (TDR), appel d'offres, contrat ou lettre de mission fournis (texte, scans ou images, en français ou en anglais).
Extrais fidèlement, sans rien inventer, en citant le texte quand c'est une exigence.
JSON STRICT : {"client":"","country":"","industry":"","sub_industry":"","engagement_type":"","financing_or_funder":"","scope":"","objectives":[""],"deliverables":[{"name":"","due":""}],"timeline":{"start":"","end":"","duration":"","submission_deadline":""},
"budget_or_days":"","reporting_framework":"","applicable_standards":[""],
"stated_requirements":[{"category":"competence|specialist|qualification|industry|language|seniority|technical|other","requirement":"","level":"","quote":""}],
"key_experts":[{"role":"","qualifications":"","years":"","specific":"","quote":""}],"evaluation_criteria":[""],"risks_mentioned":[""],"open_questions":[""]}`;

const RESEARCH = `You are the research arm of Mission Controller, in an audit and advisory firm. Search the web and answer in French, as a briefing for the engagement partner. Cite your sources inline as [source](url).
Cover, briefly and concretely:
### Le client et son contexte (activité, taille, actualité récente, gouvernance, bailleurs s'il y en a)
### Le secteur dans ce pays (marché, réglementation applicable, normes comptables et d'audit, autorités de contrôle, fiscalité spécifique)
### Les risques propres au secteur (risques inhérents, risques de fraude, risques de continuité, risques IT, comptes et assertions les plus exposés)
### Les compétences que ce type de mission exige (spécialistes, certifications, expérience sectorielle, langues)
Do not invent facts: when you found nothing reliable, say so.`;

const MATCH = `Tu es Mission Controller. Ta règle : Office Manager ne propose JAMAIS une équipe sans avoir vérifié qu'elle a réellement les capacités exigées par la mission.
On te donne : ce que dit le TDR, la recherche sur le client et le secteur, et les personnes du cabinet (CV, compétences, certifications, secteurs, langues, missions passées, charge actuelle).
1. Liste TOUTES les capacités requises : compétences, compétences de spécialiste, qualifications/certifications, expérience sectorielle, langues, séniorité, capacités techniques spécifiques du TDR. Pour chacune : source ("TDR" avec la citation, ou "recherche").
2. Pour chacune, compare avec les personnes : disponible en interne (oui / partiel / non), les personnes qui l'ont (avec la preuve tirée de leur CV ou de leurs missions) et leur disponibilité (charge actuelle), et s'il y a un MANQUE.
3. Propose une équipe UNIQUEMENT avec des personnes qui couvrent les capacités, compétences et disponibilité d'abord (R009), sans jamais forcer une affectation : c'est une proposition qu'un responsable valide.
4. Range chaque manque dans une catégorie courte et stable (ex. "IFRS 9", "Dépréciation (impairment)", "Mines", "ESG", "Audit IT", "Évaluation", "Fiscalité", "Langue : portugais").
JSON STRICT : {"requirements":[{"category":"competence|specialist|qualification|industry|language|seniority|technical","capability":"","level":"","source":"TDR|recherche","quote":"","internal":"oui|partiel|non","people":[{"name":"","evidence":"","load_pct":null,"available":"oui|partiel|non|inconnu"}],"gap":true,"gap_category":""}],
"proposed_team":[{"name":"","role":"","why":"","covers":[""],"load_pct":null}],"team_ready":true,"blocking_gaps":[""],"notes":""}`;

const EXTERNALS = `You are Mission Controller. For each capability gap below, search the web for external specialists (independent experts or specialised firms) who could cover it for this engagement, preferably in or familiar with the country and industry. Answer in French.
For each gap give 2 to 4 suggestions with: name (person or firm), why they are relevant (experience, credentials, region), how they could be engaged (sub-contracting, expert on call, partnership), and the source link. Never invent a name: list only what you found. Say "à vérifier" — nobody has been contacted.
Return STRICT JSON: {"externals":[{"gap":"","suggestions":[{"name":"","why":"","engagement":"","source":""}]}]}`;

const BRIEF = `Tu es le Grand Contrôleur (Office Manager) d'un cabinet d'audit. Écris le BRIEFING DES RISQUES LIÉS AU SECTEUR pour l'évaluation des risques de la mission, à partir du TDR et de la recherche fournie (sources à garder entre crochets avec leur lien).
Structure : ### Contexte en bref ; ### Risques inhérents du secteur (tableau | Risque | Comptes / assertions | Niveau | Pourquoi |) ; ### Risques de fraude ; ### Réglementation et conformité ; ### Continuité d'exploitation et événements récents ; ### Systèmes d'information ; ### Réponses d'audit suggérées (procédures à prévoir pour chaque risque élevé) ; ### Sources.
Professionnel, factuel, sans remplissage. Ne présente rien comme vérifié chez le client : c'est un briefing de planification, l'auditeur conclut.`;

export async function engagementStep(orgId, req, body = {}, d = {}) {
  const missionId = String(body.mission_id || '');
  const st = await engagementState(missionId, d);
  if (st.status !== 'running') return st;
  const say = m => { st.log.push({ at: new Date().toISOString(), m }); };
  const next = async stage => { st.stage = stage; await saveOne(missionId, st, d); await (d.fire || fireInternal)(req, '/api/app?route=engagement-step', { mission_id: missionId }); return st; };
  const ai = d.ai || firstAvailable, research = d.research || deepResearch;
  try {
    if (st.stage === 'read_tdr') {
      const files = [];
      for (const id of st.tdr_files) { try { files.push(await (d.fileForAI || fileForAI)(id)); } catch (e) { say('TDR illisible (' + id + ') : ' + String(e.message || e).slice(0, 80)); } }
      if (!files.length) throw fail('TDR_UNREADABLE', 422);
      st.tdr_sources = files.map(f => ({ id: f.id, name: f.name, url: f.url }));
      const text = files.filter(f => !f.visual).map(f => '### ' + f.name + '\n' + f.text).join('\n\n').slice(0, 120000);
      // Scans and pictures are read by a model that sees them (Claude or Gemini first).
      const visual = files.filter(f => f.visual);
      const r = await ai(visual.length ? ['anthropic', 'gemini', 'openai'] : ORDER, { instructions: READ_TDR, input: 'MISSION : ' + st.mission.name + (st.notes ? '\nPRÉCISIONS DU RESPONSABLE : ' + st.notes : '') + '\n\nDOCUMENTS :\n' + (text || '(voir les documents joints)'), files: visual, maxTokens: 8000 });
      st.tdr = parseJsonLoose(r.text); st.tdr_read_by = r.provider;
      say('TDR lu (' + files.length + ' document' + (files.length > 1 ? 's' : '') + ', ' + r.provider + ').');
      return next('research');
    }
    if (st.stage === 'research') {
      const t = st.tdr || {};
      const r = await research({ instructions: RESEARCH, question: 'Mission : ' + st.mission.name + '\nClient : ' + (t.client || '?') + '\nPays : ' + (t.country || '?') + '\nSecteur : ' + [t.industry, t.sub_industry].filter(Boolean).join(' / ') + '\nType de mission : ' + (t.engagement_type || '?') + '\nPérimètre : ' + String(t.scope || '').slice(0, 1500) + '\nRéférentiel : ' + (t.reporting_framework || '?') });
      st.research = { text: r.text || '', sources: r.sources || [], provider: r.provider || null, web: Boolean(r.web), error: r.error || null };
      say(r.web ? 'Recherche approfondie faite (' + r.provider + ', ' + (r.sources || []).length + ' sources).' : 'Recherche web indisponible (' + (r.error || 'aucune clé') + ') : analyse sur le TDR seul.');
      return next('match');
    }
    if (st.stage === 'match') {
      const cap = await (d.capabilityContext || capabilityContext)(orgId, d);
      const people = cap.people.map(p => ({ name: p.full_name, kind: p.kind, title: p.title, grade: p.grade, seniority: p.seniority, years: p.years_experience, specialist: p.specialist_skills, technical: (p.technical_skills || []).slice(0, 25), qualifications: p.qualifications, certifications: p.certifications, industries: p.industries, languages: p.languages, past: (p.previous_engagements || []).slice(0, 8), load_pct: p.load_pct, missions_active: p.missions_active }));
      const r = await ai(ORDER, { instructions: MATCH, input: 'RÈGLES : ' + JSON.stringify(PEOPLE_RULES) + '\n\nTDR : ' + JSON.stringify(st.tdr).slice(0, 40000) + '\n\nRECHERCHE : ' + String(st.research?.text || '(aucune)').slice(0, 25000) + '\n\nPERSONNES DU CABINET (' + cap.cv_database.profiles + ' profils lus dans les CV) : ' + JSON.stringify(people).slice(0, 80000), maxTokens: 12000 });
      st.match = parseJsonLoose(r.text); st.match_by = r.provider; st.cv_database = cap.cv_database;
      const gaps = (st.match.requirements || []).filter(x => x.gap);
      say(gaps.length ? gaps.length + ' manque' + (gaps.length > 1 ? 's' : '') + ' de capacité relevé' + (gaps.length > 1 ? 's' : '') + '.' : 'Toutes les capacités requises existent en interne.');
      return next(gaps.length ? 'externals' : 'brief');
    }
    if (st.stage === 'externals') {
      const gaps = (st.match.requirements || []).filter(x => x.gap);
      const t = st.tdr || {};
      const r = await research({ instructions: EXTERNALS, question: 'Pays : ' + (t.country || '?') + ' ; secteur : ' + (t.industry || '?') + ' ; mission : ' + st.mission.name + '\nMANQUES :\n' + gaps.map(g => '- ' + g.capability + (g.level ? ' (' + g.level + ')' : '')).join('\n'), maxTokens: 5000 });
      let externals = [];
      try { externals = parseJsonLoose(r.text).externals || []; } catch { externals = []; }
      st.externals = { items: externals, sources: r.sources || [], provider: r.provider || null, web: Boolean(r.web), error: r.error || null };
      for (const g of gaps) g.external_specialists = (externals.find(e => String(e.gap).toLowerCase() === String(g.capability).toLowerCase()) || externals.find(e => String(e.gap).toLowerCase().includes(String(g.capability).toLowerCase().slice(0, 12))) || {}).suggestions || [];
      await (d.recordGaps || recordGaps)({ mission_id: missionId, mission: st.mission.name, gaps: gaps.map(g => ({ capability: g.capability, category: g.gap_category || g.capability, severity: (st.match.blocking_gaps || []).some(b => String(b).includes(g.capability)) ? 'bloquant' : null, external_specialists: g.external_specialists })) }, d).catch(() => null);
      say('Spécialistes externes recherchés pour ' + gaps.length + ' manque' + (gaps.length > 1 ? 's' : '') + ' ; manques transmis au Grand Contrôleur.');
      return next('brief');
    }
    if (st.stage === 'brief') {
      const r = await ai(ORDER, { instructions: BRIEF, input: 'MISSION : ' + st.mission.name + '\nTDR : ' + JSON.stringify(st.tdr).slice(0, 30000) + '\n\nRECHERCHE (avec sources) :\n' + String(st.research?.text || '(aucune recherche web disponible)').slice(0, 40000) + '\nSOURCES : ' + JSON.stringify(st.research?.sources || []).slice(0, 6000), maxTokens: 8000 });
      st.risk_brief = { text: r.text, by: r.provider };
      st.risk_doc = await (d.saveReport || saveReport)('risks', st.mission.name + ' — Risques liés au secteur (Grand Contrôleur)', r.text, d).catch(e => ({ error: String(e.message || e).slice(0, 200) }));
      st.report_doc = await (d.saveReport || saveReport)('engagements', st.mission.name + ' — Préparation de l’engagement', engagementMarkdown(st), d).catch(e => ({ error: String(e.message || e).slice(0, 200) }));
      say('Briefing des risques enregistré dans l’évaluation des risques ; préparation enregistrée dans le Drive.');
      st.status = 'done'; st.stage = 'done'; st.finished_at = new Date().toISOString();
      await saveOne(missionId, st, d);
      return st;
    }
  } catch (e) {
    st.status = 'failed'; st.error = String(e.message || e).slice(0, 300); say('Arrêt : ' + st.error);
    await saveOne(missionId, st, d);
  }
  return st;
}

const cell = v => String(v ?? '–').replace(/\|/g, '/').replace(/\n/g, ' ') || '–';
export function engagementMarkdown(st) {
  const t = st.tdr || {}, m = st.match || {};
  const req = m.requirements || [];
  const lines = [
    'Préparée par Mission Controller pour le Grand Contrôleur, à partir du TDR' + (st.research?.web ? ' et d’une recherche approfondie sur le web' : '') + '. Proposition : un responsable décide.', '',
    '### La mission en bref',
    '- **Client :** ' + (t.client || '–') + ' (' + [t.country, t.industry].filter(Boolean).join(', ') + ')',
    '- **Type :** ' + (t.engagement_type || '–') + (t.reporting_framework ? ' — référentiel ' + t.reporting_framework : ''),
    '- **Périmètre :** ' + (t.scope || '–'),
    '- **Calendrier :** ' + [t.timeline?.start, t.timeline?.end].filter(Boolean).join(' → ') + (t.timeline?.submission_deadline ? ' (dépôt : ' + t.timeline.submission_deadline + ')' : ''),
    '',
    '### Vérification des capacités',
    '| Capacité requise | Source | Disponible en interne | Personne(s) | Manque |', '| --- | --- | --- | --- | --- |',
    ...req.map(r => '| ' + [cell(r.capability) + (r.level ? ' (' + cell(r.level) + ')' : ''), r.source === 'TDR' ? 'TDR' : 'Recherche', cell(r.internal), (r.people || []).map(p => p.name + (p.available && p.available !== 'oui' ? ' (dispo : ' + p.available + ')' : '')).join(', ') || '–', r.gap ? '**Oui**' : 'Non'].join(' | ') + ' |'),
    ''
  ];
  const gaps = req.filter(r => r.gap);
  if (gaps.length) {
    lines.push('### Manques et spécialistes externes possibles');
    for (const g of gaps) {
      lines.push('**' + g.capability + '** — capacité interne : non disponible' + (g.gap_category ? ' (catégorie : ' + g.gap_category + ')' : '') + '.');
      for (const s of g.external_specialists || []) lines.push('- ' + s.name + ' : ' + (s.why || '') + (s.engagement ? ' — ' + s.engagement : '') + (s.source ? ' [source](' + s.source + ')' : '') + ' (à vérifier)');
      if (!(g.external_specialists || []).length) lines.push('- Aucun spécialiste externe trouvé de façon fiable : à rechercher dans le réseau du cabinet.');
      lines.push('');
    }
  }
  lines.push('### Équipe proposée', ...(m.proposed_team || []).map(p => '- **' + p.name + '** — ' + (p.role || '') + ' : ' + (p.why || '') + (p.load_pct != null ? ' (charge actuelle ' + p.load_pct + ' %)' : '')), '',
    m.team_ready === false ? 'L’équipe ne peut pas être finalisée tant que les manques bloquants ne sont pas couverts : ' + (m.blocking_gaps || []).join(', ') + '.' : 'Les capacités requises sont couvertes ; disponibilités à confirmer par le responsable.', '');
  if ((t.open_questions || []).length) lines.push('### Questions à clarifier', ...t.open_questions.map(x => '- ' + x), '');
  if (st.research?.sources?.length) lines.push('### Sources', ...st.research.sources.slice(0, 20).map(s => '- [' + cell(s.title).slice(0, 90) + '](' + s.url + ')'));
  return lines.join('\n');
}
