// Entraîner les agents avec de vraies personnes (Paul, 2026-10-26) : chaque correction arrive dans une seule table de la plateforme ; seul le
// propriétaire / associé du cabinet pilote la valide ; une correction validée est donnée à l'IA partout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recordFeedback, listFeedback, decideFeedback, validatedFeedback, progress } from '../lib/agent-training.js';

process.env.DEFAULT_ORG_ID = '00000000-0000-4000-8000-000000000001';
const PILOT = process.env.DEFAULT_ORG_ID, TRAIN = '00000000-0000-4000-8000-000000000002';
function db() {
  const rows = []; let n = 0;
  return { rows, fetchRows: async (path, o = {}) => {
    if (o.method === 'POST') { const r = JSON.parse(o.body).map(x => ({ id: 'f' + (++n), status: 'proposed', created_at: new Date().toISOString(), ...x })); rows.push(...r); return r; }
    if (o.method === 'PATCH') { const id = decodeURIComponent(path.match(/id=eq\.([^&]+)/)[1]); const r = rows.find(x => x.id === id); if (!r) return []; Object.assign(r, JSON.parse(o.body)); return [r]; }
    let out = rows.slice();
    const f = (k, v) => { out = out.filter(x => String(x[k]) === decodeURIComponent(v)); };
    for (const [, k, v] of path.matchAll(/[?&](source_org_id|status|kind|model_key|sheet)=eq\.([^&]+)/g)) f(k, v);
    return out;
  }, audit: async () => null };
}

test('une correction faite dans un cabinet d’entraînement arrive à la plateforme ; seul le pilote la valide ; validée, elle sert partout', async () => {
  const d = db();
  await recordFeedback(TRAIN, { agent: 'enhanced-auditor', step: 'remplir D2', kind: 'sheet_hint', model_key: 'NL-T01@1', sheet: 'D2_BUDGET', proposed: 'B ← PTBA « Total »', correction: 'le budget initial vient du PTBA initial, pas du révisé' }, { email: 'awa@stagiaire' }, d);
  // the trainee sees only their own cabinet's corrections and cannot validate
  const mine = await listFeedback(TRAIN, { email: 'awa@stagiaire', role: 'owner' }, {}, d);
  assert.equal(mine.items.length, 1); assert.equal(mine.may_decide, false);
  await assert.rejects(decideFeedback(TRAIN, { email: 'awa@stagiaire', role: 'owner' }, { id: 'f1', decision: 'validated' }, d), /PLATFORM_LEAD_REQUIRED/);
  // nothing reaches the AI before validation
  assert.equal((await validatedFeedback({ model_key: 'NL-T01@1', sheet: 'D2_BUDGET' }, d)).length, 0);
  // the pilot firm's partner sees every cabinet and validates
  const all = await listFeedback(PILOT, { email: 'paul@taty', role: 'partner' }, {}, d);
  assert.equal(all.may_decide, true);
  await decideFeedback(PILOT, { email: 'paul@taty', role: 'partner' }, { id: 'f1', decision: 'validated' }, d);
  const v = await validatedFeedback({ model_key: 'NL-T01@1', sheet: 'D2_BUDGET' }, d);
  assert.equal(v.length, 1); assert.match(v[0].correction, /PTBA initial/);
});

test('le progrès d’un agent = feuilles validées sans correction / toutes les feuilles validées', () => {
  const p = progress([{ agent: 'a', step: 'remplir D2', kind: 'accepted_as_is' }, { agent: 'a', step: 'remplir D2', kind: 'accepted_after_correction' }, { agent: 'a', step: 'remplir D2', kind: 'accepted_as_is' }]);
  assert.equal(p[0].first_time_right, 67);
});

test('une erreur d’enregistrement ne bloque jamais le travail de l’auditeur', async () => {
  assert.equal(await recordFeedback(TRAIN, { agent: 'x', kind: 'free_note' }, {}, { fetchRows: async () => { throw new Error('down'); } }), null);
});
