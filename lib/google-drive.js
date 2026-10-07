import { createSign } from "node:crypto";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { documentReadLimit, spreadsheetCellText } from "./document-reading.js";
import { isTestMode, testDrives } from "./test-mode.js";
import { connectedHas, firmConnected, firmDriveKind, connectionAccessToken, SCOPES, firmDriveId } from "./google-connection.js";

// LEGACY pilot fallbacks (TATY tenant). Kept only so the current deployment
// keeps working when the env vars are absent; new code must not add tenant IDs.
export const ALL_DRIVES_ROOT = "__all_drives__";
const SHARED_WITH_ME = "__shared_with_me__";
const DEFAULT_DRIVE_ID = "0AOuBC85x_FJSUk9PVA";
const DEFAULT_MASTER_SHEET_ID = "1UBKNbaYWI9MkkXR5NF1XDHGSmExOKIB_QeLUryxa-rc";

let tokenCache = null;

// In test mode the legacy fallbacks (REAL firm files) are never used, even for reading:
// a missing setting is an error, not a silent read of the real firm.
export function configuredDriveId() {
  // 1. the Drive chosen by the owner in Paramètres ("Drive du cabinet"), 2. the env setting.
  const chosen = firmDriveId();
  if (chosen) return chosen;
  if (process.env.TATY_SHARED_DRIVE_ID) return process.env.TATY_SHARED_DRIVE_ID;
  if (isTestMode()) throw new Error("TEST_MODE_DRIVE_ID_NOT_SET: TATY_SHARED_DRIVE_ID");
  return DEFAULT_DRIVE_ID;
}

export function masterSheetId() {
  if (process.env.TATY_MASTER_SHEET_ID) return process.env.TATY_MASTER_SHEET_ID;
  if (isTestMode()) throw new Error("TEST_MODE_DRIVE_ID_NOT_SET: TATY_MASTER_SHEET_ID");
  return DEFAULT_MASTER_SHEET_ID;
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function tokenFromServiceAccount(raw) {
  const account = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: account.client_email,
    scope: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets"
    ].join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3300
  }));

  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();

  const privateKey = String(account.private_key || "").replace(/\\n/g, "\n");
  const signature = signer.sign(privateKey).toString("base64url");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`GOOGLE_AUTH_FAILURE_${response.status}`);
  }

  return {
    token: data.access_token,
    expiresAt: Date.now() + 50 * 60 * 1000
  };
}

async function tokenFromRefreshToken() {
  const refresh = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const client = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!refresh || !client || !secret) return null;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: client,
      client_secret: secret
    })
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`GOOGLE_AUTH_FAILURE_${response.status}`);
  }

  return {
    token: data.access_token,
    expiresAt: Date.now() + 50 * 60 * 1000
  };
}

function directGoogleConfigured() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    (
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN &&
      process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
    ) ||
    // "Connecter Google" from Paramètres (loaded per request by loadGoogleConnection).
    connectedHas(SCOPES.drive)
  );
}

function googleBridgeConfigured() {
  return Boolean(
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.ORPAILLEUR_JOB_SECRET
  );
}

export function googleConnectionConfigured() {
  return directGoogleConfigured() || googleBridgeConfigured();
}

// Test run "TATY TEST" (2026-10-07): the Supabase bridge is bound to the REAL firm Drive
// (its own DRIVE_ID). A preview deployment works on the test copy only, through the
// direct access (GOOGLE_SERVICE_ACCOUNT_JSON): it never goes through the bridge.
export function bridgeForbiddenHere(env = process.env) {
  return isTestMode(env);
}

