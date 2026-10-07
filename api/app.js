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
//   GET  /api/app?route=users                      firm accounts — OWNER ONLY
//   POST /api/app?route=users                      create / deactivate / role / password — OWNER ONLY
// Every route needs the pilot token, except the public login routes. Owner routes
// also need the owner token (x-office-manager-owner-token), as in api/owner.js.

const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });
const owner = run => Object.assign(run, { ownerOnly: true });
const open = run => Object.assign(run, { public: true });

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
    POST: (orgId, req) => recordDecision(orgId, req.body || {}),
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
  users: {
    GET: owner((orgId) => listAccounts(orgId)),
    POST: owner((orgId, req) => manageAccount(orgId, req.body || {})),
    unavailable: 'USERS_UNAVAILABLE'
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

export async function handleApp(req) {
  const route = ROUTES[String(req.query?.route || '')];
  if (!route) { requirePilotAccess(req); throw fail('UNKNOWN_ROUTE', 404); }
  const run = route[req.method];
  if (typeof run !== 'function') { requirePilotAccess(req); throw fail('METHOD_NOT_ALLOWED', 405); }
  if (!run.public) requirePilotAccess(req);
  if (run.ownerOnly) requireFirmOwner(req);
  const orgId = process.env.DEFAULT_ORG_ID;
  if (!orgId && route !== ROUTES.diagnostic) throw new Error('DEFAULT_ORG_ID_MISSING');
  return run(orgId, req);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    return res.status(200).json(await handleApp(req));
  } catch (error) {
    const status = error.statusCode || 500;
    const route = ROUTES[String(req.query?.route || '')];
    const shown = [400, 401, 403, 404, 405, 409, 429, 503].includes(status) ? error.message : (route?.unavailable || 'APP_UNAVAILABLE');
    const body = { error: shown };
    if (Array.isArray(error.outside)) body.outside = error.outside;
    return res.status(status).json(body);
  }
}
