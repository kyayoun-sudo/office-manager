// TENDER WATCH — the daily tender desk of the firm (Paul, 2026-10-11). It takes over the « Tender Desk
// EYNOWA » that ran alone in a Claude project, and plugs it into Office Manager for EVERY firm:
//   « Cet agent enverra les tenders au business developer et aux associés. L'associé décidera ceux qu'il
//   veut ; quand il choisit ceux avec qui on part, le business dev cherche le TDR et crée la mission. Ça
//   permettra de faire des évaluations : la date du TDR, la date de dépôt du dossier, combien on a
//   appliqué, combien on a été reçu. Shadow devra nous faire des revues sur les raisons pour lesquelles on
//   n'a pas été pris, comment on doit améliorer. On s'en servira aussi pour voir la charge de travail. »
//
// The daily cycle (one stage per server call, each fires the next):
//   search    the web, in the zones, mission types and sources set in Paramètres → Veille: published and
//             unpublished opportunities; each one's DEADLINE and STATUS checked before it is kept — an
//             unverified one is never recommended (it goes to « à surveiller »);
//   match     for each open, verified one: the best team strictly from the firm's real CVs (capabilities),
//             the compliance matrix, the missing skills, the lead, a Bid / No Bid score out of 100 —
//             a RECOMMENDATION only;
//   companies foreign companies settling in the zone that the firm could approach (never contacted);
//   report    the pipeline Excel rewritten in place in the Drive (verified after writing), the report
//             (5 sections) to the business developers and the partners, the bell. Nothing found: the
//             report says so with the agreed sentence.
// Then people act (never the agent):
//   a partner (or the named deciders) decides FOLLOW / NOT, with a reason for « not »;
//   the business developer obtains the TDR and creates the opportunity (lib/opportunities.js, linked);
//   the business developer records the submission (date, amount) and the result (won / lost / no
//   follow-up, reason, winner); a lost bid is reviewed by Shadow (causes, improvements) — a proposal a
//   partner validates; only then it becomes a lesson, shared with the business developer if the partner says so.
// Every step is dated: the indicators (how many received, followed, submitted, won; rates; delays) and the
// workload (bids in preparation + probable missions weighted by the success rate + current missions) come
// from these dates, never from a guess.
//
// Memory: OFFICE_MANAGER_TENDERS.json in the agents' memory (one record per tender, updated in place,
// never twice: a tender already known is UPDATED). Never: submitting a bid, contacting a company or a
// decision-maker — those stay human.

import { randomUUID, createHash } from 'node:crypto';
import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, updateJsonFile } from './mapping-scan.js';
import { firstAvailable, deepResearch, parseJsonLoose } from './ai-plus.js';
import { FIRM_LEAD, BUSINESS_DEV, SHADOW_VIEWERS } from './roles.js';
import { can, requireCan, loadOverrides } from './permissions.js';

export const FILE = 'OFFICE_MANAGER_TENDERS.json';
export const PIPELINE = 'PIPELINE_APPELS_OFFRES';
export const NOTHING_TODAY = 'Aucune nouvelle opportunité vérifiée et suffisamment pertinente n’a été identifiée aujourd’hui.';
export const STAGES = Object.freeze(['new', 'followed', 'declined', 'tdr', 'opportunity', 'submitted', 'won', 'lost', 'no_follow', 'watch', 'expired']);
export const STAGE_LABELS = Object.freeze({ new: 'À décider', followed: 'Suivi : TDR à obtenir', declined: 'Écarté par l’associé', tdr: 'TDR obtenu', opportunity: 'Opportunité créée',
  submitted: 'Offre déposée', won: 'Gagné', lost: 'Perdu', no_follow: 'Sans suite', watch: 'À surveiller (non vérifié)', expired: 'Date limite dépassée' });
export const DECLINE_REASONS = Object.freeze(['Hors compétence', 'Délai trop court', 'Conflit d’intérêts', 'Capacité insuffisante', 'Budget trop faible', 'Zone non couverte', 'Autre']);
const ORDER = ['anthropic', 'openai', 'gemini'];
const DAY = 86400000;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const q = encodeURIComponent;
const now = () => new Date().toISOString();
const cut = (s, n) => String(s ?? '').slice(0, n);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isoDate = s => { const m = /(\d{4}-\d{2}-\d{2})/.exec(String(s || '')); return m && Number.isFinite(Date.parse(m[1])) ? m[1] : null; };
const who = a => a?.display_name || a?.email || null;
const checkedAccount = async (orgId, account, d) => ({ ...account, permissions: await (d.loadOverrides || loadOverrides)(orgId, d.fetchRows || rest) });
const DRIVE = d => ({ drive: d.drive || driveAdapter, folder: d.folder || memoryFolderId() });

