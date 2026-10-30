import { requirePilotAccess } from '../lib/auth.js';
import { resolveRequestOrg } from '../lib/firm-context.js';
import { requirePersonOrServer, visibleMissionIds } from '../lib/caller.js';
import { saveMissionPlan } from '../lib/mission-plans.js';
import { assertIsolatedOrg } from '../lib/test-mode.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
    requirePilotAccess(req, { allowSession: true }); // the session is verified below
    if(req.method!=='POST') return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    const orgId = await resolveRequestOrg(req);
    if(!orgId) throw new Error('DEFAULT_ORG_ID_MISSING');
    assertIsolatedOrg(orgId);
    // Audit 2026-10-30: a person on this mission (or a lead), never the shared token alone.
    const account = await requirePersonOrServer(req, orgId);
    const visible = await visibleMissionIds(orgId, account);
    if (visible && !visible.has(req.body?.mission_id)) return res.status(403).json({error:'NOT_ON_THIS_MISSION'});
    const plan=await saveMissionPlan(orgId,req.body);
    return res.status(200).json({plan,approval_status:'not_approved'});
  } catch(error) {
    const status=error.statusCode || 500;
    return res.status(status).json({error:[400,401,403,404].includes(status)?error.message:'PLAN_SAVE_UNAVAILABLE'});
  }
}
