import { rest } from "./supabase.js";
import { configuredDriveId } from "./google-drive.js";
import { listingFromInventory } from "./orpailleur-memory.js";

// A COMPLETE baseline is required. last_seen_at preserves baseline rows even
// when a later partial scan replaces their last_scan_id. Queries stay scoped
// to one organisation and Drive; reaching the bound never implies completeness.
export async function inventoryListing(orgId, {
  maxRows = 50000, driveId = configuredDriveId(), fetchRows = rest
} = {}) {
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 50000) throw new Error("INVALID_INVENTORY_LIMIT");
  const scope = `org_id=eq.${encodeURIComponent(orgId)}&drive_id=eq.${encodeURIComponent(driveId)}`;
  const runQuery = `orpailleur_scan_runs?${scope}&status=eq.COMPLETE&select=id,status,started_at&order=started_at.desc,id.desc&limit=1`;
  const run = (await fetchRows(runQuery))?.[0];
  if (!run) return null;
  if (!run.id || !Number.isFinite(Date.parse(run.started_at))) throw new Error("INVALID_COMPLETE_SCAN");
  const rows = [];
  let cursor = null;
  let exhausted = false;
  while (rows.length < maxRows) {
    const limit = Math.min(1000, maxRows - rows.length);
    const path = `orpailleur_inventory?${scope}&last_seen_at=gte.${encodeURIComponent(run.started_at)}&select=file_id,parent_id,folder_path,name,mime_type,modified_at,drive_version,size_bytes,web_url,last_scan_id&order=file_id.asc&limit=${limit}` +
      (cursor ? `&file_id=gt.${encodeURIComponent(cursor)}` : "");
    const page = await fetchRows(path);
    if (!Array.isArray(page) || page.length > limit) throw new Error("INVALID_INVENTORY_PAGE");
    const next = page.at(-1)?.file_id;
    if (page.length && (!next || next === cursor)) throw new Error("INVALID_INVENTORY_CURSOR");
    rows.push(...page);
    if (page.length < limit) { exhausted = true; break; }
    cursor = next;
  }
  if (!exhausted) {
    const probe = await fetchRows(`orpailleur_inventory?${scope}&last_seen_at=gte.${encodeURIComponent(run.started_at)}&file_id=gt.${encodeURIComponent(cursor)}&select=file_id&order=file_id.asc&limit=1`);
    if (!Array.isArray(probe)) throw new Error("INVALID_INVENTORY_PAGE");
    exhausted = probe.length === 0;
  }
  const latest = (await fetchRows(runQuery))?.[0];
  const complete = exhausted && latest?.id === run.id;
  // Rows are already selected by baseline observation time, not current scan tag.
  const listing = listingFromInventory(rows, { runStatus: complete ? "COMPLETE" : "PARTIAL" });
  return { ...listing, run_id: run.id,
    ...(complete ? {} : { warning: exhausted ? "INVENTORY_BASELINE_CHANGED" : "INVENTORY_LIMIT_REACHED" }) };
}
