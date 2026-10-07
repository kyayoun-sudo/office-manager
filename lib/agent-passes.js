import crypto from 'node:crypto';
import { rest } from './supabase.js';
import { getSchedule, dueSlots } from './schedule.js';
import { createRequest } from './tidy.js';

// Scheduled passes of the agents, complementary by design:
//   Orpailleur (08:00, 12:00, 20:00)  inventory, read, file and RENAME what is new since its last
//                                      pass, taking into account the needs left by the Grand Contrôleur.
//   Grand Contrôleur (owner's times)  starts from the Orpailleur's latest results (pieces received,
//                                      proposals), reviews missions/PBC/deadlines/staffing and ends with
//                                      "BESOINS POUR L'ORPAILLEUR" for the next Orpailleur pass.
//   Sika (weekly)                     billing and administrative follow-up from both.
// A pass never sends anything outside the firm and never deletes anything.

const q = v => encodeURIComponent(v);
const NEEDS_MARK = /BESOINS POUR L.ORPAILLEUR\s*:?/i;

function safeEqual(a, b) {
  const aa = crypto.createHash('sha256').update(String(a || '')).digest();
  const bb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(aa, bb) && Boolean(a);
}

// The tick is called by a scheduler (Supabase pg_cron, GitHub Actions…), not by people.
export function requireSchedulerSecret(req) {
  const expected = process.env.OFFICE_MANAGER_SCHEDULER_SECRET || process.env.ORPAILLEUR_JOB_SECRET;
  if (!expected) throw Object.assign(new Error('SCHEDULER_SECRET_NOT_CONFIGURED'), { statusCode: 503 });
  if (!safeEqual(req.headers?.['x-scheduler-secret'], expected)) throw Object.assign(new Error('SCHEDULER_UNAUTHORIZED'), { statusCode: 401 });
}

// Fire-and-forget call to another endpoint of the same app (separate invocation).
export function fireInternal(req, path, body, fetchImpl = fetch) {
  const host = req?.headers?.host;
  if (!host) return Promise.resolve(false);
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const headers = { 'Content-Type': 'application/json', 'x-office-manager-token': process.env.OFFICE_MANAGER_ACCESS_TOKEN || '' };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const sent = fetchImpl(proto + '://' + host + path, { method: 'POST', headers, body: JSON.stringify(body) }).then(() => true, () => false);
  return Promise.race([sent, new Promise(r => setTimeout(() => r(true), 1500))]);
}

export function extractNeeds(summary) {
  const text = String(summary || '');
  const m = text.split(NEEDS_MARK);
  return (m.length > 1 ? m[m.length - 1] : '').trim().slice(0, 800);
}

async function lastPass(orgId, agent, fetchRows) {
  const rows = await fetchRows('office_agent_passes?org_id=eq.' + q(orgId) + '&agent_key=eq.' + q(agent) +
    '&select=id,slot,status,summary,details,started_at&order=started_at.desc&limit=2');
  return rows || [];
}

async function lastControllerSummary(orgId, fetchRows) {
  try {
    const rows = await fetchRows('office_agent_runs?org_id=eq.' + q(orgId) + '&agent_key=eq.grand-controleur&status=eq.verified&select=summary,finished_at&order=started_at.desc&limit=1');
    return rows?.[0]?.summary || '';
  } catch { return ''; }
}

async function orpailleurDigest(orgId, fetchRows) {
  const [prev] = await lastPass(orgId, 'orpailleur', fetchRows);
  const id = prev?.details?.tidy_request_id;
  if (!id) return 'Aucun passage récent de l’Orpailleur.';
  const r = (await fetchRows('office_tidy_requests?org_id=eq.' + q(orgId) + '&id=eq.' + q(id) + '&select=status,counts,last_error&limit=1'))?.[0];
  if (!r) return 'Dernier passage de l’Orpailleur introuvable.';
  const c = r.counts || {};
  return 'Dernier passage de l’Orpailleur (' + prev.slot + ') : ' + (c.total || 0) + ' fichiers nouveaux ou modifiés lus, ' +
    (c.moved || 0) + ' rangés ou renommés, ' + (c.to_review || 0) + ' propositions en attente de validation, ' +
    (c.needs_reading || 0) + ' à lire, ' + (c.failed || 0) + ' échecs' + (r.last_error ? ' (blocage : ' + r.last_error + ')' : '') + '.';
}

async function startDriveScan() {
  const base = process.env.SUPABASE_URL, secret = process.env.ORPAILLEUR_JOB_SECRET;
  if (!base || !secret) return false;
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/functions/v1/orpailleur-durable-worker', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-orpailleur-secret': secret }, body: JSON.stringify({ action: 'start' })
    });
    return r.ok;
  } catch { return false; }
}

