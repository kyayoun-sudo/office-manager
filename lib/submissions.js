import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, saveJsonFile } from './mapping-scan.js';
import { connectedHas, connectionAccessToken, SCOPES, loadGoogleConnection } from './google-connection.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { fireInternal } from './agent-passes.js';
import { saveReport } from './agent-outputs.js';

// SUBMISSION PERFORMANCE — Grand Contrôleur / Office Manager (Paul, 2026-10-08).
// The AI reads the e-mails about tenders, proposals and engagement opportunities (Gmail of the
// firm's connected Google account, read-only) and rebuilds, for each submission: when the TDR /
// opportunity arrived, the official deadline, when the proposal actually left, the days available
// and used, early / on time / late, the internal milestones (assignment, first draft, CV
// requests and receipts, partner review, missing information) and who took part.
// KPI are then COMPUTED from those dates (not estimated by the AI), at firm, process, team and
// individual level. Delays are attributed only on evidence, to the stage where they occurred: a
// proposal submitted late because the partner reviewed it late does not count against the junior
// who prepared it. Then recommendations to improve the process, for the Partner Dashboard.
// Progress and results in the agents' Drive memory (OFFICE_MANAGER_SUBMISSIONS.json).

const FILE = 'OFFICE_MANAGER_SUBMISSIONS.json';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_THREADS = 60, THREADS_PER_STEP = 6, MSG_CHARS = 1800;
const DAY = 86400000, HOUR = 3600000;
const ORDER = ['anthropic', 'openai', 'gemini'];

export const SUBMISSION_QUERY = '(TDR OR "termes de référence" OR "terms of reference" OR "appel d\'offres" OR "appel d’offres" OR "request for proposal" OR RFP OR "manifestation d\'intérêt" OR "expression of interest" OR soumission OR submission OR "dépôt" OR "proposition technique" OR "offre technique" OR "technical proposal" OR "financial proposal" OR "date limite" OR deadline)';

async function gmail(path, token, fetchImpl) {
  const r = await fetchImpl(API + path, { headers: { Authorization: 'Bearer ' + token } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('GMAIL_READ_' + r.status), { statusCode: 502 });
  return data;
}
const header = (m, n) => (m.payload?.headers || []).find(h => h.name.toLowerCase() === n)?.value || '';
function bodyText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  for (const p of part.parts || []) { const t = bodyText(p); if (t) return t; }
  return '';
}
const attachments = part => { const out = []; const walk = p => { if (!p) return; if (p.filename) out.push(p.filename); (p.parts || []).forEach(walk); }; walk(part); return out.slice(0, 12); };

export async function submissionState(d = {}) {
  return (await loadJsonFile(FILE, d.drive || driveAdapter, d.folder || memoryFolderId())).state || { status: 'none' };
}
async function save(st, d) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const cur = await loadJsonFile(FILE, drive, folder);
  st.updated_at = new Date().toISOString();
  await saveJsonFile(FILE, drive, folder, cur.fileId, st);
  return st;
}

export async function startSubmissionReview(orgId, req, body = {}, d = {}) {
  const months = Math.min(24, Math.max(1, Number(body.months) || 12));
  if (!d.token) {
    await loadGoogleConnection(orgId).catch(() => null);
    if (!connectedHas(SCOPES.gmailRead)) throw Object.assign(new Error('GMAIL_READ_NOT_CONNECTED'), { statusCode: 409 });
  }
  const prev = await submissionState(d);
  const st = { status: 'running', stage: 'collect', months, started_at: new Date().toISOString(), threads: [], extracted: [], done: 0,
    previous: prev.status === 'done' ? { finished_at: prev.finished_at, kpi: prev.kpi } : prev.previous || null };
  await save(st, d);
  await (d.fire || fireInternal)(req, '/api/app?route=submissions-step', {});
  return { started: true, months };
}

const EXTRACT = `Tu es le Grand Contrôleur (Office Manager) d'un cabinet d'audit et de conseil. Tu lis des fils d'e-mails (français ou anglais) liés à des appels d'offres, TDR, propositions et opportunités.
Pour chaque fil, relève les ÉVÉNEMENTS datés, uniquement ceux qui sont écrits ou prouvés par l'e-mail lui-même (date d'envoi, contenu), avec la référence du message comme preuve.
Types : "opportunity_received" (TDR/appel reçu), "deadline" (date limite officielle, écrite dans le texte), "assignment" (quelqu'un est chargé de la proposition), "first_draft", "cv_request", "cv_received", "document_request", "document_received", "missing_information", "partner_review_requested", "partner_review_done", "submitted" (envoi de l'offre au client / dépôt sur la plateforme / accusé de réception), "clarification", "outcome" (attribué / non retenu).
JSON STRICT : {"threads":[{"thread_id":"","opportunity":"","client":"","reference":"","events":[{"type":"","at":"AAAA-MM-JJTHH:MM","who":"","who_email":"","role":"","evidence_message_id":"","evidence":"citation courte"}],"people":[{"name":"","email":"","role":"preparer|reviewer|partner|manager|hr|client|other"}],"not_a_submission":false}]}
Règles : la date limite vient du texte (jamais supposée) ; "submitted" seulement avec une preuve d'envoi ou de dépôt ; si le fil ne concerne pas une soumission, not_a_submission = true.`;

