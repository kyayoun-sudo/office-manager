import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { oauthCredentials } from "./oauth-credentials.ts";
import { DEFAULT_ORG_ID } from "./deployment-config.ts";
import { tidyMoveAction } from './tidy-moves.ts';
import { createMissionBudgetAction, budgetGoogleDeps } from './mission-budget-files.ts';
import {
  BridgeError,
  createBinaryFileAction,
  findExactFileAction,
  googleBinaryDeps,
  updateBinaryFileAction
} from "./binary-files.ts";

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

  const credentials = await oauthCredentials(name =>
    Deno.env.get(name) || (name === "DEFAULT_ORG_ID" ? DEFAULT_ORG_ID : undefined)
  );
  if (credentials) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credentials.refresh_token,
        client_id: credentials.client_id,
        client_secret: credentials.client_secret
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
    fields: "id,name,mimeType,parents,modifiedTime,createdTime,webViewLink,size,description,driveId,trashed"
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

    if (action === 'create_mission_budget') {
      const read = async (table: string, filter: string) => {
        const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const response = await fetch((Deno.env.get('SUPABASE_URL') || '') + '/rest/v1/' + table + '?' + filter, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
        if (!response.ok) throw new BridgeError('BUDGET_RECORD_UNREADABLE', 503);
        return (await response.json())[0] || null;
      };
      const scope = (org: string) => 'org_id=eq.' + encodeURIComponent(org);
      return json(await createMissionBudgetAction({ ...budgetGoogleDeps(gfetch, DRIVE_ID),
        orgId: Deno.env.get('DEFAULT_ORG_ID') || DEFAULT_ORG_ID,
        getBudget: (org: string, id: string) => read('office_mission_budget_versions', scope(org) + '&id=eq.' + encodeURIComponent(id) + '&select=*&limit=1'),
        getDecision: (org: string, id: string) => read('office_mission_budget_decisions', scope(org) + '&budget_id=eq.' + encodeURIComponent(id) + '&select=decision,content_hash&order=sequence.desc&limit=1'),
        sourcesCurrent: async (org: string, budget: any) => {
          const filter = scope(org) + '&office_mission_id=eq.' + encodeURIComponent(budget.office_mission_id);
          const [plan, programme, team, mission] = await Promise.all([
            read('office_mission_plan_versions', filter + '&select=id,content_hash&order=version.desc&limit=1'),
            read('office_mission_programme_versions', filter + '&select=id,plan_id,content_hash&order=version.desc&limit=1'),
            read('office_mission_team_versions', filter + '&select=id,plan_id,content_hash&order=version.desc&limit=1'),
            read('office_missions', scope(org) + '&id=eq.' + encodeURIComponent(budget.office_mission_id) + '&select=id,name,planned_start,planned_end&limit=1')
          ]);
          const data = budget.data;
          if (!plan || !programme || !team || plan.id !== data.plan_id || plan.content_hash !== data.plan_hash || programme.id !== data.programme_id || programme.content_hash !== data.programme_hash || team.id !== data.team_version_id || team.content_hash !== data.team_hash || programme.plan_id !== plan.id || team.plan_id !== plan.id) return false;
          if (!mission || mission.name !== data.mission.name || mission.planned_start !== data.mission.planned_start || mission.planned_end !== data.mission.planned_end) return false;
          const profiles = await Promise.all(data.team.map((member: any) => read('office_staff_profiles', scope(org) + '&id=eq.' + encodeURIComponent(member.staff_profile_id) + '&active=eq.true&select=id,full_name&limit=1')));
          if (profiles.some((profile: any, index: number) => !profile || profile.full_name !== data.team[index].name)) return false;
          const [planDecision, teamDecision, programmeDecision] = await Promise.all([
            read('office_mission_plan_decisions', scope(org) + '&plan_id=eq.' + encodeURIComponent(plan.id) + '&select=decision,content_hash&order=sequence.desc&limit=1'),
            read('office_mission_review_decisions', scope(org) + '&target_kind=eq.team&target_id=eq.' + encodeURIComponent(team.id) + '&select=decision,content_hash&order=sequence.desc&limit=1'),
            read('office_mission_review_decisions', scope(org) + '&target_kind=eq.programme&target_id=eq.' + encodeURIComponent(programme.id) + '&select=decision,content_hash,reviewed_team_id&order=sequence.desc&limit=1')
          ]);
          return planDecision?.decision === 'approve' && planDecision.content_hash === plan.content_hash && teamDecision?.decision === 'approve' && teamDecision.content_hash === team.content_hash && programmeDecision?.decision === 'approve' && programmeDecision.content_hash === programme.content_hash && programmeDecision.reviewed_team_id === team.id;
        },
        claimBudget: async (org: string, id: string, hash: string) => {
          const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
          const response = await fetch((Deno.env.get('SUPABASE_URL') || '') + '/rest/v1/office_mission_budget_exports', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: org, budget_id: id, content_hash: hash }) });
          if (response.status === 409) return false;
          if (!response.ok) throw new BridgeError('BUDGET_EXPORT_CLAIM_FAILED', 503);
          return true;
        },
        folderLinked: async (org: string, mission: string, folder: string) => Boolean(await read('orpailleur_inventory', scope(org) + '&office_mission_id=eq.' + encodeURIComponent(mission) + '&file_id=eq.' + encodeURIComponent(folder) + '&is_folder=eq.true&select=file_id&limit=1'))
      }, body));
    }

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

    if (action === 'tidy_move') {
      const readRow = async (table: string, filter: string) => {
        const base = Deno.env.get('SUPABASE_URL') || '';
        const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const response = await fetch(base + '/rest/v1/' + table + '?' + filter + '&select=*&limit=1', {
          headers: { apikey: key, Authorization: 'Bearer ' + key }
        });
        if (!response.ok) throw new BridgeError('TIDY_RECORD_UNREADABLE', 503);
        return (await response.json())[0] || null;
      };
      const scope = 'org_id=eq.' + encodeURIComponent(String(body.org_id || '')) + '&request_id=eq.' + encodeURIComponent(String(body.request_id || ''));
      return json(await tidyMoveAction({
        orgId: Deno.env.get('DEFAULT_ORG_ID') || DEFAULT_ORG_ID, driveId: DRIVE_ID,
        getItem: (_org: string, _request: string, id: string) => readRow('office_tidy_items', scope + '&id=eq.' + encodeURIComponent(id)),
        getRequest: (org: string, id: string) => readRow('office_tidy_requests', 'org_id=eq.' + encodeURIComponent(org) + '&id=eq.' + encodeURIComponent(id)),
        getMetadata: fileMetadata,
        move: (id: string, from: string, to: string) => {
          const params = new URLSearchParams({ supportsAllDrives: 'true', addParents: to, removeParents: from, fields: 'id,parents' });
          return gjson('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?' + params.toString(), { method: 'PATCH', body: '{}' });
        }
      }, body));
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

    // Office Manager memory files (OFFICE_MANAGER_MAP.xlsx /
    // OFFICE_MANAGER_REGISTER.xlsx): allow-listed names and MIME type, 10 MB,
    // configured Shared Drive only, create-once / update-in-place with an
    // optimistic concurrency check. No move, no delete. See binary-files.ts.
    if (action === "find_exact_file") {
      return json(await findExactFileAction(googleBinaryDeps(gfetch, DRIVE_ID), body));
    }

    if (action === "create_binary_file") {
      return json(await createBinaryFileAction(googleBinaryDeps(gfetch, DRIVE_ID), body));
    }

    if (action === "update_binary_file") {
      return json(await updateBinaryFileAction(googleBinaryDeps(gfetch, DRIVE_ID), body));
    }

    return json({ error: "UNKNOWN_ACTION" }, 400);
  } catch (error) {
    if (error instanceof BridgeError) {
      return json({ error: error.message, code: error.code }, error.status);
    }
    console.error(error);
    return json({ error: String(error?.message || error) }, 500);
  }
});