// Write guard of the test mode (added after the independent review of 2026-10-07):
// every Drive write — new file or folder under a parent, copy, sheet update/append/clear,
// file update, move — is checked against the Drive the target belongs to. In test mode
// it must be the TEST Shared Drive (TATY_SHARED_DRIVE_ID), never the real one
// (TEST_SOURCE_DRIVE_ID), whatever ID an agent, a copied document or an env var supplies.
// Outside test mode it does nothing (production unchanged).
const writeTargetCache = new Map();
export async function assertWritableTarget(id, { env = process.env, meta = null } = {}) {
  if (!isTestMode(env)) return;
  const { target, source } = testDrives(env);
  if (!target || (source && target === source)) throw new Error("TEST_MODE_TARGET_DRIVE_NOT_SET");
  const key = String(id || "");
  if (!key) throw new Error("TEST_MODE_WRITE_TARGET_REQUIRED");
  if (key === target) return;
  if (key === source) throw new Error("TEST_MODE_WRITE_TO_REAL_DRIVE_REFUSED");
  if (firmDriveKind() === "all") {
    // Whole Google Drive: anywhere but the real firm's protected Drive (TEST_SOURCE_DRIVE_ID).
    const m = meta ? await meta(key) : await googleRequest(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(key)}?supportsAllDrives=true&fields=id,driveId`
    );
    // Paul, 2026-10-07: « il doit pouvoir ranger partout » — with the whole Google Drive chosen,
    // the protected-source rule is lifted: every move still waits for « À valider ».
    void m; return;
  }
  if (firmDriveKind() === "folder") {
    // Root is a « Mon Drive » folder: the target must sit under it (parents walked up).
    if (await insideFolder(key, target, meta)) return;
    throw new Error("TEST_MODE_WRITE_OUTSIDE_TEST_DRIVE_REFUSED");
  }
  let driveId = writeTargetCache.get(key);
  if (driveId === undefined) {
    const m = meta ? await meta(key) : await googleRequest(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(key)}?supportsAllDrives=true&fields=id,driveId`
    );
    driveId = m?.driveId || null;
    writeTargetCache.set(key, driveId);
  }
  if (driveId !== target) throw new Error("TEST_MODE_WRITE_OUTSIDE_TEST_DRIVE_REFUSED");
}

