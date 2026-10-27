// Reuse HUMAN-VALIDATED orders, never an unapproved AI guess. Same tenant/mission, SOP and workbook semantics.
// New/changed evidence goes back to the brain: old knowledge is not proof about new data.
import { createHash } from 'node:crypto';
import { recipeFor, saveRecipe } from './fill-recipes.js';
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const methodSignature = ctx => hash({ model: ctx.map.key, shape: ctx.map.fingerprint, understanding: ctx.u, sop: ctx.view.card, procedure: ctx.view.line, period: ctx.view.mission?.period_label, client: ctx.view.mission?.client_name, programme: ctx.view.programme?.version });
const revision = meta => meta?.modifiedTime ? JSON.stringify([meta.modifiedTime, meta.version || null, meta.md5Checksum || null]) : null;
async function catalogue(ctx) {
  const rows = [];
  for (const doc of [...ctx.docs].sort((a, b) => a.id.localeCompare(b.id))) {
    const meta = await ctx.drive.getMeta(doc.id);
    if (!meta || meta.trashed || !revision(meta)) return null;
    rows.push({ id: doc.id, revision: revision(meta) });
  }
  return rows;
}
const methodKey = (org, mission) => org + '|' + mission;
export const knownFillMethod = (recipe, org, mission) => recipe?.orders_methods?.[methodKey(org, mission)] || recipe?.orders_method || null;
const sourceIds = orders => [...new Set([...orders.blocks.map(b => b.document_id), ...(orders.lookups || []).map(x => x.verify_in?.document_id), ...(orders.checks || []).map(x => x.document_id)].filter(Boolean))].sort();

export async function rememberFillMethod(ctx, orders, { org, mission, account, readPiece, readCache }, d = {}) {
  if (!account?.email || !orders.blocks?.length) return null;
  const sources = [];
  for (const id of sourceIds(orders)) {
    const doc = ctx.docs.find(x => x.id === id);
    if (!doc) return null;
    const piece = readCache?.[id] || await readPiece(doc, ctx.drive, d);
    if (!piece?.fingerprint || piece.unreadable) return null;
    sources.push({ id, fingerprint: piece.fingerprint });
  }
  const catalog = await catalogue(ctx);
  if (!catalog) return null;
  const old = await (d.recipeFor || recipeFor)(ctx.map.key, ctx.sheet, d);
  const method = { version: 1, org, mission, signature: methodSignature(ctx), sources, orders, catalog,
    validated_by: account.email, validated_at: new Date().toISOString() };
  const methods = Object.fromEntries(Object.entries({ ...(old?.orders_methods || {}), [methodKey(org, mission)]: method }).slice(-20));
  await (d.saveRecipe || saveRecipe)(ctx.map.key, { ...(old || {}), sheet: ctx.sheet, orders_method: method, orders_methods: methods,
    validated_by: account.email, at: method.validated_at }, d);
  return method;
}

export async function reusableFillMethod(ctx, org, mission, readPiece, d = {}) {
  const recipe = await (d.recipeFor || recipeFor)(ctx.map.key, ctx.sheet, d);
  const method = knownFillMethod(recipe, org, mission);
  if (!method || method.version !== 1 || !method.validated_by || method.org !== org || method.mission !== mission || method.signature !== methodSignature(ctx)) return null;
  // A newly deposited document can supply something missing or contradict the old plan: re-evaluate it with AI.
  if (JSON.stringify(method.catalog || []) !== JSON.stringify(await catalogue(ctx))) return null;
  const readCache = {};
  for (const source of method.sources) {
    const doc = ctx.docs.find(x => x.id === source.id);
    if (!doc) return null;
    const piece = await readPiece(doc, ctx.drive, d);
    if (!piece?.fingerprint || piece.fingerprint !== source.fingerprint || piece.unreadable) return null;
    readCache[doc.id] = piece;
  }
  return { orders: method.orders, provider: 'validated-memory', method, readCache };
}
