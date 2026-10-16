import { registerCabinet, createCabinet, myCabinets } from '../lib/cabinet-onboarding.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Explicit rollout gate. Existing pilot account and document routes are untouched.
  if (process.env.OFFICE_MANAGER_CABINET_ONBOARDING !== 'on') {
    return res.status(503).json({ error: 'CABINET_ONBOARDING_NOT_ENABLED' });
  }
  try {
    const action = String(req.query?.action || '');
    if (req.method === 'POST' && action === 'register') return res.status(200).json(await registerCabinet(req.body));
    if (req.method === 'POST' && action === 'create') return res.status(200).json(await createCabinet(req));
    if (req.method === 'GET' && action === 'mine') return res.status(200).json(await myCabinets(req));
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: status === 500 ? 'CABINET_SETUP_FAILED' : error.message });
  }
}
