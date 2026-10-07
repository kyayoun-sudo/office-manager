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
  const live = missions.filter(m => !['cancelled', 'canceled', 'closed', 'archived'].includes(String(m.status || '').toLowerCase()));
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

// Merges duplicates: their team assignments and actions move to the kept mission; the duplicate
// is closed (status « cancelled », name kept, nothing deleted).
export async function dedupeMissions(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest, org = 'org_id=eq.' + q(orgId);
  const missions = await fetchRows('office_missions?' + org + '&select=id,name,mission_code,status,planned_start,planned_end&limit=1000') || [];
  const groups = groupDuplicates(missions);
  const report = [];
  for (const g of groups) {
    for (const dup of g.merge) {
      for (const table of ['office_mission_assignments', 'office_action_queue']) {
        await fetchRows(table + '?' + org + '&office_mission_id=eq.' + q(dup.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ office_mission_id: g.keep.id }) }).catch(() => null);
      }
      const patch = { status: 'cancelled' };
      if (!g.keep.planned_end && dup.planned_end) await fetchRows('office_missions?' + org + '&id=eq.' + q(g.keep.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ planned_start: dup.planned_start, planned_end: dup.planned_end }) }).catch(() => null);
      await fetchRows('office_missions?' + org + '&id=eq.' + q(dup.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      report.push({ kept: g.keep.name, merged: dup.name });
    }
  }
  return { merged: report.length, details: report };
}
