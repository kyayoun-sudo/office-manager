// Drive adapter shared by the mission engine (lib/mission-engine.js), the
// Orpailleur memory (lib/orpailleur-memory.js), the agent tools and the owner
// endpoint. Engines receive it as a parameter so they stay testable offline.
import {
  configuredDriveId,
  copyDriveFile,
  createBinaryFile,
  downloadFileBuffer,
  findFilesByExactName,
  getDriveFileMetadata,
  getSheetFormulaMap,
  getSheetValues,
  listDriveChildren,
  readDriveFileText,
  searchDriveFiles,
  updateBinaryFile,
  updateSheetValues
} from "./google-drive.js";

export const driveAdapter = {
  getMeta: id => getDriveFileMetadata(id),
  listChildren: id => listDriveChildren(id),
  searchFiles: ({ query, mimeType, limit }) =>
    searchDriveFiles({ query, mimeType, limit }),
  readText: (id, { maxChars } = {}) =>
    readDriveFileText(id, { maxChars: maxChars || 30000 }),
  copyFile: (id, name, parentId) => copyDriveFile(id, name, parentId),
  getValues: (id, range) => getSheetValues(id, range),
  getFormulaMap: (id, sheetName) => getSheetFormulaMap(id, sheetName),
  updateValues: (id, range, rows) => updateSheetValues(id, range, rows),
  findFilesByExactName: (name, parentId) => findFilesByExactName(name, parentId),
  downloadBuffer: id => downloadFileBuffer(id),
  createBinary: args => createBinaryFile(args),
  updateBinary: (id, args) => updateBinaryFile(id, args)
};

export { configuredDriveId };