// ---- Settings (Paramètres → Veille), in office_firm_settings.settings.tender_watch ----
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  zones: ['Côte d’Ivoire', 'Sénégal', 'Burkina Faso', 'Mali', 'Niger', 'Togo', 'Bénin', 'Guinée', 'Cameroun', 'Gabon', 'Congo', 'RD Congo', 'Tchad', 'Centrafrique', 'Madagascar', 'Mauritanie', 'Djibouti', 'Comores', 'Burundi', 'Rwanda'],
  mission_types: ['Audit financier et comptable', 'Audit de projets financés par les bailleurs', 'Commissariat aux comptes', 'Audit interne et contrôle interne', 'Expertise comptable', 'Conseil en gestion et finances publiques', 'Évaluation de projets'],
  sources: ['Portails nationaux des marchés publics', 'Banque mondiale', 'Banque africaine de développement', 'Nations unies (UNGM)', 'Union européenne (TED, Funding & Tenders)', 'AFD', 'Agrégateurs d’appels d’offres', 'Sites et presse des entreprises'],
  min_amount: null,
  deciders: 'partners', // 'partners' = any partner; 'business_partner' = the partner named in Opportunités; 'named' = the list below
  named_deciders: [],
  extra_recipients: [],
  companies: true,
  prep_days_default: 5,
  hour: 7
});
export function cleanSettings(input = {}, base = DEFAULT_SETTINGS) {
  const list = (v, n, m) => (Array.isArray(v) ? v : String(v || '').split(/\n|;/)).map(x => cut(String(x).trim(), m)).filter(Boolean).slice(0, n);
  const out = { ...base };
  if ('enabled' in input) out.enabled = Boolean(input.enabled);
  if ('zones' in input) out.zones = list(input.zones, 60, 80);
  if ('mission_types' in input) out.mission_types = list(input.mission_types, 40, 120);
  if ('sources' in input) out.sources = list(input.sources, 40, 200);
  if ('min_amount' in input) out.min_amount = Number(input.min_amount) > 0 ? Math.round(Number(input.min_amount)) : null;
  if ('deciders' in input) out.deciders = ['partners', 'business_partner', 'named'].includes(input.deciders) ? input.deciders : 'partners';
  if ('named_deciders' in input) out.named_deciders = list(input.named_deciders, 20, 254).map(e => e.toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if ('extra_recipients' in input) out.extra_recipients = list(input.extra_recipients, 20, 254).map(e => e.toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if ('companies' in input) out.companies = Boolean(input.companies);
  if ('prep_days_default' in input) out.prep_days_default = Math.min(60, Math.max(1, Math.round(Number(input.prep_days_default) || 5)));
  if ('hour' in input) out.hour = Math.min(20, Math.max(5, Math.round(Number(input.hour) || 7)));
  return out;
}
async function firmSettingsRow(orgId, fetchRows) {
  const rows = await fetchRows('office_firm_settings?org_id=eq.' + q(orgId) + '&select=settings&limit=1').catch(() => null);
  return (Array.isArray(rows) && rows[0]?.settings) || {};
}
export async function watchSettings(orgId, d = {}) {
  const s = await firmSettingsRow(orgId, d.fetchRows || rest);
  return { ...cleanSettings(s.tender_watch || {}, DEFAULT_SETTINGS), business_partner: s.business_partner || null };
}
export async function saveWatchSettings(orgId, body = {}, account = null, d = {}) {
  account = await checkedAccount(orgId, account, d);
  requireCan(account, 'tender_settings');
  const fetchRows = d.fetchRows || rest;
  const settings = await firmSettingsRow(orgId, fetchRows);
  const next = cleanSettings(body, cleanSettings(settings.tender_watch || {}, DEFAULT_SETTINGS));
  try {
    await fetchRows('office_firm_settings?on_conflict=org_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ org_id: orgId, settings: { ...settings, tender_watch: next }, updated_by: who(account), updated_at: now() }]) });
  } catch (e) { throw fail(/office_firm_settings|PGRST205|42P01/i.test(String(e?.message || e)) ? 'ROLES_SQL_NOT_INSTALLED' : String(e.message || e), 409); }
  return { settings: next };
}

// ---- Memory ----
export function emptyState() { return { schema: 'office-manager.tenders/1', tenders: {}, companies: {}, runs: [], last_run: null, running: null, updated_at: null }; }
async function load(d = {}) { const { drive, folder } = DRIVE(d); const s = (await (d.loadJsonFile || loadJsonFile)(FILE, drive, folder).catch(() => ({ state: null }))).state; return s ? { ...emptyState(), ...s } : emptyState(); }
async function change(fn, d = {}) {
  let out = null;
  await (d.updateJsonFile || updateJsonFile)(FILE, cur => { const st = cur ? { ...emptyState(), ...cur } : emptyState(); out = fn(st) ?? null; st.updated_at = now(); st.runs = (st.runs || []).slice(-60); return st; }, DRIVE(d));
  return out;
}

// ---- Idempotence: one tender = one key (buyer + reference, else buyer + title + deadline) ----
export function tenderKey(t) {
  const buyer = norm(t.buyer).split(' ').filter(w => w.length > 2).slice(0, 6).join(' ');
  const ref = norm(t.reference).replace(/\s+/g, '');
  const base = ref.length >= 4 ? buyer + '|' + ref : buyer + '|' + norm(t.title).split(' ').filter(w => w.length > 3).slice(0, 10).join(' ') + '|' + (isoDate(t.deadline) || '');
  return createHash('sha1').update(base).digest('hex').slice(0, 16);
}

// A tender may be recommended only when its deadline is verified and still ahead.
export function verifiedOpen(t, at = Date.now()) {
  const dl = isoDate(t.deadline);
  return Boolean(t.verified && dl && Date.parse(dl + 'T23:59:59Z') >= at);
}

// Found items merged into the memory: a known one is UPDATED (deadline, status, sources), never added
// twice; the people's decisions and dates are never touched by the agent.
export function mergeFound(st, items, at = now()) {
  const counts = { new: 0, updated: 0, watch: 0 };
  for (const raw of Array.isArray(items) ? items.slice(0, 80) : []) {
    const title = cut(raw.title, 300).trim();
    if (!title) continue;
    const t = { title, buyer: cut(raw.buyer, 200), country: cut(raw.country, 80), mission_type: cut(raw.mission_type, 120), reference: cut(raw.reference, 120),
      kind: cut(raw.kind || 'appel d’offres', 60), published: Boolean(raw.published !== false), source_url: cut(raw.source_url, 500), sources: (Array.isArray(raw.sources) ? raw.sources : []).map(s => cut(s?.url || s, 500)).filter(Boolean).slice(0, 8),
      published_at: isoDate(raw.published_at), deadline: isoDate(raw.deadline), deadline_source: cut(raw.deadline_source, 500), status_note: cut(raw.status_note, 300), verified: Boolean(raw.verified && isoDate(raw.deadline)),
      summary: cut(raw.summary, 1200), estimated_value: cut(raw.estimated_value, 80), funder: cut(raw.funder, 120) };
    const key = tenderKey(t);
    const existing = Object.values(st.tenders).find(x => x.key === key);
    const open = verifiedOpen(t, Date.parse(at));
    if (existing) {
      Object.assign(existing, { ...t, title: existing.title || t.title, sources: [...new Set([...(existing.sources || []), ...t.sources])].slice(0, 12), last_seen_at: at, updated_at: at });
      if (existing.stage === 'watch' && open) existing.stage = 'new';
      if (existing.stage === 'new' && !open) existing.stage = t.deadline && Date.parse(t.deadline) < Date.parse(at) ? 'expired' : 'watch';
      counts.updated++;
      continue;
    }
    const id = randomUUID();
    st.tenders[id] = { id, key, ...t, stage: open ? 'new' : (t.deadline && Date.parse(t.deadline) < Date.parse(at) ? 'expired' : 'watch'), received_at: at, last_seen_at: at, updated_at: at,
      recommendation: null, decision: null, tdr_at: null, opportunity_id: null, opportunity_at: null, submitted_at: null, amount_proposed: null, result: null, shadow_review: null, history: [{ at, what: 'repéré par la veille' }] };
    open ? counts.new++ : counts.watch++;
  }
  // A deadline passed while nobody decided: the tender leaves « à décider ».
  for (const x of Object.values(st.tenders)) if (['new', 'watch'].includes(x.stage) && x.deadline && Date.parse(x.deadline + 'T23:59:59Z') < Date.parse(at)) { x.stage = 'expired'; x.updated_at = at; }
  return counts;
}

// ---- The daily pass ----
const SEARCH = `Tu es le Tender Desk quotidien d'un cabinet d'audit, d'expertise comptable et de conseil. Tu cherches sur le web les appels d'offres, avis à manifestation d'intérêt (AMI), demandes de propositions et opportunités commerciales (publiés et non publiés : projets annoncés, financements approuvés, besoins exprimés) correspondant aux ZONES, TYPES DE MISSIONS et SOURCES donnés.
Pour CHAQUE opportunité retenue, tu VÉRIFIES sur la source la date limite de dépôt et le statut actuel (ouvert, prorogé, annulé, attribué). "verified": true seulement si tu as lu la date limite sur une source fiable (donne "deadline_source", l'adresse exacte). Une opportunité non vérifiée peut figurer avec "verified": false (elle ira « à surveiller »), jamais présentée comme recommandée.
Ignore ce qui est clos, annulé, attribué ou hors des zones et types demandés. Rien d'inventé : pas de référence, de montant ou de date que la source ne donne pas.
JSON STRICT : {"items":[{"title":"","buyer":"organisme acheteur","country":"","mission_type":"","reference":"","kind":"appel d'offres|AMI|demande de propositions|opportunité non publiée","published":true,"funder":"bailleur s'il y en a un","published_at":"AAAA-MM-JJ","deadline":"AAAA-MM-JJ","deadline_source":"url","verified":true,"status_note":"ouvert / prorogé jusqu'au …","estimated_value":"","source_url":"","sources":["url"],"summary":"objet en 2 phrases"}]}`;

const MATCH = `Tu es le Firm Manager d'un cabinet d'audit. Pour chaque appel d'offres donné, compose l'ÉQUIPE OPTIMALE STRICTEMENT à partir des personnes réelles du cabinet données (CV : titres, années d'expérience, compétences, qualifications, secteurs, langues, charge actuelle). N'invente aucune personne ni aucune compétence.
Pour chaque appel d'offres : la matrice de conformité (chaque exigence connue → satisfaite / partielle / non satisfaite, et par qui), les compétences manquantes (à chercher chez des experts partenaires), le chef de file proposé, une estimation des jours de préparation de l'offre et des jours de mission si elle est gagnée, et une décision Bid / No Bid avec un score sur 100 et ses raisons (adéquation des compétences, références, charge de l'équipe, délai, risques).
C'est une RECOMMANDATION : l'associé décide.
JSON STRICT : {"results":[{"id":"","score":0,"bid":"Bid|No Bid|À approfondir","why":"","lead":"nom","team":[{"name":"","role":"","why":""}],"compliance":[{"requirement":"","status":"satisfaite|partielle|non satisfaite","by":""}],"missing":[""],"prep_days":5,"mission_days":null,"risks":[""]}]}`;

const COMPANIES = `Recherche publique, en français, avec sources : entreprises étrangères qui s'implantent ou se développent dans les pays donnés (nouvelles filiales, investissements annoncés, grands contrats, entrées sur le marché) et qui pourraient avoir besoin d'un cabinet d'audit, d'expertise comptable ou de conseil local. Pour chacune : nom, pays d'origine, pays d'implantation, ce qui se passe (daté), le besoin probable, la source. Aucun contact personnel. Rien d'inventé.
JSON STRICT : {"companies":[{"name":"","origin":"","country":"","event":"","date":"AAAA-MM-JJ","need":"","source":"url"}]}`;

export async function startTenderWatch(orgId, req, opts = {}, d = {}) {
  const settings = await watchSettings(orgId, d);
  if (!settings.enabled && !opts.force) return { skipped: 'TENDER_WATCH_DISABLED' };
  const today = (opts.today || now().slice(0, 10));
  const st = await load(d);
  if (!opts.force && st.last_run === today) return { skipped: 'ALREADY_TODAY' };
  if (st.running && Date.now() - Date.parse(st.running.at) < 20 * 60000) return { skipped: 'ALREADY_RUNNING', run: st.running.id };
  const run = { id: randomUUID(), at: now(), day: today, stage: 'search', by: opts.by || 'planifié' };
  await change(s => { s.running = run; s.last_run = today; }, d);
  await (d.fire || (await import('./agent-passes.js')).fireInternal)(req, '/api/app?route=tender-step', { run_id: run.id });
  return { started: true, run: run.id };
}

export async function tenderStep(orgId, req, body = {}, d = {}) {
  if (body.review_loss) return reviewLoss(orgId, String(body.review_loss), d);
  const st = await load(d);
  const run = st.running;
  if (!run || run.id !== body.run_id) return { skipped: 'RUN_NOT_ACTIVE' };
  const settings = await watchSettings(orgId, d);
  const fire = d.fire || (await import('./agent-passes.js')).fireInternal;
  const next = async stage => { await change(s => { if (s.running?.id === run.id) s.running.stage = stage; }, d); if (stage !== 'done') await fire(req, '/api/app?route=tender-step', { run_id: run.id }); };
  try {
    if (run.stage === 'search') {
      const known = Object.values(st.tenders).filter(t => !['won', 'lost', 'no_follow', 'expired', 'declined'].includes(t.stage)).slice(0, 60).map(t => t.buyer + ' — ' + t.title + (t.deadline ? ' (' + t.deadline + ')' : ''));
      const question = 'Date du jour : ' + run.day + '\nZONES : ' + settings.zones.join(', ') + '\nTYPES DE MISSIONS : ' + settings.mission_types.join(' ; ') + '\nSOURCES À CONSULTER : ' + settings.sources.join(' ; ') +
        (settings.min_amount ? '\nMONTANT MINIMUM : ' + settings.min_amount : '') + '\nDÉJÀ CONNUES (mets à jour leur date limite et leur statut si tu les retrouves, sans les répéter si rien ne change) :\n' + known.join('\n');
      const r = await (d.deepResearch || deepResearch)({ instructions: SEARCH, question, maxTokens: 8000 });
      if (!r.web) throw fail('WEB_RESEARCH_UNAVAILABLE: ' + cut(r.error, 120), 503);
      let items = [];
      try { items = parseJsonLoose(r.text).items || []; } catch { items = []; }
      const counts = await change(s => mergeFound(s, items), d);
      await change(s => { if (s.running?.id === run.id) s.running.search = { ...counts, found: items.length, sources: (r.sources || []).length }; }, d);
      return next('match').then(() => ({ stage: 'search', ...counts }));
    }
    if (run.stage === 'match') {
      const todo = Object.values(st.tenders).filter(t => t.stage === 'new' && !t.recommendation).slice(0, 8);
      if (todo.length) {
        const ctx = await (d.capabilityContext || (async (o) => (await import('./capabilities.js')).capabilityContext(o)))(orgId).catch(() => ({ people: [] }));
        const people = (ctx.people || []).filter(p => p.kind !== 'consultant' || p.full_name).slice(0, 80).map(p => ({ name: p.full_name, title: p.title, grade: p.grade, years: p.years_experience, skills: [...(p.specialist_skills || []), ...(p.technical_skills || [])].slice(0, 25),
          qualifications: p.qualifications, industries: p.industries, languages: p.languages, load_pct: p.load_pct, kind: p.kind }));
        const input = 'PERSONNES DU CABINET (CV) :\n' + JSON.stringify(people).slice(0, 40000) + '\n\nAPPELS D’OFFRES :\n' + JSON.stringify(todo.map(t => ({ id: t.id, title: t.title, buyer: t.buyer, country: t.country, mission_type: t.mission_type, deadline: t.deadline, summary: t.summary, funder: t.funder }))).slice(0, 20000);
        let results = [];
        try { results = parseJsonLoose((await (d.firstAvailable || firstAvailable)(ORDER, { instructions: MATCH, input, maxTokens: 8000 })).text).results || []; } catch { results = []; }
        const names = new Set(people.map(p => norm(p.name)));
        await change(s => {
          for (const r of results) {
            const t = s.tenders[r.id]; if (!t || t.recommendation) continue;
            // Only real people of the firm stay in the team (never an invented name).
            const team = (Array.isArray(r.team) ? r.team : []).filter(m => names.has(norm(m.name))).slice(0, 12).map(m => ({ name: cut(m.name, 120), role: cut(m.role, 80), why: cut(m.why, 300) }));
            t.recommendation = { score: Math.max(0, Math.min(100, Math.round(Number(r.score) || 0))), bid: ['Bid', 'No Bid', 'À approfondir'].includes(r.bid) ? r.bid : 'À approfondir', why: cut(r.why, 800),
              lead: team.some(m => norm(m.name) === norm(r.lead)) ? cut(r.lead, 120) : (team[0]?.name || null), team, compliance: (Array.isArray(r.compliance) ? r.compliance : []).slice(0, 30).map(c => ({ requirement: cut(c.requirement, 300), status: cut(c.status, 30), by: cut(c.by, 120) })),
              missing: (Array.isArray(r.missing) ? r.missing : []).map(x => cut(x, 200)).slice(0, 15), prep_days: Math.min(60, Math.max(1, Math.round(Number(r.prep_days) || settings.prep_days_default))),
              mission_days: Number(r.mission_days) > 0 ? Math.round(Number(r.mission_days)) : null, risks: (Array.isArray(r.risks) ? r.risks : []).map(x => cut(x, 200)).slice(0, 10), at: now(), by: 'Firm Manager (IA)' };
            t.updated_at = now();
          }
        }, d);
      }
      return next(settings.companies ? 'companies' : 'report').then(() => ({ stage: 'match', matched: todo.length }));
    }
    if (run.stage === 'companies') {
      const r = await (d.deepResearch || deepResearch)({ instructions: COMPANIES, question: 'Pays : ' + settings.zones.join(', ') + '\nDate : ' + run.day + '\nDéjà connues : ' + Object.values(st.companies).slice(-60).map(c => c.name).join(', '), maxTokens: 5000 });
      let list = [];
      try { list = r.web ? (parseJsonLoose(r.text).companies || []) : []; } catch { list = []; }
      await change(s => {
        for (const c of list.slice(0, 30)) {
          const name = cut(c.name, 160).trim(); if (!name) continue;
          const k = createHash('sha1').update(norm(name) + '|' + norm(c.country)).digest('hex').slice(0, 16);
          s.companies[k] = { ...(s.companies[k] || { first_seen: now(), status: 'à approcher (validation humaine)' }), key: k, name, origin: cut(c.origin, 80), country: cut(c.country, 80), event: cut(c.event, 400), date: isoDate(c.date), need: cut(c.need, 300), source: cut(c.source, 500), last_seen: now() };
        }
      }, d);
      return next('report').then(() => ({ stage: 'companies', companies: list.length }));
    }
    if (run.stage === 'report') {
      const fresh = await load(d);
      const out = await publishReport(orgId, fresh, run, settings, d);
      await change(s => { s.runs.push({ id: run.id, day: run.day, at: run.at, finished_at: now(), search: s.running?.search || null, report: out.report || null, pipeline: out.pipeline || null, mail: out.mail || null }); s.running = null; }, d);
      await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: 'firm-manager', action_type: 'TENDER_WATCH_DONE', source_ref: 'tender-run:' + run.id, decision: out.summary, status: 'done' }).catch(() => null);
      return { stage: 'report', ...out };
    }
    return { skipped: 'UNKNOWN_STAGE' };
  } catch (e) {
    await change(s => { if (s.running?.id === run.id) { s.runs.push({ id: run.id, day: run.day, at: run.at, finished_at: now(), error: cut(e.message || e, 200) }); s.running = null; } }, d).catch(() => null);
    throw e;
  }
}

// ---- The report: 5 sections, to the business developers and the partners ----
export function priorityTenders(st, at = Date.now()) {
  return Object.values(st.tenders).filter(t => t.stage === 'new' && verifiedOpen(t, at)).sort((a, b) => (b.recommendation?.score || 0) - (a.recommendation?.score || 0) || String(a.deadline).localeCompare(String(b.deadline)));
}
export function reportMarkdown(st, run, at = Date.now()) {
  const prio = priorityTenders(st, at).filter(t => (t.recommendation?.bid || 'Bid') !== 'No Bid');
  const newToday = Object.values(st.tenders).filter(t => String(t.received_at).slice(0, 10) === run.day);
  const companies = Object.values(st.companies || {}).filter(c => String(c.last_seen).slice(0, 10) === run.day).slice(0, 12);
  const L = [];
  L.push('## 1. Résumé exécutif');
  if (!prio.length && !newToday.length) L.push(NOTHING_TODAY);
  else L.push(newToday.length + ' opportunité(s) repérée(s) aujourd’hui, ' + prio.length + ' prioritaire(s) vérifiée(s) en attente de décision des associés. Les opportunités non vérifiées restent « à surveiller » et ne sont pas recommandées.');
  L.push('', '## 2. Opportunités prioritaires');
  if (!prio.length) L.push('Aucune.');
  for (const t of prio.slice(0, 15)) L.push('- **' + t.title + '** — ' + [t.buyer, t.country].filter(Boolean).join(', ') + ' · date limite ' + t.deadline + ' (vérifiée : ' + (t.deadline_source || t.source_url || 'source') + ')' +
    (t.recommendation ? ' · ' + t.recommendation.bid + ' ' + t.recommendation.score + '/100 — ' + t.recommendation.why : ''));
  L.push('', '## 3. Équipe optimale proposée (à partir des CV réels)');
  for (const t of prio.slice(0, 10)) {
    const r = t.recommendation; if (!r) continue;
    L.push('- ' + t.title + ' — chef de file : ' + (r.lead || 'à désigner') + ' ; équipe : ' + (r.team.map(m => m.name + ' (' + m.role + ')').join(', ') || '—') + (r.missing.length ? ' ; manquant : ' + r.missing.join(', ') : ''));
  }
  L.push('', '## 4. Entreprises à approcher (aucun contact sans validation humaine)');
  if (!companies.length) L.push('Aucune nouvelle aujourd’hui.');
  for (const c of companies) L.push('- ' + c.name + ' (' + [c.origin, c.country].filter(Boolean).join(' → ') + ') : ' + c.event + (c.need ? ' — besoin probable : ' + c.need : '') + (c.source ? ' [source](' + c.source + ')' : ''));
  L.push('', '## 5. Actions à lancer');
  L.push('- Associés : décider « on suit » / « on ne suit pas » pour chaque opportunité prioritaire, dans Office Manager → Veille des appels d’offres.');
  L.push('- Business Development Manager : pour chaque opportunité suivie, obtenir le TDR complet et créer l’opportunité.');
  const soon = Object.values(st.tenders).filter(t => ['followed', 'tdr', 'opportunity'].includes(t.stage) && t.deadline && Date.parse(t.deadline) - at < 7 * DAY);
  for (const t of soon) L.push('- Dépôt à préparer avant le ' + t.deadline + ' : ' + t.title);
  return L.join('\n');
}

export function pipelineSheets(st, at = Date.now()) {
  const all = Object.values(st.tenders).sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
  const row = t => [t.title, t.buyer, t.country, t.mission_type, t.reference, STAGE_LABELS[t.stage] || t.stage, t.published_at || '', t.received_at?.slice(0, 10) || '', t.deadline || '', t.verified ? 'oui' : 'non',
    t.recommendation?.bid || '', t.recommendation?.score ?? '', t.decision ? (t.decision.follow ? 'suivi' : 'écarté : ' + (t.decision.reason || '')) + ' (' + t.decision.by + ', ' + t.decision.at.slice(0, 10) + ')' : '',
    t.tdr_at?.slice(0, 10) || '', t.submitted_at?.slice(0, 10) || '', t.amount_proposed || '', t.result ? t.result.outcome + (t.result.reason ? ' — ' + t.result.reason : '') : '', t.source_url || ''];
  const head = ['Titre', 'Acheteur', 'Pays', 'Type de mission', 'Référence', 'Étape', 'Publié le', 'Reçu le', 'Date limite', 'Date vérifiée', 'Bid / No Bid', 'Score', 'Décision', 'TDR obtenu le', 'Déposé le', 'Montant proposé', 'Résultat', 'Source'];
  const people = new Map();
  for (const t of all) for (const m of t.recommendation?.team || []) { const p = people.get(m.name) || { name: m.name, roles: new Set(), tenders: 0 }; p.roles.add(m.role); p.tenders++; people.set(m.name, p); }
  const missing = new Map();
  for (const t of all) for (const m of t.recommendation?.missing || []) missing.set(m, (missing.get(m) || 0) + 1);
  return [
    { name: 'Pipeline', rows: [head, ...all.map(row)] },
    { name: 'Entreprises à contacter', rows: [['Entreprise', 'Origine', 'Pays', 'Ce qui se passe', 'Date', 'Besoin probable', 'Source', 'Statut'], ...Object.values(st.companies || {}).map(c => [c.name, c.origin, c.country, c.event, c.date || '', c.need, c.source, c.status])] },
    { name: 'Appels d’offres ouverts', rows: [head, ...all.filter(t => verifiedOpen(t, at) && !['won', 'lost', 'no_follow', 'declined'].includes(t.stage)).map(row)] },
    { name: 'Opportunités à surveiller', rows: [head, ...all.filter(t => t.stage === 'watch').map(row)] },
    { name: 'Matrice CV', rows: [['Personne', 'Rôles proposés', 'Nombre d’appels d’offres'], ...[...people.values()].map(p => [p.name, [...p.roles].join(', '), p.tenders])] },
    { name: 'Experts partenaires manquants', rows: [['Compétence manquante', 'Nombre d’appels d’offres'], ...[...missing.entries()].sort((a, b) => b[1] - a[1])] }
  ];
}

async function recipients(orgId, settings, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const rows = await fetchRows('office_app_users?org_id=eq.' + q(orgId) + '&active=eq.true&role=in.(owner,partner,bdm)&select=email,role&limit=200').catch(() => []) || [];
  return [...new Set([...rows.map(r => String(r.email || '').toLowerCase()), ...(settings.extra_recipients || [])].filter(Boolean))];
}

async function publishReport(orgId, st, run, settings, d = {}) {
  const at = Date.now();
  const md = reportMarkdown(st, run, at);
  const prio = priorityTenders(st, at).filter(t => (t.recommendation?.bid || 'Bid') !== 'No Bid');
  const out = { summary: (prio.length ? prio.length + ' opportunité(s) prioritaire(s)' : 'Aucune opportunité prioritaire') + ' le ' + run.day };
  // The pipeline Excel, rewritten in place, then read back (« vérifié » only when it is there).
  try {
    const saved = await (d.saveWorkbook || (async (...a) => (await import('./agent-outputs.js')).saveWorkbook(...a)))('firm-manager', PIPELINE, pipelineSheets(st, at), d);
    const meta = saved?.id ? await (d.drive || driveAdapter).getMeta(saved.id).catch(() => null) : null;
    out.pipeline = { id: saved?.id || null, url: saved?.url || meta?.webViewLink || null, verified: Boolean(meta) };
  } catch (e) { out.pipeline = { error: cut(e.message || e, 160), verified: false }; }
  try {
    const rep = await (d.saveReport || (async (...a) => (await import('./agent-outputs.js')).saveReport(...a)))('firm-manager', 'Veille des appels d’offres — ' + run.day, md, d);
    out.report = { id: rep?.id || null, url: rep?.url || null };
  } catch (e) { out.report = { error: cut(e.message || e, 160) }; }
  // The e-mail: to the firm's own people only; a SENT status only with Gmail's message id.
  const to = await recipients(orgId, settings, d);
  const subject = 'Veille des appels d’offres – ' + run.day + ' – ' + prio.length + ' opportunité(s) prioritaire(s)';
  const excelLine = out.pipeline?.verified && out.pipeline.url ? '\n\nPipeline Excel (à jour, vérifié dans le Drive) : ' + out.pipeline.url : '\n\nLe fichier Excel du pipeline n’a pas pu être écrit et vérifié aujourd’hui : il n’est pas joint (pas de fichier douteux).';
  const body = md.replace(/\*\*/g, '').replace(/\[source\]\(([^)]+)\)/g, '$1') + excelLine + '\n\nTout se décide dans Office Manager → Veille des appels d’offres.';
  if (!to.length) out.mail = { sent: false, reason: 'NO_RECIPIENTS' };
  else try {
    const { getPersona } = await import('./agent-persona.js');
    const { sendViaGmail, assertColleaguesOnly } = await import('./agent-mail.js');
    const persona = await (d.getPersona || getPersona)(orgId);
    assertColleaguesOnly(to, persona, d.env || process.env);
    const id = await (d.send || sendViaGmail)({ recipients: to, subject, body }, persona);
    out.mail = id ? { sent: true, message_id: id, to } : { sent: false, reason: 'NO_MESSAGE_ID' };
  } catch (e) { out.mail = { sent: false, reason: cut(e.message || e, 120), to }; }
  return out;
}

