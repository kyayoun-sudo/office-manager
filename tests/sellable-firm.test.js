import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFacts } from '../lib/kpi.js';
import { capabilityState } from '../lib/capabilities.js';
import { resetFirm } from '../lib/accounts.js';

test('team views ignore archived or cancelled missions (an older space)', async () => {
  const calls = [];
  const fetchRows = async path => {
    calls.push(path);
    if (path.startsWith('office_missions')) return [{ id: 'm-live', name: 'En cours', status: 'active' }];
    if (path.startsWith('office_mission_assignments')) return [{ office_mission_id: 'm-live', staff_profile_id: 's1' }, { office_mission_id: 'm-old', staff_profile_id: 's1' }];
    if (path.startsWith('office_action_queue')) return [{ id: 'a1', office_mission_id: 'm-old' }, { id: 'a2', office_mission_id: null }];
    return [];
  };
  const f = await loadFacts('org', fetchRows);
  assert.ok(calls.find(c => c.startsWith('office_missions')).includes('status=not.in.('));
  assert.deepEqual(f.assignments.map(a => a.office_mission_id), ['m-live']);
  assert.deepEqual(f.actions.map(a => a.id), ['a2']);
});

test('skills read in another Drive are not shown for the current Drive', async () => {
  const state = { status: 'done', drive_id: 'OLD', people: [{ name: 'X' }] };
  const drive = { findFilesByExactName: async () => [{ id: 'f' }], downloadBuffer: async () => Buffer.from(JSON.stringify(state)) };
  const other = await capabilityState({ drive, folder: 'mem', driveId: 'NEW' });
  assert.equal(other.status, 'none');
  assert.equal(other.people.length, 0);
  const same = await capabilityState({ drive, folder: 'mem', driveId: 'OLD' });
  assert.equal(same.people.length, 1);
});

test('« Repartir de zéro »: owner only, EFFACER required, owner kept as owner of a blank space', async () => {
  const owner = { auth_user_id: 'u1', email: 'o@c.ci', role: 'owner', display_name: 'O' };
  await assert.rejects(resetFirm('org', { ...owner, role: 'partner' }, { confirm: 'EFFACER' }), /OWNER_ONLY/);
  await assert.rejects(resetFirm('org', owner, { confirm: 'oui' }, { purgeFirm: async () => ({}) }), /TYPE_EFFACER_TO_CONFIRM/);
  let purgedWith = null; const inserted = [];
  const r = await resetFirm('org', owner, { confirm: 'EFFACER' }, {
    purgeFirm: async (org, acc, d) => { purgedWith = d.keepAuthUser; return { erased: true }; },
    fetchRows: async (path, opts) => { inserted.push(JSON.parse(opts.body)[0]); return null; }
  });
  assert.equal(r.reset, true);
  assert.equal(purgedWith, 'u1', 'the person restarting keeps their sign-in');
  assert.equal(inserted[0].role, 'owner');
  // Purge SQL not installed → nothing erased, no owner row reinserted.
  const none = [];
  await assert.rejects(resetFirm('org', owner, { confirm: 'EFFACER' }, {
    purgeFirm: async () => { throw Object.assign(new Error('PURGE_SQL_NOT_INSTALLED'), { status: 409 }); },
    fetchRows: async (p, o) => { none.push(o); return null; }
  }), /PURGE_SQL_NOT_INSTALLED/);
  assert.equal(none.length, 0);
});

test('a new firm kit: its own identifier and fresh secrets, owner addresses, scheduler SQL filled in', async () => {
  const { newFirmKit, renderKit } = await import('../scripts/new-firm.mjs');
  assert.throws(() => newFirmKit({ url: 'https://a.vercel.app' }), /OWNER_REQUIRED/);
  assert.throws(() => newFirmKit({ url: 'http://a', owners: ['x@y.ci'] }), /URL_REQUIRED/);
  const a = newFirmKit({ name: 'A', url: 'https://a.vercel.app/', owners: ['Associe@A.ci'] });
  const b = newFirmKit({ name: 'B', url: 'https://b.vercel.app', owners: ['p@b.ci'] });
  const env = k => Object.fromEntries(k.env.map(([n, v]) => [n, v]));
  assert.notEqual(a.orgId, b.orgId);
  assert.notEqual(env(a).OWNER_APPROVAL_SECRET, env(b).OWNER_APPROVAL_SECRET, 'never the same secret for two firms');
  assert.equal(env(a).FIRST_OWNER_EMAILS, 'associe@a.ci');
  assert.ok(a.cron.includes('https://a.vercel.app/api/app?route=scheduler-tick') && a.cron.includes(env(a).OFFICE_MANAGER_SCHEDULER_SECRET));
  assert.ok(!a.cron.includes('VOTRE'));
  assert.match(renderKit(a), /https:\/\/a\.vercel\.app\/oauth\/google\/callback/);
});
