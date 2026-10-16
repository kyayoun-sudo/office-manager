import { localAdapter, localStorageState, isLocalId } from "./local-storage.js";
import { requireScreenAccess } from "./permissions.js";
const fail = (code, statusCode = 400) =>
  Object.assign(new Error(code), { statusCode });
export async function serverFiles(orgId, req, account, d = {}) {
  if (!account?.email) throw fail("USER_SESSION_REQUIRED", 401);
  const b = req.method === "GET" ? req.query || {} : req.body || {};
  const action =
    req.method === "GET" ? String(b.action || "roots") : String(b.action || "");
  const write = ["create", "update", "mkdir", "rename"].includes(action);
  if (write && req.method !== "POST") throw fail("METHOD_NOT_ALLOWED", 405);
  await (d.permission || requireScreenAccess)(
    orgId,
    account,
    "documents",
    write ? "prepare" : "view",
  );
  if (
    write &&
    ![
      "owner",
      "partner",
      "manager",
      "supervisor",
      "senior",
      "auditor",
      "collaborator",
      "secretary",
      "bdm",
    ].includes(account.role)
  )
    throw fail("ROLE_NOT_ALLOWED", 403);
  const adapter = d.adapter || localAdapter(orgId, account, d);
  if (action === "state") return localStorageState(d.env);
  if (action === "roots") return adapter.roots();
  if (!isLocalId(b.id || b.parentId)) throw fail("LOCAL_FILE_REQUIRED");
  if (action === "meta") return adapter.getMeta(b.id);
  if (action === "list") return { files: await adapter.listChildren(b.id) };
  if (action === "read") return adapter.readText(b.id);
  if (action === "download") return adapter.download(b.id);
  if (action === "create")
    return adapter.createBinary({
      name: b.name,
      parentId: b.parentId,
      buffer: Buffer.from(String(b.base64 || ""), "base64"),
    });
  if (action === "update")
    return adapter.updateBinary(b.id, {
      buffer: Buffer.from(String(b.base64 || ""), "base64"),
      expectedVersion: b.expectedVersion,
    });
  if (action === "mkdir") return adapter.createFolder(b.parentId, b.name);
  if (action === "rename")
    return adapter.rename(b.id, {
      name: b.name,
      parentId: b.parentId,
      expectedVersion: b.expectedVersion,
    });
  throw fail("ACTION_NOT_SUPPORTED");
}
