import test from "node:test";
import assert from "node:assert/strict";
import { inventoryListing } from "../lib/inventory-listing.js";
const run = { id: "baseline", status: "COMPLETE", started_at: "2026-10-07T00:00:00Z" };
const rows = n => Array.from({ length: n }, (_, i) => ({ file_id: String(i).padStart(5,"0"), name: "Synthetic", last_scan_id: "later-partial" }));
function db(n, { absent = false, changed = false } = {}) {
  let runReads = 0;
  return async path => {
    assert.match(path, /org_id=eq.org&drive_id=eq.drive/);
    if (path.startsWith("orpailleur_scan_runs")) {
      assert.match(path, /status=eq.COMPLETE/);
      return absent ? [] : [{ ...run, id: changed && ++runReads > 1 ? "new" : run.id }];
    }
    assert.match(path, /last_seen_at=gte./);
    const limit = Number(path.match(/&limit=(\d+)/)[1]);
    const cursor = path.match(/file_id=gt.([^&]+)/)?.[1];
    return rows(n).filter(r => !cursor || r.file_id > decodeURIComponent(cursor)).slice(0,limit);
  };
}
test("inventory requires a COMPLETE baseline", async () => {
  assert.equal(await inventoryListing("org",{driveId:"drive",fetchRows:db(1,{absent:true})}),null);
});
test("inventory keeps observations re-tagged by later partial scans and paginates", async () => {
  const r=await inventoryListing("org",{driveId:"drive",fetchRows:db(1101)});
  assert.equal(r.complete,true); assert.equal(r.items.length,1101);
});
test("inventory refuses completeness at a truncated bound", async () => {
  const r=await inventoryListing("org",{driveId:"drive",maxRows:1000,fetchRows:db(1001)});
  assert.equal(r.complete,false); assert.equal(r.warning,"INVENTORY_LIMIT_REACHED");
});
test("exact bound is complete only after an empty probe", async () => {
  const r=await inventoryListing("org",{driveId:"drive",maxRows:1000,fetchRows:db(1000)});
  assert.equal(r.complete,true);
});
test("baseline changing during pagination is explicitly incomplete", async () => {
  const r=await inventoryListing("org",{driveId:"drive",fetchRows:db(1,{changed:true})});
  assert.equal(r.complete,false); assert.equal(r.warning,"INVENTORY_BASELINE_CHANGED");
});
