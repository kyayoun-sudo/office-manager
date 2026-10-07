import { rest } from './supabase.js';

// One mission, one row (Paul, 2026-10-07: « il y a des doublons, il a pris la même mission deux
// fois »). Names read in different documents differ: « BLE TRANSIT AUDIT 2025 »,
// « BLE_TRANSIT_AUDIT_2025 », « Audit BLE TRANSIT 2025 »; « Trésorerie 2026 » vs « Atlas Industrie —
// Trésorerie 2026 ». They are recognised as the same mission:
//   - same words (accents, underscores, punctuation and small words ignored), or
//   - one name's words all inside ONE other name only (a generic name never merges into two
//     different clients' missions), or
//   - very close names with the same year.

const q = encodeURIComponent;
const SMALL = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'd', 'l', 'a', 'au', 'aux', 'en', 'pour', 'the', 'of', 'and', 'mission']);

export function words(name) {
  return new Set(String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean).map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).filter(w => !SMALL.has(w)));
}
const years = s => new Set([...s].filter(w => /^20\d\d$/.test(w)));
const sameSet = (a, b) => a.size === b.size && [...a].every(w => b.has(w));
const inside = (a, b) => a.size > 0 && [...a].every(w => b.has(w));

function close(a, b) {
  const ya = years(a), yb = years(b);
  if (ya.size && yb.size && ![...ya].some(y => yb.has(y))) return false;
  const inter = [...a].filter(w => b.has(w)).length;
  return inter >= 4 && inter / (a.size + b.size - inter) >= 0.6;
}

// The existing mission this name refers to, or null.
export function findSameMission(name, missions) {
  const w = words(name);
  if (!w.size) return null;
  const sets = missions.map(m => ({ m, w: words(m.name) }));
  const exact = sets.find(x => sameSet(x.w, w));
  if (exact) return exact.m;
  const containing = sets.filter(x => inside(w, x.w));
  if (containing.length === 1) return containing[0].m;
  const contained = sets.filter(x => inside(x.w, w));
  if (contained.length === 1) return contained[0].m;
  const near = sets.filter(x => close(w, x.w));
  return near.length === 1 ? near[0].m : null;
}

// The better row to keep: client named (« Client — … »), dates, then the longer name.
const richness = m => (/—| - /.test(m.name || '') ? 4 : 0) + (m.planned_end ? 2 : 0) + (m.planned_start ? 1 : 0) + Math.min(1, String(m.name || '').length / 200);

export function groupDuplicates(missions) {
  const live = missions.filter(m => !['cancelled', 'canceled', 'closed', 'archived'].includes(String(m.status || '').toLowerCase()) && !/entra[iî]nement|training/i.test(m.name || ''));
  const groups = [];
  const used = new Set();
  for (const m of [...live].sort((a, b) => richness(b) - richness(a))) {
    if (used.has(m.id)) continue;
    const others = live.filter(x => x.id !== m.id && !used.has(x.id));
    const same = others.filter(x => findSameMission(x.name, [m, ...others.filter(o => o.id !== x.id)])?.id === m.id);
    if (same.length) { groups.push({ keep: m, merge: same }); same.forEach(x => used.add(x.id)); }
    used.add(m.id);
  }
  return groups;
}

const LIVE = m => !['cancelled', 'canceled', 'closed', 'archived'].includes(String(m.status || '').toLowerCase());

// One duplicate into the kept mission: team assignments and actions move, dates are kept if the
// kept row has none, the duplicate is closed (status « cancelled », name kept, nothing deleted).
async function mergeInto(fetchRows, org, keep, dup) {
  for (const table of ['office_mission_assignments', 'office_action_queue']) {
    await fetchRows(table + '?' + org + '&office_mission_id=eq.' + q(dup.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ office_mission_id: keep.id }) }).catch(() => null);
  }
  if (!keep.planned_end && dup.planned_end) {
    await fetchRows('office_missions?' + org + '&id=eq.' + q(keep.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ planned_start: dup.planned_start, planned_end: dup.planned_end }) }).catch(() => null);
    keep.planned_end = dup.planned_end;
  }
  await fetchRows('office_missions?' + org + '&id=eq.' + q(dup.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'cancelled' }) });
}

