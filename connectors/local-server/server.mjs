import http from "node:http";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { localFiles } from "./files.mjs";
import { verifyRequest, fail, MAX_BYTES } from "./protocol.mjs";
export async function createConnector(
  config,
  secret = process.env.OFFICE_LOCAL_CONNECTOR_SECRET,
) {
  if (!secret || secret.length < 32) throw fail("CONNECTOR_SECRET_REQUIRED");
  const files = await localFiles(config);
  return http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (req.method !== "POST" || req.url !== "/v1")
        throw fail("NOT_FOUND", 404);
      let raw = "";
      let size = 0;
      for await (const buf of req) {
        size += buf.length;
        if (size > (MAX_BYTES * 4) / 3 + 10000)
          throw fail("REQUEST_TOO_LARGE", 413);
        raw += buf.toString("utf8");
      }
      const claims = verifyRequest(
        secret,
        String(req.headers.authorization || "").replace(/^Bearer /, ""),
        raw,
        config.org_id,
      );
      let b;
      try {
        b = JSON.parse(raw);
      } catch {
        throw fail("INVALID_JSON");
      }
      const result = await files.execute(b, claims);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      const mapped = { ENOENT: 404, EEXIST: 409, EACCES: 403, EPERM: 403 };
      res.writeHead(e.statusCode || mapped[e.code] || 500, {
        "Content-Type": "application/json",
      });
      res.end(
        JSON.stringify({
          error: e.statusCode
            ? e.message
            : e.code === "EEXIST"
              ? "FILE_ALREADY_EXISTS"
              : mapped[e.code]
                ? "FILE_ACCESS_FAILED"
                : "CONNECTOR_FAILED",
        }),
      );
    }
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const arg = process.argv.indexOf("--config");
  if (arg < 0) throw fail("CONFIG_FILE_REQUIRED");
  const config = JSON.parse(await fs.readFile(process.argv[arg + 1], "utf8"));
  const server = await createConnector(config);
  const port = Number(config.port) || 8788;
  server.listen(port, "127.0.0.1", () =>
    process.stdout.write(
      "Office Manager local connector listening on loopback port " +
        port +
        "\n",
    ),
  );
}
