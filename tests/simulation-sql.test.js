import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/INSTALL_TOUT.sql', import.meta.url), 'utf8');

test('the install script adds parent_org_id and the simulation function, additively', () => {
  assert.match(sql, /alter table public\.office_organizations add column if not exists parent_org_id uuid/i);
  assert.match(sql, /create or replace function public\.office_create_simulation\(/i);
  assert.match(sql, /'NOT_IN_PARENT'/);
  assert.match(sql, /'PARENT_IS_SIMULATION'/);
  assert.match(sql, /revoke all on function public\.office_create_simulation[^;]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.office_create_simulation[^;]*to service_role/i);
});

test('the simulation function copies nothing from the parent', () => {
  const body = sql.slice(sql.search(/function public\.office_create_simulation/i));
  const fn = body.slice(0, body.search(/\$\$;\s*revoke/i));
  assert.doesNotMatch(fn, /office_google_connections|office_firm_drive|office_firm_settings/i);
});
