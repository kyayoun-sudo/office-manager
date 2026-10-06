import { requirePilotAccess } from '../lib/auth.js';
import { getBranding, saveBranding } from '../lib/branding.js';
import { globalSearch } from '../lib/global-search.js';
import { listPendingActions, recordDecision } from '../lib/action-decisions.js';
import { getMissionView } from '../lib/mission-view.js';

// Single endpoint for the new screens, to stay within Vercel's function limit.
//   GET  /api/app?route=branding                   firm name, colour, logo
//   POST /api/app?route=branding                   save them
//   GET  /api/app?route=search&q=…&scope=…         read-only global search
//   GET  /api/app?route=actions                    proposals waiting for a decision
//   POST /api/app?route=actions                    record a decision (executes nothing)
//   GET  /api/app?route=mission-view&mission_id=…  mission dossier + team names
// Same pilot token as every other endpoint. No existing endpoint is changed.

const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });

export const ROUTES = Object.freeze({
  branding: {
    GET: (orgId) => getBranding(orgId),
    POST: (orgId, req) => saveBranding(orgId, req.body || {}, req.body?.updated_by),
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
  }
});

export async function handleApp(req) {
  requirePilotAccess(req);
  const route = ROUTES[String(req.query?.route || '')];
  if (!route) throw fail('UNKNOWN_ROUTE', 404);
  const run = route[req.method];
  if (!run) throw fail('METHOD_NOT_ALLOWED', 405);
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
    const shown = [400, 401, 404, 405, 409].includes(status) ? error.message : (route?.unavailable || 'APP_UNAVAILABLE');
    return res.status(status).json({ error: shown });
  }
}