// ---- People's decisions ----
export function deciderCheck(account, settings) {
  if (settings.deciders === 'named' && settings.named_deciders?.length) return { onlyThese: settings.named_deciders, extraDeciders: settings.named_deciders };
  if (settings.deciders === 'business_partner' && settings.business_partner?.email) return { onlyThese: [settings.business_partner.email] };
  return {};
}
export async function decideTender(orgId, body = {}, account = null, d = {}) {
  account = await checkedAccount(orgId, account, d);
  const settings = await watchSettings(orgId, d);
  const id = String(body.id || '');
  const follow = Boolean(body.follow);
  const reason = cut(body.reason, 300).trim();
  if (!follow && !reason) throw fail('DECLINE_REASON_REQUIRED');
  const res = await change(st => {
    const t = st.tenders[id]; if (!t) throw fail('TENDER_NOT_FOUND', 404);
    if (!['new', 'watch', 'declined', 'followed'].includes(t.stage)) throw fail('TENDER_ALREADY_IN_PROGRESS', 409);
    requireCan(account, 'tender_follow_decision', deciderCheck(account, settings));
    const at = now();
    t.decision = { follow, reason: follow ? (reason || null) : reason, by: who(account), by_email: String(account?.email || '').toLowerCase(), at };
    t.stage = follow ? 'followed' : 'declined';
    t.updated_at = at; t.history.push({ at, what: (follow ? 'suivi' : 'écarté (' + reason + ')') + ' par ' + who(account) });
    return { id, stage: t.stage };
  }, d);
  await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: 'firm-manager', action_type: follow ? 'TENDER_FOLLOWED' : 'TENDER_DECLINED', source_ref: 'tender:' + id, decision: (follow ? 'Suivi' : 'Écarté : ' + reason) + ' — ' + who(account), status: 'done' }).catch(() => null);
  return res;
}

