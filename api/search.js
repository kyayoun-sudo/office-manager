import { requirePilotAccess } from '../lib/auth.js';
import { globalSearch } from '../lib/global-search.js';

// GET /api/search?q=...&scope=all|documents|missions|people
// Read-only search across documents, missions and people. No AI call, no write.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    requirePilotAccess(req);
    if (req.method !== 'GET') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    const orgId = process.env.DEFAULT_ORG_ID;
    if (!orgId) throw new Error('DEFAULT_ORG_ID_MISSING');
    return res.status(200).json(await globalSearch(orgId, req.query?.q, req.query?.scope));
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: [400, 401].includes(status) ? error.message : 'SEARCH_UNAVAILABLE' });
  }
}
