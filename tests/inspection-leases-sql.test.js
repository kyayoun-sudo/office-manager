import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('reader lease SQL is rerunnable, exclusive, scoped and unavailable to frontend roles', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.office_agent_checkpoints(org_id uuid not null, agent_key text not null check(length(agent_key) between 2 and 60), status text, report jsonb not null default '{}', updated_at timestamptz, primary key(org_id,agent_key));
      alter table public.office_agent_checkpoints enable row level security;
      revoke all on public.office_agent_checkpoints from public,anon,authenticated;
      grant select,insert,update on public.office_agent_checkpoints to service_role;`);
    const sql = await readFile(new URL('../db/inspection-reader-leases.sql', import.meta.url), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const org = '00000000-0000-0000-0000-000000000001', scope = 'a'.repeat(64), token1 = '00000000-0000-0000-0000-000000000002', token2 = '00000000-0000-0000-0000-000000000003';
    const call = async (fn, token, scoped = scope) => (await db.query(`select public.${fn}($1::uuid,$2,$3::uuid,600) as ok`, [org, scoped, token])).rows[0].ok;
    await db.exec('set role service_role');
    assert.equal(await call('office_claim_reader_lease', token1), true);
    assert.equal(await call('office_claim_reader_lease', token2), false);
    assert.equal(await call('office_claim_reader_lease', token2, 'b'.repeat(64)), true);
    assert.equal(await call('office_renew_reader_lease', token2), false);
    assert.equal(await call('office_release_reader_lease', token2), false);
    assert.equal(await call('office_renew_reader_lease', token1), true);
    await db.query(`update public.office_agent_checkpoints set report=jsonb_set(report,'{expires_at}',to_jsonb('2000-01-01T00:00:00Z'::text)) where report->>'scope'=$1`, [scope]);
    assert.equal(await call('office_claim_reader_lease', token2), true);
    assert.equal(await call('office_renew_reader_lease', token1), false);
    assert.equal(await call('office_release_reader_lease', token1), false);
    assert.equal(await call('office_release_reader_lease', token2), true);
    await db.exec('reset role; set role anon');
    await assert.rejects(() => call('office_claim_reader_lease', token1), /permission denied/);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(() => call('office_claim_reader_lease', token1), /permission denied/);
    await db.exec('reset role');
    const functions = await db.query("select prosecdef from pg_proc where proname like 'office_%reader_lease'");
    assert.ok(functions.rows.every(r => r.prosecdef === false));
  } finally { await db.close(); }
});
