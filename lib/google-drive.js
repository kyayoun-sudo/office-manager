import { createSign } from "node:crypto";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { documentReadLimit, spreadsheetCellText } from "./document-reading.js";
import { extractPdfText, PDF_MIME } from "./pdf-reading.js";
import { extractStructuredOffice, STRUCTURED_MIMES } from './structured-reading.js';
import { decodeDocumentText, extractCsv } from './tabular-text-reading.js';
import { readStructuredGoogleSheet } from './google-sheet-reader.js';
import { boundedResponseBytes } from './bounded-content.js';
import { isTestMode, testDrives } from "./test-mode.js";
import { connectedHas, firmConnected, firmDriveKind, connectionAccessToken, SCOPES, firmDriveId } from "./google-connection.js";

// LEGACY pilot fallbacks (TATY tenant). Kept only so the current deployment
// keeps working when the env vars are absent; new code must not add tenant IDs.
export const ALL_DRIVES_ROOT = "__all_drives__";
const SHARED_WITH_ME = "__shared_with_me__";
const DEFAULT_MASTER_SHEET_ID = "1UBKNbaYWI9MkkXR5NF1XDHGSmExOKIB_QeLUryxa-rc";

let tokenCache = null;

// In test mode the legacy fallbacks (REAL firm files) are never used, even for reading:
// a missing setting is an error, not a silent read of the real firm.
// ONE Drive: the one the firm chose in Paramètres (2026-10-09, Paul: « il a les data d'un autre
// Drive, pas de celui sur lequel je l'ai mis »). The agents used to fall back SILENTLY on a server
// setting or on an old hard-coded Drive when the firm's choice was not found (e.g. after the
// organisation changed): they then read and wrote another Drive. Now, outside a preview, no choice
// = an explicit error the owner sees (FIRM_DRIVE_NOT_CHOSEN), never another Drive.
// The server setting stays usable only when explicitly allowed (OFFICE_MANAGER_ALLOW_ENV_DRIVE=true).
export function configuredDriveId() {
  const chosen = firmDriveId();
  if (chosen) return chosen;
  if (isTestMode()) {
    if (process.env.TATY_SHARED_DRIVE_ID) return process.env.TATY_SHARED_DRIVE_ID;
    throw new Error("TEST_MODE_DRIVE_ID_NOT_SET: TATY_SHARED_DRIVE_ID");
  }
  if (String(process.env.OFFICE_MANAGER_ALLOW_ENV_DRIVE || "").toLowerCase() === "true" && process.env.TATY_SHARED_DRIVE_ID) return process.env.TATY_SHARED_DRIVE_ID;
  throw Object.assign(new Error("FIRM_DRIVE_NOT_CHOSEN: choisissez le Drive du cabinet dans Paramètres"), { statusCode: 409 });
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