const insideCache = new Map();
export async function insideFolder(id, rootId, meta = null) {
  let cur = String(id || ""), seen = 0;
  const path = [];
  while (cur && seen++ < 30) {
    if (cur === rootId) { path.forEach(p => insideCache.set(p + ">" + rootId, true)); return true; }
    const k = cur + ">" + rootId;
    if (insideCache.has(k)) { const v = insideCache.get(k); path.forEach(p => insideCache.set(p + ">" + rootId, v)); return v; }
    path.push(cur);
    const m = meta ? await meta(cur) : await googleRequest(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cur)}?supportsAllDrives=true&fields=id,parents`
    );
    cur = m?.parents?.[0] || "";
  }
  path.forEach(p => insideCache.set(p + ">" + rootId, false));
  return false;
}

// A folder just created under an already-checked parent is in the same Drive: remembered,
// so the copy does not re-check each new folder with an extra Google call.
export function trustCreatedChild(parentId, childId, env = process.env) {
  const { target } = testDrives(env);
  if (!childId) return;
  if (parentId === target || writeTargetCache.get(String(parentId)) === target) writeTargetCache.set(String(childId), target);
  if (parentId === target || insideCache.get(String(parentId) + ">" + target)) insideCache.set(String(childId) + ">" + target, true);
}

async function bridgeRequest(action, payload = {}) {
  if (bridgeForbiddenHere()) {
    throw new Error("PREVIEW_BRIDGE_FORBIDDEN: the test works on the Drive copy through GOOGLE_SERVICE_ACCOUNT_JSON only");
  }
  if (!googleBridgeConfigured()) {
    throw new Error("GOOGLE_CONNECTION_REQUIRED");
  }
  const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.ORPAILLEUR_JOB_SECRET;
  const response = await fetch(`${base}/functions/v1/taty-google-bridge`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "x-orpailleur-secret": secret,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, ...payload })
  });
  const raw = await response.text();
  let data = raw;
  if (raw) {
    try { data = JSON.parse(raw); } catch {}
  }
  if (!response.ok) {
    throw new Error(
      `GOOGLE_BRIDGE_${response.status}: ${
        typeof data === "string"
          ? data.slice(0, 400)
          : JSON.stringify(data).slice(0, 400)
      }`
    );
  }
  if (data?.error) throw new Error(String(data.error));
  return data;
}

export async function googleAccessToken() {
  // The firm's own Google account (connected by its owner in the app) comes first: each firm
  // works with its own Drive, whatever access the server was configured with.
  if (firmConnected()) return connectionAccessToken();
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.token;
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    tokenCache = await tokenFromServiceAccount(
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON
    );
    return tokenCache.token;
  }

  const refreshed = await tokenFromRefreshToken();
  if (refreshed) {
    tokenCache = refreshed;
    return tokenCache.token;
  }

  // The firm's Google account connected by the owner in Paramètres.
  if (connectedHas(SCOPES.drive)) return connectionAccessToken();

  throw new Error(
    "GOOGLE_CONNECTION_REQUIRED: configure GOOGLE_SERVICE_ACCOUNT_JSON or OAuth refresh credentials in Vercel"
  );
}

async function googleRequest(url, options = {}) {
  const token = await googleAccessToken();

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  const raw = await response.text();
  let data = raw;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {}
  }

  if (!response.ok) {
    throw new Error(
      `GOOGLE_API_${response.status}: ${
        typeof data === "string"
          ? data.slice(0, 400)
          : JSON.stringify(data).slice(0, 400)
      }`
    );
  }

  return data;
}

function escapeQ(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function driveFilesParams(params = {}) {
  const output = new URLSearchParams({
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    spaces: "drive",
    ...params
  });

  const driveId = configuredDriveId();
  if (firmDriveKind() === "folder" || firmDriveKind() === "all") {
    // The firm's Drive is a folder of « Mon Drive », or the whole Google Drive.
    output.set("corpora", "allDrives");
  } else if (driveId) {
    output.set("corpora", "drive");
    output.set("driveId", driveId);
  }

  return output;
}

export async function searchDriveFiles({
  query = "",
  parentId = null,
  mimeType = null,
  limit = 50
} = {}) {
  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    const data = await bridgeRequest("search_files", {
      query,
      parent_id: parentId,
      mime_type: mimeType,
      limit
    });
    return data.files || [];
  }

  const clauses = ["trashed = false"];

  if (parentId) {
    clauses.push(`'${escapeQ(parentId)}' in parents`);
  }

  if (mimeType) {
    clauses.push(`mimeType = '${escapeQ(mimeType)}'`);
  }

  if (query) {
    const q = escapeQ(query);
    clauses.push(`(name contains '${q}' or fullText contains '${q}')`);
  }

  const params = driveFilesParams({
    q: clauses.join(" and "),
    pageSize: String(
      Math.min(Math.max(Number(limit) || 50, 1), 100)
    ),
    orderBy: "modifiedTime desc",
    fields:
      "files(id,name,mimeType,parents,modifiedTime,createdTime,webViewLink,size,description),nextPageToken,incompleteSearch"
  });

  const data = await googleRequest(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`
  );

  return data.files || [];
}

