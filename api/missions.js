import { requirePilotAccess } from '../lib/auth.js';
import { listMissions, getMissionDossier } from '../lib/mission-dossier.js';
import { assertIsolatedOrg } from '../lib/test-mode.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
    requirePilotAccess(req);
    if(req.method !== 'GET') return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
    const orgId=process.env.DEFAULT_ORG_ID;
    if(!orgId) throw new Error('DEFAULT_ORG_ID_MISSING');
    assertIsolatedOrg(orgId);
    const missionId=req.query?.mission_id;
    const result=missionId === undefined ? await listMissions(orgId) : await getMissionDossier(orgId,missionId);
    return res.status(200).json(result);
  } catch(error) {
    const status=error.statusCode || 500;
    return res.status(status).json({error: [400,401,404].includes(status) ? error.message : 'MISSION_DOSSIER_UNAVAILABLE'});
  }
}