const MERGE = `Tu es le Grand Contrôleur. On te donne des événements extraits de plusieurs fils d'e-mails. Regroupe-les par SOUMISSION (une même opportunité peut couvrir plusieurs fils) et donne pour chacune les dates clés et les jalons.
JSON STRICT : {"submissions":[{"opportunity":"","client":"","reference":"","received_at":"","deadline":"","submitted_at":"","milestones":[{"type":"","at":"","who":"","evidence":""}],"people":[{"name":"","email":"","role":""}],"thread_ids":[""],"outcome":"","confidence":"haute|moyenne|basse","missing":[""]}]}
N'invente aucune date : laisse vide ce qui n'est pas prouvé et liste-le dans "missing".`;

const ATTRIBUTE = `Tu es le Grand Contrôleur. Tu évalues le PROCESSUS de soumission et l'ÉQUIPE, objectivement et sur preuves.
Pour chaque soumission tardive ou serrée (moins de 48 h de marge), dis OÙ le temps a été perdu (étape : affectation, collecte des CV, documents manquants, premier jet, revue de l'associé, validation, dépôt) et QUI ou QUOI en est la cause (une personne, une dépendance externe, le processus), avec les preuves (jalons datés).
RÈGLE ABSOLUE : n'attribue jamais une mauvaise performance à une personne quand la preuve montre que le retard vient d'une autre personne, d'une dépendance ou du processus ; si la preuve manque, écris "cause non établie".
Puis donne des RECOMMANDATIONS concrètes pour améliorer le processus, chiffrées à partir des KPI fournis (ex. "Trois des cinq dernières propositions déposées à moins de 24 h de la limite : fixer une date limite interne 48 h avant", "La collecte des CV a coûté en moyenne 1,7 jour : tenir des CV standard validés dans le dossier RH/CV", "La revue de l'associé tombe dans les 12 dernières heures : demande de revue automatique 72 h avant").
JSON STRICT : {"attributions":[{"opportunity":"","where":"","cause":"personne|dépendance|processus|non établie","who":"","evidence":"","not_attributable_to":[""]}],
"recommendations":[{"title":"","detail":"","based_on":"","level":"cabinet|processus|équipe|individuel","priority":"haute|moyenne|basse"}],
"people_notes":[{"name":"","note":"","evidence":""}]}
Les "people_notes" sont des repères factuels pour un échange avec la personne (jamais une sanction, jamais une décision RH automatique).`;

