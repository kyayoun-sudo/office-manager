import { requirePilotAccess } from '../lib/auth.js';
import { requireFirmOwner } from '../lib/owner-auth.js';
import { getBranding, saveBranding } from '../lib/branding.js';
import { globalSearch } from '../lib/global-search.js';
import { listPendingActions, recordDecision } from '../lib/action-decisions.js';
import { getMissionView } from '../lib/mission-view.js';
import { getPersona, savePersona, draftInternalMessage } from '../lib/agent-persona.js';
import { login, refreshSession, logout, bootstrapOwner, listAccounts, manageAccount } from '../lib/accounts.js';
import { diagnose } from '../lib/diagnostic.js';
import { createRequest, listRequests, getRequest, step, decide, undo, stop } from '../lib/tidy.js';
import { getSchedule, saveSchedule } from '../lib/schedule.js';
import { tick, runNow, listPasses } from '../lib/agent-passes.js';
import { requireRole, logAccess } from '../lib/user-auth.js';
import { teamKpis, coordination, myKpis } from '../lib/kpi.js';
import { checkReadiness, launchMappingPass } from '../lib/readiness.js';
import { listMessages, proposeMessage, decideMessage } from '../lib/agent-mail.js';
import { getTraining, startCampaign, stopCampaign, cleanupCampaign, confirmCase, step as trainingStep } from '../lib/training.js';
import { getTestRun, startCopy, copyTick, seed as seedTestRun } from '../lib/test-run.js';
import { googleStatus, startConnect, finishConnect, disconnectGoogle, loadGoogleConnection, setFirmDrive } from '../lib/google-connection.js';
import { assertIsolatedOrg } from '../lib/test-mode.js';

// Single endpoint for the new screens, to stay within Vercel's function limit.
//   GET  /api/app?route=branding                   firm name, colour, logo (everyone)
//   POST /api/app?route=branding                   save them — OWNER ONLY
//   GET  /api/app?route=search&q=…&scope=…         read-only global search
//   GET  /api/app?route=actions                    proposals waiting for a decision
//   POST /api/app?route=actions                    record a decision (executes nothing)
//   GET  /api/app?route=mission-view&mission_id=…  mission dossier + team names
//   GET  /api/app?route=agent-persona              agent mail identity and tone — OWNER ONLY
//   POST /api/app?route=agent-persona              save them — OWNER ONLY
//   POST /api/app?route=agent-message              draft an internal message (never sent)
//   POST /api/app?route=login                      e-mail + password -> session (public)
//   POST /api/app?route=session                    re-check a session with its refresh token (public)
//   POST /api/app?route=logout                     end the session (public)
//   POST /api/app?route=bootstrap-owner            first owner account (owner code, only if no account)
//   POST /api/app?route=diagnostic                 which code was typed, what is missing (public, no secret shown)
//   GET  /api/app?route=tidy[&id=…]                Orpailleur tidy-up requests / one request with its plan
//   POST /api/app?route=tidy {action}              create | step | decide | undo | stop (background chained)
//   GET  /api/app?route=agent-schedule             agent pass times — OWNER ONLY (POST: save)
//   GET  /api/app?route=passes                     latest agent passes
//   POST /api/app?route=scheduler-tick             called by the scheduler (x-scheduler-secret), runs due passes
//   POST /api/app?route=scheduler-run {agent}      run a pass now — OWNER ONLY
//   GET  /api/app?route=coordination               missions at risk, late and unassigned actions — MANAGERS (personal session)
//   GET  /api/app?route=team-kpi                   team indicators — MANAGERS (personal session, access logged)
//   GET  /api/app?route=my-kpi                     my own indicators — any account (personal session)
//   GET  /api/app?route=users                      firm accounts — OWNER ONLY
//   POST /api/app?route=users                      create / deactivate / role / password — OWNER ONLY
//   GET  /api/app?route=training                   agent training: campaign, missions, grades, report (personal session)
//   POST /api/app?route=training {action}          start | stop | cleanup (remove the training missions) — OWNER ONLY
//   POST /api/app?route=training-confirm           the team confirms / corrects the agent on a real mission (personal session)
//   POST /api/app?route=training-step              next unit of training work (background chain)
//   GET  /api/app?route=messages                   agent's messages to colleagues — MANAGERS (personal session)
//   POST /api/app?route=messages {action}          propose (any account) | decide approve/reject (owner, partner, manager)
//   GET  /api/app?route=readiness                  "Mise en service": every link of the chain checked — OWNER ONLY
//   POST /api/app?route=readiness {action}         mapping-pass (full Drive mapping by the Orpailleur) — OWNER ONLY
// Every route needs the pilot token, except the public login routes. Owner routes
// also need the owner token (x-office-manager-owner-token), as in api/owner.js.