export async function getDriveFileMetadata(fileId) {
  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    return bridgeRequest("file_metadata", { file_id: fileId });
  }

  const params = new URLSearchParams({
    supportsAllDrives: "true",
    fields:
      "id,name,mimeType,parents,modifiedTime,createdTime,webViewLink,size,description,driveId,trashed,md5Checksum"
  });

  return googleRequest(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}?${params.toString()}`
  );
}


async function extractOfficeBuffer(meta, buffer, limit, mimeOverride = null) {
  const mime = mimeOverride || meta.mimeType || "";

  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const extracted = await mammoth.extractRawText({ buffer });
    const text = extracted.value || "";
    return {
      supported: true,
      extractor: "mammoth-docx",
      file: meta,
      text: text.slice(0, limit),
      truncated: text.length > limit,
      warnings: extracted.messages || []
    };
  }

  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const chunks = [];
    workbook.eachSheet(worksheet => {
      chunks.push(`--- SHEET: ${worksheet.name} ---`);
      worksheet.eachRow({ includeEmpty: false }, row => {
        const values = [];
        for (let i = 1; i <= row.cellCount; i += 1) {
          const cell = row.getCell(i);
          const value = spreadsheetCellText(cell);
          values.push(value || "");
        }
        chunks.push(values.join("\t"));
      });
    });
    const text = chunks.join("\n");
    return {
      supported: true,
      extractor: "exceljs-xlsx",
      file: meta,
      text: text.slice(0, limit),
      truncated: text.length > limit,
      sheet_count: workbook.worksheets.length
    };
  }

  return {
    supported: false,
    file: meta,
    reason: `No safe text extractor configured yet for MIME type ${mime}`
  };
}

export async function readDriveFileText(
  fileId,
  { maxChars = 30000 } = {}
) {
  const meta = await getDriveFileMetadata(fileId);
  const mime = meta.mimeType || "";
  const limit = documentReadLimit(maxChars);

  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    const data = await bridgeRequest("read_file", {
      file_id: fileId,
      max_bytes: 8000000
    });
    if (data.mode === "text") {
      const text = String(data.text || "");
      return {
        supported: true,
        extractor: "supabase-google-bridge-text",
        file: data.file || meta,
        text: text.slice(0, limit),
        truncated: text.length > limit
      };
    }
    if (data.mode === "base64" && data.base64) {
      return extractOfficeBuffer(
        data.file || meta,
        Buffer.from(data.base64, "base64"),
        limit,
        data.mime_type || meta.mimeType
      );
    }
    return {
      supported: false,
      file: data.file || meta,
      reason: "Google bridge returned no readable content"
    };
  }

  async function fetchBuffer(url) {
    const token = await googleAccessToken();
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`GOOGLE_CONTENT_READ_${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  if (mime === "application/vnd.google-apps.document") {
    const url =
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}/export?mimeType=text%2Fplain`;
    const token = await googleAccessToken();
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`GOOGLE_CONTENT_READ_${response.status}`);
    }
    const text = await response.text();
    return {
      supported: true,
      extractor: "google-docs-text",
      file: meta,
      text: text.slice(0, limit),
      truncated: text.length > limit
    };
  }

  if (
    mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const buffer = await fetchBuffer(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?alt=media&supportsAllDrives=true`
    );
    const extracted = await mammoth.extractRawText({ buffer });
    const text = extracted.value || "";
    return {
      supported: true,
      extractor: "mammoth-docx",
      file: meta,
      text: text.slice(0, limit),
      truncated: text.length > limit,
      warnings: extracted.messages || []
    };
  }

  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.google-apps.spreadsheet"
  ) {
    const url = mime === "application/vnd.google-apps.spreadsheet"
      ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          fileId
        )}/export?mimeType=${encodeURIComponent(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )}`
      : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          fileId
        )}?alt=media&supportsAllDrives=true`;

    const buffer = await fetchBuffer(url);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const chunks = [];

    workbook.eachSheet(worksheet => {
      chunks.push(`--- SHEET: ${worksheet.name} ---`);
      worksheet.eachRow({ includeEmpty: false }, row => {
        const values = [];
        for (let i = 1; i <= row.cellCount; i += 1) {
          const cell = row.getCell(i);
          const value = spreadsheetCellText(cell);
          values.push(value || "");
        }
        chunks.push(values.join("\t"));
      });
    });

    const text = chunks.join("\n");
    return {
      supported: true,
      extractor: "exceljs-xlsx",
      file: meta,
      text: text.slice(0, limit),
      truncated: text.length > limit,
      sheet_count: workbook.worksheets.length
    };
  }

  if (mime.startsWith("text/") || mime === "application/json") {
    const url =
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?alt=media&supportsAllDrives=true`;
    const token = await googleAccessToken();
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`GOOGLE_CONTENT_READ_${response.status}`);
    }
    const text = await response.text();
    return {
      supported: true,
      extractor: "plain-text",
      file: meta,
      text: text.slice(0, limit),
      truncated: text.length > limit
    };
  }

  return {
    supported: false,
    file: meta,
    reason:
      `No safe text extractor configured yet for MIME type ${mime}`
  };
}

export async function getSheetValues(spreadsheetId, range) {
  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    const data = await bridgeRequest("sheet_get", {
      spreadsheet_id: spreadsheetId,
      range
    });
    return data.values || [];
  }

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;

  const data = await googleRequest(url);
  return data.values || [];
}

// Downloads a native Google Sheet as xlsx (direct API or the existing bridge
// read_file action, which already exports Sheets as xlsx).
async function downloadSpreadsheetAsXlsx(spreadsheetId) {
  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    const data = await bridgeRequest("read_file", {
      file_id: spreadsheetId,
      max_bytes: 8000000
    });
    if (data.mode !== "base64" || !data.base64) {
      throw new Error("SPREADSHEET_EXPORT_UNAVAILABLE");
    }
    return Buffer.from(data.base64, "base64");
  }

  const token = await googleAccessToken();
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      spreadsheetId
    )}/export?mimeType=${encodeURIComponent(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) {
    throw new Error(`GOOGLE_CONTENT_READ_${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// Returns the sheet names and the A1 addresses of formula cells of one sheet
// (by name, or the first sheet). Used before any write, so that a value is
// never written over a formula. Works in direct and bridge modes.
export async function getSheetFormulaMap(spreadsheetId, sheetName = null) {
  const buffer = await downloadSpreadsheetAsXlsx(spreadsheetId);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheetNames = workbook.worksheets.map(ws => ws.name);
  const worksheet = sheetName
    ? workbook.getWorksheet(sheetName)
    : workbook.worksheets[0];

  if (!worksheet) {
    return { sheetNames, sheetName: null, formulaCells: [] };
  }

  const formulaCells = [];
  worksheet.eachRow({ includeEmpty: false }, row => {
    row.eachCell({ includeEmpty: false }, cell => {
      const isFormula =
        cell.type === ExcelJS.ValueType.Formula ||
        Boolean(cell.formula) ||
        Boolean(cell.sharedFormula) ||
        Boolean(cell.value && typeof cell.value === "object" &&
          ("formula" in cell.value || "sharedFormula" in cell.value));
      if (isFormula) formulaCells.push(cell.address);
    });
  });

  return { sheetNames, sheetName: worksheet.name, formulaCells };
}

export async function updateSheetValues(
  spreadsheetId,
  range,
  values
) {
  await assertWritableTarget(spreadsheetId);
  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    return bridgeRequest("sheet_update", {
      spreadsheet_id: spreadsheetId,
      range,
      values
    });
  }

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(
      range
    )}?valueInputOption=USER_ENTERED`;

  return googleRequest(url, {
    method: "PUT",
    body: JSON.stringify({
      range,
      majorDimension: "ROWS",
      values
    })
  });
}

export async function appendSheetValues(
  spreadsheetId,
  range,
  values
) {
  await assertWritableTarget(spreadsheetId);
  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    return bridgeRequest("sheet_append", {
      spreadsheet_id: spreadsheetId,
      range,
      values
    });
  }

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(
      range
    )}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  return googleRequest(url, {
    method: "POST",
    body: JSON.stringify({
      range,
      majorDimension: "ROWS",
      values
    })
  });
}

export async function clearSheetRange(spreadsheetId, range) {
  await assertWritableTarget(spreadsheetId);
  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    return bridgeRequest("sheet_clear", {
      spreadsheet_id: spreadsheetId,
      range
    });
  }

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}:clear`;

  return googleRequest(url, {
    method: "POST",
    body: JSON.stringify({})
  });
}

