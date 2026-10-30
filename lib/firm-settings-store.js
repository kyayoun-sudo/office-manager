import { rest } from './supabase.js';

// The firm's settings row (office_firm_settings.settings) is shared by many modules: Drive, rights, references,
// memory pointers, methodology, onboarding, secretariat, tender watch… (audit 2026-10-30).
// Every module used to read the whole object with `.catch(() => null)`, change one key and write the whole object back:
//   - a failed read became « no settings », and the write then ERASED every other setting of the firm;
//   - two writes at the same time: the last one silently erased the other's change.
// Here, one way for all: a strict read (a failure is an error, never « empty »), and a write that only lands if nobody
// changed the row since it was read (updated_at); otherwise the row is read again and the change applied again.
const q = encodeURIComponent;
const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const missingSettingsTable = e => /office_firm_settings|PGRST205|42P01/i.test(String(e?.message || e));

// Strict: throws when the database cannot be read. A missing row is { exists: false, settings: {} }.
export async function readSettingsRow(orgId, fetchRows = rest) {
  const rows = await fetchRows('office_firm_settings?org_id=eq.' + q(orgId) + '&select=settings,updated_at&limit=1');
  const row = Array.isArray(rows) ? rows[0] : null;
  return row ? { exists: true, settings: row.settings || {}, updated_at: row.updated_at || null } : { exists: false, settings: {}, updated_at: null };
}

// mutate(settingsCopy, row) returns the new settings object, or undefined for « nothing to change ».
// It may be called more than once (when another write came first): keep it free of side effects.
export async function changeFirmSettings(orgId, mutate, { fetchRows = rest, by = null, tries = 5, missingCode = 'FIRM_SETTINGS_SQL_NOT_INSTALLED' } = {}) {
  if (!orgId) throw fail('DEFAULT_ORG_ID_MISSING', 500);
  try {
    for (let attempt = 0; attempt < tries; attempt++) {
      const row = await readSettingsRow(orgId, fetchRows);
      const next = await mutate(structuredClone(row.settings), row);
      if (next === undefined) return row.settings;
      const body = { settings: next, updated_at: new Date().toISOString(), ...(by ? { updated_by: String(by).slice(0, 200) } : {}) };
      const written = row.exists && row.updated_at
        ? await fetchRows('office_firm_settings?org_id=eq.' + q(orgId) + '&updated_at=eq.' + q(row.updated_at), { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) })
        : await fetchRows('office_firm_settings?on_conflict=org_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify([{ org_id: orgId, ...body }]) });
      // An empty list = the row changed since it was read (or was created meanwhile): read again, apply again.
      if (!Array.isArray(written) || written.length) return next;
      await sleep(40 * (attempt + 1));
    }
  } catch (e) {
    if (missingSettingsTable(e)) throw fail(missingCode, 409);
    throw e;
  }
  throw fail('FIRM_SETTINGS_BUSY', 409);
}