export async function runPass(orgId, pass, req, deps = {}) {
  const fetchRows = deps.fetchRows || rest;
  const fire = deps.fireInternal || fireInternal;
  const scan = deps.startDriveScan || startDriveScan;
  const create = deps.createRequest || createRequest;
  const time = String(pass.slot).slice(-5);

  if (pass.agent_key === 'orpailleur') {
    const previous = (await lastPass(orgId, 'orpailleur', fetchRows)).find(p => p.id !== pass.id);
    const since = previous?.started_at || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const needs = extractNeeds(await lastControllerSummary(orgId, fetchRows));
    const scanStarted = await scan();
    const request = await create(orgId, {
      title: 'Passage automatique de ' + time,
      since,
      requested_by: 'Orpailleur (passage de ' + time + ')',
      instructions: 'Passage automatique : lire, ranger et renommer les fichiers nouveaux ou modifiés depuis le passage précédent, ' +
        'selon les règles du cabinet et ce que les validations passées ont appris.' +
        (needs ? ' Besoins signalés par le Grand Contrôleur, à traiter en priorité : ' + needs : '')
    });
    await fire(req, '/api/app?route=tidy', { action: 'step', request_id: request.id });
    return { summary: 'Rangement lancé sur les nouveautés depuis ' + since.slice(0, 16).replace('T', ' ') + (needs ? ', en tenant compte des besoins du Grand Contrôleur' : '') + '.',
      details: { tidy_request_id: request.id, since, drive_scan_started: scanStarted, controller_needs: Boolean(needs) } };
  }

  if (pass.agent_key === 'grand-controleur') {
    const digest = await orpailleurDigest(orgId, fetchRows);
    const message = 'Passage planifié du Grand Contrôleur (' + time + '). ' + digest + ' ' +
      'Pars de ce travail de l’Orpailleur sans le refaire. Fais le point sur les missions : pièces PBC reçues et manquantes, ' +
      'échéances, affectations, risques et alertes ; consulte les spécialistes utiles. N’envoie rien hors du cabinet et ne modifie rien sans validation. ' +
      'Termine par une section « BESOINS POUR L’ORPAILLEUR : » listant les pièces à rechercher ou les dossiers à surveiller au prochain passage.';
    await fire(req, '/api/agent', { message, agent: 'auto', provider: 'auto', risk: 'normal' });
    return { summary: 'Point demandé au Grand Contrôleur à partir du dernier passage de l’Orpailleur. Résultat dans « Suivi des demandes ».', details: { orpailleur_digest: digest } };
  }

  if (pass.agent_key === 'sika') {
    const digest = await orpailleurDigest(orgId, fetchRows);
    const controller = (await lastControllerSummary(orgId, fetchRows)).slice(0, 800);
    const message = 'Passage hebdomadaire de Sika. Fais le point sur la facturation, les encaissements et les relances administratives de la semaine. ' +
      'Appuie-toi sur le dernier point du Grand Contrôleur' + (controller ? ' (' + controller + ')' : '') + ' et sur l’Orpailleur (' + digest + '). ' +
      'Distingue paiements annoncés et paiements vérifiés. Propose, n’envoie rien sans validation.';
    await fire(req, '/api/agent', { message, agent: 'sika', provider: 'auto', risk: 'normal' });
    return { summary: 'Point hebdomadaire demandé à Sika. Résultat dans « Suivi des demandes ».', details: {} };
  }
  throw Object.assign(new Error('UNKNOWN_AGENT'), { statusCode: 400 });
}

// Records the pass (one per slot, so overlapping ticks never run it twice), then runs it.
export async function startPass(orgId, agent, slot, req, deps = {}) {
  const fetchRows = deps.fetchRows || rest;
  const inserted = await fetchRows('office_agent_passes?on_conflict=org_id,agent_key,slot', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify([{ org_id: orgId, agent_key: agent, slot, status: 'started' }])
  });
  const pass = inserted?.[0];
  if (!pass) return { agent, slot, skipped: 'already_done' };
  try {
    const r = await runPass(orgId, pass, req, deps);
    await fetchRows('office_agent_passes?org_id=eq.' + q(orgId) + '&id=eq.' + q(pass.id), {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'done', summary: r.summary, details: r.details, finished_at: new Date().toISOString() })
    });
    return { agent, slot, done: true, summary: r.summary };
  } catch (e) {
    await fetchRows('office_agent_passes?org_id=eq.' + q(orgId) + '&id=eq.' + q(pass.id), {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'failed', summary: String(e.message || e).slice(0, 500), finished_at: new Date().toISOString() })
    });
    return { agent, slot, failed: String(e.message || e) };
  }
}

export async function tick(orgId, req, deps = {}) {
  requireSchedulerSecret(req);
  const fetchRows = deps.fetchRows || rest;
  const schedule = deps.schedule || await getSchedule(orgId, fetchRows);
  const due = dueSlots(schedule, deps.now || new Date());
  const results = [];
  for (const d of due) results.push(await startPass(orgId, d.agent, d.slot, req, deps));
  return { enabled: Boolean(schedule.enabled), due: due.length, results };
}

// Owner: run an agent pass now (manual slot, never collides with the planned ones).
export async function runNow(orgId, req, deps = {}) {
  const agent = String(req.body?.agent || '');
  if (!['orpailleur', 'grand-controleur', 'sika'].includes(agent)) throw Object.assign(new Error('UNKNOWN_AGENT'), { statusCode: 400 });
  const slot = 'manuel ' + new Date().toISOString().slice(0, 19).replace('T', ' ');
  return startPass(orgId, agent, slot, req, deps);
}

export async function listPasses(orgId, fetchRows = rest) {
  const rows = await fetchRows('office_agent_passes?org_id=eq.' + q(orgId) + '&select=agent_key,slot,status,summary,started_at,finished_at&order=started_at.desc&limit=30');
  return { passes: rows || [] };
}
