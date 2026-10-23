import { requirePilotAccess } from '../lib/auth.js';
import { currentAccount } from '../lib/user-auth.js';
import {
  importAnalyticalReview,
  analyticalReviewContext,
  chooseAnalyticalManager,
  organizeAnalyticalFile,
  stageAnalyticalFiles,
  deleteAnalyticalFile,
  startAnalyticalReview,
  refreshEynowaKnowledge,
  finalizeAnalyticalReview
} from '../lib/analytical-review.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    requirePilotAccess(req);
    const account = await currentAccount(req);
    const orgId = process.env.DEFAULT_ORG_ID;
    if (!orgId) throw new Error('DEFAULT_ORG_ID_MISSING');
    const missionId = String((req.method === 'GET' ? req.query?.mission_id : req.body?.mission_id) || '');
    if (req.method === 'GET') return res.status(200).json(await analyticalReviewContext(orgId, missionId, account));
    if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    const body = req.body || {}, action = String(body.action || '');
    let result;
    if (action === 'choose-manager') result = await chooseAnalyticalManager(orgId, missionId, String(body.candidate_id || body.assignment_id || ''), account);
    else if (action === 'organize-file') result = await organizeAnalyticalFile(orgId, missionId, String(body.file_id || ''), body.kind === 'review' ? 'review' : 'source', account);
    else if (action === 'import-review') result = await importAnalyticalReview(orgId, missionId, String(body.file_id || ''), account);
    else if (action === 'stage-files') result = await stageAnalyticalFiles(orgId, missionId, Array.isArray(body.file_ids) ? body.file_ids : [], account);
    else if (action === 'delete-file') result = await deleteAnalyticalFile(orgId, missionId, String(body.file_id || ''), account);
    else if (action === 'refresh-lab') result = await refreshEynowaKnowledge(orgId, missionId);
    else if (action === 'start') result = await startAnalyticalReview(orgId, req, missionId, account);
    else if (action === 'finalize') result = await finalizeAnalyticalReview(orgId, missionId, account);
    else return res.status(400).json({ error: 'UNKNOWN_ACTION' });
    return res.status(200).json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({ error: error.message || 'ANALYTICAL_REVIEW_UNAVAILABLE' });
  }
}
