import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const DRIVE_ID = Deno.env.get("TATY_SHARED_DRIVE_ID") || "0AOuBC85x_FJSUk9PVA";
const JOB_SECRET = Deno.env.get("ORPAILLEUR_JOB_SECRET") || "";
const FOLDER_MIME = "application/vnd.google-apps.folder";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });

function encodeBytes(value: string) {
  return new TextEncoder().encode(value);
}

function b64url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? encodeBytes(value) : value;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function googleToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const serviceAccount = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (serviceAccount) {
    const obj = JSON.parse(serviceAccount);
    const raw = atob(
      String(obj.private_key || "").replace(
        /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,
        ""
      )
    );
    const der = Uint8Array.from(raw, c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = b64url(
      JSON.stringify({
        iss: obj.client_email,
        scope: [
          "https://www.googleapis.com/auth/drive",
          "https://www.googleapis.com/auth/spreadsheets"
        ].join(" "),
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3300
      })
    );
    const unsigned = `${header}.${payload}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      encodeBytes(unsigned)
    );
    const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`;

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
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + 50 * 60 * 1000
    };
    return cachedToken.token;
  }

  const refresh = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN");
  const client = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const secret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (refresh && client && secret) {
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
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + 50 * 60 * 1000
    };
    return cachedToken.token;
  }

  throw new Error("GOOGLE_CONNECTION_REQUIRED");
}

async function gfetch(url: string, init: RequestInit = {}) {
  const token = await googleToken();
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {})
    }
  });
}

async function gjson(url: string, init: RequestInit = {}) {
  const response = await gfetch(url, init);
  const raw = await response.text();
  let data: unknown = raw;
  if (raw) {
    try { data = JSON.parse(raw); } catch {}
  }
  if (!response.ok) {
    throw new Error(
      `GOOGLE_API_${response.status}: ${
        typeof data === "string" ? data.slice(0, 400) : JSON.stringify(data).slice(0, 400)
      }`
    );
  }
  return data as any;
}

function escapeQ(value: unknown) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function driveParams(extra: Record<string, string> = {}) {
  const p = new URLSearchParams({
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    spaces: "drive",
    corpora: "drive",
    driveId: DRIVE_ID,
    ...extra
  });
  return p;
}

async function fileMetadata(fileId: string) {
  const p = new URLSearchParams({
    supportsAllDrives: "true",
    fields: "id,name,mimeType,parents,modifiedTime,createdTime,webViewLink,size,description,driveId"
  });
  return gjson(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${p.toString()}`
  );
}

async function listChildren(parentId: string) {
  const files: any[] = [];
  let pageToken: string | null = null;
  do {
    const p = driveParams({
      q: `'${escapeQ(parentId)}' in parents and trashed = false`,
      pageSize: "100",
      fields: "files(id,name,mimeType,parents,modifiedTime,createdTime,webViewLink,size,description),nextPageToken"
    });
    if (pageToken) p.set("pageToken", pageToken);
    const data = await gjson(
      `https://www.googleapis.com/drive/v3/files?${p.toString()}`
    );
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken && files.length < 1000);
  return files;
}

async function readFile(fileId: string, maxBytes = 8_000_000) {
  const meta = await fileMetadata(fileId);
  const mime = String(meta.mimeType || "");

  if (mime === "application/vnd.google-apps.document") {
    const response = await gfetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain`
    );
    if (!response.ok) throw new Error(`GOOGLE_CONTENT_READ_${response.status}`);
    const text = await response.text();
    return { mode: "text", file: meta, text };
  }

  if (mime.startsWith("text/") || mime === "application/json") {
    const response = await gfetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`
    );
    if (!response.ok) throw new Error(`GOOGLE_CONTENT_READ_${response.status}`);
    const text = await response.text();
    return { mode: "text", file: meta, text };
  }

  if (mime === "application/vnd.google-apps.spreadsheet") {
    const response = await gfetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}`
    );
    if (!response.ok) throw new Error(`GOOGLE_CONTENT_READ_${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("FILE_TOO_LARGE_FOR_BRIDGE");
    return {
      mode: "base64",
      file: meta,
      mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      base64: bytesToBase64(bytes)
    };
  }

  const response = await gfetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`
  );
  if (!response.ok) throw new Error(`GOOGLE_CONTENT_READ_${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("FILE_TOO_LARGE_FOR_BRIDGE");
  return { mode: "base64", file: meta, mime_type: mime, base64: bytesToBase64(bytes) };
}

