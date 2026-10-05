// Phase 3.1 — MAP / REGISTER writable through the existing Google bridge.
// Offline: the REAL bridge module (supabase/functions/taty-google-bridge/
// binary-files.ts, type-stripped by Node) runs against a fake Google Drive.
import { test, before } from "node:test";
import assert from "node:assert/strict";

import {
  BINARY_MAX_BYTES,
  BridgeError,
  XLSX_MIME,
  createBinaryFileAction,
  googleBinaryDeps,
  updateBinaryFileAction
} from "../supabase/functions/taty-google-bridge/binary-files.ts";

const DRIVE_ID = "SHARED-DRIVE";
const FOLDER = "application/vnd.google-apps.folder";
const GDOC = "application/vnd.google-apps.document";

// ---------------------------------------------------------------------------
// Fake Google Drive (what the bridge talks to)
// ---------------------------------------------------------------------------

function fakeGoogle() {
  const files = new Map();
  const bytes = new Map();
  const texts = new Map();
  let counter = 0;
  let clock = 0;
  const tick = () => new Date(Date.UTC(2026, 9, 5, 12, 0, ++clock)).toISOString();
  const add = (meta, text) => {
    files.set(meta.id, { driveId: DRIVE_ID, trashed: false, parents: [], modifiedTime: "2026-09-01T00:00:00Z", ...meta });
    if (text !== undefined) texts.set(meta.id, text);
  };
  const deps = {
    driveId: DRIVE_ID,
    async getMetadata(id) {
      const meta = files.get(id);
      return meta ? { ...meta } : null;
    },
    async listChildren(parentId) {
      return [...files.values()].filter(f => !f.trashed && f.parents.includes(parentId)).map(f => ({ ...f }));
    },
    async uploadCreate({ name, parentId, mimeType, bytes: data }) {
      const meta = { id: `bin-${++counter}`, name, mimeType, parents: [parentId], driveId: DRIVE_ID, trashed: false, modifiedTime: tick(), createdTime: "2026-10-05T12:00:00Z", size: String(data.length), webViewLink: "https://drive/x" };
      files.set(meta.id, meta);
      bytes.set(meta.id, Buffer.from(data));
      return { ...meta };
    },
    async uploadUpdate({ fileId, bytes: data }) {
      const meta = files.get(fileId);
      meta.modifiedTime = tick();
      meta.size = String(data.length);
      bytes.set(fileId, Buffer.from(data));
      return { ...meta };
    }
  };
  return { files, bytes, texts, add, deps };
}

function baseDrive() {
  const g = fakeGoogle();
  g.add({ id: "ROOT", name: "Shared", mimeType: FOLDER });
  g.add({ id: "F-OTHER", name: "Other drive folder", mimeType: FOLDER, driveId: "ANOTHER-DRIVE" });
  return g;
}

const b64 = s => Buffer.from(s).toString("base64");

async function expectBridgeError(promise, code) {
  await assert.rejects(promise, error => error instanceof BridgeError && error.code === code);
}

// ---------------------------------------------------------------------------
// A. Bridge actions
// ---------------------------------------------------------------------------

test("bridge create_binary_file creates an xlsx in the Shared Drive", async () => {
  const g = baseDrive();
  const out = await createBinaryFileAction(g.deps, {
    parent_id: "ROOT", name: "OFFICE_MANAGER_MAP.xlsx", mime_type: XLSX_MIME, base64: b64("xlsx-bytes"), expected_name: "OFFICE_MANAGER_MAP.xlsx"
  });
  assert.equal(out.name, "OFFICE_MANAGER_MAP.xlsx");
  assert.equal(out.mimeType, XLSX_MIME);
  assert.deepEqual(out.parents, ["ROOT"]);
  for (const key of ["id", "modifiedTime", "createdTime", "webViewLink", "size"]) assert.ok(out[key], key);
  assert.equal(g.bytes.get(out.id).toString(), "xlsx-bytes");

  // Create never makes a second file with the same name.
  await expectBridgeError(createBinaryFileAction(g.deps, {
    parent_id: "ROOT", name: "OFFICE_MANAGER_MAP.xlsx", mime_type: XLSX_MIME, base64: b64("again")
  }), "FILE_ALREADY_EXISTS");
  await expectBridgeError(createBinaryFileAction(g.deps, {
    name: "OFFICE_MANAGER_MAP.xlsx", mime_type: XLSX_MIME, base64: b64("x")
  }), "PARENT_ID_REQUIRED");
  await expectBridgeError(createBinaryFileAction(g.deps, {
    parent_id: "ROOT", name: "OFFICE_MANAGER_REGISTER.xlsx", mime_type: XLSX_MIME
  }), "BASE64_REQUIRED");
  await expectBridgeError(createBinaryFileAction(g.deps, {
    parent_id: "ROOT", name: "OFFICE_MANAGER_REGISTER.xlsx", mime_type: XLSX_MIME, base64: "not base64!!"
  }), "INVALID_BASE64");
});