export async function submissionStep(orgId, req, d = {}) {
  const st = await submissionState(d);
  if (st.status !== 'running') return st;
  const fetchImpl = d.fetchImpl || fetch, ai = d.ai || firstAvailable;
  const fire = () => (d.fire || fireInternal)(req, '/api/app?route=submissions-step', {});
  try {
    if (st.stage === 'collect') {
      const token = d.token || await connectionAccessToken();
      const list = await gmail('/threads?maxResults=' + MAX_THREADS + '&q=' + encodeURIComponent('newer_than:' + st.months + 'm ' + SUBMISSION_QUERY), token, fetchImpl);
      const ids = (list.threads || []).map(t => t.id).slice(0, MAX_THREADS);
      for (const id of ids) {
        const t = await gmail('/threads/' + encodeURIComponent(id) + '?format=full', token, fetchImpl).catch(() => null);
        if (!t) continue;
        st.threads.push({ id, messages: (t.messages || []).slice(-12).map(m => ({ id: m.id, at: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : header(m, 'date'),
          from: header(m, 'from'), to: header(m, 'to'), cc: header(m, 'cc'), subject: header(m, 'subject'), attachments: attachments(m.payload),
          text: bodyText(m.payload).split(/\n(?:Le .{5,80} a écrit|On .{5,80} wrote)\s*:|\n-{2,} ?Original Message/)[0].replace(/\s+\n/g, '\n').slice(0, MSG_CHARS) })) });
      }
      st.stage = 'extract'; await save(st, d); await fire(); return st;
    }
    if (st.stage === 'extract') {
      const batch = st.threads.slice(st.done, st.done + THREADS_PER_STEP);
      if (batch.length) {
        try {
          const r = await ai(ORDER, { instructions: EXTRACT, input: JSON.stringify(batch).slice(0, 150000), maxTokens: 8000 });
          st.extracted.push(...(parseJsonLoose(r.text).threads || []).filter(t => !t.not_a_submission));
        } catch (e) { st.last_error = String(e.message || e).slice(0, 200); }
        st.done += batch.length;
      }
      if (st.done >= st.threads.length) st.stage = 'merge';
      await save(st, d); await fire(); return st;
    }
    if (st.stage === 'merge') {
      const r = await ai(ORDER, { instructions: MERGE, input: JSON.stringify(st.extracted).slice(0, 180000), maxTokens: 12000 });
      st.submissions = (parseJsonLoose(r.text).submissions || []).map(measure);
      st.kpi = submissionKpis(st.submissions);
      const a = await ai(ORDER, { instructions: ATTRIBUTE, input: 'KPI : ' + JSON.stringify(st.kpi) + '\n\nSOUMISSIONS : ' + JSON.stringify(st.submissions).slice(0, 150000), maxTokens: 8000 });
      const out = parseJsonLoose(a.text);
      st.attributions = out.attributions || []; st.recommendations = out.recommendations || []; st.people_notes = out.people_notes || [];
      st.report = await (d.saveReport || saveReport)('submissions', 'Performance des soumissions', submissionMarkdown(st), d).catch(e => ({ error: String(e.message || e).slice(0, 200) }));
      st.threads = []; st.extracted = st.extracted.slice(0, 200);   // the raw mail is not kept
      st.status = 'done'; st.stage = 'done'; st.finished_at = new Date().toISOString();
      await save(st, d); return st;
    }
  } catch (e) {
    st.status = 'failed'; st.error = String(e.message || e).slice(0, 300); st.threads = [];
    await save(st, d);
  }
  return st;
}

const t = v => { const x = Date.parse(v || ''); return Number.isFinite(x) ? x : null; };
const round = (x, n = 1) => x == null ? null : Math.round(x * 10 ** n) / 10 ** n;
// Dates → durations and status, computed (never estimated).
export function measure(s) {
  const rec = t(s.received_at), dl = t(s.deadline), sub = t(s.submitted_at);
  const ms = (s.milestones || []).map(m => ({ ...m, ts: t(m.at) })).filter(m => m.ts);
  const first = type => ms.filter(m => m.type === type).sort((a, b) => a.ts - b.ts)[0]?.ts ?? null;
  const last = type => ms.filter(m => m.type === type).sort((a, b) => b.ts - a.ts)[0]?.ts ?? null;
  const margin = dl != null && sub != null ? (dl - sub) / HOUR : null;
  const cvReq = first('cv_request'), cvRec = last('cv_received'), revReq = first('partner_review_requested'), revDone = last('partner_review_done');
  return { ...s,
    window_days: rec != null && dl != null ? round((dl - rec) / DAY) : null,
    days_used: rec != null && sub != null ? round((sub - rec) / DAY) : null,
    margin_hours: round(margin), margin_days: margin == null ? null : round(margin / 24),
    timing: margin == null ? 'inconnu' : margin < 0 ? 'en retard' : margin < 24 ? 'à moins de 24 h' : margin < 48 ? 'à moins de 48 h' : 'en avance',
    to_assignment_days: rec != null && first('assignment') != null ? round((first('assignment') - rec) / DAY) : null,
    to_first_draft_days: rec != null && first('first_draft') != null ? round((first('first_draft') - rec) / DAY) : null,
    cv_delay_days: cvReq != null && cvRec != null && cvRec >= cvReq ? round((cvRec - cvReq) / DAY) : null,
    partner_review_days: revReq != null && revDone != null && revDone >= revReq ? round((revDone - revReq) / DAY) : null,
    partner_review_hours_before_deadline: revDone != null && dl != null ? round((dl - revDone) / HOUR) : null,
    missing_info_events: ms.filter(m => m.type === 'missing_information').length };
}