const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });
const owner = run => Object.assign(run, { ownerOnly: true });
const open = run => Object.assign(run, { public: true });
// Needs a personal session (Supabase access token) with one of these roles.
const MANAGERS = ['owner', 'partner', 'manager'];
const users = (roles, run) => Object.assign(run, { userRoles: roles });
const ALL_ROLES = ['owner', 'partner', 'manager', 'collaborator'];

export const ROUTES = Object.freeze({
  branding: {
    GET: (orgId) => getBranding(orgId),
    POST: owner((orgId, req) => saveBranding(orgId, req.body || {}, req.body?.updated_by)),
    unavailable: 'BRANDING_UNAVAILABLE'
  },
  search: {
    GET: (orgId, req) => globalSearch(orgId, req.query?.q, req.query?.scope),
    unavailable: 'SEARCH_UNAVAILABLE'
  },
  actions: {
    GET: (orgId) => listPendingActions(orgId),
    // Validators only, and the journal records who they really are (never a typed name).
    POST: users(MANAGERS, (orgId, req) => recordDecision(orgId, { ...(req.body || {}), decided_by: req.account?.display_name || req.account?.email || null })),
    unavailable: 'ACTIONS_UNAVAILABLE'
  },
  'mission-view': {
    GET: (orgId, req) => getMissionView(orgId, req.query?.mission_id),
    unavailable: 'MISSION_VIEW_UNAVAILABLE'
  },
  'agent-persona': {
    GET: owner((orgId) => getPersona(orgId)),
    POST: owner((orgId, req) => savePersona(orgId, req.body || {}, req.body?.updated_by)),
    unavailable: 'AGENT_PERSONA_UNAVAILABLE'
  },
  'agent-message': {
    POST: (orgId, req) => draftInternalMessage(orgId, req.body || {}),
    unavailable: 'AGENT_MESSAGE_UNAVAILABLE'
  },
  login: { POST: open((orgId, req) => login(orgId, req.body || {})), unavailable: 'LOGIN_UNAVAILABLE' },
  session: { POST: open((orgId, req) => refreshSession(orgId, req.body || {})), unavailable: 'SESSION_UNAVAILABLE' },
  logout: { POST: open((orgId, req) => logout(req.body || {})), unavailable: 'LOGOUT_UNAVAILABLE' },
  'bootstrap-owner': { POST: open((orgId, req) => bootstrapOwner(orgId, req)), unavailable: 'BOOTSTRAP_UNAVAILABLE' },
  tidy: {
    GET: (orgId, req) => req.query?.id ? getRequest(orgId, req.query.id) : listRequests(orgId),
    POST: (orgId, req) => tidyAction(orgId, req),
    unavailable: 'TIDY_UNAVAILABLE'
  },
  diagnostic: { POST: open((orgId, req) => diagnose(req.body || {})), unavailable: 'DIAGNOSTIC_UNAVAILABLE' },
  'agent-schedule': {
    GET: owner((orgId) => getSchedule(orgId)),
    POST: owner((orgId, req) => saveSchedule(orgId, req.body || {}, req.body?.updated_by)),
    unavailable: 'SCHEDULE_UNAVAILABLE'
  },
  passes: { GET: (orgId) => listPasses(orgId), unavailable: 'PASSES_UNAVAILABLE' },
  // Public route: the scheduler secret is checked inside tick().
  'scheduler-tick': { POST: open((orgId, req) => tick(orgId, req)), unavailable: 'SCHEDULER_UNAVAILABLE' },
  'scheduler-run': { POST: owner((orgId, req) => runNow(orgId, req)), unavailable: 'SCHEDULER_UNAVAILABLE' },
  coordination: {
    GET: users(MANAGERS, async (orgId, req) => { await logAccess(orgId, req.account, 'view_coordination'); return coordination(orgId); }),
    unavailable: 'COORDINATION_UNAVAILABLE'
  },
  'team-kpi': {
    GET: users(MANAGERS, async (orgId, req) => { await logAccess(orgId, req.account, 'view_team_kpi'); return teamKpis(orgId); }),
    unavailable: 'KPI_UNAVAILABLE'
  },
  'my-kpi': {
    GET: users(['owner', 'partner', 'manager', 'collaborator'], (orgId, req) => myKpis(orgId, req.account)),
    unavailable: 'KPI_UNAVAILABLE'
  },
  training: {
    GET: users(ALL_ROLES, (orgId, req) => getTraining(orgId, req)),
    POST: owner((orgId, req) => trainingAction(orgId, req)),
    unavailable: 'TRAINING_UNAVAILABLE'
  },
  'training-confirm': { POST: users(ALL_ROLES, (orgId, req) => confirmCase(orgId, req)), unavailable: 'TRAINING_UNAVAILABLE' },
  'training-step': { POST: (orgId, req) => trainingStep(orgId, req), unavailable: 'TRAINING_UNAVAILABLE' },
  messages: {
    GET: users(MANAGERS, (orgId) => listMessages(orgId)),
    POST: users(ALL_ROLES, (orgId, req) => {
      const body = req.body || {};
      if (body.action === 'propose') return proposeMessage(orgId, body, req.account);
      if (body.action === 'decide') return decideMessage(orgId, body, req.account);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'MESSAGES_UNAVAILABLE'
  },
  readiness: {
    GET: owner((orgId) => checkReadiness(orgId)),
    POST: owner((orgId, req) => {
      if (req.body?.action === 'mapping-pass') return launchMappingPass(req);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'READINESS_UNAVAILABLE'
  },
  users: {
    GET: owner((orgId) => listAccounts(orgId)),
    POST: owner((orgId, req) => manageAccount(orgId, req.body || {})),
    unavailable: 'USERS_UNAVAILABLE'
  },
  // Test of the whole app on a copy of the firm — works only in a preview on a test firm.
  //   GET  /api/app?route=test-run                 environment check, copy progress, missions — OWNER ONLY
  //   POST /api/app?route=test-run {action}        copy (the Drive) | seed (team + 5 missions) — OWNER ONLY
  //   POST /api/app?route=test-run-step            next chunk of the copy (background chain)
  'test-run': {
    GET: owner((orgId) => getTestRun(orgId)),
    POST: owner((orgId, req) => {
      if (req.body?.action === 'copy') return startCopy(orgId, req);
      if (req.body?.action === 'seed') return seedTestRun(orgId, req);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'TEST_RUN_UNAVAILABLE'
  },
  'test-run-step': { POST: (orgId, req) => copyTick(orgId, req), unavailable: 'TEST_RUN_UNAVAILABLE' },
  // "Connecter Google" (Drive + Gmail of the firm), from Paramètres.
  //   GET  /api/app?route=google                   connected account, rights, shared drives seen — OWNER ONLY
  //   POST /api/app?route=google {action}          connect (returns Google's consent address) | disconnect — OWNER ONLY
  //   GET  /oauth/google/callback (rewrite)        Google sends the owner back here (signed state checked)
  google: {
    GET: owner((orgId, req) => googleStatus(orgId, { req })),
    POST: owner((orgId, req) => {
      if (req.body?.action === 'connect') return startConnect(orgId, req);
      if (req.body?.action === 'disconnect') return disconnectGoogle(orgId);
      if (req.body?.action === 'set-drive') return setFirmDrive(orgId, req);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'GOOGLE_UNAVAILABLE'
  },
  'google-callback': {
    GET: open(async (orgId, req) => {
      try {
        const r = await finishConnect(orgId, req);
        return { __redirect: '/parametres.html?google=ok&email=' + encodeURIComponent(r.email) + '#google' };
      } catch (e) {
        return { __redirect: '/parametres.html?google=error&code=' + encodeURIComponent(String(e.message || e).slice(0, 80)) + '#google' };
      }
    }),
    unavailable: 'GOOGLE_UNAVAILABLE'
  }
});

// Starts the next background step without waiting for it (separate invocation).
export function continueInBackground(req, requestId, fetchImpl = fetch) {
  const host = req.headers?.host;
  if (!host || !requestId) return Promise.resolve(false);
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const headers = { 'Content-Type': 'application/json', 'x-office-manager-token': process.env.OFFICE_MANAGER_ACCESS_TOKEN || '' };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const sent = fetchImpl(proto + '://' + host + '/api/app?route=tidy', {
    method: 'POST', headers, body: JSON.stringify({ action: 'step', request_id: requestId })
  }).then(() => true, () => false);
  return Promise.race([sent, new Promise(r => setTimeout(() => r(true), 1500))]);
}

async function tidyAction(orgId, req) {
  const body = req.body || {};
  const action = String(body.action || '');
  let result, chainId = null;
  if (action === 'create') { result = await createRequest(orgId, body); chainId = result.id; }
  else if (action === 'step') { result = await step(orgId, body.request_id); if (result.more) chainId = body.request_id; }
  else if (action === 'decide') { result = await decide(orgId, body); if (body.decision !== 'reject') chainId = body.request_id; }
  else if (action === 'undo') result = await undo(orgId, body);
  else if (action === 'stop') result = await stop(orgId, body);
  else throw fail('UNKNOWN_ACTION', 400);
  if (chainId) await continueInBackground(req, chainId);
  return result;
}

async function trainingAction(orgId, req) {
  const action = String(req.body?.action || '');
  if (action === 'start') return startCampaign(orgId, req);
  if (action === 'stop') return stopCampaign(orgId);
  if (action === 'cleanup') return cleanupCampaign(orgId, req);
  throw fail('UNKNOWN_ACTION', 400);
}

export async function handleApp(req) {
  const route = ROUTES[String(req.query?.route || '')];
  if (!route) { requirePilotAccess(req); throw fail('UNKNOWN_ROUTE', 404); }
  const run = route[req.method];
  if (typeof run !== 'function') { requirePilotAccess(req); throw fail('METHOD_NOT_ALLOWED', 405); }
  if (!run.public) requirePilotAccess(req);
  if (run.ownerOnly) requireFirmOwner(req);
  const orgId = process.env.DEFAULT_ORG_ID;
  if (!orgId && route !== ROUTES.diagnostic) throw new Error('DEFAULT_ORG_ID_MISSING');
  // Test mode (preview): never on the real firm's organisation (test run TATY TEST).
  if (route !== ROUTES.diagnostic) assertIsolatedOrg(orgId);
  if (run.userRoles) req.account = await requireRole(req, run.userRoles);
  // The firm's Google connection (Paramètres → Connecter Google), used by Drive and Gmail.
  if (orgId) await loadGoogleConnection(orgId).catch(() => null);
  return run(orgId, req);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const out = await handleApp(req);
    // Only the Google callback redirects, and only to a page of this app.
    if (out && typeof out.__redirect === 'string' && out.__redirect.startsWith('/')) {
      res.statusCode = 302; res.setHeader('Location', out.__redirect); return res.end();
    }
    return res.status(200).json(out);
  } catch (error) {
    const status = error.statusCode || 500;
    const route = ROUTES[String(req.query?.route || '')];
    const shown = [400, 401, 403, 404, 405, 409, 429, 503].includes(status) ? error.message : (route?.unavailable || 'APP_UNAVAILABLE');
    const body = { error: shown };
    if (Array.isArray(error.outside)) body.outside = error.outside;
    return res.status(status).json(body);
  }
}