function columnLetter(number) {
  let n = number;
  let out = "";

  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }

  return out;
}

export async function upsertSheetRow({
  spreadsheetId,
  sheetName,
  key,
  rowValues
}) {
  const width = rowValues.length;
  const lastCol = columnLetter(width);
  const rows = await getSheetValues(
    spreadsheetId,
    `${sheetName}!A1:${lastCol}3000`
  );

  let rowNumber = -1;

  for (let i = 1; i < rows.length; i += 1) {
    if (String(rows[i]?.[0] || "") === String(key)) {
      rowNumber = i + 1;
      break;
    }
  }

  if (rowNumber > 0) {
    await updateSheetValues(
      spreadsheetId,
      `${sheetName}!A${rowNumber}:${lastCol}${rowNumber}`,
      [rowValues]
    );

    return { action: "updated", rowNumber };
  }

  await appendSheetValues(
    spreadsheetId,
    `${sheetName}!A:${lastCol}`,
    [rowValues]
  );

  return { action: "inserted", rowNumber: null };
}

// ---------------------------------------------------------------------------
// Binary files (Office Manager memory: OFFICE_MANAGER_MAP.xlsx /
// OFFICE_MANAGER_REGISTER.xlsx)
// ---------------------------------------------------------------------------

export function directGoogleAccess() {
  return directGoogleConfigured();
}

