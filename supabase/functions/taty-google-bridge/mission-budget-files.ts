import { BridgeError, googleBinaryDeps, XLSX_MIME } from './binary-files.ts';

const fail = (code: string) => { throw new BridgeError(code, 409); };
export async function createMissionBudgetAction(deps: any, body: any) {
  if (body.org_id !== deps.orgId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.budget_id || '')) fail('BUDGET_SCOPE_INVALID');
  const budget = await deps.getBudget(body.org_id, body.budget_id);
  const decision = await deps.getDecision(body.org_id, body.budget_id);
  if (!budget || decision?.decision !== 'approve' || decision.content_hash !== budget.content_hash || body.content_hash !== budget.content_hash) fail('BUDGET_APPROVAL_REQUIRED');
  if (!(await deps.sourcesCurrent(body.org_id, budget))) fail('BUDGET_SOURCE_CHANGED');
  const folder = await deps.getMetadata(budget.data.destination_parent_id);
  if (!folder || folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder' || folder.driveId !== deps.driveId) fail('OUTSIDE_FIRM_DRIVE');
  if (!(await deps.folderLinked(body.org_id, budget.office_mission_id, folder.id))) fail('BUDGET_FOLDER_NOT_LINKED_TO_MISSION');
  const name = 'MISSION_BUDGET_' + body.budget_id + '.xlsx';
  const encoded = String(body.base64 || '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 2800000) fail('INVALID_BUDGET_BINARY');
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  if (bytes[0] !== 80 || bytes[1] !== 75) fail('INVALID_BUDGET_BINARY');
  const existing = await deps.findExact(folder.id, name);
  if (existing.length) fail('BUDGET_FILE_ALREADY_EXISTS');
  // One immutable database claim per budget prevents concurrent duplicate uploads.
  // Failed uploads remain claimed: recovery must verify Drive before a retry.
  if (!(await deps.claimBudget(body.org_id, body.budget_id, budget.content_hash))) fail('BUDGET_EXPORT_ALREADY_CLAIMED');
  const currentDecision = await deps.getDecision(body.org_id, body.budget_id);
  if (currentDecision?.decision !== 'approve' || currentDecision.content_hash !== budget.content_hash) fail('BUDGET_APPROVAL_REQUIRED');
  if (!(await deps.sourcesCurrent(body.org_id, budget))) fail('BUDGET_SOURCE_CHANGED');
  const created = await deps.uploadCreate({ name, parentId: folder.id, mimeType: XLSX_MIME, bytes });
  const verified = await deps.getMetadata(created.id);
  if (verified?.trashed || verified?.mimeType !== XLSX_MIME || !verified?.parents?.includes(folder.id) || verified.driveId !== deps.driveId || verified.name !== name) fail('BUDGET_UPLOAD_NOT_VERIFIED');
  return { id: verified.id, name: verified.name, parents: verified.parents };
}

export function budgetGoogleDeps(gfetch: any, driveId: string) {
  return googleBinaryDeps(gfetch, driveId);
}
