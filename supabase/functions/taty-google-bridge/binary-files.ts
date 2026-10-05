// Binary file actions of taty-google-bridge (versioned with the bridge).
//
//   create_binary_file  -> create ONE new file (multipart upload)
//   update_binary_file  -> replace the bytes of an EXISTING file in place
//
// Purpose: let Office Manager AI write its two memory files
// (OFFICE_MANAGER_MAP.xlsx / OFFICE_MANAGER_REGISTER.xlsx) through the
// existing bridge, without giving the bridge a generic "write any file" power.
//
// Pure module: Google calls are injected (deps), so the same code runs in the
// Deno Edge Function and in the offline Node tests. Erasable TypeScript only
// (no enums / parameter properties) so Node can strip the types.

export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

// Explicit allow-lists: only xlsx, and only the two memory files.
export const BINARY_ALLOWED_MIMES: ReadonlySet<string> = new Set([XLSX_MIME]);
export const BINARY_ALLOWED_NAMES: ReadonlySet<string> = new Set([
  "OFFICE_MANAGER_MAP.xlsx",
  "OFFICE_MANAGER_REGISTER.xlsx"
]);
// Single limit for memory files, used for write (here) AND read
// (lib/google-drive.js MEMORY_BINARY_MAX_BYTES, passed as read_file max_bytes).
export const MEMORY_BINARY_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB
export const BINARY_MAX_BYTES = MEMORY_BINARY_MAX_BYTES;

export const FILE_FIELDS =
  "id,name,mimeType,parents,modifiedTime,createdTime,webViewLink,size,driveId,trashed";

export type DriveMeta = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
  size?: string;
  driveId?: string;
  trashed?: boolean;
};

// Injected Google Drive operations (implemented with gfetch in index.ts).
export type BinaryDeps = {
  driveId: string;
  getMetadata: (fileId: string) => Promise<DriveMeta | null>; // null = not found
  // Exact, paginated lookup: '<parent>' in parents and name = '<name>' and trashed = false
  findExact: (parentId: string, name: string) => Promise<DriveMeta[]>;
  uploadCreate: (args: { name: string; parentId: string; mimeType: string; bytes: Uint8Array }) => Promise<DriveMeta>;
  uploadUpdate: (args: { fileId: string; mimeType: string; bytes: Uint8Array }) => Promise<DriveMeta>;
};