test("bridge update_binary_file keeps the same file_id and creates no duplicate", async () => {
  const g = baseDrive();
  const created = await createBinaryFileAction(g.deps, {
    parent_id: "ROOT", name: "OFFICE_MANAGER_REGISTER.xlsx", mime_type: XLSX_MIME, base64: b64("v1")
  });
  const before = g.files.size;
  const updated = await updateBinaryFileAction(g.deps, {
    file_id: created.id, mime_type: XLSX_MIME, base64: b64("v2"), expected_modified_time: created.modifiedTime
  });
  assert.equal(updated.id, created.id);
  assert.notEqual(updated.modifiedTime, created.modifiedTime, "returns the re-read final metadata");
  assert.equal(g.bytes.get(created.id).toString(), "v2");
  assert.equal(g.files.size, before, "no new file");
});

test("bridge update with a wrong expected_modified_time -> MEMORY_CONFLICT, nothing written", async () => {
  const g = baseDrive();
  const created = await createBinaryFileAction(g.deps, {
    parent_id: "ROOT", name: "OFFICE_MANAGER_MAP.xlsx", mime_type: XLSX_MIME, base64: b64("original")
  });
  await expectBridgeError(updateBinaryFileAction(g.deps, {
    file_id: created.id, mime_type: XLSX_MIME, base64: b64("overwrite"), expected_modified_time: "2020-01-01T00:00:00Z"
  }), "MEMORY_CONFLICT");
  assert.equal(g.bytes.get(created.id).toString(), "original");
  await expectBridgeError(updateBinaryFileAction(g.deps, {
    file_id: created.id, mime_type: XLSX_MIME, base64: b64("x")
  }), "EXPECTED_MODIFIED_TIME_REQUIRED");
});

test("bridge refuses files over the size limit", async () => {
  const g = baseDrive();
  const tooBig = Buffer.alloc(BINARY_MAX_BYTES + 1, 1).toString("base64");
  await expectBridgeError(createBinaryFileAction(g.deps, {
    parent_id: "ROOT", name: "OFFICE_MANAGER_MAP.xlsx", mime_type: XLSX_MIME, base64: tooBig
  }), "FILE_TOO_LARGE");
  assert.equal(g.files.size, 2);
});

test("bridge refuses a MIME type or a file name that is not allow-listed", async () => {
  const g = baseDrive();
  await expectBridgeError(createBinaryFileAction(g.deps, {
    parent_id: "ROOT", name: "OFFICE_MANAGER_MAP.xlsx", mime_type: "application/pdf", base64: b64("x")
  }), "MIME_TYPE_NOT_ALLOWED");
  await expectBridgeError(createBinaryFileAction(g.deps, {
    parent_id: "ROOT", name: "Client WP.xlsx", mime_type: XLSX_MIME, base64: b64("x")
  }), "FILE_NAME_NOT_ALLOWED");

  // A business xlsx in the drive can never be overwritten through the bridge.
  g.add({ id: "CLIENT-WP", name: "WP_Tresorerie_ABC.xlsx", mimeType: XLSX_MIME, parents: ["ROOT"] });
  await expectBridgeError(updateBinaryFileAction(g.deps, {
    file_id: "CLIENT-WP", mime_type: XLSX_MIME, base64: b64("x"), expected_modified_time: "2026-09-01T00:00:00Z"
  }), "FILE_NAME_NOT_ALLOWED");
});