// Single size limit of the memory files (OFFICE_MANAGER_MAP / _REGISTER),
// identical to MEMORY_BINARY_MAX_BYTES of the bridge (binary-files.ts):
// a file accepted on write is always readable back.
export const MEMORY_BINARY_MAX_BYTES = 10 * 1024 * 1024;

// Reads a memory file as bytes. Works in direct mode and through the existing
// bridge (read_file returns base64 for non-Google files).
export async function downloadFileBuffer(fileId) {
  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    const data = await bridgeRequest("read_file", {
      file_id: fileId,
      max_bytes: MEMORY_BINARY_MAX_BYTES
    });
    if (data.mode !== "base64" || !data.base64) {
      throw new Error("BINARY_READ_UNAVAILABLE");
    }
    return Buffer.from(data.base64, "base64");
  }
  const token = await googleAccessToken();
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) throw new Error(`GOOGLE_CONTENT_READ_${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MEMORY_BINARY_MAX_BYTES) throw new Error("MEMORY_FILE_TOO_LARGE");
  return buffer;
}

// Exact-name lookup inside one folder: a Drive query on the exact name,
// following nextPageToken to the end (never limited to a first page of
// children). Bridge mode uses the read-only find_exact_file action.
export async function findFilesByExactName(name, parentId) {
  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    const data = await bridgeRequest("find_exact_file", { parent_id: parentId, name });
    return data.files || [];
  }

  const files = [];
  let pageToken = null;
  do {
    const params = driveFilesParams({
      q: `'${escapeQ(parentId)}' in parents and name = '${escapeQ(name)}' and trashed = false`,
      pageSize: "1000",
      fields: "files(id,name,mimeType,parents,modifiedTime,createdTime,webViewLink,size),nextPageToken"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await googleRequest(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return files.filter(
    item => item.mimeType !== "application/vnd.google-apps.folder" && item.name === name
  );
}

// Binary create / in-place update. Callers (the memory engine) do not know
// whether the direct Google API or the Supabase bridge is used: both enforce
// "create once" and "update the same file_id only if unchanged since read".
export async function createBinaryFile({ name, parentId, buffer, mimeType }) {
  await assertWritableTarget(parentId);
  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    return bridgeRequest("create_binary_file", {
      parent_id: parentId,
      name,
      mime_type: mimeType,
      base64: Buffer.from(buffer).toString("base64"),
      expected_name: name
    });
  }

  const existing = await findFilesByExactName(name, parentId);
  if (existing.length) throw new Error(`FILE_ALREADY_EXISTS: ${name}`);
  const token = await googleAccessToken();
  const boundary = `om-${Date.now().toString(36)}`;
  const metadata = JSON.stringify({ name, parents: [parentId], mimeType });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`)
  ]);
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,parents,modifiedTime,createdTime,webViewLink,size",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GOOGLE_UPLOAD_${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

