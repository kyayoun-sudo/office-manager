// A firm starts from an EMPTY Supabase (2026-10-11, trial with several firms): db/INSTALL_TOUT.sql must create every
// table and every column the code reads, filters, sorts or writes. This test installs it on an empty database and
// checks the code against it, so a new column used in the code without its SQL fails here, not at a firm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';

const ROOT = new URL('../', import.meta.url);
const files = execSync('git ls-files "lib/*.js" "api/*.js" "agents/*.js"', { cwd: ROOT }).toString().trim().split('\n');
// Columns the code tolerates missing on purpose (each read wrapped in a fallback), or legacy-only paths.
const TOLERATED = new Set([]);

function usedColumns() {
  const used = new Map();
  const add = (t, c, where) => { if (!c || c === '*' || /[()>\-:.]/.test(c)) return; (used.get(t) || used.set(t, new Map()).get(t)).set(c, where); };
  for (const f of files) {
    const src = readFileSync(new URL(f, ROOT), 'utf8');
    for (const m of src.matchAll(/(?<![a-z_])((?:office|orpailleur)_[a-z_]+)\?([^'"`\n]*)/g)) {
      const [, table, query] = m;
      const sel = query.match(/(?:^|&)select=([^&$]+)/);
      if (sel) for (const c of sel[1].split(',')) add(table, c.trim(), f);
      for (const k of query.matchAll(/(?:^|&)([a-z_]+)=(?:eq|neq|in|is|not|gte|lte|lt|gt|ilike|like|cs|ov)\./g)) add(table, k[1], f);
      for (const k of query.matchAll(/(?:^|&)order=([a-z_]+)/g)) add(table, k[1], f);
      for (const k of query.matchAll(/on_conflict=([a-z_,]+)/g)) for (const c of k[1].split(',')) add(table, c, f);
    }
  }
  return used;
}

// Insert / update keys of the writes a new firm goes through (checked by hand: the generic scan above sees reads).
const WRITES = {
  office_organizations: ['id', 'slug', 'name', 'timezone', 'account_kind'],
  office_memberships: ['org_id', 'user_id', 'role', 'active'],
  office_processing_permissions: ['org_id', 'outbound_messaging_approved', 'approval_scope', 'inventory_metadata_approved', 'selected_content_approved', 'external_ai_approved'],
  office_agent_settings: ['org_id', 'agent_key', 'instruction_version', 'mode'],
  office_agent_runs: ['org_id', 'agent_key', 'status', 'metrics', 'errors', 'summary', 'finished_at'],
  office_agent_tool_events: ['org_id', 'run_id', 'parent_agent_key', 'specialist_key', 'tool_name', 'phase', 'input_summary', 'output_summary', 'metadata', 'started_at', 'finished_at'],
  office_action_queue: ['org_id', 'agent_key', 'office_mission_id', 'assigned_staff_profile_id', 'action_type', 'idempotency_key', 'summary', 'evidence', 'payload', 'status', 'work_state', 'due_at', 'requested_at', 'approved_at', 'executed_at', 'verified_at', 'verification_evidence'],
  office_missions: ['org_id', 'mission_code', 'name', 'status', 'planned_start', 'planned_end', 'client_contact_emails', 'client_folder_id', 'drive_folder_id', 'client_name', 'memory_file_id', 'status_changed_at', 'closed_at', 'archived_at'],
  office_staff_profiles: ['org_id', 'full_name', 'email', 'role_title', 'department', 'active', 'profile_status', 'skills', 'cv_drive_file_id', 'cv_url'],
  office_mission_assignments: ['org_id', 'office_mission_id', 'staff_profile_id', 'mission_role', 'planned_start', 'planned_end', 'allocation_pct', 'status', 'responsibility_scope']
};

test('an empty Supabase gets every table and column the code uses (db/INSTALL_TOUT.sql)', async () => {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
  const sql = readFileSync(new URL('db/INSTALL_TOUT.sql', ROOT), 'utf8');
  await db.exec(sql);
  await db.exec(sql); // safe to re-run on a firm's existing base
  const rows = (await db.query("select table_name, column_name from information_schema.columns where table_schema = 'public'")).rows;
  const have = new Map();
  for (const r of rows) (have.get(r.table_name) || have.set(r.table_name, new Set()).get(r.table_name)).add(r.column_name);
  const fns = new Set((await db.query("select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'")).rows.map(r => r.proname));

  const missing = [];
  for (const [table, cols] of usedColumns()) {
    if (fns.has(table)) continue; // rpc/<function>
    if (!have.has(table)) { if (!TOLERATED.has(table)) missing.push(table + ' (table, ' + [...cols.values()][0] + ')'); continue; }
    for (const [c, where] of cols) if (!have.get(table).has(c) && !TOLERATED.has(table + '.' + c)) missing.push(table + '.' + c + ' (' + where + ')');
  }
  for (const [table, cols] of Object.entries(WRITES)) for (const c of cols) if (!have.get(table)?.has(c)) missing.push(table + '.' + c + ' (write)');
  assert.deepEqual(missing, [], 'missing in db/INSTALL_TOUT.sql:\n' + missing.join('\n'));
  await db.close();
});

test('« Autoriser les agents »: only an owner or partner of THIS firm can write the grant, stamped with their identity', async () => {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
  await db.exec(readFileSync(new URL('db/INSTALL_TOUT.sql', ROOT), 'utf8'));
  const A = '00000000-0000-0000-0000-00000000000a', B = '00000000-0000-0000-0000-00000000000b';
  const owner = '00000000-0000-0000-0000-0000000000a1', stranger = '00000000-0000-0000-0000-0000000000b1';
  await db.exec(`insert into office_organizations(id,name) values ('${A}','A'),('${B}','B');
    insert into office_memberships(org_id,user_id,role) values ('${A}','${owner}','owner'),('${B}','${stranger}','owner');`);
  const as = async (uid, stmt) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`); try { return await db.query(stmt); } finally { await db.exec('reset role;'); } };
  await as(owner, `insert into office_processing_permissions(org_id,selected_content_approved,external_ai_approved,inventory_metadata_approved,approved_by) values ('${A}',true,true,true,'${stranger}')`);
  const row = (await db.query(`select approved_by, approved_at from office_processing_permissions where org_id='${A}'`)).rows[0];
  assert.equal(row.approved_by, owner, 'the approver is the session, never a value sent by the client');
  assert.ok(row.approved_at);
  await assert.rejects(as(stranger, `insert into office_processing_permissions(org_id,external_ai_approved) values ('${A}',true) on conflict (org_id) do update set external_ai_approved=true`), /row-level security|policy/);
  await db.exec(`insert into office_missions(org_id,name) values ('${A}','M')`);
  // Supabase grants tables to « authenticated » by default (then RLS returns no row); here there is no grant at all.
  const direct = await as(owner, `select * from office_missions`).then(r => r.rows.length, () => 0);
  assert.equal(direct, 0, 'a session never reads the firm tables directly (server only)');
  await db.close();
});