// The business developer: TDR obtained → opportunity created (lib/opportunities.js links it back).
export async function markTdr(orgId, body = {}, account = null, d = {}) {
  account = await checkedAccount(orgId, account, d);
  const id = String(body.id || '');
  return change(st => {
    const t = st.tenders[id]; if (!t) throw fail('TENDER_NOT_FOUND', 404);
    requireCan(account, 'tender_obtain_tdr', { followed: Boolean(t.decision?.follow) });
    const at = now();
    if (!t.tdr_at) t.tdr_at = at;
    if (t.stage === 'followed') t.stage = 'tdr';
    t.updated_at = at; t.history.push({ at, what: 'TDR obtenu par ' + who(account) });
    return { id, stage: t.stage, create_opportunity: '/opportunites.html?tender=' + encodeURIComponent(id) };
  }, d);
}
export async function linkOpportunity(tenderId, opportunityId, account = null, d = {}) {
  return change(st => {
    const t = st.tenders[tenderId]; if (!t) return null;
    if (t.opportunity_id) return { id: tenderId, opportunity_id: t.opportunity_id, already: true };
    const at = now();
    t.opportunity_id = opportunityId; t.opportunity_at = at; if (!t.tdr_at) t.tdr_at = at;
    if (['followed', 'tdr'].includes(t.stage)) t.stage = 'opportunity';
    t.updated_at = at; t.history.push({ at, what: 'opportunité créée par ' + (who(account) || 'Firm Manager') });
    return { id: tenderId, opportunity_id: opportunityId };
  }, d);
}

