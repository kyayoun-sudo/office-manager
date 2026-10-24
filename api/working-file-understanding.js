import ExcelJS from 'exceljs';
import { requirePilotAccess } from '../lib/auth.js';
import { resolveRequestOrg } from '../lib/firm-context.js';
import { currentAccount, logAccess } from '../lib/user-auth.js';
import { requireMissionAccess } from '../lib/mission-access.js';
import { procedureView } from '../lib/procedure-work.js';
import { driveAdapter } from '../lib/drive-adapter.js';
import { stepSources } from '../lib/step-runner.js';
import { understandWorkingFile } from '../lib/working-file-understanding.js';

const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });

// Read-only Working File understanding endpoint.
// It deliberately uses the same authenticated mission-access path as the existing procedure workspace.
// It does not write to Drive, Supabase or the Working File, so it must not be blocked by the preview-only
// write-isolation guard used by destructive/test-run operations.
// Preview runtime refreshed after internal-colleague mail sandbox configuration update.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    requirePilotAccess(req);
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    const orgId = await resolveRequestOrg(req);
    if (!orgId) throw fail('DEFAULT_ORG_ID_MISSING', 500);
    const account = await currentAccount(req);
    const input = req.method === 'GET' ? req.query : (req.body || {});
    const missionId = String(input.mission_id || '').trim();
    const code = String(input.code || '').trim();
    if (!missionId || !code) throw fail('MISSION_AND_CODE_REQUIRED', 400);
    await requireMissionAccess(orgId, missionId, account);

    const view = await procedureView(orgId, missionId, code, account, { refreshSop: true });
    if (!view.workpaper?.file_id) throw fail('NO_WORKPAPER_FOR_CYCLE', 409);
    const buffer = await driveAdapter.downloadBuffer(view.workpaper.file_id);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(buffer));
    const sopSteps = (view.card?.steps || []).filter(s => !s.common).map((s, i) => ({ n: i + 1, text: s.text || String(s), source: 'sop' }));
    const sources = await stepSources(orgId, missionId).catch(() => []);
    const understanding = understandWorkingFile(wb, { procedureCode: code, sopSteps, sources });
    await logAccess(orgId, account, 'WORKING_FILE_UNDERSTANDING', `${missionId}:${code}`).catch(() => null);
    return res.status(200).json({ understanding });
  } catch (error) {
    const status = error.statusCode || 500;
    // Preserve actionable read-only errors instead of hiding every non-4xx behind one generic message.
    const known = ['DEFAULT_ORG_ID_MISSING', 'NO_WORKPAPER_FOR_CYCLE', 'MISSION_AND_CODE_REQUIRED', 'NOT_ON_THIS_MISSION'];
    const safe = status < 500 || known.includes(error.message) ? error.message : 'WORKING_FILE_UNDERSTANDING_UNAVAILABLE';
    return res.status(status).json({ error: safe });
  }
}
