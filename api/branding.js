import { requirePilotAccess } from '../lib/auth.js';
import { getBranding, saveBranding } from '../lib/branding.js';

// White-label settings of the firm. GET: read. POST: save (firm name, colours, logo).
// No AI call, no Drive access, no change to any existing table.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    requirePilotAccess(req);
    const orgId = process.env.DEFAULT_ORG_ID;
    if (!orgId) throw new Error('DEFAULT_ORG_ID_MISSING');
    if (req.method === 'GET') return res.status(200).json(await getBranding(orgId));
    if (req.method === 'POST') {
      const body = req.body || {};
      return res.status(200).json(await saveBranding(orgId, body, body.updated_by));
    }
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: [400, 401].includes(status) ? error.message : 'BRANDING_UNAVAILABLE' });
  }
}
