import { stepSources } from './step-runner.js';
import { driveAdapter } from './drive-adapter.js';
import { readDocumentWindow } from './document-content.js';

// The shared read-only tool boundary used by all operational SDK agents.
export async function inspectMissionDocuments(org, account, input, d = {}) {
  if (account) await (d.requireMissionAccess || (await import('./mission-access.js')).requireMissionAccess)(org, input.mission_id, account);
  const documents = await (d.sources || stepSources)(org, input.mission_id, { ...d, strictSources: true });
  if (input.file_id) {
    const doc = documents.find(f => f.file_id === input.file_id);
    if (!doc) throw new Error('PIECE_NOT_IN_MISSION');
    return (d.readDocumentWindow || readDocumentWindow)({ ...doc, id: doc.file_id }, d.drive || driveAdapter, input, d);
  }
  const page = input.catalog_page || 0;
  if (!Number.isInteger(page) || page < 0) throw new Error('CATALOG_PAGE_OUT_OF_RANGE');
  return { documents: documents.slice(page * 30, (page + 1) * 30), total: documents.length, page,
    next_page: (page + 1) * 30 < documents.length ? page + 1 : null, note: 'Names and roles are hints; request actual contents.' };
}
