import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { localFiles } from "../connectors/local-server/files.mjs";
import {
  signRequest,
  verifyRequest,
} from "../connectors/local-server/protocol.mjs";
import { createConnector } from "../connectors/local-server/server.mjs";
import { localAdapter } from "../lib/local-storage.js";
import { missionPresentation } from "../lib/mission-function.js";
const claims = { subject: "auditor@test.local", write: true, org: "org" };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "om-local-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "files");
  await fs.mkdir(root);
  const config = {
    org_id: "org",
    state_file: path.join(dir, "state.json"),
    roots: [
      {
        id: "audit",
        path: root,
        readers: ["reader@test.local"],
        writers: [claims.subject],
      },
    ],
  };
  return { root, dir, config, files: await localFiles(config) };
}
const b64 = (s) => Buffer.from(s).toString("base64");
test("local files preserve versions, refuse overwrites and keep identity when renamed", async (t) => {
  const { files, root } = await fixture(t);
  const file = await files.execute(
    {
      action: "create",
      parentId: "local:root:audit",
      name: "WP.txt",
      base64: b64("original"),
    },
    claims,
  );
  await assert.rejects(
    files.execute(
      {
        action: "create",
        parentId: "local:root:audit",
        name: "WP.txt",
        base64: b64("wrong"),
      },
      claims,
    ),
    { code: "EEXIST" },
  );
  await assert.rejects(
    files.execute(
      {
        action: "update",
        id: file.id,
        expectedVersion: "stale",
        base64: b64("wrong"),
      },
      claims,
    ),
    /FILE_CHANGED/,
  );
  const updated = await files.execute(
    {
      action: "update",
      id: file.id,
      expectedVersion: file.version,
      base64: b64("reviewed"),
    },
    claims,
  );
  assert.equal(
    await fs.readFile(
      path.join(
        root,
        ".office-manager-versions",
        file.id.slice(6),
        file.version,
      ),
      "utf8",
    ),
    "original",
  );
  const renamed = await files.execute(
    {
      action: "rename",
      id: file.id,
      name: "WP-reviewed.txt",
      expectedVersion: updated.version,
    },
    claims,
  );
  assert.equal(renamed.id, file.id);
  assert.equal(
    await fs.readFile(path.join(root, "WP-reviewed.txt"), "utf8"),
    "reviewed",
  );
  assert.equal(
    (await files.execute({ action: "list", id: "local:root:audit" }, claims))
      .length,
    1,
  );
});
test("local ACL, write scope, path traversal and symlinks fail closed", async (t) => {
  const { files, root, dir } = await fixture(t);
  await assert.rejects(
    files.execute(
      { action: "list", id: "local:root:audit" },
      { ...claims, subject: "outsider@test.local" },
    ),
    /ROOT_NOT_ALLOWED/,
  );
  await assert.rejects(
    files.execute(
      {
        action: "create",
        parentId: "local:root:audit",
        name: "../escape",
        base64: b64("x"),
      },
      claims,
    ),
    /INVALID_FILE_NAME/,
  );
  await assert.rejects(
    files.execute(
      { action: "mkdir", parentId: "local:root:audit", name: "folder" },
      { ...claims, write: false },
    ),
    /WRITE_NOT_ALLOWED/,
  );
  await assert.rejects(
    files.execute(
      { action: "mkdir", parentId: "local:root:audit", name: "folder" },
      { ...claims, subject: "reader@test.local" },
    ),
    /ROOT_READ_ONLY/,
  );
  await fs.writeFile(path.join(dir, "secret.txt"), "secret");
  await fs.symlink(path.join(dir, "secret.txt"), path.join(root, "link.txt"));
  assert.deepEqual(
    await files.execute({ action: "list", id: "local:root:audit" }, claims),
    [],
  );
});
test("backup folder cannot redirect writes outside the root", async (t) => {
  const { files, root, dir } = await fixture(t);
  const f = await files.execute(
    {
      action: "create",
      parentId: "local:root:audit",
      name: "WP.txt",
      base64: b64("before"),
    },
    claims,
  );
  await fs.symlink(dir, path.join(root, ".office-manager-versions"));
  await assert.rejects(
    files.execute(
      {
        action: "update",
        id: f.id,
        expectedVersion: f.version,
        base64: b64("after"),
      },
      claims,
    ),
    /UNSAFE_ARCHIVE/,
  );
  assert.equal(await fs.readFile(path.join(root, "WP.txt"), "utf8"), "before");
});
test("HMAC binds body, expiry, organisation and personal identity", () => {
  const secret = "x".repeat(40),
    body = '{"action":"roots"}',
    token = signRequest(secret, body, claims, 1000);
  assert.equal(
    verifyRequest(secret, token, body, "org", 1001).subject,
    claims.subject,
  );
  for (const [raw, org, now] of [
    [body + "x", "org", 1001],
    [body, "other", 1001],
    [body, "org", 62000],
  ])
    assert.throws(
      () => verifyRequest(secret, token, raw, org, now),
      /UNAUTHORIZED/,
    );
});
test("real HTTP connector uses signed requests and rejects unauthenticated calls", async (t) => {
  const { config } = await fixture(t),
    secret = "s".repeat(40),
    server = await createConnector(config, secret);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = "http://127.0.0.1:" + server.address().port;
  const adapter = localAdapter(
    "org",
    { email: claims.subject },
    {
      env: {
        OFFICE_LOCAL_CONNECTOR_URL: url,
        OFFICE_LOCAL_CONNECTOR_SECRET: secret,
        OFFICE_LOCAL_ORG_ID: "org",
        OFFICE_LOCAL_ALLOW_LOOPBACK_HTTP: "true",
      },
    },
  );
  assert.equal((await adapter.roots()).roots[0].id, "local:root:audit");
  const f = await adapter.createBinary({
    parentId: "local:root:audit",
    name: "Read.txt",
    buffer: Buffer.from("evidence"),
  });
  assert.equal((await adapter.readText(f.id)).text, "evidence");
  assert.equal(
    (await fetch(url + "/v1", { method: "POST", body: "{}" })).status,
    401,
  );
  await assert.rejects(
    localAdapter(
      "other",
      { email: claims.subject },
      {
        env: {
          OFFICE_LOCAL_CONNECTOR_URL: url,
          OFFICE_LOCAL_CONNECTOR_SECRET: secret,
          OFFICE_LOCAL_ORG_ID: "org",
        },
      },
    ).roots(),
    /ORGANISATION_MISMATCH/,
  );
});
test("mission presentation changes between missions without changing account authority", async () => {
  const account = { email: "a@test.local", role: "auditor" };
  const fetchRows = async (query) =>
    query.startsWith("office_staff_profiles")
      ? [{ id: "staff" }]
      : [
          {
            mission_role: query.includes("eq.mission-one")
              ? "Manager"
              : "Auditeur junior",
            status: "confirmed",
          },
        ];
  assert.equal(
    (await missionPresentation("org", "mission-one", account, fetchRows)).role,
    "manager",
  );
  assert.equal(
    (await missionPresentation("org", "mission-two", account, fetchRows)).role,
    "auditor",
  );
  assert.equal(account.role, "auditor");
  const ambiguous = await missionPresentation(
    "org",
    "mission-one",
    account,
    async (query) =>
      query.startsWith("office_staff_profiles")
        ? [{ id: "staff" }]
        : [{ mission_role: "Manager" }, { mission_role: "Auditeur" }],
  );
  assert.equal(ambiguous.source, "ambiguous");
  assert.equal(ambiguous.role, "auditor");
});