test("bridge refuses any file_id / parent outside the configured Shared Drive", async () => {
  const g = baseDrive();
  await expectBridgeError(createBinaryFileAction(g.deps, {
    parent_id: "F-OTHER", name: "OFFICE_MANAGER_MAP.xlsx", mime_type: XLSX_MIME, base64: b64("x")
  }), "OUT_OF_DRIVE_SCOPE");
  g.add({ id: "FOREIGN-MAP", name: "OFFICE_MANAGER_MAP.xlsx", mimeType: XLSX_MIME, parents: ["F-OTHER"], driveId: "ANOTHER-DRIVE" });
  await expectBridgeError(updateBinaryFileAction(g.deps, {
    file_id: "FOREIGN-MAP", mime_type: XLSX_MIME, base64: b64("x"), expected_modified_time: "2026-09-01T00:00:00Z"
  }), "OUT_OF_DRIVE_SCOPE");
  await expectBridgeError(updateBinaryFileAction(g.deps, {
    file_id: "UNKNOWN", mime_type: XLSX_MIME, base64: b64("x"), expected_modified_time: "x"
  }), "FILE_NOT_FOUND");
});

test("Google requests built by the bridge: multipart create, media PATCH on the same id, Drive-scoped listing", async () => {
  const requests = [];
  const store = new Map([["ROOT", { id: "ROOT", name: "Shared", mimeType: FOLDER, driveId: DRIVE_ID, trashed: false, parents: [] }]]);
  const gfetch = async (url, init = {}) => {
    requests.push({ url, method: init.method || "GET", headers: init.headers || {}, bodyBytes: init.body ? init.body.byteLength : 0 });
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart")) {
      store.set("NEW", { id: "NEW", name: "OFFICE_MANAGER_MAP.xlsx", mimeType: XLSX_MIME, parents: ["ROOT"], driveId: DRIVE_ID, trashed: false, modifiedTime: "t1" });
      return reply(store.get("NEW"));
    }
    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files/NEW?uploadType=media")) {
      store.get("NEW").modifiedTime = "t2";
      return reply(store.get("NEW"));
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) return reply({ files: [] });
    const id = decodeURIComponent(url.split("/files/")[1].split("?")[0]);
    return store.has(id) ? reply(store.get(id)) : reply({ error: "not found" }, 404);
  };
  const deps = googleBinaryDeps(gfetch, DRIVE_ID);
  const created = await createBinaryFileAction(deps, { parent_id: "ROOT", name: "OFFICE_MANAGER_MAP.xlsx", mime_type: XLSX_MIME, base64: b64("abc") });
  const updated = await updateBinaryFileAction(deps, { file_id: created.id, mime_type: XLSX_MIME, base64: b64("abcd"), expected_modified_time: "t1" });
  assert.equal(updated.id, "NEW");
  assert.equal(updated.modifiedTime, "t2");

  const create = requests.find(r => r.url.includes("uploadType=multipart"));
  assert.equal(create.method, "POST");
  assert.match(create.headers["Content-Type"], /^multipart\/related; boundary=/);
  const patch = requests.find(r => r.url.includes("uploadType=media"));
  assert.equal(patch.method, "PATCH");
  assert.match(patch.url, /\/upload\/drive\/v3\/files\/NEW\?/);
  assert.equal(patch.bodyBytes, 4);
  const listing = requests.find(r => r.url.startsWith("https://www.googleapis.com/drive/v3/files?"));
  assert.match(listing.url, new RegExp(`driveId=${DRIVE_ID}`));
  assert.ok(requests.every(r => !["DELETE"].includes(r.method)), "no delete");
  assert.ok(requests.every(r => !/addParents|removeParents/.test(r.url)), "no move");
});

