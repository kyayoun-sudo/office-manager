type Credentials = { client_id: string; client_secret: string; refresh_token: string };

export async function oauthCredentials(
  env: (name: string) => string | undefined,
  request: typeof fetch = fetch
): Promise<Credentials | null> {
  const direct = {
    client_id: env("GOOGLE_OAUTH_CLIENT_ID") || "",
    client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET") || "",
    refresh_token: env("GOOGLE_OAUTH_REFRESH_TOKEN") || ""
  };
  if (direct.client_id && direct.client_secret && direct.refresh_token) return direct;

  const base = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const org = env("DEFAULT_ORG_ID");
  if (!base || !key || !org) return null;

  const response = await request(`${base.replace(/\/$/, "")}/rest/v1/rpc/office_get_google_drive_secret`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_org_id: org })
  });
  if (!response.ok) throw new Error(`GOOGLE_CREDENTIAL_LOOKUP_FAILURE_${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length > 1) throw new Error("GOOGLE_CREDENTIAL_LOOKUP_INVALID");
  const stored = rows[0];
  if (!stored?.client_id || !stored?.client_secret || !stored?.refresh_token) return null;
  return { client_id: stored.client_id, client_secret: stored.client_secret, refresh_token: stored.refresh_token };
}
