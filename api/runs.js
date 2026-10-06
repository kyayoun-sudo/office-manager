import { requirePilotAccess } from '../lib/auth.js';
import { rest } from '../lib/supabase.js';
import { presentRun } from '../lib/run-status.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    requirePilotAccess(req);
    if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    const orgId = process.env.DEFAULT_ORG_ID;
    if (!orgId) throw new Error('DEFAULT_ORG_ID_MISSING');
    // Ignore any client-supplied organisation. Do not expose error details or metrics.
    const rows = await rest('office_agent_runs?org_id=eq.' + encodeURIComponent(orgId) +
      '&metrics->>release=eq.v2.3-architecture-phase1' +
      '&select=id,agent_key,status,started_at,finished_at,summary&order=started_at.desc&limit=20');
    return res.status(200).json({ runs: rows.map(row => presentRun(row)) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error:
      error.statusCode === 401 ? 'UNAUTHORIZED' : 'RUN_HISTORY_UNAVAILABLE' });
  }
}