// ---------------------------------------------------------------------------
// B. End to end in bridge mode: memory engine -> lib/google-drive.js ->
//    (mocked HTTP) -> bridge dispatcher with the real binary actions -> fake Google
// ---------------------------------------------------------------------------

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.ORPAILLEUR_JOB_SECRET = "job-secret";
process.env.TATY_SHARED_DRIVE_ID = DRIVE_ID;
process.env.OFFICE_MANAGER_MEMORY_FOLDER_ID = "ROOT";
process.env.OFFICE_MANAGER_SCAN_ROOT_ID = "ROOT";
delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

const world = { g: null, actions: [] };

function bridgeResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Minimal copy of the bridge dispatcher for the read actions + the REAL binary actions.
async function bridge(body, headers) {
  if (headers["x-orpailleur-secret"] !== "job-secret") return bridgeResponse({ error: "UNAUTHORIZED" }, 401);
  const g = world.g;
  world.actions.push(body.action);
  try {
    switch (body.action) {
      case "list_children":
        return bridgeResponse({ files: await g.deps.listChildren(body.parent_id) });
      case "file_metadata": {
        const meta = await g.deps.getMetadata(body.file_id);
        return meta ? bridgeResponse(meta) : bridgeResponse({ error: "GOOGLE_API_404" }, 500);
      }
      case "read_file": {
        const meta = await g.deps.getMetadata(body.file_id);
        if (g.texts.has(body.file_id)) return bridgeResponse({ mode: "text", file: meta, text: g.texts.get(body.file_id) });
        return bridgeResponse({ mode: "base64", file: meta, mime_type: meta.mimeType, base64: (g.bytes.get(body.file_id) || Buffer.alloc(0)).toString("base64") });
      }
      case "search_files":
        return bridgeResponse({ files: [] });
      case "create_binary_file":
        return bridgeResponse(await createBinaryFileAction(g.deps, body));
      case "update_binary_file":
        return bridgeResponse(await updateBinaryFileAction(g.deps, body));
      default:
        return bridgeResponse({ error: `NOT_ALLOWED_IN_THIS_TEST: ${body.action}` }, 500);
    }
  } catch (error) {
    if (error instanceof BridgeError) return bridgeResponse({ error: error.message, code: error.code }, error.status);
    return bridgeResponse({ error: String(error.message || error) }, 500);
  }
}

globalThis.fetch = async (url, options = {}) => {
  url = String(url);
  if (url === "https://supabase.test/functions/v1/taty-google-bridge") {
    return bridge(JSON.parse(options.body), options.headers || {});
  }
  if (url.startsWith("https://supabase.test/rest/v1/office_agent_tool_events")) {
    return bridgeResponse([{ id: "evt" }]);
  }
  throw new Error(`Unexpected network call in offline test: ${url}`);
};

function orgGoogle() {
  const g = baseDrive();
  g.add({ id: "F-ACTIVE", name: "01_MISSIONS_EN_COURS", mimeType: FOLDER, parents: ["ROOT"] });
  g.add({ id: "DOC1", name: "Lettre de mission ABC", mimeType: GDOC, parents: ["F-ACTIVE"] }, "Lettre de mission ABC SA 2025");
  g.add({ id: "WP1", name: "WP_Tresorerie_ABC.xlsx", mimeType: XLSX_MIME, parents: ["F-ACTIVE"] });
  g.bytes.set("WP1", Buffer.from("client working paper"));
  return g;
}

let driveAdapter;
let memory;
let agentTools;
before(async () => {
  ({ driveAdapter } = await import("../lib/drive-adapter.js"));
  memory = await import("../lib/orpailleur-memory.js");
  agentTools = await import("../lib/agent-tools.js");
});

const memoryFiles = g => [...g.files.values()].filter(f => f.name.startsWith("OFFICE_MANAGER_"));