// Replaces the content of an EXISTING file in place: same file_id, no new
// file. expectedModifiedTime is mandatory: on mismatch -> MEMORY_CONFLICT and
// nothing is written.
export async function updateBinaryFile(fileId, { buffer, mimeType, expectedModifiedTime }) {
  if (!expectedModifiedTime) throw new Error("EXPECTED_MODIFIED_TIME_REQUIRED");
  await assertWritableTarget(fileId);

  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    return bridgeRequest("update_binary_file", {
      file_id: fileId,
      mime_type: mimeType,
      base64: Buffer.from(buffer).toString("base64"),
      expected_modified_time: expectedModifiedTime
    });
  }

  const current = await getDriveFileMetadata(fileId);
  if (current.modifiedTime !== expectedModifiedTime) {
    throw new Error(`MEMORY_CONFLICT: expected ${expectedModifiedTime}, current ${current.modifiedTime}`);
  }
  const token = await googleAccessToken();
  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true&fields=id,name,mimeType,parents,modifiedTime,createdTime,webViewLink,size`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
      body: buffer
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GOOGLE_UPLOAD_${response.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return getDriveFileMetadata(fileId);
}

export async function listDriveChildren(parentId) {
  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    const data = await bridgeRequest("list_children", {
      parent_id: parentId
    });
    // The existing bridge bounds this action at 1000 entries and does not
    // expose its pagination cursor. Conservatively refuse an ambiguous bound.
    if (data.nextPageToken || data.incompleteSearch || (data.files || []).length >= 1000) {
      throw new Error("DRIVE_LISTING_INCOMPLETE");
    }
    return data.files || [];
  }

  // « Tout le Google Drive » (firm setting): the virtual root lists « Mon Drive » and every
  // shared drive the connected account can see, as top folders.
  if (parentId === ALL_DRIVES_ROOT) {
    const out = [
      { id: "root", name: "Mon Drive", mimeType: "application/vnd.google-apps.folder", parents: [ALL_DRIVES_ROOT] },
      { id: SHARED_WITH_ME, name: "Partagés avec moi", mimeType: "application/vnd.google-apps.folder", parents: [ALL_DRIVES_ROOT] }
    ];
    let token = null;
    do {
      const data = await googleRequest(`https://www.googleapis.com/drive/v3/drives?pageSize=100&fields=drives(id,name),nextPageToken${token ? "&pageToken=" + encodeURIComponent(token) : ""}`);
      for (const d of data.drives || []) out.push({ id: d.id, name: d.name, mimeType: "application/vnd.google-apps.folder", parents: [ALL_DRIVES_ROOT] });
      token = data.nextPageToken || null;
    } while (token);
    return out;
  }

  const base = driveFilesParams({
    q: `'${escapeQ(parentId)}' in parents and trashed = false`,
    pageSize: "1000",
    fields:
      "files(id,name,mimeType,parents,modifiedTime,createdTime,webViewLink,size,md5Checksum),nextPageToken,incompleteSearch"
  });
  if (parentId === SHARED_WITH_ME) {
    base.set("q", "sharedWithMe = true and trashed = false");
    base.set("corpora", "user"); base.delete("driveId");
  } else if (firmDriveKind() === "all") {
    // Scope each listing to the drive of the folder (an all-drives search can be partial).
    if (parentId === "root") base.set("corpora", "user");
    else {
      const meta = await googleRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(parentId)}?supportsAllDrives=true&fields=id,driveId`).catch(() => null);
      const owner = meta?.driveId || (meta ? null : parentId); // a shared drive id is its own root
      if (owner) { base.set("corpora", "drive"); base.set("driveId", owner); } else base.set("corpora", "user");
    }
  }

  const all = [];
  let pageToken = null;

  do {
    if (pageToken) {
      base.set("pageToken", pageToken);
    } else {
      base.delete("pageToken");
    }

    const data = await googleRequest(
      `https://www.googleapis.com/drive/v3/files?${base.toString()}`
    );

    if (data.incompleteSearch) throw new Error("DRIVE_LISTING_INCOMPLETE");
    all.push(...(data.files || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken && all.length < 5000);

  if (pageToken) throw new Error("DRIVE_LISTING_INCOMPLETE");
  return all;
}

