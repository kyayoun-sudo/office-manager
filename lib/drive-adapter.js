// Drive adapter shared by the mission engine (lib/mission-engine.js), the
// Orpailleur memory (lib/orpailleur-memory.js), the agent tools and the owner
// endpoint. Engines receive it as a parameter so they stay testable offline.
import {
  configuredDriveId,
  copyDriveFile,
  createBinaryFile,
  downloadFileBuffer,
  exportAsPdf,
  findFilesByExactName,
  getDriveFileMetadata,
  getSheetFormulaMap,
  getSheetValues,
  listDriveChildren,
  listChangedSince,
  readDriveFileText,
  searchDriveFiles,
  updateBinaryFile,
  updateSheetValues
} from "./google-drive.js";

import { guardMemory } from './memory-files.js';
const rawGoogleAdapter = {
  getMeta: id => getDriveFileMetadata(id),
  listChildren: id => listDriveChildren(id),
  changedSince: (since, o) => listChangedSince(since, o),
  searchFiles: ({ query, mimeType, limit }) =>
    searchDriveFiles({ query, mimeType, limit }),
  readText: (id, options = {}) =>
    readDriveFileText(id, { ...options, maxChars: options.maxChars || 30000 }),
  copyFile: (id, name, parentId) => copyDriveFile(id, name, parentId),
  getValues: (id, range) => getSheetValues(id, range),
  getFormulaMap: (id, sheetName) => getSheetFormulaMap(id, sheetName),
  updateValues: (id, range, rows) => updateSheetValues(id, range, rows),
  findFilesByExactName: (name, parentId) => findFilesByExactName(name, parentId),
  downloadBuffer: id => downloadFileBuffer(id),
  createBinary: args => createBinaryFile(args),
  updateBinary: (id, args) => updateBinaryFile(id, args),
  exportPdf: (id, scratchFolderId) => exportAsPdf(id, scratchFolderId)
};
// Memory files: found again by id, never created twice, richest copy first (lib/memory-files.js, 2026-10-19).
const googleAdapter = guardMemory(rawGoogleAdapter);

// Existing Drive IDs keep the original provider. Local references are explicit and
// require the verified request context; background agents cannot inherit a user's rights.
import { isLocalId, currentLocalAdapter } from './local-storage.js';
export const driveAdapter = new Proxy(googleAdapter, {
  get(target, property) {
    const original = target[property];
    if (typeof original !== 'function') return original;
    return (...args) => {
      if (property === 'copyFile' && isLocalId(args[0]) !== isLocalId(args[2])) throw new Error('CROSS_PROVIDER_COPY_NOT_SUPPORTED');
      const id = property === 'createBinary' ? args[0]?.parentId : property === 'copyFile' ? args[2] : property === 'findFilesByExactName' ? args[1] : args[0];
      if (!isLocalId(id)) {
        if (typeof id === 'string' && id.startsWith('local:')) throw new Error('INVALID_LOCAL_REFERENCE');
        return original(...args);
      }
      const method = currentLocalAdapter()[property];
      if (typeof method !== 'function') throw new Error('LOCAL_OPERATION_NOT_SUPPORTED');
      if (property === 'copyFile' && !isLocalId(args[0])) throw new Error('CROSS_PROVIDER_COPY_NOT_SUPPORTED');
      return method(...args);
    };
  }
});
export { configuredDriveId };
