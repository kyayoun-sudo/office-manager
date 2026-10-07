import { BridgeError } from './binary-files.ts';

const FOLDER = 'application/vnd.google-apps.folder';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code: string) => { throw new BridgeError(code, 409); };

// Destination and file come from the approved internal item, never arbitrary
// caller-supplied IDs. No content, renaming, permissions or deletion operations.
export async function tidyMoveAction(deps: any, body: any) {
  if (body.org_id !== deps.orgId || !UUID.test(body.item_id || '') || !UUID.test(body.request_id || '')) fail('TIDY_SCOPE_INVALID');
  const item = await deps.getItem(body.org_id, body.request_id, body.item_id);
  const request = await deps.getRequest(body.org_id, body.request_id);
  if (!item || !request) fail('TIDY_ITEM_NOT_FOUND');
  const undo = body.undo === true;
  if (undo ? item.status !== 'moved' : (item.status !== 'approved' || item.error !== 'EN_COURS' || request.status !== 'executing')) fail('TIDY_MOVE_NOT_APPROVED');
  const from = undo ? item.dest_folder_id : item.current_parent_id;
  const to = undo ? item.previous_parent_id : item.dest_folder_id;
  if (!from || !to || from === to) fail('TIDY_PARENTS_INVALID');
  const file = await deps.getMetadata(item.file_id);
  const destination = to === deps.driveId ? { id: to, mimeType: FOLDER, driveId: deps.driveId, trashed: false } : await deps.getMetadata(to);
  if (!file || !destination || file.trashed || destination.trashed) fail('FILE_GONE');
  if (file.driveId !== deps.driveId || destination.driveId !== deps.driveId) fail('OUTSIDE_FIRM_DRIVE');
  if (file.mimeType === FOLDER || file.mimeType === 'application/vnd.google-apps.shortcut' || destination.mimeType !== FOLDER) fail('TIDY_FILE_TYPE_INVALID');
  if (/^OFFICE_MANAGER_(MAP|REGISTER)\.xlsx$/i.test(file.name || '')) fail('MEMORY_MOVE_REFUSED');
  const parents = file.parents || [];
  if (!parents.includes(from)) {
    if (parents.includes(to)) return { id: file.id, parents, already_moved: true };
    fail('MOVED_MEANWHILE');
  }
  await deps.move(file.id, from, to);
  const verified = await deps.getMetadata(file.id);
  if (!verified?.parents?.includes(to) || verified.parents.includes(from)) fail('MOVE_NOT_VERIFIED');
  return { id: verified.id, parents: verified.parents };
}
