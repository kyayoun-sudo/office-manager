import { requirePilotAccess } from '../lib/auth.js';
import { getAgentSetting } from '../lib/supabase.js';
import { getPeopleIntelligence } from '../lib/people-intelligence.js';
import { assertIsolatedOrg } from '../lib/test-mode.js';

// Deterministic internal reading only: no external AI call, assignment or notification.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    requirePilotAccess(req);
    if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    const orgId = process.env.DEFAULT_ORG_ID;
    if (!orgId) throw new Error('DEFAULT_ORG_ID_MISSING');
    assertIsolatedOrg(orgId);
    const missionId = req.body?.mission_id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(missionId || '')) {
      return res.status(400).json({ error: 'VALID_MISSION_ID_REQUIRED' });
    }
    const setting = await getAgentSetting(orgId, 'grand-controleur');
    if (!setting || setting.mode === 'disabled') return res.status(409).json({ error: 'AGENT_DISABLED' });
    return res.status(200).json(await getPeopleIntelligence(orgId, missionId));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error:
      error.statusCode === 404 || error.statusCode === 401 ? error.message : 'PEOPLE_INTELLIGENCE_UNAVAILABLE' });
  }
}
