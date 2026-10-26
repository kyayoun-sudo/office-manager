// La recette d'une feuille de données, apprise et réutilisée de mission en mission (Paul, 2026-10-26 : « si on change de mission, pouvoir
// trouver ces mêmes documents » ; « il n'apprend pas »).
//
// Quand une personne valide un remplissage (« Oui, remplis », écrit et relu), on retient COMMENT la feuille a été remplie, en SORTES de
// pièces (les familles des fiches, lib/piece-profile.js) et en SENS de colonnes — jamais des noms de fichiers ni des données du client :
//   D2_BUDGET du modèle NL-T01 : lignes = catégories (sous-totaux) d'un budget_previsionnel ; A ← numéro de compte retrouvé dans un
//   grand_livre_general ; B ← « montant prévu » du budget_previsionnel ; D ← « budget révisé » de l'execution_budgetaire ; C = D − B ; …
// À la mission suivante (même modèle de working file, autre cabinet ou autres pièces), l'IA reçoit cette recette et retrouve elle-même,
// parmi les nouvelles pièces, celles de la même famille ; le code ne fait que vérifier. Une recette n'est jamais du code : c'est une donnée
// du cabinet, corrigée par la personne à chaque validation.
import { loadJsonFile, saveJsonFile } from './mapping-scan.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';

const FILE = 'OFFICE_MANAGER_FILL_RECIPES.json';
const keyOf = (mapKey, sheet) => String(mapKey || '?') + '|' + String(sheet || '');
const load = d => (d.loadJsonFile || loadJsonFile)(FILE, d.drive || driveAdapter, d.folder || memoryFolderId()).catch(() => ({ state: null }));

// The recipe of this sheet of this working-file model (null when the sheet was never filled and validated).
export async function recipeFor(mapKey, sheet, d = {}) {
  const st = (await load(d)).state;
  return st?.recipes?.[keyOf(mapKey, sheet)] || null;
}

// Built from what was validated: the plan (column → document, heading, compute), the documents' fiches, the rows' source.
export function recipeFrom({ sheet, u, plan, rowsFrom, glDoc, profiles }, account = {}) {
  const fam = id => (id && profiles[id]?.family) || null;
  const meaning = (id, heading) => (profiles[id]?.columns || []).find(c => String(c.heading || '').trim().toLowerCase() === String(heading || '').trim().toLowerCase())?.meaning || null;
  return {
    sheet, title: u.title || null,
    rows_from: rowsFrom ? { family: fam(rowsFrom.document_id), which: rowsFrom.which, several: (rowsFrom.document_ids || []).length > 1, line_unit: profiles[rowsFrom.document_id]?.line_unit || null } : null,
    gl: glDoc ? { family: fam(glDoc), used_for: 'numéro de compte des lignes, par leur libellé' } : null,
    columns: u.columns.map(c => {
      const p = plan.find(x => x.col === c.col) || {};
      if (p.compute) return { col: c.col, header: c.header, compute: p.compute };
      if (!p.document_id) return { col: c.col, header: c.header, left_empty: true };
      return { col: c.col, header: c.header, family: fam(p.document_id), heading: p.heading || null, meaning: meaning(p.document_id, p.heading), account_from_gl: Boolean(p.account_from_gl) };
    }),
    validated_by: account.email || null, at: new Date().toISOString(),
  };
}

export async function saveRecipe(mapKey, recipe, d = {}) {
  if (!recipe) return null;
  const L = await load(d), st = L.state || { recipes: {} };
  st.recipes ||= {};
  const k = keyOf(mapKey, recipe.sheet), old = st.recipes[k];
  st.recipes[k] = { ...recipe, times: (old?.times || 0) + 1, previous: old ? { at: old.at, validated_by: old.validated_by } : null };
  st.updated_at = recipe.at;
  await (d.saveJsonFile || saveJsonFile)(FILE, d.drive || driveAdapter, d.folder || memoryFolderId(), L.fileId || null, st);
  return st.recipes[k];
}

// Without the AI: the recipe applied by the code to THIS mission's pieces, by family (a piece of the same family, of the mission's year
// first). Everything « à confirmer ».
export function applyRecipe(recipe, docs, profiles, year = []) {
  if (!recipe) return null;
  const ofFamily = f => docs.filter(x => f && profiles[x.id]?.family === f)
    .sort((a, b) => Number(year.some(y => String(profiles[b.id]?.period || '').includes(y))) - Number(year.some(y => String(profiles[a.id]?.period || '').includes(y))));
  const columns = [];
  for (const c of recipe.columns || []) {
    if (c.compute) { columns.push({ col: c.col, compute: c.compute, by: 'recette', why: 'calculé comme à la mission précédente (' + c.compute + ')' }); continue; }
    if (c.left_empty || !c.family) continue;
    const doc = ofFamily(c.family)[0]; if (!doc) continue;
    // the heading of THIS piece whose meaning is the recipe's (fiche), else the same heading text
    const cols = profiles[doc.id]?.columns || [];
    const h = (c.meaning && cols.find(x => x.meaning && x.meaning.toLowerCase() === c.meaning.toLowerCase())?.heading) || cols.find(x => String(x.heading).toLowerCase() === String(c.heading || '').toLowerCase())?.heading || null;
    columns.push({ col: c.col, document_id: doc.id, heading: h, account_from_gl: c.account_from_gl, sure: false, by: 'recette', why: 'comme à la mission précédente : « ' + (c.meaning || c.heading || c.family) + ' » d’une pièce « ' + c.family + ' » (l’IA n’a pas répondu ; à vérifier)' });
  }
  const rf = recipe.rows_from?.family ? ofFamily(recipe.rows_from.family) : [];
  const rowsFrom = rf.length ? { document_id: rf[0].id, document_ids: (recipe.rows_from.several ? rf : rf.slice(0, 1)).map(x => x.id).slice(0, 40), which: recipe.rows_from.which || 'lines' } : null;
  const gl = recipe.gl?.family ? ofFamily(recipe.gl.family)[0]?.id || null : null;
  return { columns, rowsFrom, gl };
}