test("server file route rejects GET writes and does not grant a reviewer write access", async () => {
  const { serverFiles } = await import("../lib/server-files.js");
  let calls = 0;
  const d = {
    permission: async () => {},
    adapter: {
      createFolder: async () => {
        calls++;
      },
    },
  };
  await assert.rejects(
    serverFiles(
      "org",
      {
        method: "GET",
        query: { action: "mkdir", parentId: "local:root:audit", name: "X" },
      },
      { email: claims.subject, role: "manager" },
      d,
    ),
    /METHOD_NOT_ALLOWED/,
  );
  await assert.rejects(
    serverFiles(
      "org",
      {
        method: "POST",
        body: { action: "mkdir", parentId: "local:root:audit", name: "X" },
      },
      { email: claims.subject, role: "quality_reviewer" },
      d,
    ),
    /ROLE_NOT_ALLOWED/,
  );
  assert.equal(calls, 0);
});

test('preview deployments cannot call the cabinet connector',async()=>{
 let called=false;
 const adapter=localAdapter('org',{email:claims.subject},{env:{VERCEL_ENV:'preview',OFFICE_LOCAL_CONNECTOR_URL:'https://example.test',OFFICE_LOCAL_CONNECTOR_SECRET:'s'.repeat(40),OFFICE_LOCAL_ORG_ID:'org'},fetch:async()=>{called=true;}});
 await assert.rejects(adapter.roots(),/LOCAL_CONNECTOR_DISABLED_IN_TEST_MODE/);assert.equal(called,false);
});
