import { requirePilotAccess } from '../lib/auth.js';
import { requireFirmOwner } from '../lib/owner-auth.js';
import { getBranding, saveBranding } from '../lib/branding.js';
import { globalSearch } from '../lib/global-search.js';
import { listPendingActions, recordDecision } from '../lib/action-decisions.js';
import { getMissionView } from '../lib/mission-view.js';
import { getPersona, savePersona, draftInternalMessage } from '../lib/agent-persona.js';

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
// Every route needs the pilot token. Owner routes also need the owner token
// (x-office-manager-owner-token), the same credential as api/owner.js.

const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });
const owner = run => Object.assign(run, { ownerOnly: true });

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
  }
});

export async function handleApp(req) {
  requirePilotAccess(req);
  const route = ROUTES[String(req.query?.route || '')];
  if (!route) throw fail('UNKNOWN_ROUTE', 404);
  const run = route[req.method];
  if (typeof run !== 'function') throw fail('METHOD_NOT_ALLOWED', 405);
  if (run.ownerOnly) requireFirmOwner(req);
  const orgId = process.env.DEFAULT_ORG_ID;
  if (!orgId) throw new Error('DEFAULT_ORG_ID_MISSING');
  return run(orgId, req);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    return res.status(200).json(await handleApp(req));
  } catch (error) {
    const status = error.statusCode || 500;
    const route = ROUTES[String(req.query?.route || '')];
    const shown = [400, 401, 403, 404, 405, 409, 503].includes(status) ? error.message : (route?.unavailable || 'APP_UNAVAILABLE');
    const body = { error: shown };
    if (Array.isArray(error.outside)) body.outside = error.outside;
    return res.status(status).json(body);
  }
}
