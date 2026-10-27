import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberFillMethod, reusableFillMethod } from '../lib/learned-fill-method.js';

function harness() {
  let recipe = null, revision = '1', fingerprint = 'content';
  const ctx = { map: { key: 'template@1', fingerprint: 'shape' }, sheet: 'D1', u: { columns: [{ col: 'A' }] },
    view: { card: { code: 'TEST-01', steps: ['Lire'] }, line: { code: 'TEST-01' }, mission: { period_label: '2026' } }, docs: [{ id: 'D' }], drive: { getMeta: async () => ({ modifiedTime: revision }) } };
  const orders = { blocks: [{ document_id: 'D' }], lookups: [], checks: [] };
  const readPiece = async () => ({ fingerprint });
  const d = { recipeFor: async () => recipe, saveRecipe: async (k, r) => { recipe = r; } };
  return { ctx, orders, readPiece, d, changedRevision: () => { revision = '2'; }, changedContent: () => { fingerprint = 'new'; } };
}

test('nouvelle pièce, source modifiée, autre période, autre SOP, modèle, mission ou cabinet : retour à l’IA', async () => {
  for (const change of ['source', 'revision', 'period', 'sop', 'shape', 'mission', 'org', 'new_document']) {
    const h = harness();
    await rememberFillMethod(h.ctx, h.orders, { org: 'O', mission: 'M', account: { email: 'reviewer' }, readPiece: h.readPiece }, h.d);
    assert.ok(await reusableFillMethod(h.ctx, 'O', 'M', h.readPiece, h.d));
    if (change === 'source') h.changedContent();
    if (change === 'revision') h.changedRevision();
    if (change === 'period') h.ctx.view.mission.period_label = '2027';
    if (change === 'sop') h.ctx.view.card.steps = ['Nouvelle étape'];
    if (change === 'shape') h.ctx.map.fingerprint = 'new-shape';
    if (change === 'new_document') h.ctx.docs.push({ id: 'E' });
    assert.equal(await reusableFillMethod(h.ctx, change === 'org' ? 'OTHER' : 'O', change === 'mission' ? 'OTHER' : 'M', h.readPiece, h.d), null, change);
  }
});

test('sans empreinte, sans révision connue ou sans validation humaine, pas de réutilisation automatique', async () => {
  const h = harness();
  assert.equal(await rememberFillMethod(h.ctx, h.orders, { org: 'O', mission: 'M', account: {}, readPiece: h.readPiece }, h.d), null);
  assert.equal(await rememberFillMethod(h.ctx, h.orders, { org: 'O', mission: 'M', account: { email: 'x' }, readPiece: async () => ({}) }, h.d), null);
  h.ctx.drive.getMeta = async () => ({});
  assert.equal(await rememberFillMethod(h.ctx, h.orders, { org: 'O', mission: 'M', account: { email: 'x' }, readPiece: h.readPiece }, h.d), null);
});

test('deux missions du même modèle gardent chacune leur méthode validée', async () => {
  const h = harness();
  for (const mission of ['M1', 'M2']) await rememberFillMethod(h.ctx, h.orders, { org: 'O', mission, account: { email: 'reviewer' }, readPiece: h.readPiece }, h.d);
  assert.ok(await reusableFillMethod(h.ctx, 'O', 'M1', h.readPiece, h.d));
  assert.ok(await reusableFillMethod(h.ctx, 'O', 'M2', h.readPiece, h.d));
});
