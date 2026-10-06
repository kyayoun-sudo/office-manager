import { requirePilotAccess } from '../lib/auth.js';
import { getMissionView } from '../lib/mission-view.js';

// GET /api/mission-view?mission_id=<uuid> -> dossier + team names + summary. Read-only.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    requirePilotAccess(req);
    if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    const orgId = process.env.DEFAULT_ORG_ID;
    if (!orgId) throw new Error('DEFAULT_ORG_ID_MISSING');
    return res.status(200).json(await getMissionView(orgId, req.query?.mission_id));
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: [400, 401, 404].includes(status) ? error.message : 'MISSION_VIEW_UNAVAILABLE' });
  }
}