async function createDriveFolder(name, parentId) {
  await assertWritableTarget(parentId);
  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    return bridgeRequest("create_folder", {
      name,
      parent_id: parentId
    });
  }

  const params = new URLSearchParams({
    supportsAllDrives: "true",
    fields: "id,name,mimeType,parents,webViewLink"
  });

  return googleRequest(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId]
      })
    }
  );
}

export async function copyDriveFile(fileId, name, parentId) {
  await assertWritableTarget(parentId);
  if (!directGoogleConfigured() && googleBridgeConfigured()) {
    return bridgeRequest("copy_file", {
      file_id: fileId,
      name,
      parent_id: parentId
    });
  }

  const params = new URLSearchParams({
    supportsAllDrives: "true",
    fields: "id,name,mimeType,parents,webViewLink"
  });

  return googleRequest(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}/copy?${params.toString()}`,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        parents: [parentId]
      })
    }
  );
}


export async function ensureFileCopyFromTemplate({
  templateFileId,
  destinationParentId,
  destinationName
}) {
  const children = await listDriveChildren(destinationParentId);
  const existing = children.find(
    item =>
      item.mimeType !== "application/vnd.google-apps.folder" &&
      item.name === destinationName
  );

  if (existing) {
    return { file: existing, created: false };
  }

  return {
    file: await copyDriveFile(
      templateFileId,
      destinationName,
      destinationParentId
    ),
    created: true
  };
}

async function ensureFolder(name, parentId) {
  const children = await listDriveChildren(parentId);

  const existing = children.find(
    item =>
      item.mimeType === "application/vnd.google-apps.folder" &&
      item.name === name
  );

  if (existing) {
    return { folder: existing, created: false };
  }

  return {
    folder: await createDriveFolder(name, parentId),
    created: true
  };
}

// foldersOnly=true creates the mission skeleton (folder tree) WITHOUT copying
// any file. Mission work products must be created by the programme-driven
// engine (lib/mission-engine.js), never by copying a whole template library.
export async function syncFolderFromTemplate({
  templateFolderId,
  destinationParentId,
  destinationName,
  maxItems = 250,
  foldersOnly = false
}) {
  const root = await ensureFolder(
    destinationName,
    destinationParentId
  );

  const stats = {
    foldersCreated: root.created ? 1 : 0,
    filesCopied: 0,
    skippedExisting: 0,
    processed: 0,
    filesNotCopied: []
  };

  async function sync(sourceFolderId, targetFolderId, depth = 0) {
    if (depth > 10) {
      throw new Error("TEMPLATE_DEPTH_LIMIT_EXCEEDED");
    }

    const sourceChildren = await listDriveChildren(sourceFolderId);
    const targetChildren = await listDriveChildren(targetFolderId);

    for (const child of sourceChildren) {
      stats.processed += 1;

      if (stats.processed > maxItems) {
        throw new Error("TEMPLATE_ITEM_LIMIT_EXCEEDED");
      }

      if (
        child.mimeType === "application/vnd.google-apps.folder"
      ) {
        let target = targetChildren.find(
          item =>
            item.mimeType ===
              "application/vnd.google-apps.folder" &&
            item.name === child.name
        );

        if (!target) {
          target = await createDriveFolder(
            child.name,
            targetFolderId
          );
          stats.foldersCreated += 1;
        } else {
          stats.skippedExisting += 1;
        }

        await sync(child.id, target.id, depth + 1);
      } else {
        if (foldersOnly) {
          if (stats.filesNotCopied.length < 200) {
            stats.filesNotCopied.push({
              id: child.id,
              name: child.name,
              mimeType: child.mimeType
            });
          }
          continue;
        }

        const exists = targetChildren.some(
          item =>
            item.mimeType !==
              "application/vnd.google-apps.folder" &&
            item.name === child.name
        );

        if (exists) {
          stats.skippedExisting += 1;
          continue;
        }

        await copyDriveFile(
          child.id,
          child.name,
          targetFolderId
        );

        stats.filesCopied += 1;
      }
    }
  }

  await sync(templateFolderId, root.folder.id, 0);

  return {
    root: root.folder,
    ...stats
  };
}
