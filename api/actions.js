import { requirePilotAccess } from '../lib/auth.js';
import { listPendingActions, recordDecision } from '../lib/action-decisions.js';

// "À valider".
// GET  /api/actions -> proposals waiting for a decision, with the last decision recorded.
// POST /api/actions { action_id, decision: approve|reject|defer, note?, decided_by? }
//      -> appends the manager's decision to office_action_decisions.
// Nothing is executed, sent, filed or assigned here; office_action_queue is never modified.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    requirePilotAccess(req);
    const orgId = process.env.DEFAULT_ORG_ID;
    if (!orgId) throw new Error('DEFAULT_ORG_ID_MISSING');
    if (req.method === 'GET') return res.status(200).json(await listPendingActions(orgId));
    if (req.method === 'POST') return res.status(200).json(await recordDecision(orgId, req.body || {}));
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: [400, 401, 404, 409].includes(status) ? error.message : 'ACTIONS_UNAVAILABLE' });
  }
}
