import test from 'node:test';
import assert from 'node:assert/strict';
import { changeFirmSettings, readSettingsRow } from '../lib/firm-settings-store.js';

// Audit 2026-10-30: the firm's settings row is shared by about ten modules. Each one read the whole object with
// `.catch(() => null)`, changed one key and wrote the whole object back.
const ORG = '11111111-1111-4111-8111-111111111111';

// A small office_firm_settings table that behaves like PostgREST: version (updated_at), conditional PATCH, insert.
function table(initial = null, { failReads = 0 } = {}) {
  let row = initial ? { settings: initial, updated_at: 't0' } : null, n = 0, reads = 0;
  const fetchRows = async (path, o = {}) => {
    if (!o.method) { if (reads++ < failReads) throw new Error('SUPABASE_503: upstream connect error'); return row ? [{ ...row, settings: structuredClone(row.settings) }] : []; }
    const body = JSON.parse(o.body);
    if (o.method === 'PATCH') {
      const want = decodeURIComponent(path.split('updated_at=eq.')[1] || '');
      if (!row || row.updated_at !== want) return [];
      row = { settings: body.settings, updated_at: 't' + ++n }; return [row];
    }
    if (o.method === 'POST') { if (row) return []; row = { settings: body[0].settings, updated_at: 't' + ++n }; return [row]; }
    throw new Error('unexpected ' + o.method);
  };
  return { fetchRows, get: () => row?.settings };
}

test('a failed read never erases the firm settings (it used to write « {} + one key » over everything)', async () => {
  const db = table({ drive: 'D1', permissions: { matrix: { auditor: { mission: 'view:mine' } } }, memory_files: { D1: { x: 'id1' } } }, { failReads: 1 });
  await assert.rejects(changeFirmSettings(ORG, s => ({ ...s, secretariat_email: 'sec@c.ci' }), { fetchRows: db.fetchRows }), /SUPABASE_503/);
  assert.deepEqual(db.get(), { drive: 'D1', permissions: { matrix: { auditor: { mission: 'view:mine' } } }, memory_files: { D1: { x: 'id1' } } }, 'nothing written');
  await assert.rejects(readSettingsRow(ORG, async () => { throw new Error('SUPABASE_503'); }), /SUPABASE_503/, 'a strict read: a failure is an error, never « empty »');
});

test('two writes at the same time: both changes are kept (the last one used to erase the other)', async () => {
  const db = table({ drive: 'D1' });
  // Two modules read the same version, then write: the second write is refused (version changed), re-read, re-applied.
  await Promise.all([
    changeFirmSettings(ORG, async s => { await new Promise(r => setTimeout(r, 5)); return { ...s, memory_files: { D1: { a: 'A' } } }; }, { fetchRows: db.fetchRows }),
    changeFirmSettings(ORG, async s => { await new Promise(r => setTimeout(r, 5)); return { ...s, methodology: { file_id: 'M' } }; }, { fetchRows: db.fetchRows })
  ]);
  assert.deepEqual(db.get(), { drive: 'D1', memory_files: { D1: { a: 'A' } }, methodology: { file_id: 'M' } });
});

test('first write of a firm creates the row; « nothing to change » writes nothing; a missing table is said', async () => {
  const db = table(null);
  assert.deepEqual(await changeFirmSettings(ORG, s => ({ ...s, personal_ai_allowed: false }), { fetchRows: db.fetchRows }), { personal_ai_allowed: false });
  assert.deepEqual(db.get(), { personal_ai_allowed: false });
  let wrote = false;
  await changeFirmSettings(ORG, () => undefined, { fetchRows: async (p, o) => { if (o?.method) wrote = true; return [{ settings: {}, updated_at: 't' }]; } });
  assert.equal(wrote, false);
  await assert.rejects(changeFirmSettings(ORG, s => s, { fetchRows: async () => { throw new Error('SUPABASE_404: {"code":"PGRST205"}'); }, missingCode: 'ROLES_SQL_NOT_INSTALLED' }), /ROLES_SQL_NOT_INSTALLED/);
});

test('the modules that write the settings keep the other settings of the firm', async () => {
  const db = table({ drive: 'D1', references: { r: { file_id: 'R' } } });
  const { saveFirmSettings } = await import('../lib/roles.js');
  await saveFirmSettings(ORG, { workflow_stuck_days: 10 }, 'p@c.ci', db.fetchRows);
  const { rememberPointer } = await import('../lib/methodology.js');
  await rememberPointer(ORG, { file_id: 'M2' }, { fetchRows: db.fetchRows });
  const s = db.get();
  assert.equal(s.drive, 'D1'); assert.deepEqual(s.references, { r: { file_id: 'R' } });
  assert.equal(s.workflow_stuck_days, 10); assert.equal(s.methodology.file_id, 'M2');
  // A failed read in the methodology pointer: nothing erased (it used to rewrite « {} + methodology »).
  const broken = table({ drive: 'D1' }, { failReads: 1 });
  assert.equal(await rememberPointer(ORG, { file_id: 'M3' }, { fetchRows: broken.fetchRows }), null);
  assert.deepEqual(broken.get(), { drive: 'D1' });
});

test('« Mon IA »: when the firm settings cannot be read, it is not allowed (it used to be « allowed »)', async () => {
  const { personalAIOverview } = await import('../lib/personal-ai.js');
  const settingsDown = async path => { if (path.startsWith('office_firm_settings')) throw new Error('SUPABASE_503'); return []; };
  assert.equal((await personalAIOverview(ORG, { fetchRows: settingsDown })).allowed, false);
  const noTable = async path => { if (path.startsWith('office_firm_settings')) throw new Error('SUPABASE_404: {"code":"PGRST205"}'); return []; };
  assert.equal((await personalAIOverview(ORG, { fetchRows: noTable })).allowed, true, 'nothing was ever forbidden');
  const forbidden = async path => path.startsWith('office_firm_settings') ? [{ settings: { personal_ai_allowed: false } }] : [];
  assert.equal((await personalAIOverview(ORG, { fetchRows: forbidden })).allowed, false);
});
