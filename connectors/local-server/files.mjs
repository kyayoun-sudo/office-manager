import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fail, MAX_BYTES } from "./protocol.mjs";
const FOLDER = "application/vnd.google-apps.folder";
const mime = (name) =>
  ({
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
  })[path.extname(name).toLowerCase()] || "application/octet-stream";
const nameOf = (n) => {
  if (
    typeof n !== "string" ||
    !n.trim() ||
    n.length > 180 ||
    /[/\\:\x00-\x1f<>"|?*]/.test(n) ||
    /^[. ]|[. ]$/.test(n) ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(n)
  )
    throw fail("INVALID_FILE_NAME");
  return n;
};
export async function localFiles(config) {
  if (
    typeof config.state_file !== "string" ||
    !path.isAbsolute(config.state_file)
  )
    throw fail("STATE_FILE_REQUIRED");
  if (!config.org_id || !Array.isArray(config.roots) || !config.roots.length)
    throw fail("CONNECTOR_CONFIG_REQUIRED");
  const roots = new Map();
  for (const r of config.roots) {
    if (
      !/^[a-zA-Z0-9_-]{1,60}$/.test(r.id) ||
      roots.has(r.id) ||
      !path.isAbsolute(r.path)
    )
      throw fail("INVALID_ROOT");
    const p = await fs.realpath(r.path);
    roots.set(r.id, { ...r, path: p });
  }
  const statePath = path.resolve(config.state_file);
  for (const r of roots.values())
    if (statePath === r.path || statePath.startsWith(r.path + path.sep))
      throw fail("STATE_MUST_BE_OUTSIDE_DOCUMENTS");
  let state = { files: {} };
  try {
    state = JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  let chain = Promise.resolve();
  async function save() {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    const tmp = statePath + "." + randomUUID() + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
    await fs.rename(tmp, statePath);
  }
  function access(root, subject, write) {
    const r = roots.get(root);
    if (!r) throw fail("FILE_NOT_FOUND", 404);
    const email = String(subject).toLowerCase();
    if (
      !(r.readers || [])
        .concat(r.writers || [])
        .some((x) => String(x).toLowerCase() === email)
    )
      throw fail("ROOT_NOT_ALLOWED", 403);
    if (
      write &&
      !(r.writers || []).some((x) => String(x).toLowerCase() === email)
    )
      throw fail("ROOT_READ_ONLY", 403);
    return r;
  }
  function entry(id) {
    if (id?.startsWith("local:root:"))
      return { root: id.slice(11), rel: "", id };
    const e = state.files?.[id];
    if (!e) throw fail("FILE_NOT_FOUND", 404);
    return { ...e, id };
  }
  async function resolve(e, subject, write = false) {
    const r = access(e.root, subject, write);
    if (
      typeof e.rel !== "string" ||
      path.isAbsolute(e.rel) ||
      e.rel.split(/[\\/]/).includes("..")
    )
      throw fail("PATH_NOT_ALLOWED", 403);
    const target = path.resolve(r.path, e.rel);
    if (target !== r.path && !target.startsWith(r.path + path.sep))
      throw fail("PATH_NOT_ALLOWED", 403);
    let p = r.path;
    for (const seg of e.rel.split(path.sep).filter(Boolean)) {
      p = path.join(p, seg);
      const s = await fs.lstat(p);
      if (s.isSymbolicLink()) throw fail("SYMLINK_NOT_ALLOWED", 403);
    }
    const real = await fs.realpath(target);
    if (real !== r.path && !real.startsWith(r.path + path.sep))
      throw fail("PATH_NOT_ALLOWED", 403);
    return target;
  }
  function register(root, rel) {
    for (const [id, e] of Object.entries(state.files))
      if (e.root === root && e.rel === rel) return id;
    const id = "local:" + randomUUID();
    state.files[id] = { root, rel };
    return id;
  }
  async function meta(id, subject) {
    const e = entry(id),
      p = await resolve(e, subject),
      s = await fs.stat(p);
    if (!s.isDirectory() && !s.isFile()) throw fail("UNSUPPORTED_FILE");
    const version = s.isFile()
      ? createHash("sha256")
          .update(await boundedRead(p, s))
          .digest("hex")
      : String(s.mtimeMs);
    return {
      id,
      name: e.rel ? path.basename(p) : roots.get(e.root).name || e.root,
      mimeType: s.isDirectory() ? FOLDER : mime(p),
      size: s.size,
      modifiedTime: s.mtime.toISOString(),
      version,
      parents: e.rel
        ? [
            path.dirname(e.rel) === "."
              ? "local:root:" + e.root
              : register(e.root, path.dirname(e.rel)),
          ]
        : [],
      provider: "local",
      trashed: false,
    };
  }
  async function boundedRead(p, s) {
    if (s.size > MAX_BYTES) throw fail("FILE_TOO_LARGE", 413);
    return fs.readFile(p);
  }
  async function list(id, subject) {
    const e = entry(id),
      p = await resolve(e, subject);
    const children = await fs.readdir(p, { withFileTypes: true });
    const out = [];
    for (const x of children) {
      if (
        x.name === ".office-manager-versions" ||
        x.name.startsWith(".om-") ||
        x.isSymbolicLink() ||
        (!x.isFile() && !x.isDirectory())
      )
        continue;
      if (out.length >= 500) throw fail("FOLDER_TOO_LARGE_USE_SUBFOLDER", 413);
      const cid = register(e.root, path.join(e.rel, x.name));
      try {
        out.push(await meta(cid, subject));
      } catch (error) {
        if (error.message === "FILE_TOO_LARGE")
          out.push({
            id: cid,
            name: x.name,
            mimeType: mime(x.name),
            too_large: true,
            provider: "local",
          });
        else throw error;
      }
    }
    await save();
    return out;
  }
  const binary = (b) => {
    if (
      typeof b !== "string" ||
      b.length > Math.ceil((MAX_BYTES * 4) / 3) + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        b,
      )
    )
      throw fail("INVALID_BINARY");
    const buf = Buffer.from(b, "base64");
    if (buf.length > MAX_BYTES) throw fail("FILE_TOO_LARGE", 413);
    return buf;
  };
  async function create(b, subject, directory = false) {
    const e = entry(b.parentId),
      parent = await resolve(e, subject, true),
      s = await fs.stat(parent);
    if (!s.isDirectory()) throw fail("FOLDER_REQUIRED");
    const name = nameOf(b.name),
      dest = path.join(parent, name);
    if (directory) await fs.mkdir(dest);
    else
      await fs.writeFile(dest, binary(b.base64), { flag: "wx", mode: 0o600 });
    const id = register(e.root, path.join(e.rel, name));
    await save();
    return meta(id, subject);
  }
  async function update(b, subject) {
    const e = entry(b.id);
    if (!e.rel) throw fail("ROOT_WRITE_NOT_ALLOWED", 403);
    const p = await resolve(e, subject, true),
      before = await meta(b.id, subject);
    if (before.mimeType === FOLDER) throw fail("FILE_REQUIRED");
    if (!b.expectedVersion || b.expectedVersion !== before.version)
      throw fail("FILE_CHANGED_RELOAD", 409);
    const buf = binary(b.base64),
      lock = p + ".om-lock";
    let h;
    try {
      h = await fs.open(lock, "wx");
    } catch {
      throw fail("FILE_BUSY", 409);
    }
    let temp;
    try {
      const recheck = await meta(b.id, subject);
      if (recheck.version !== before.version)
        throw fail("FILE_CHANGED_RELOAD", 409);
      const old = await fs.readFile(p);
      const archive = path.join(
        roots.get(e.root).path,
        ".office-manager-versions",
        b.id.slice(6),
      );
      for (const dir of [path.dirname(archive), archive]) {
        try {
          await fs.mkdir(dir, { mode: 0o700 });
        } catch (err) {
          if (err.code !== "EEXIST") throw err;
        }
        const st = await fs.lstat(dir);
        if (st.isSymbolicLink() || !st.isDirectory())
          throw fail("UNSAFE_ARCHIVE", 403);
      }
      await fs
        .writeFile(path.join(archive, before.version), old, {
          flag: "wx",
          mode: 0o600,
        })
        .catch((err) => {
          if (err.code !== "EEXIST") throw err;
        });
      temp = path.join(path.dirname(p), ".om-" + randomUUID());
      await fs.writeFile(temp, buf, { flag: "wx", mode: 0o600 });
      if ((await meta(b.id, subject)).version !== before.version)
        throw fail("FILE_CHANGED_RELOAD", 409);
      await fs.rename(temp, p);
      temp = null;
      return meta(b.id, subject);
    } finally {
      await h.close();
      await fs.unlink(lock).catch(() => {});
      if (temp) await fs.unlink(temp).catch(() => {});
    }
  }
  async function rename(b, subject) {
    const e = entry(b.id);
    if (!e.rel) throw fail("ROOT_WRITE_NOT_ALLOWED", 403);
    const p = await resolve(e, subject, true),
      before = await meta(b.id, subject);
    if (before.mimeType === FOLDER)
      throw fail("FOLDER_MOVE_NOT_SUPPORTED", 409);
    if (b.expectedVersion !== before.version)
      throw fail("FILE_CHANGED_RELOAD", 409);
    const parentEntry = b.parentId
      ? entry(b.parentId)
      : {
          root: e.root,
          rel: path.dirname(e.rel) === "." ? "" : path.dirname(e.rel),
        };
    if (parentEntry.root !== e.root)
      throw fail("CROSS_ROOT_MOVE_NOT_SUPPORTED", 409);
    const parent = await resolve(parentEntry, subject, true);
    const dest = path.join(parent, nameOf(b.name || path.basename(p)));
    if (dest === p) return before;
    // Link with exclusive destination semantics; never overwrite a different existing file.
    await fs.link(p, dest);
    try {
      if ((await meta(b.id, subject)).version !== before.version)
        throw fail("FILE_CHANGED_RELOAD", 409);
      await fs.unlink(p);
    } catch (err) {
      await fs.unlink(dest).catch(() => {});
      throw err;
    }
    state.files[b.id] = {
      root: e.root,
      rel: path.relative(roots.get(e.root).path, dest),
    };
    await save();
    return meta(b.id, subject);
  }
  async function execute(b, claims) {
    const subject = claims.subject;
    const write = ["create", "update", "rename", "mkdir", "copy"].includes(
      b.action,
    );
    if (write && !claims.write) throw fail("WRITE_NOT_ALLOWED", 403);
    if (b.action === "roots")
      return {
        roots: [...roots.values()]
          .filter((r) => {
            try {
              access(r.id, subject, false);
              return true;
            } catch {
              return false;
            }
          })
          .map((r) => ({
            id: "local:root:" + r.id,
            name: r.name || r.id,
            writable: (r.writers || []).some(
              (x) => x.toLowerCase() === subject.toLowerCase(),
            ),
          })),
      };
    if (b.action === "meta") return meta(b.id, subject);
    if (b.action === "list") return list(b.id, subject);
    if (b.action === "download") {
      const e = entry(b.id),
        p = await resolve(e, subject),
        m = await meta(b.id, subject);
      if (m.mimeType === FOLDER) throw fail("FILE_REQUIRED");
      const buf = await boundedRead(p, await fs.stat(p));
      if (createHash("sha256").update(buf).digest("hex") !== m.version)
        throw fail("FILE_CHANGED_RELOAD", 409);
      return { meta: m, base64: buf.toString("base64") };
    }
    if (b.action === "create") return create(b, subject);
    if (b.action === "mkdir") return create(b, subject, true);
    if (b.action === "update") return update(b, subject);
    if (b.action === "rename") return rename(b, subject);
    if (b.action === "copy") {
      const e = entry(b.id),
        p = await resolve(e, subject),
        m = await meta(b.id, subject);
      if (m.mimeType === FOLDER) throw fail("FILE_REQUIRED");
      return create(
        {
          ...b,
          base64: (await boundedRead(p, await fs.stat(p))).toString("base64"),
        },
        subject,
      );
    }
    throw fail("ACTION_NOT_SUPPORTED");
  }
  return {
    async execute(b, c) {
      const next = chain.then(async () => {
        const result = await execute(b, c);
        await fs.mkdir(path.dirname(statePath), { recursive: true });
        await fs.appendFile(
          statePath + ".audit.jsonl",
          JSON.stringify({
            at: new Date().toISOString(),
            subject: c.subject,
            action: b.action,
            id: b.id || null,
            parentId: b.parentId || null,
          }) + "\n",
          { mode: 0o600 },
        );
        return result;
      });
      chain = next.catch(() => {});
      return next;
    },
  };
}
