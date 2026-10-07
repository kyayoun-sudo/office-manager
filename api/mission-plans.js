import { requirePilotAccess } from '../lib/auth.js';
import { saveMissionPlan } from '../lib/mission-plans.js';
import { assertIsolatedOrg } from '../lib/test-mode.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
    requirePilotAccess(req);
    if(req.method!=='POST') return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    const orgId=process.env.DEFAULT_ORG_ID;
    if(!orgId) throw new Error('DEFAULT_ORG_ID_MISSING');
    assertIsolatedOrg(orgId);
    const plan=await saveMissionPlan(orgId,req.body);
    return res.status(200).json({plan,approval_status:'not_approved'});
  } catch(error) {
    const status=error.statusCode || 500;
    return res.status(status).json({error:[400,401,404].includes(status)?error.message:'PLAN_SAVE_UNAVAILABLE'});
  }
}