export class BridgeError extends Error {
  status: number;
  code: string;
  constructor(code: string, status: number, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.status = status;
  }
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export function decodeBase64Strict(value: unknown): Uint8Array {
  if (typeof value !== "string" || !value.length) {
    throw new BridgeError("BASE64_REQUIRED", 400);
  }
  const clean = value.replace(/\s+/g, "");
  if (clean.length % 4 !== 0 || !BASE64_PATTERN.test(clean)) {
    throw new BridgeError("INVALID_BASE64", 400);
  }
  // Size guard BEFORE decoding.
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const decodedLength = (clean.length / 4) * 3 - padding;
  if (decodedLength > BINARY_MAX_BYTES) {
    throw new BridgeError("FILE_TOO_LARGE", 413, `${decodedLength} > ${BINARY_MAX_BYTES} bytes`);
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (!bytes.length) throw new BridgeError("EMPTY_FILE", 400);
  return bytes;
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new BridgeError(code, 400);
  return value.trim();
}

function requireAllowedMime(value: unknown): string {
  const mime = requireString(value, "MIME_TYPE_REQUIRED");
  if (!BINARY_ALLOWED_MIMES.has(mime)) throw new BridgeError("MIME_TYPE_NOT_ALLOWED", 400, mime);
  return mime;
}

function requireAllowedName(value: unknown): string {
  const name = requireString(value, "NAME_REQUIRED");
  if (!BINARY_ALLOWED_NAMES.has(name)) throw new BridgeError("FILE_NAME_NOT_ALLOWED", 403, name);
  return name;
}

// Scope: the object must belong to the configured Shared Drive and not be trashed.
function assertInDrive(meta: DriveMeta | null, driveId: string, code: string): DriveMeta {
  if (!meta) throw new BridgeError(code, 404, "not found");
  if (!meta.driveId || meta.driveId !== driveId) throw new BridgeError("OUT_OF_DRIVE_SCOPE", 403);
  if (meta.trashed) throw new BridgeError(code, 409, "trashed");
  return meta;
}

function publicMeta(meta: DriveMeta) {
  return {
    id: meta.id,
    name: meta.name,
    mimeType: meta.mimeType,
    parents: meta.parents || [],
    modifiedTime: meta.modifiedTime || null,
    createdTime: meta.createdTime || null,
    webViewLink: meta.webViewLink || null,
    size: meta.size || null
  };
}

// create_binary_file { parent_id, name, mime_type, base64, expected_name? }
export async function createBinaryFileAction(deps: BinaryDeps, body: Record<string, unknown>) {
  const parentId = requireString(body.parent_id, "PARENT_ID_REQUIRED");
  const name = requireAllowedName(body.name);
  if (body.expected_name !== undefined && body.expected_name !== null && body.expected_name !== name) {
    throw new BridgeError("EXPECTED_NAME_MISMATCH", 400);
  }
  const mimeType = requireAllowedMime(body.mime_type);
  const bytes = decodeBase64Strict(body.base64);

  const parent = assertInDrive(await deps.getMetadata(parentId), deps.driveId, "PARENT_NOT_FOUND");
  if (parent.mimeType !== FOLDER_MIME) throw new BridgeError("PARENT_NOT_A_FOLDER", 400);

  // Never create a second file with the same name: the caller must update.
  // Exact paginated search, independent of how many siblings the folder has.
  const existing = await deps.findExact(parentId, name);
  if (existing.some(item => item.name === name && item.mimeType !== FOLDER_MIME && !item.trashed)) {
    throw new BridgeError("FILE_ALREADY_EXISTS", 409, name);
  }

  const created = await deps.uploadCreate({ name, parentId, mimeType, bytes });
  const confirmed = assertInDrive(await deps.getMetadata(created.id), deps.driveId, "CREATED_FILE_NOT_FOUND");
  return publicMeta(confirmed);
}

// find_exact_file { parent_id, name } — read-only, memory file names only.
export async function findExactFileAction(deps: BinaryDeps, body: Record<string, unknown>) {
  const parentId = requireString(body.parent_id, "PARENT_ID_REQUIRED");
  const name = requireAllowedName(body.name);
  const parent = assertInDrive(await deps.getMetadata(parentId), deps.driveId, "PARENT_NOT_FOUND");
  if (parent.mimeType !== FOLDER_MIME) throw new BridgeError("PARENT_NOT_A_FOLDER", 400);
  const files = (await deps.findExact(parentId, name))
    .filter(item => item.name === name && item.mimeType !== FOLDER_MIME && !item.trashed)
    .map(publicMeta);
  return { files };
}

// update_binary_file { file_id, mime_type, base64, expected_modified_time }
export async function updateBinaryFileAction(deps: BinaryDeps, body: Record<string, unknown>) {
  const fileId = requireString(body.file_id, "FILE_ID_REQUIRED");
  const mimeType = requireAllowedMime(body.mime_type);
  const expected = requireString(body.expected_modified_time, "EXPECTED_MODIFIED_TIME_REQUIRED");
  const bytes = decodeBase64Strict(body.base64);

  // 1. current metadata, scope and identity checks
  const current = assertInDrive(await deps.getMetadata(fileId), deps.driveId, "FILE_NOT_FOUND");
  if (current.mimeType === FOLDER_MIME) throw new BridgeError("TARGET_IS_A_FOLDER", 400);
  requireAllowedName(current.name);
  if (current.mimeType !== mimeType) throw new BridgeError("MIME_TYPE_CHANGE_NOT_ALLOWED", 400);

  // 2-3. optimistic concurrency: nothing is written on mismatch
  if (current.modifiedTime !== expected) {
    throw new BridgeError("MEMORY_CONFLICT", 409, `expected ${expected}, current ${current.modifiedTime}`);
  }

  // 4. replace the bytes of the SAME file_id (no new file)
  await deps.uploadUpdate({ fileId, mimeType, bytes });

  // 5. re-read and return the final file
  const confirmed = assertInDrive(await deps.getMetadata(fileId), deps.driveId, "FILE_NOT_FOUND");
  return publicMeta(confirmed);
}

// Google implementations of the injected operations (used by index.ts).
type GoogleFetch = (url: string, init?: RequestInit) => Promise<Response>;

function multipartBody(boundary: string, metadata: unknown, mimeType: string, bytes: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const out = new Uint8Array(head.length + bytes.length + tail.length);
  out.set(head, 0);
  out.set(bytes, head.length);
  out.set(tail, head.length + bytes.length);
  return out;
}

// Request bodies need an ArrayBuffer-backed value (strict BodyInit typing).
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function okJson(response: Response) {
  const raw = await response.text();
  let data: unknown = raw;
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* keep text */ }
  if (!response.ok) {
    throw new Error(`GOOGLE_API_${response.status}: ${String(typeof data === "string" ? data : JSON.stringify(data)).slice(0, 400)}`);
  }
  return data as any;
}

export function googleBinaryDeps(gfetch: GoogleFetch, driveId: string): BinaryDeps {
  const base = "https://www.googleapis.com/drive/v3/files";
  const upload = "https://www.googleapis.com/upload/drive/v3/files";
  return {
    driveId,
    async getMetadata(fileId) {
      const response = await gfetch(`${base}/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${FILE_FIELDS}`);
      if (response.status === 404) return null;
      return okJson(response);
    },
    async findExact(parentId, name) {
      const esc = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const files: DriveMeta[] = [];
      let pageToken: string | null = null;
      do {
        const params = new URLSearchParams({
          q: `'${esc(parentId)}' in parents and name = '${esc(name)}' and trashed = false`,
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
          corpora: "drive",
          driveId,
          pageSize: "1000",
          fields: `nextPageToken,files(${FILE_FIELDS})`
        });
        if (pageToken) params.set("pageToken", pageToken);
        const page = await okJson(await gfetch(`${base}?${params.toString()}`));
        files.push(...(page.files || []));
        pageToken = page.nextPageToken || null;
      } while (pageToken);
      return files;
    },
    async uploadCreate({ name, parentId, mimeType, bytes }) {
      const boundary = `om-bridge-${crypto.randomUUID()}`;
      return okJson(await gfetch(
        `${upload}?uploadType=multipart&supportsAllDrives=true&fields=${FILE_FIELDS}`,
        {
          method: "POST",
          headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
          body: toArrayBuffer(multipartBody(boundary, { name, parents: [parentId], mimeType }, mimeType, bytes))
        }
      ));
    },
    async uploadUpdate({ fileId, mimeType, bytes }) {
      return okJson(await gfetch(
        `${upload}/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true&fields=${FILE_FIELDS}`,
        { method: "PATCH", headers: { "Content-Type": mimeType }, body: toArrayBuffer(bytes) }
      ));
    }
  };
}
