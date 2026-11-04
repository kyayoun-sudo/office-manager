// The same rest() calls on a plain PostgreSQL (VPS, no Supabase): installed schema, real tables, the URL forms the code uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createSqlRest, buildStatement, loadCatalog } from '../lib/sql-rest.js';

const ROOT = new URL('../', import.meta.url);
const ORG = '6c2fe1e2-3daf-4795-9d09-3fdb95e52942', MISSION = 'ef188e85-0522-4fd2-937c-0549dedef5f1';
let shared;
async function setup() {
  if (shared) return shared;
  const pg = new PGlite();
  // The VPS order: compatibility first (roles, auth.uid), then the application's tables.
  await pg.exec(readFileSync(new URL('db/vps-compat.sql', ROOT), 'utf8'));
  await pg.exec(readFileSync(new URL('db/INSTALL_TOUT.sql', ROOT), 'utf8'));
  const db = { role: 'service_role',
    query: async (sql, params) => (await pg.query(sql, params)).rows,
    transaction: fn => pg.transaction(tx => fn(async (sql, params) => (await tx.query(sql, params)).rows))
  };
  const sr = createSqlRest(db);
  await pg.query(`insert into office_organizations (id, slug, name) values ($1, 'pilote', 'Cabinet pilote')`, [ORG]);
  await pg.query(`insert into office_missions (id, org_id, mission_code, name, status) values ($1, $2, 'PAGFIC', 'Audit projet', 'fieldwork')`, [MISSION, ORG]);
  shared = { pg, db, rest: sr.run };
  return shared;
}