// The secretariat sent the MI / the proposal (2026-10-12): its recorded sending (with proof) is the submission date,
// so the tender watch measures « déposé avant / après la date limite » without anyone typing it twice.
export async function submittedBySecretariat(tenderId, { at, proof, on_time }, d = {}) {
  if (!proof || proof === 'link') return { skipped: 'SUBMISSION_PROOF_REQUIRED' };
  return change(st => {
    const t = st.tenders[tenderId]; if (!t) return null;
    if (t.submitted_at) return { id: tenderId, already: true };
    t.submitted_at = at; t.submission_proof = proof || null; t.submitted_on_time = on_time ?? null;
    if (!['won', 'lost', 'no_follow'].includes(t.stage)) t.stage = 'submitted';
    t.updated_at = now(); t.history.push({ at: now(), what: 'offre envoyée par le secrétariat (' + String(at).slice(0, 10) + (on_time === false ? ', après la date limite' : on_time ? ', avant la date limite' : '') + ')' });
    return { id: tenderId, stage: t.stage };
  }, d);
}

export async function recordSubmission(orgId, body = {}, account = null, d = {}) {
  account = await checkedAccount(orgId, account, d);
  const id = String(body.id || '');
  return change(st => {
    const t = st.tenders[id]; if (!t) throw fail('TENDER_NOT_FOUND', 404);
    requireCan(account, 'tender_record_result');
    if (!t.decision?.follow) throw fail('FOLLOW_DECISION_FIRST', 409);
    const at = now();
    t.submitted_at = isoDate(body.date) ? isoDate(body.date) + 'T12:00:00.000Z' : at;
    t.amount_proposed = Number(body.amount) > 0 ? Math.round(Number(body.amount)) : null;
    t.currency = cut(body.currency || 'XOF', 8);
    t.stage = 'submitted'; t.updated_at = at; t.history.push({ at, what: 'offre déposée (' + t.submitted_at.slice(0, 10) + ') par ' + who(account) });
    return { id, stage: t.stage };
  }, d);
}

