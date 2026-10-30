import { requirePilotAccess } from '../lib/auth.js';
import { resolveRequestOrg } from '../lib/firm-context.js';
import { requirePersonOrServer, visibleMissionIds } from '../lib/caller.js';
import { listMissions, getMissionDossier } from '../lib/mission-dossier.js';
import { assertIsolatedOrg } from '../lib/test-mode.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
    requirePilotAccess(req, { allowSession: true }); // the session is verified below
    if(req.method !== 'GET') return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    const orgId = await resolveRequestOrg(req);
    if(!orgId) throw new Error('DEFAULT_ORG_ID_MISSING');
    assertIsolatedOrg(orgId);
    // Audit 2026-10-30: a person's own session (or the server), and only the missions the firm's rights let them see.
    const account = await requirePersonOrServer(req, orgId);
    const visible = await visibleMissionIds(orgId, account);
    const missionId=req.query?.mission_id;
    if (missionId !== undefined && visible && !visible.has(missionId)) return res.status(403).json({error:'NOT_ON_THIS_MISSION'});
    const result=missionId === undefined ? await listMissions(orgId, { ids: visible }) : await getMissionDossier(orgId,missionId);
    return res.status(200).json(result);
  } catch(error) {
    const status=error.statusCode || 500;
    return res.status(status).json({error: [400,401,403,404].includes(status) ? error.message : 'MISSION_DOSSIER_UNAVAILABLE'});
  }
}
