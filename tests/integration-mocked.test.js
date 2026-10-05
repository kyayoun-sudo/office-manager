// Integration tests through the real tool/Drive layers with a mocked fetch
// (Google bridge + Supabase REST). No network, no real file.
import { test, before } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.ORPAILLEUR_JOB_SECRET = "job-secret";
delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

const FOLDER = "application/vnd.google-apps.folder";
const SHEET = "application/vnd.google-apps.spreadsheet";

const state = {
  files: new Map(),
  bridgeCalls: [],
  queue: new Map()
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function pbcRows() {
  const header = new Array(20).fill("H");
  const row = (ref, received, status) => {
    const r = new Array(19).fill("");
    r[0] = ref; r[2] = `Doc ${ref}`; r[10] = "Oui"; r[14] = "2026-09-01";
    r[15] = received; r[17] = received; r[18] = status;
    return r;
  };
  return [header, row("PBC-001", "Non", ""), row("PBC-002", "Oui", state.pbc2Status)];
}

globalThis.fetch = async (url, options = {}) => {
  url = String(url);
  const body = options.body ? JSON.parse(options.body) : null;

  if (url.endsWith("/functions/v1/taty-google-bridge")) {
    state.bridgeCalls.push(body.action);
    switch (body.action) {
      case "list_children":
        return json({ files: [...state.files.values()].filter(f => f.parents.includes(body.parent_id)) });
      case "create_folder": {
        const id = `new-${state.files.size + 1}`;
        state.files.set(id, { id, name: body.name, mimeType: FOLDER, parents: [body.parent_id] });
        return json(state.files.get(id));
      }
      case "copy_file":
        return json({ error: "copy_file must not be called" }, 500);
      case "file_metadata":
        return json(state.files.get(body.file_id) || { id: body.file_id, name: "x", mimeType: SHEET, webViewLink: "u" });
      case "sheet_get":
        return json({ values: body.range.startsWith("PBC_MASTER") ? pbcRows() : [["Manager", "Awa Sy"]] });
      default:
        return json({ error: `unexpected ${body.action}` }, 500);
    }
  }

  if (url.startsWith("https://supabase.test/rest/v1/office_action_queue")) {
    const [row] = body;
    if (state.queue.has(row.idempotency_key)) return json([]); // ignore-duplicates
    state.queue.set(row.idempotency_key, row);
    return json([{ id: row.idempotency_key, ...row }]);
  }
  if (url.startsWith("https://supabase.test/rest/v1/office_agent_tool_events")) {
    return json([{ id: "evt" }]);
  }
  return json({ error: `unmocked ${url}` }, 500);
};

let drive;
let tools;
before(async () => {
  drive = await import("../lib/google-drive.js");
  const { buildSpecialistTools } = await import("../lib/agent-tools.js");
  tools = Object.fromEntries(
    buildSpecialistTools("mission-controller", { orgId: "org", runId: "run" }).map(t => [t.name, t])
  );
});

test("mission skeleton: folders created, no template file copied", async () => {
  state.files.clear();
  state.bridgeCalls.length = 0;
  for (const f of [
    { id: "TPL", name: "STRUCTURE_MISSION", mimeType: FOLDER, parents: ["ROOT"] },
    { id: "TPL-WP", name: "05_WORKING_PAPERS", mimeType: FOLDER, parents: ["TPL"] },
    { id: "WP1", name: "Modèle WP Trésorerie", mimeType: SHEET, parents: ["TPL-WP"] },
    { id: "WP2", name: "Modèle WP Ventes", mimeType: SHEET, parents: ["TPL-WP"] },
    { id: "DEST", name: "Missions", mimeType: FOLDER, parents: ["ROOT"] }
  ]) state.files.set(f.id, f);

  const result = await drive.syncFolderFromTemplate({
    templateFolderId: "TPL",
    destinationParentId: "DEST",
    destinationName: "ABC_2025",
    foldersOnly: true
  });
  assert.equal(result.filesCopied, 0);
  assert.equal(result.foldersCreated, 2);
  assert.deepEqual(result.filesNotCopied.map(f => f.id).sort(), ["WP1", "WP2"]);
  assert.ok(!state.bridgeCalls.includes("copy_file"));
});

async function runReminders() {
  const out = await tools.detect_overdue_pbc_reminders.invoke(
    {},
    JSON.stringify({
      spreadsheet_file_id: "CHK",
      mission_id: null,
      mission_manager_name: null,
      client_site_responsible_name: null,
      create_actions: true
    })
  );
  return JSON.parse(out);
}

test("reminders: one pending action per item/deadline/state, no duplicate, no email", async () => {
  state.queue.clear();
  state.files.set("CHK", { id: "CHK", name: "ABC_PBC_CHECKLIST", mimeType: SHEET, parents: ["X"], webViewLink: "u" });
  state.pbc2Status = "Partiel";

  const first = await runReminders();
  assert.equal(first.overdue_count, 2);
  assert.equal(first.email_sent, false);
  assert.equal(first.actions.filter(a => a.created).length, 2);
  for (const action of state.queue.values()) {
    assert.equal(action.payload.dispatch_status, "PENDING_EMAIL_DISPATCHER");
    assert.ok(action.payload.recipients.every(r => r.email === null));
  }

  const second = await runReminders();
  assert.equal(second.actions.filter(a => a.created).length, 0, "same state/deadline: no duplicate");

  state.pbc2Status = "Non conforme";
  const third = await runReminders();
  const created = third.actions.filter(a => a.created).map(a => a.reference);
  assert.deepEqual(created, ["PBC-002"], "state changed to NON_CONFORME: one new reminder");
  assert.equal(state.queue.size, 3);
});