test('select: eq, in, is, neq, order, limit, select list with JSON path alias', async () => {
  const { rest } = await setup();
  const rows = await rest('office_action_queue', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([
    { org_id: ORG, agent_key: 'orpailleur', action_type: 'A', summary: 's1', status: 'pending', work_state: 'planned', idempotency_key: 'k1', payload: { file_name: 'GL 2023.xls', n: 1 } },
    { org_id: ORG, agent_key: 'sika', action_type: 'B', summary: 's2', status: 'pending', work_state: 'planned', idempotency_key: 'k2', payload: { file_name: 'PTBA.xlsx', n: 2 } }]) });
  assert.equal(rows.length, 2);
  assert.match(rows[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(typeof rows[0].created_at, 'string', 'timestamps stay strings, as PostgREST gave them');
  const q = encodeURIComponent;
  const got = await rest(`office_action_queue?org_id=eq.${q(ORG)}&agent_key=in.(orpailleur,sika)&office_mission_id=is.null&action_type=neq.Z&select=id,summary,file_name:payload->>file_name,payload->n&order=summary.desc&limit=1`);
  assert.deepEqual(got.map(r => [r.summary, r.file_name, r.n]), [['s2', 'PTBA.xlsx', 2]]);
  // (a trigger of the schema adds its own recommendation rows: only this test's actions are looked at)
  assert.deepEqual(await rest(`office_action_queue?org_id=eq.${q(ORG)}&action_type=in.(A,B)&agent_key=not.in.(orpailleur,sika)&select=id`), []);
  assert.equal((await rest(`office_action_queue?org_id=eq.${q(ORG)}&action_type=in.(A,B)&agent_key=not.in.(sika)&select=id`)).length, 1);
  assert.deepEqual(await rest(`office_action_queue?id=in.()&select=id`), []);
});

test('or=(…) with ilike wildcards, nested and(), and a JSON path filter', async () => {
  const { rest } = await setup();
  const q = encodeURIComponent;
  const a = await rest(`office_action_queue?org_id=eq.${q(ORG)}&or=(summary.ilike.*S1*,and(agent_key.eq.sika,status.eq.none))&select=summary`);
  assert.deepEqual(a.map(r => r.summary), ['s1']);
  const b = await rest(`office_action_queue?org_id=eq.${q(ORG)}&payload->>file_name=like.GL*&select=summary`);
  assert.deepEqual(b.map(r => r.summary), ['s1']);
  const c = await rest(`office_action_queue?org_id=eq.${q(ORG)}&or=(idempotency_key.like.k1*,idempotency_key.like.k9*)&order=created_at.asc,id.asc&select=idempotency_key`);
  assert.deepEqual(c.map(r => r.idempotency_key), ['k1']);
});

test('upsert: ignore-duplicates keeps the first, merge-duplicates updates; return=minimal answers null', async () => {
  const { rest } = await setup();
  const row = { org_id: ORG, agent_key: 'orpailleur', action_type: 'A', summary: 'autre', status: 'pending', work_state: 'planned', idempotency_key: 'k1' };
  const ignored = await rest('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([row]) });
  assert.deepEqual(ignored, []);
  const minimal = await rest('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([row]) });
  assert.equal(minimal, null);
  const [after] = await rest(`office_action_queue?org_id=eq.${ORG}&idempotency_key=eq.k1&select=summary`);
  assert.equal(after.summary, 'autre');
});

test('PATCH guarded by updated_at (the optimistic write of the procedures), DELETE, and the trigger still runs', async () => {
  const { rest, pg } = await setup();
  const [w] = await rest('office_procedure_work?on_conflict=org_id,programme_id,procedure_code', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([{ org_id: ORG, office_mission_id: MISSION, programme_id: '11111111-1111-4111-8111-111111111111', cycle_code: 'PRJ', procedure_code: 'PRJ-01', preparer: 'p@x', status: 'to_do' }]) });
  const ok = await rest(`office_procedure_work?id=eq.${w.id}&org_id=eq.${ORG}&updated_at=eq.${encodeURIComponent(w.updated_at)}`, { method: 'PATCH', headers: { Prefer: 'return=representation', 'x-office-manager-actor': 'paul@cabinet.test', 'x-office-manager-actor-kind': 'person' },
    body: JSON.stringify({ walkthrough: [{ kind: 'k', id: '1' }], status: 'in_progress', updated_at: '2026-11-04T10:00:00.000Z' }) });
  assert.equal(ok.length, 1);
  assert.deepEqual(ok[0].walkthrough, [{ kind: 'k', id: '1' }]);
  const stale = await rest(`office_procedure_work?id=eq.${w.id}&org_id=eq.${ORG}&updated_at=eq.${encodeURIComponent(w.updated_at)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'x' }) });
  assert.deepEqual(stale, [], 'a stale updated_at changes nothing (MEMORY_CONFLICT for the caller)');
  const log = (await pg.query(`select source_table, operation, actor, actor_kind from office_mission_change_log where mission_id = $1 and source_table = 'office_procedure_work'`, [MISSION])).rows;
  assert.ok(log.length >= 2, 'the mission change journal is still written');
  assert.ok(log.some(r => r.operation === 'UPDATE' && r.actor === 'paul@cabinet.test' && r.actor_kind === 'person'), 'and it names the person who acted');
  const gone = await rest(`office_procedure_work?id=eq.${w.id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  assert.equal(gone.length, 1);
});

test('errors keep the shapes the code checks: unknown table / column, duplicate, bad value', async () => {
  const { rest } = await setup();
  await assert.rejects(rest('office_nope?select=id'), e => e.statusCode === 404 && /PGRST205/.test(e.message) && /office_nope/.test(e.message));
  await assert.rejects(rest('office_missions?select=id,nope'), e => e.statusCode === 400 && /42703/.test(e.message));
  await assert.rejects(rest('office_missions', { method: 'POST', body: JSON.stringify([{ org_id: ORG, nope: 1 }]) }), /PGRST204/);
  await assert.rejects(rest('office_missions', { method: 'POST', body: JSON.stringify([{ id: MISSION, org_id: ORG, mission_code: 'X', name: 'X' }]) }), e => e.statusCode === 409 && /23505/.test(e.message));
  await assert.rejects(rest('office_missions?id=eq.not-a-uuid&select=id'), e => e.statusCode === 400 && /22P02/.test(e.message));
});

test('identifiers cannot inject SQL; values are always parameters', async () => {
  const { rest, db } = await setup();
  const cat = await loadCatalog(db.query);
  await assert.rejects(rest('office_missions;drop table office_missions?select=id'), /PGRST205/);
  await assert.rejects(rest('office_missions?select=id,"name";drop'), /42703/);
  const st = buildStatement(`office_missions?name=eq.${encodeURIComponent("x'); drop table office_missions; --")}&select=id`, {}, cat);
  assert.ok(!/drop/i.test(st.sql));
  assert.deepEqual(await rest(`office_missions?name=eq.${encodeURIComponent("x'); drop table office_missions; --")}&select=id`), []);
  assert.equal((await rest(`office_missions?id=eq.${MISSION}&select=id`)).length, 1);
});

test('rpc: a function of the installed schema is called with named arguments', async () => {
  const { rest, db } = await setup();
  const cat = await loadCatalog(db.query);
  assert.ok(cat.functions.has('office_ai_usage_increment'), 'the function exists in the schema');
  const fn = cat.functions.get('office_ai_usage_increment');
  const args = Object.fromEntries(fn.args.map(a => [a.name, /int|numeric/.test(a.type) ? 1 : /date/.test(a.type) ? '2026-11-04' : /uuid/.test(a.type) ? ORG : 'x']));
  const out = await rest('rpc/office_ai_usage_increment', { method: 'POST', body: JSON.stringify(args) });
  assert.notEqual(out, undefined);
  await assert.rejects(rest('rpc/office_nope', { method: 'POST', body: '{}' }), e => e.statusCode === 404 && /PGRST202/.test(e.message));
});

test('« Autoriser les agents » on the VPS: the approver is the identity the server verified (auth.uid), never a value of the body', async () => {
  const { rest } = await setup();
  const owner = '22222222-2222-4222-8222-222222222222';
  await rest('office_processing_permissions?on_conflict=org_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal', 'x-office-manager-auth-user': owner },
    body: JSON.stringify([{ org_id: ORG, inventory_metadata_approved: true, selected_content_approved: true, external_ai_approved: true, outbound_messaging_approved: false, approved_by: '33333333-3333-4333-8333-333333333333' }]) });
  const [p] = await rest(`office_processing_permissions?org_id=eq.${ORG}&select=approved_by,approved_at`);
  assert.equal(p.approved_by, owner);
  assert.ok(p.approved_at);
  await assert.rejects(rest('office_missions?select=id', { headers: { 'x-office-manager-auth-user': "x'; drop" } }), /invalid auth user/);
});