export async function recordResult(orgId, req, body = {}, account = null, d = {}) {
  account = await checkedAccount(orgId, account, d);
  const id = String(body.id || '');
  const outcome = ['won', 'lost', 'no_follow'].includes(body.outcome) ? body.outcome : null;
  if (!outcome) throw fail('OUTCOME_REQUIRED');
  const res = await change(st => {
    const t = st.tenders[id]; if (!t) throw fail('TENDER_NOT_FOUND', 404);
    requireCan(account, 'tender_record_result');
    if (!t.submitted_at && outcome !== 'no_follow') throw fail('SUBMISSION_FIRST', 409);
    const at = now();
    t.result = { outcome, at: isoDate(body.date) ? isoDate(body.date) + 'T12:00:00.000Z' : at, reason: cut(body.reason, 600) || null, winner: cut(body.winner, 160) || null,
      winner_price: Number(body.winner_price) > 0 ? Math.round(Number(body.winner_price)) : null, scores: cut(body.scores, 600) || null, by: who(account) };
    t.stage = outcome; t.updated_at = at; t.history.push({ at, what: 'résultat : ' + STAGE_LABELS[outcome] + ' (' + who(account) + ')' });
    if (outcome === 'lost') t.shadow_review = { status: 'pending', at };
    return { id, stage: t.stage, review: outcome === 'lost' };
  }, d);
  // A lost bid goes to Shadow for a review (in the background, its own call).
  if (res.review && req) await (d.fire || (await import('./agent-passes.js')).fireInternal)(req, '/api/app?route=tender-step', { review_loss: id }).catch(() => null);
  return res;
}

