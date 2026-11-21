import test from 'node:test';
import assert from 'node:assert/strict';
import { recordJournal, journalFromAudit, readJournal, isCorrection } from '../lib/simulation-journal.js';
import { listSimulations } from '../lib/simulation.js';
import { resetSimulationGuardCache } from '../lib/simulation-guard.js';

const PARENT = '11111111-1111-4111-8111-111111111111', SIM = '22222222-2222-4222-8222-222222222222', REAL = '44444444-4444-4444-8444-444444444444';
const MISSION = '55555555-5555-4555-8555-555555555555';
const owner = { id: 'u-owner', email: 'o@c.test' }, partner = { id: 'u-partner' }, junior = { id: 'u-jr' }, stranger = { id: 'u-x' };
process.env.OFFICE_MANAGER_MULTI_CABINET = 'on';

function world() {
  const db = { journal: [], members: [
    { org_id: SIM, auth_user_id: 'u-owner', role: 'owner', active: true }, { org_id: SIM, auth_user_id: 'u-jr', role: 'auditor', active: true },
    { org_id: PARENT, auth_user_id: 'u-partner', role: 'partner', active: true }, { org_id: PARENT, auth_user_id: 'u-jr', role: 'auditor', active: true }] };
  const kinds = { [SIM]: { account_kind: 'simulation', parent_org_id: PARENT }, [PARENT]: { account_kind: null, parent_org_id: null }, [REAL]: { account_kind: null, parent_org_id: null } };
  const fetchRows = async (path, o = {}) => {
    if (path.startsWith('office_organizations?id=eq.')) { const r = kinds[/id=eq\.([^&]+)/.exec(path)[1]]; return r ? [r] : []; }
    if (path.startsWith('office_firm_drive')) return [{ drive_id: 'folder:abc' }];
    if (path.startsWith('office_app_users?')) {
      const org = /org_id=eq\.([^&]+)/.exec(path)[1], uid = /auth_user_id=eq\.([^&]+)/.exec(path)?.[1];
      return db.members.filter(m => m.org_id === org && (!uid || m.auth_user_id === uid) && m.active).map(m => ({ ...m }));
    }
    if (path.startsWith('office_simulation_journal')) {
      if (o.method === 'POST') { db.journal.push(...JSON.parse(o.body).map((r, i) => ({ ...r, id: 'j' + db.journal.length + i, at: new Date(Date.UTC(2026, 10, 21, 10, db.journal.length)).toISOString() }))); return null; }
      const org = /org_id=eq\.([^&]+)/.exec(path)[1], actor = /actor_id=eq\.([^&]+)/.exec(path)?.[1], kind = /kind=eq\.([^&]+)/.exec(path)?.[1];
      return db.journal.filter(j => j.org_id === org && (!actor || j.actor_id === actor) && (!kind || j.kind === kind)).reverse();
    }
    throw new Error('unexpected ' + path);
  };
  resetSimulationGuardCache();
  return { db, d: { fetchRows } };
}
const UID = { owner: '66666666-6666-4666-8666-666666666666', jr: '77777777-7777-4777-8777-777777777777' };

test('a simulation journals; a real firm writes nothing', async () => {
  const { db, d } = world();
  assert.ok(await recordJournal(SIM, { kind: 'consigne', agent: 'orpailleur', body: 'Classe ce relevé', actor_id: UID.owner, actor_email: 'o@c.test', mission_id: MISSION }, d));
  assert.equal(await recordJournal(REAL, { kind: 'consigne', body: 'x' }, d), null);
  assert.equal(db.journal.length, 1); assert.equal(db.journal[0].mission_id, MISSION); assert.equal(db.journal[0].org_id, SIM);
});

test('body is bounded, empty or unknown kinds are ignored, and a failing base never throws', async () => {
  const { db, d } = world();
  await recordJournal(SIM, { kind: 'reponse', body: 'x'.repeat(9000) }, d);
  assert.equal(db.journal[0].body.length, 4000);
  assert.equal(await recordJournal(SIM, { kind: 'reponse', body: '   ' }, d), null);
  assert.equal(await recordJournal(SIM, { kind: 'raisonnement', body: 'x' }, d), null);
  assert.equal(await recordJournal(SIM, { kind: 'consigne', body: 'x' }, { fetchRows: async () => { throw new Error('down'); } }), null);
});

test('corrections and refusals come from audit events; ordinary events do not', async () => {
  const { db, d } = world();
  assert.equal(isCorrection({ action_type: 'PIECES_RENAMED' }), true);
  assert.equal(isCorrection({ action_type: 'ANYTHING', status: 'rejected' }), true);
  assert.equal(isCorrection({ action_type: 'SIMULATION_CREATED' }), false);
  await journalFromAudit(SIM, { action_type: 'SIMULATION_CREATED', agent: 'office-manager' }, d);
  await journalFromAudit(SIM, { action_type: 'PIECE_PROFILE_CORRECTED', agent: 'enhanced-auditor', approved_by: 'jr@c.test', output_ref: 'GL → balance' }, d);
  assert.equal(db.journal.length, 1); assert.equal(db.journal[0].kind, 'correction'); assert.match(db.journal[0].body, /GL → balance/); assert.equal(db.journal[0].actor_email, 'jr@c.test');
});

test('who reads what: simulation owner and parent partner read all, a member only their own, a stranger nothing', async () => {
  const { db, d } = world();
  await recordJournal(SIM, { kind: 'consigne', body: 'du patron', actor_id: UID.owner }, d);
  await recordJournal(SIM, { kind: 'consigne', body: 'du junior', actor_id: UID.jr }, d);
  const asOwner = await readJournal(owner, SIM, SIM, {}, d);
  assert.equal(asOwner.scope, 'all'); assert.equal(asOwner.entries.length, 2);
  const asPartner = await readJournal(partner, PARENT, SIM, {}, d);
  assert.equal(asPartner.scope, 'all'); assert.equal(asPartner.entries.length, 2);
  const jrOwn = { id: UID.jr };
  db.members.push({ org_id: SIM, auth_user_id: UID.jr, role: 'auditor', active: true });
  const asJunior = await readJournal(jrOwn, SIM, SIM, {}, d);
  assert.equal(asJunior.scope, 'own'); assert.deepEqual(asJunior.entries.map(e => e.body), ['du junior']);
  await assert.rejects(readJournal(stranger, PARENT, SIM, {}, d), /JOURNAL_NOT_ALLOWED/);
  await assert.rejects(readJournal(partner, REAL, SIM, {}, d), /NOT_A_SIMULATION/);
  await assert.rejects(readJournal(partner, PARENT, REAL, {}, d), /NOT_A_SIMULATION/);
});

test('partners of the parent see every simulation without being members; others only theirs', async () => {
  const sims = [{ id: SIM, name: 'A', created_at: '2026-11-18' }];
  const fetchRows = async path => {
    if (path.startsWith('office_organizations?parent_org_id')) return sims;
    if (path.includes('org_id=eq.' + PARENT)) return [{ org_id: PARENT, role: path.includes('u-partner') ? 'partner' : 'auditor' }];
    return path.includes('u-jr') ? [{ org_id: SIM, role: 'auditor', active: true }] : [];
  };
  const p = await listSimulations({ id: 'u-partner' }, PARENT, { fetchRows });
  assert.equal(p.length, 1); assert.equal(p[0].member, false); assert.equal(p[0].role, null);
  assert.equal((await listSimulations({ id: 'u-jr' }, PARENT, { fetchRows }))[0].member, true);
  assert.equal((await listSimulations({ id: 'u-x' }, PARENT, { fetchRows })).length, 0);
});
