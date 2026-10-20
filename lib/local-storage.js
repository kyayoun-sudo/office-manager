import { isTestMode } from "./test-mode.js";
import { boundedResponseBytes } from "./bounded-content.js";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  signRequest,
  MAX_BYTES,
} from "../connectors/local-server/protocol.mjs";
const context = new AsyncLocalStorage();
const fail = (code, statusCode = 409) =>
  Object.assign(new Error(code), { statusCode });
export const isLocalId = (id) =>
  typeof id === "string" &&
  /^local:(?:root:[A-Za-z0-9_-]{1,60}|[0-9a-f-]{36})$/.test(id);
export const withDocumentContext = (orgId, account, fn) =>
  context.run({ orgId, account }, fn);
export function localStorageState(env = process.env) {
  return {
    configured: Boolean(
      env.OFFICE_LOCAL_CONNECTOR_URL &&
        env.OFFICE_LOCAL_CONNECTOR_SECRET &&
        env.OFFICE_LOCAL_ORG_ID,
    ),
    provider: "local",
    drive_unchanged: true,
    macros: false,
  };
}
export function localAdapter(orgId, account, d = {}) {
  const env = d.env || process.env,
    fetcher = d.fetch || fetch;
  async function call(action, args = {}, write = false) {
    if (isTestMode(env))
      throw fail("LOCAL_CONNECTOR_DISABLED_IN_TEST_MODE", 403);
    if (!account?.email) throw fail("LOCAL_PERSONAL_SESSION_REQUIRED", 401);
    if (!env.OFFICE_LOCAL_CONNECTOR_URL || !env.OFFICE_LOCAL_CONNECTOR_SECRET)
      throw fail("LOCAL_CONNECTOR_NOT_CONFIGURED", 503);
    if (orgId !== env.OFFICE_LOCAL_ORG_ID)
      throw fail("LOCAL_ORGANISATION_MISMATCH", 403);
    const url = new URL(env.OFFICE_LOCAL_CONNECTOR_URL);
    if (
      url.protocol !== "https:" &&
      !(
        env.OFFICE_LOCAL_ALLOW_LOOPBACK_HTTP === "true" &&
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      )
    )
      throw fail("LOCAL_HTTPS_REQUIRED", 503);
    if (url.username || url.password || url.search || url.hash)
      throw fail("LOCAL_CONNECTOR_URL_INVALID", 503);
    const body = JSON.stringify({ action, ...args });
    const token = signRequest(env.OFFICE_LOCAL_CONNECTOR_SECRET, body, {
      org: orgId,
      subject: account.email.toLowerCase(),
      write,
    });
    let response;
    try {
      response = await fetcher(new URL("/v1", url), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch {
      throw fail("LOCAL_CONNECTOR_UNREACHABLE", 503);
    }
    const text = (
      await boundedResponseBytes(response, (MAX_BYTES * 4) / 3 + 200000)
    ).toString("utf8");
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw fail("LOCAL_INVALID_RESPONSE", 502);
    }
    if (!response.ok)
      throw fail(
        data.error || "LOCAL_CONNECTOR_FAILED",
        [400, 401, 403, 404, 409, 413, 503].includes(response.status)
          ? response.status
          : 502,
      );
    return data;
  }
  function link(m) {
    return {
      ...m,
      webViewLink: "/fichiers.html?file=" + encodeURIComponent(m.id),
    };
  }
  const adapter = {
    roots: () => call("roots"),
    getMeta: async (id) => link(await call("meta", { id })),
    listChildren: async (id) => (await call("list", { id })).map(link),
    download: (id) => call("download", { id }),
    downloadBuffer: async (id) =>
      Buffer.from((await call("download", { id })).base64, "base64"),
    createBinary: async ({ name, parentId, buffer }) =>
      link(
        await call(
          "create",
          { name, parentId, base64: Buffer.from(buffer).toString("base64") },
          true,
        ),
      ),
    createFolder: async (parentId, name) =>
      link(await call("mkdir", { parentId, name }, true)),
    updateBinary: async (
      id,
      { buffer, expectedModifiedTime, expectedVersion },
    ) => {
      const m = await adapter.getMeta(id);
      if (!expectedVersion && !expectedModifiedTime)
        throw fail("EXPECTED_VERSION_REQUIRED");
      if (expectedModifiedTime && expectedModifiedTime !== m.modifiedTime)
        throw fail("FILE_CHANGED_RELOAD");
      if (/macroEnabled|ms-excel\.sheet\.binary/i.test(m.mimeType))
        throw fail("LOCAL_MACRO_WRITE_NOT_SUPPORTED");
      return link(
        await call(
          "update",
          {
            id,
            base64: Buffer.from(buffer).toString("base64"),
            expectedVersion: expectedVersion || m.version,
          },
          true,
        ),
      );
    },
    rename: async (id, { name, parentId, expectedVersion }) =>
      link(await call("rename", { id, name, parentId, expectedVersion }, true)),
    copyFile: async (id, name, parentId) =>
      link(await call("copy", { id, name, parentId }, true)),
    findFilesByExactName: async (name, parentId) =>
      (await adapter.listChildren(parentId)).filter((x) => x.name === name),
    readText: async (id, options = {}) => {
      const download = await call("download", { id });
      const file = link(download.meta);
      const buffer = Buffer.from(download.base64, "base64");
      const max = Math.min(
        200000,
        Math.max(100, Number(options.maxChars) || 30000),
      );
      let result;
      if (
        /^text\//.test(file.mimeType) ||
        file.mimeType === "application/json"
      ) {
        const text = buffer.toString("utf8");
        result = { text: text.slice(0, max), partial: text.length > max };
      } else if (
        [
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ].includes(file.mimeType)
      ) {
        result = await (
          await import("./office-structured-reader.js")
        ).extractStructuredOffice(buffer, file.mimeType, max, options);
      } else if (file.mimeType === "application/pdf") {
        result = options.sopReading ? await (await import("./sop-pdf-reading.js")).readSopPdf(buffer,{limit:max,...options}) : await (await import("./pdf-reading.js")).extractPdfText(buffer,{limit:max,...options});
      } else throw fail("LOCAL_READER_NOT_SUPPORTED");
      return {
        ...result,
        file,
        supported: true,
        partial: Boolean(result.partial || result.truncated),
      };
    },
    // Google-native Sheets and PDF export require a different engine; never fake them.
    getValues: async () => {
      throw fail("LOCAL_SHEETS_API_NOT_SUPPORTED");
    },
    getFormulaMap: async () => {
      throw fail("LOCAL_SHEETS_API_NOT_SUPPORTED");
    },
    updateValues: async () => {
      throw fail("LOCAL_SHEETS_API_NOT_SUPPORTED");
    },
    exportPdf: async () => {
      throw fail("LOCAL_PDF_EXPORT_NOT_SUPPORTED");
    },
  };
  return adapter;
}
export function currentLocalAdapter() {
  const c = context.getStore();
  if (!c) throw fail("LOCAL_PERSONAL_SESSION_REQUIRED", 401);
  return localAdapter(c.orgId, c.account);
}