// ---- Shadow: why we lost, how to improve (a proposal; a partner validates) ----
const LOSS = `Tu es Shadow, le laboratoire d'apprentissage d'un cabinet d'audit. Une offre a été PERDUE. On te donne : l'appel d'offres, la recommandation initiale (score, équipe, conformité, compétences manquantes), l'offre déposée (date, montant), le résultat (motif reçu, cabinet retenu, son prix, notes publiées) et les dates du cycle.
Donne les causes PROBABLES (chacune rattachée à un fait donné, jamais inventée : prix, références, équipe, méthodologie, délai, conformité administrative, choix de l'appel d'offres) et des améliorations concrètes pour les prochaines offres. Si les faits ne permettent pas de conclure, dis-le.
JSON STRICT : {"causes":[{"cause":"","fact":""}],"improvements":[""],"lesson":"une phrase réutilisable","confidence":"haute|moyenne|basse"}`;
export async function reviewLoss(orgId, id, d = {}) {
  const st = await load(d);
  const t = st.tenders[id];
  if (!t || t.stage !== 'lost') return { skipped: 'NOT_LOST' };
  if (t.shadow_review?.status && t.shadow_review.status !== 'pending') return { skipped: 'ALREADY_REVIEWED' };
  const input = JSON.stringify({ tender: { title: t.title, buyer: t.buyer, country: t.country, mission_type: t.mission_type, deadline: t.deadline, summary: t.summary }, recommendation: t.recommendation,
    submission: { at: t.submitted_at, amount: t.amount_proposed, currency: t.currency }, result: t.result, dates: { received: t.received_at, decided: t.decision?.at, tdr: t.tdr_at, submitted: t.submitted_at } }).slice(0, 20000);
  let r = null;
  try { r = parseJsonLoose((await (d.firstAvailable || firstAvailable)(ORDER, { instructions: LOSS, input, maxTokens: 3000 })).text); } catch (e) { r = { error: cut(e.message, 120) }; }
  return change(s => {
    const x = s.tenders[id]; if (!x) return null;
    x.shadow_review = r?.error ? { status: 'pending', at: now(), error: r.error } : { status: 'proposed', at: now(), causes: (r.causes || []).slice(0, 8).map(c => ({ cause: cut(c.cause, 300), fact: cut(c.fact, 300) })),
      improvements: (r.improvements || []).map(x2 => cut(x2, 300)).slice(0, 8), lesson: cut(r.lesson, 400), confidence: ['haute', 'moyenne', 'basse'].includes(r.confidence) ? r.confidence : 'basse', by: 'Shadow (IA)' };
    return { id, status: x.shadow_review.status };
  }, d);
}
// The partner validates (→ a Shadow lesson for the Firm Manager) or rejects; and may share it with the BDM.
export async function decideLossReview(orgId, body = {}, account = null, d = {}) {
  account = await checkedAccount(orgId, account, d);
  const id = String(body.id || '');
  const accept = Boolean(body.accept);
  requireCan(account, 'shadow_lesson_validate');
  const out = await change(st => {
    const t = st.tenders[id]; if (!t?.shadow_review || t.shadow_review.status !== 'proposed') throw fail('NO_REVIEW_TO_DECIDE', 409);
    t.shadow_review = { ...t.shadow_review, status: accept ? 'validated' : 'rejected', decided_by: who(account), decided_at: now(), shared_with_bdm: accept && Boolean(body.share), note: cut(body.note, 400) || null };
    return { id, review: t.shadow_review };
  }, d);
  if (accept && out.review.lesson) {
    const s = await import('./shadow.js');
    await (d.changeLab || s.changeLab)(lab => s.mergeLesson(lab, { agent: 'grand-controleur', category: 'appels d’offres', situation: 'Offre perdue : ' + id, error: (out.review.causes || []).map(c => c.cause).join(' ; '),
      cause: (out.review.causes || []).map(c => c.fact).join(' ; '), lesson: out.review.lesson, rule: (out.review.improvements || []).join(' ; '), type: 'experience_lesson', confidence: out.review.confidence, evidence: ['decision:tender-loss:' + id], kind: 'human_correction' }), d).catch(() => null);
  }
  return out;
}