const avg = xs => { const v = xs.filter(x => x != null && Number.isFinite(x)); return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
const pct = (n, d) => d ? Math.round(100 * n / d) : null;
export function submissionKpis(subs) {
  const known = subs.filter(s => s.margin_hours != null);
  const people = {};
  for (const s of subs) for (const p of s.people || []) {
    const k = String(p.email || p.name || '').toLowerCase(); if (!k || p.role === 'client') continue;
    const e = (people[k] ||= { name: p.name || p.email, email: p.email || null, roles: new Set(), submissions: 0, late_or_tight: 0 });
    e.roles.add(p.role || 'other'); e.submissions++; if (s.margin_hours != null && s.margin_hours < 48) e.late_or_tight++;
  }
  return {
    firm: { submissions: subs.length, with_dates: known.length,
      avg_margin_days: avg(known.map(s => s.margin_days)), on_time_pct: pct(known.filter(s => s.margin_hours >= 0).length, known.length),
      over_24h_pct: pct(known.filter(s => s.margin_hours >= 24).length, known.length), over_48h_pct: pct(known.filter(s => s.margin_hours >= 48).length, known.length),
      late: known.filter(s => s.margin_hours < 0).length, avg_window_days: avg(subs.map(s => s.window_days)), avg_days_used: avg(subs.map(s => s.days_used)) },
    process: { avg_to_assignment_days: avg(subs.map(s => s.to_assignment_days)), avg_to_first_draft_days: avg(subs.map(s => s.to_first_draft_days)),
      avg_cv_delay_days: avg(subs.map(s => s.cv_delay_days)), avg_partner_review_days: avg(subs.map(s => s.partner_review_days)),
      partner_review_last_12h: subs.filter(s => s.partner_review_hours_before_deadline != null && s.partner_review_hours_before_deadline < 12).length,
      submissions_with_missing_info: subs.filter(s => s.missing_info_events > 0).length },
    // Involvement only: the AI attribution (on evidence) says where delays came from.
    people: Object.values(people).map(p => ({ ...p, roles: [...p.roles] })).sort((a, b) => b.submissions - a.submissions).slice(0, 60),
    method: 'Dates lues dans les e-mails (preuve citée), durées et KPI calculés. Une soumission sans date prouvée n’entre pas dans les pourcentages.'
  };
}

const c = v => String(v ?? '–').replace(/\|/g, '/');
export function submissionMarkdown(st) {
  const k = st.kpi || { firm: {}, process: {} };
  const f = k.firm, p = k.process;
  return [
    (f.submissions || 0) + ' soumissions retrouvées dans les e-mails des ' + st.months + ' derniers mois. Les dates viennent des e-mails, les KPI sont calculés à partir d’elles.', '',
    '### Indicateurs du cabinet',
    '| Indicateur | Valeur |', '| --- | --- |',
    '| Marge moyenne avant la date limite | ' + c(f.avg_margin_days) + ' jour(s) |', '| Déposées à temps | ' + c(f.on_time_pct) + ' % |',
    '| Déposées plus de 24 h avant | ' + c(f.over_24h_pct) + ' % |', '| Déposées plus de 48 h avant | ' + c(f.over_48h_pct) + ' % |', '| En retard | ' + c(f.late) + ' |',
    '| Fenêtre moyenne (TDR → date limite) | ' + c(f.avg_window_days) + ' jour(s) |', '| Jours utilisés en moyenne | ' + c(f.avg_days_used) + ' |', '',
    '### Processus',
    '| Étape | Délai moyen |', '| --- | --- |',
    '| TDR → affectation | ' + c(p.avg_to_assignment_days) + ' jour(s) |', '| TDR → premier jet | ' + c(p.avg_to_first_draft_days) + ' jour(s) |',
    '| Collecte des CV | ' + c(p.avg_cv_delay_days) + ' jour(s) |', '| Revue de l’associé | ' + c(p.avg_partner_review_days) + ' jour(s) |',
    '| Revues dans les 12 dernières heures | ' + c(p.partner_review_last_12h) + ' |', '',
    '### Soumissions',
    '| Opportunité | Reçue | Date limite | Déposée | Marge | Statut |', '| --- | --- | --- | --- | --- | --- |',
    ...(st.submissions || []).map(s => '| ' + [c(s.opportunity), c((s.received_at || '').slice(0, 10)), c((s.deadline || '').slice(0, 16).replace('T', ' ')), c((s.submitted_at || '').slice(0, 16).replace('T', ' ')), s.margin_days == null ? '–' : s.margin_days + ' j', s.timing].join(' | ') + ' |'), '',
    '### Où le temps a été perdu',
    ...(st.attributions || []).map(a => '- **' + a.opportunity + '** : ' + a.where + ' — cause : ' + a.cause + (a.who ? ' (' + a.who + ')' : '') + '. ' + (a.evidence || '') + ((a.not_attributable_to || []).length ? ' Non imputable à : ' + a.not_attributable_to.join(', ') + '.' : '')), '',
    '### Recommandations',
    ...(st.recommendations || []).map((r, i) => (i + 1) + '. **' + r.title + '** — ' + r.detail + (r.based_on ? ' (' + r.based_on + ')' : ''))
  ].join('\n');
}