Deno.serve(async req => {
  try {
    if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const supplied = req.headers.get("x-orpailleur-secret") || "";
    if (!JOB_SECRET || supplied !== JOB_SECRET) {
      return json({ error: "UNAUTHORIZED" }, 401);
    }

    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "status") {
      const drive = await gjson(
        `https://www.googleapis.com/drive/v3/drives/${encodeURIComponent(DRIVE_ID)}?fields=id,name`
      );
      return json({ ok: true, drive });
    }

    if (action === "search_files") {
      const clauses = ["trashed = false"];
      if (body.parent_id) clauses.push(`'${escapeQ(body.parent_id)}' in parents`);
      if (body.mime_type) clauses.push(`mimeType = '${escapeQ(body.mime_type)}'`);
      if (body.query) {
        const q = escapeQ(body.query);
        clauses.push(`(name contains '${q}' or fullText contains '${q}')`);
      }
      const p = driveParams({
        q: clauses.join(" and "),
        pageSize: String(Math.min(Math.max(Number(body.limit) || 25, 1), 100)),
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,parents,modifiedTime,createdTime,webViewLink,size,description),nextPageToken,incompleteSearch"
      });
      return json(await gjson(`https://www.googleapis.com/drive/v3/files?${p.toString()}`));
    }

    if (action === "file_metadata") {
      return json(await fileMetadata(String(body.file_id || "")));
    }

    if (action === "read_file") {
      return json(await readFile(String(body.file_id || ""), Number(body.max_bytes) || 8_000_000));
    }

    if (action === "list_children") {
      return json({ files: await listChildren(String(body.parent_id || "")) });
    }

    if (action === "create_folder") {
      const p = new URLSearchParams({ supportsAllDrives: "true", fields: "id,name,mimeType,parents,webViewLink" });
      return json(await gjson(`https://www.googleapis.com/drive/v3/files?${p.toString()}`, {
        method: "POST",
        body: JSON.stringify({
          name: String(body.name || ""),
          mimeType: FOLDER_MIME,
          parents: [String(body.parent_id || "")]
        })
      }));
    }

    if (action === "copy_file") {
      const p = new URLSearchParams({ supportsAllDrives: "true", fields: "id,name,mimeType,parents,webViewLink" });
      return json(await gjson(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(String(body.file_id || ""))}/copy?${p.toString()}`,
        {
          method: "POST",
          body: JSON.stringify({
            name: String(body.name || ""),
            parents: [String(body.parent_id || "")]
          })
        }
      ));
    }

    if (["sheet_get", "sheet_update", "sheet_append", "sheet_clear"].includes(action)) {
      const sid = encodeURIComponent(String(body.spreadsheet_id || ""));
      const range = encodeURIComponent(String(body.range || ""));
      if (action === "sheet_get") {
        return json(await gjson(
          `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${range}?majorDimension=ROWS`
        ));
      }
      if (action === "sheet_update") {
        return json(await gjson(
          `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${range}?valueInputOption=USER_ENTERED`,
          {
            method: "PUT",
            body: JSON.stringify({ range: body.range, majorDimension: "ROWS", values: body.values || [] })
          }
        ));
      }
      if (action === "sheet_append") {
        return json(await gjson(
          `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          {
            method: "POST",
            body: JSON.stringify({ range: body.range, majorDimension: "ROWS", values: body.values || [] })
          }
        ));
      }
      return json(await gjson(
        `https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${range}:clear`,
        { method: "POST", body: JSON.stringify({}) }
      ));
    }

    return json({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: String(error?.message || error) }, 500);
  }
});