// ---- Indicators and workload (from the recorded dates only) ----
const days = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / DAY * 10) / 10 : null);
const avg = xs => { const v = xs.filter(x => Number.isFinite(x)); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length * 10) / 10 : null; };
const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : null);
export function tenderKpis(tenders, { from = null, to = null } = {}) {
  const list = Object.values(tenders || {}).filter(t => (!from || t.received_at >= from) && (!to || t.received_at <= to));
  const decided = list.filter(t => t.decision);
  const followed = list.filter(t => t.decision?.follow);
  const submitted = list.filter(t => t.submitted_at);
  const won = list.filter(t => t.stage === 'won'), lost = list.filter(t => t.stage === 'lost');
  const valueProposed = submitted.reduce((s, t) => s + (t.amount_proposed || 0), 0), valueWon = won.reduce((s, t) => s + (t.amount_proposed || 0), 0);
  const by = (k) => { const m = {}; for (const t of list) { const key = t[k] || '—'; const x = m[key] ||= { received: 0, followed: 0, submitted: 0, won: 0 }; x.received++; if (t.decision?.follow) x.followed++; if (t.submitted_at) x.submitted++; if (t.stage === 'won') x.won++; } return m; };
  const missed = list.filter(t => t.decision?.follow && !t.submitted_at && t.deadline && Date.parse(t.deadline + 'T23:59:59Z') < Date.now());
  return {
    received: list.length, decided: decided.length, followed: followed.length, declined: decided.length - followed.length, submitted: submitted.length, won: won.length, lost: lost.length,
    rates: { selection: pct(followed.length, list.length), submission: pct(submitted.length, followed.length), success: pct(won.length, won.length + lost.length), value_won: pct(valueWon, valueProposed) },
    delays_days: { notice_to_received: avg(list.map(t => t.published_at ? days(t.published_at + 'T00:00:00Z', t.received_at) : null)), received_to_decision: avg(decided.map(t => days(t.received_at, t.decision.at))),
      tdr_to_submission: avg(submitted.map(t => days(t.tdr_at, t.submitted_at))), margin_before_deadline: avg(submitted.map(t => t.deadline ? days(t.submitted_at, t.deadline + 'T23:59:59Z') : null)), submission_to_result: avg(list.filter(t => t.result && t.submitted_at).map(t => days(t.submitted_at, t.result.at))) },
    missed_deadlines: missed.length, value: { proposed: valueProposed, won: valueWon },
    decline_reasons: decided.filter(t => !t.decision.follow).reduce((m, t) => (m[t.decision.reason || 'Autre'] = (m[t.decision.reason || 'Autre'] || 0) + 1, m), {}),
    by_mission_type: by('mission_type'), by_country: by('country')
  };
}
// Workload: bids in preparation (their days), probable missions (their days × the success rate), and the
// people's current load (capabilities). Shown when a partner decides.
export function tenderWorkload(tenders, people = [], successRate = null) {
  const list = Object.values(tenders || {});
  const rate = successRate == null ? 0.3 : successRate / 100;
  const inPrep = list.filter(t => ['followed', 'tdr', 'opportunity'].includes(t.stage));
  const pending = list.filter(t => t.stage === 'submitted');
  const per = new Map();
  const add = (name, k, v) => { const p = per.get(name) || { name, prep_days: 0, probable_days: 0, bids: 0 }; p[k] += v; if (k === 'prep_days') p.bids++; per.set(name, p); };
  for (const t of inPrep) { const r = t.recommendation; const team = r?.team?.length ? r.team : []; for (const m of team) add(m.name, 'prep_days', Math.round((r.prep_days || 5) / Math.max(1, team.length) * 10) / 10); }
  for (const t of pending) { const r = t.recommendation; const team = r?.team || []; if (r?.mission_days) for (const m of team) add(m.name, 'probable_days', Math.round(r.mission_days * rate / Math.max(1, team.length) * 10) / 10); }
  for (const p of people) { const x = per.get(p.full_name || p.name); if (x) { x.load_pct = p.load_pct ?? null; x.missions_active = p.missions_active ?? null; } }
  return { success_rate_used: Math.round(rate * 100), bids_in_preparation: inPrep.length, prep_days: inPrep.reduce((s, t) => s + (t.recommendation?.prep_days || 0), 0),
    submitted_pending: pending.length, probable_mission_days: Math.round(pending.reduce((s, t) => s + (t.recommendation?.mission_days || 0) * rate, 0)), per_person: [...per.values()].sort((a, b) => (b.prep_days + b.probable_days) - (a.prep_days + a.probable_days)) };
}

// ---- The page ----
export async function tendersView(orgId, account, d = {}) {
  account = await checkedAccount(orgId, account, d);
  const role = account?.role;
  if (!BUSINESS_DEV.includes(role)) throw fail('ROLE_NOT_ALLOWED', 403);
  const [st, settings] = await Promise.all([load(d), watchSettings(orgId, d)]);
  const showShadow = SHADOW_VIEWERS.includes(role);
  const kpis = tenderKpis(st.tenders);
  const ctx = await (d.capabilityContext || (async (o) => (await import('./capabilities.js')).capabilityContext(o)))(orgId).catch(() => ({ people: [] }));
  const decide = can(account, 'tender_follow_decision', deciderCheck(account, settings));
  const tenders = Object.values(st.tenders).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 300).map(t => {
    const x = { ...t, stage_label: STAGE_LABELS[t.stage] || t.stage };
    // Shadow's reviews are seen by the partners and the IT administrator only; the BDM sees a review only
    // when a partner validated it and chose to share it (as a recommendation).
    if (!showShadow) x.shadow_review = t.shadow_review?.status === 'validated' && t.shadow_review.shared_with_bdm ? { status: 'shared', improvements: t.shadow_review.improvements, lesson: t.shadow_review.lesson } : null;
    return x;
  });
  return { tenders, companies: Object.values(st.companies || {}).sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen))).slice(0, 100), kpis,
    workload: tenderWorkload(st.tenders, ctx.people || [], kpis.rates.success), runs: (st.runs || []).slice(-10).reverse(), running: st.running, last_run: st.last_run,
    settings: FIRM_LEAD.includes(role) ? settings : { deciders: settings.deciders, zones: settings.zones },
    me: { role, may_decide: decide.ok, why_not: decide.reason, may_settings: FIRM_LEAD.includes(role), sees_shadow: showShadow },
    stage_labels: STAGE_LABELS, decline_reasons: DECLINE_REASONS };
}

// Bell: what waits for this person (deciders: tenders to decide; BDM: TDR to obtain, deadlines close).
export async function tenderTasks(orgId, account, d = {}) {
  account = await checkedAccount(orgId, account, d);
  if (!BUSINESS_DEV.includes(account?.role)) return [];
  const [st, settings] = await Promise.all([load(d), watchSettings(orgId, d)]);
  const out = [];
  if (can(account, 'tender_follow_decision', deciderCheck(account, settings)).ok)
    for (const t of priorityTenders(st)) out.push({ id: 'td|' + t.id, title: 'À décider : ' + t.title, meta: [t.buyer, 'date limite ' + t.deadline, t.recommendation ? t.recommendation.bid + ' ' + t.recommendation.score + '/100' : ''].filter(Boolean).join(' · '), href: '/veille.html?id=' + t.id, at: t.received_at });
  if (['bdm', 'owner', 'partner'].includes(account.role))
    for (const t of Object.values(st.tenders).filter(x => x.stage === 'followed')) out.push({ id: 'tf|' + t.id, title: 'TDR à obtenir : ' + t.title, meta: 'date limite ' + (t.deadline || '?'), href: '/veille.html?id=' + t.id, at: t.decision?.at });
  if (SHADOW_VIEWERS.includes(account.role))
    for (const t of Object.values(st.tenders).filter(x => x.shadow_review?.status === 'proposed')) out.push({ id: 'tl|' + t.id, title: 'Shadow : revue d’une offre perdue — ' + t.title, meta: 'à valider', href: '/veille.html?id=' + t.id, at: t.shadow_review.at });
  return out.slice(0, 30);
}

// The scheduler: once a day after the firm's hour (local time), in the background.
export async function maybeDailyWatch(orgId, req, local, d = {}) {
  const settings = await watchSettings(orgId, d).catch(() => null);
  if (!settings?.enabled) return { skipped: 'TENDER_WATCH_DISABLED' };
  if (local.minutes < settings.hour * 60) return { skipped: 'NOT_YET' };
  return startTenderWatch(orgId, req, { today: local.date }, d);
}