// Same mission by its words (no AI): « BLE TRANSIT AUDIT 2025 » = « BLE_TRANSIT_AUDIT_2025 ».
// d.ai: then the AI reads the remaining list with what the Orpailleur found in the files (client,
// type, year, source document) and groups what is still the same mission under other names
// (« Proposition Expertise France — IMPLUS SERA (Lots 1-3) » / « Proposition Lots 1-3 (SERA…) »,
// French / English names, missing client prefix…). Only sure groups are merged.
export async function dedupeMissions(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest, org = 'org_id=eq.' + q(orgId);
  const missions = await fetchRows('office_missions?' + org + '&select=id,name,mission_code,status,planned_start,planned_end&limit=1000') || [];
  const report = [];
  const closed = new Set();
  for (const g of groupDuplicates(missions)) {
    for (const dup of g.merge) { await mergeInto(fetchRows, org, g.keep, dup); closed.add(dup.id); report.push({ kept: g.keep.name, merged: dup.name, how: 'words' }); }
  }
  if (d.ai) {
    const live = missions.filter(m => LIVE(m) && !closed.has(m.id));
    const groups = await aiDuplicateGroups(live, d).catch(() => []);
    const byId = new Map(live.map(m => [m.id, m]));
    for (const g of groups) {
      const keep = byId.get(g.keep);
      if (!keep || closed.has(keep.id)) continue;
      for (const id of g.same || []) {
        const dup = byId.get(id);
        if (!dup || dup.id === keep.id || closed.has(dup.id)) continue;
        await mergeInto(fetchRows, org, keep, dup); closed.add(dup.id);
        report.push({ kept: keep.name, merged: dup.name, how: 'ai', reason: String(g.reason || '').slice(0, 200) });
      }
    }
  }
  return { merged: report.length, details: report };
}

const AI_INSTRUCTIONS = `Tu es l'Orpailleur d'un cabinet d'audit. Tu reçois la liste des missions enregistrées (id, nom, code, dates) et ce que tu as lu dans les fichiers du Drive (client, type, année, document source).
Plusieurs lignes désignent souvent LA MÊME mission sous des noms différents : client absent du nom, underscores, abréviations, nom en anglais / en français, proposition commerciale et mission du même client sur les mêmes lots, nom du dossier et nom du document.
Regroupe-les. Réponds en JSON STRICT : {"groups":[{"keep":"<id à garder : le nom le plus complet, avec le client>","same":["<id>"],"reason":"<une phrase>"}]}
Règles : seulement si tu es sûr ; deux exercices différents (2025 / 2026) = deux missions ; deux clients différents = deux missions ; deux types différents pour le même client (audit financier / revue de paie) = deux missions ; une mission d'entraînement n'est jamais regroupée. Utilise uniquement les id fournis. Si rien n'est sûr : {"groups":[]}.`;

export async function aiDuplicateGroups(missions, d = {}) {
  if (missions.length < 2) return [];
  const knowledge = d.knowledge || (d.loadKnowledge ? await d.loadKnowledge().catch(() => null) : null);
  const read = (knowledge?.missions || []).slice(0, 150).map(m => ({ name: m.name, client: m.client, kind: m.kind, type: m.type, year: m.year, source: m.source }));
  const input = 'MISSIONS ENREGISTRÉES :\n' + JSON.stringify(missions.slice(0, 300).map(m => ({ id: m.id, name: m.name, code: m.mission_code || null, start: m.planned_start || null, end: m.planned_end || null }))) +
    '\n\nCE QUE TU AS LU DANS LES FICHIERS :\n' + JSON.stringify(read);
  const run = d.runAI || (await import('./ai.js')).runAI;
  for (const provider of ['auto', 'openai', 'anthropic']) {
    try {
      const t = String((await run({ agentKey: 'orpailleur', instructions: AI_INSTRUCTIONS, input: input.slice(0, 100000), provider, maxTokens: 6000 })).text || '');
      const a = t.indexOf('{'), b = t.lastIndexOf('}');
      if (a < 0 || b <= a) continue;
      const out = JSON.parse(t.slice(a, b + 1));
      return Array.isArray(out.groups) ? out.groups : [];
    } catch { /* next provider */ }
  }
  return [];
}
