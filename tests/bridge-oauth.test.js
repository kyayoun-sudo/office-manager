import test from "node:test";
import assert from "node:assert/strict";
import { oauthCredentials } from "../supabase/functions/taty-google-bridge/oauth-credentials.ts";

const config = { SUPABASE_URL: "https://example.supabase.co/", SUPABASE_SERVICE_ROLE_KEY: "test-key", DEFAULT_ORG_ID: "test-org" };
const credentials = { client_id: "client", client_secret: "secret", refresh_token: "refresh" };

test("complete environment credentials retain priority", async () => {
  const env = { GOOGLE_OAUTH_CLIENT_ID: "client", GOOGLE_OAUTH_CLIENT_SECRET: "secret", GOOGLE_OAUTH_REFRESH_TOKEN: "refresh" };
  assert.deepEqual(await oauthCredentials(name => env[name], () => { throw new Error("Unexpected request"); }), credentials);
});

test("stored credentials use only the configured organisation", async () => {
  const result = await oauthCredentials(name => config[name], async (url, init) => {
    assert.equal(url, "https://example.supabase.co/rest/v1/rpc/office_get_google_drive_secret");
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body), { p_org_id: "test-org" });
    assert.equal(init.headers.Authorization, "Bearer test-key");
    return Response.json([credentials]);
  });
  assert.deepEqual(result, credentials);
});

test("missing organisation never queries credentials", async () => {
  assert.equal(await oauthCredentials(name => name === "DEFAULT_ORG_ID" ? undefined : config[name], () => { throw new Error("Unexpected request"); }), null);
});

test("incomplete stored credentials require connection", async () => {
  assert.equal(await oauthCredentials(name => config[name], async () => Response.json([{ client_id: "client" }])), null);
});

test("lookup failure never includes secret response content", async () => {
  await assert.rejects(oauthCredentials(name => config[name], async () => new Response("private-data", { status: 403 })), /^Error: GOOGLE_CREDENTIAL_LOOKUP_FAILURE_403$/);
});

test("multiple credential rows are rejected", async () => {
  await assert.rejects(oauthCredentials(name => config[name], async () => Response.json([credentials, credentials])), /GOOGLE_CREDENTIAL_LOOKUP_INVALID/);
});