test("run_mapping_pass works in (simulated) bridge mode — no MEMORY_WRITE_UNAVAILABLE", async () => {
  world.g = orgGoogle();
  world.actions = [];
  const tool = agentTools.buildSpecialistTools("orpailleur", { orgId: "org", runId: null })
    .find(t => t.name === "run_mapping_pass");
  const out = JSON.parse(await tool.invoke({}, JSON.stringify({ listing_source: "DRIVE_WALK", max_reads: null, max_items: null })));
  assert.equal(out.status, "PASS_COMPLETED");
  assert.notEqual(out.status, "MEMORY_WRITE_UNAVAILABLE");
  assert.equal(out.mapping_state, "MAPPING_PENDING_REVIEW");
  assert.equal(world.actions.filter(a => a === "create_binary_file").length, 2);
});

test("first mapping creates exactly MAP + REGISTER; the second updates the same IDs", async () => {
  world.g = orgGoogle();
  world.actions = [];
  const run = now => memory.runMappingPass(driveAdapter, { memoryFolderId: "ROOT", rootFolderId: "ROOT", now: new Date(now) });

  const first = await run("2026-10-05T12:00:00Z");
  const files1 = memoryFiles(world.g);
  assert.deepEqual(files1.map(f => f.name).sort(), ["OFFICE_MANAGER_MAP.xlsx", "OFFICE_MANAGER_REGISTER.xlsx"]);

  const second = await run("2026-10-06T12:00:00Z");
  const files2 = memoryFiles(world.g);
  assert.equal(files2.length, 2);
  assert.equal(second.summary.map_file_id, first.summary.map_file_id);
  assert.equal(second.summary.register_file_id, first.summary.register_file_id);
  assert.equal(world.actions.filter(a => a === "create_binary_file").length, 2);
  assert.equal(world.actions.filter(a => a === "update_binary_file").length, 2);

  // The xlsx written through the bridge reads back correctly.
  const reopened = await memory.openMemory(driveAdapter, { memoryFolderId: "ROOT" });
  assert.ok(reopened.register.rows.some(r => r.file_id === "DOC1"));
});

test("a concurrent change of a memory file aborts the write (engine and bridge)", async () => {
  world.g = orgGoogle();
  await memory.runMappingPass(driveAdapter, { memoryFolderId: "ROOT", rootFolderId: "ROOT", now: new Date("2026-10-05T12:00:00Z") });
  const loaded = await memory.openMemory(driveAdapter, { memoryFolderId: "ROOT" });
  const mapId = loaded.map.fileId;
  const bytesBefore = Buffer.from(world.g.bytes.get(mapId));

  world.g.files.get(mapId).modifiedTime = "2026-10-05T12:30:00Z"; // the owner edited MAP meanwhile
  await assert.rejects(memory.saveMemory(driveAdapter, loaded), /MEMORY_CONFLICT/);
  assert.deepEqual(world.g.bytes.get(mapId), bytesBefore, "nothing written");

  // The bridge enforces it by itself too (stale expected_modified_time).
  await assert.rejects(
    driveAdapter.updateBinary(mapId, { buffer: Buffer.from("x"), mimeType: XLSX_MIME, expectedModifiedTime: loaded.map.modifiedTime }),
    /GOOGLE_BRIDGE_409.*MEMORY_CONFLICT/
  );
  assert.deepEqual(world.g.bytes.get(mapId), bytesBefore);
});

test("no business document is moved or modified during FIRST_MAPPING", async () => {
  world.g = orgGoogle();
  world.actions = [];
  const snapshot = new Map([...world.g.files.entries()].map(([id, meta]) => [id, JSON.stringify(meta)]));
  const wpBytes = Buffer.from(world.g.bytes.get("WP1"));

  await memory.runMappingPass(driveAdapter, { memoryFolderId: "ROOT", rootFolderId: "ROOT", now: new Date("2026-10-05T12:00:00Z") });

  for (const [id, before] of snapshot) {
    assert.equal(JSON.stringify(world.g.files.get(id)), before, `business object ${id} unchanged`);
  }
  assert.deepEqual(world.g.bytes.get("WP1"), wpBytes);
  const writes = world.actions.filter(a => !["list_children", "file_metadata", "read_file", "search_files"].includes(a));
  assert.deepEqual(writes.sort(), ["create_binary_file", "create_binary_file"]);
});
