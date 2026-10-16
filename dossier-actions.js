import { createHash } from "node:crypto";
const fail = (code, statusCode = 400) =>
  Object.assign(new Error(code), { statusCode });
const STAGES = [
  "identified",
  "contacted",
  "response",
  "meeting",
  "available",
  "cv_received",
  "fees_received",
  "opinion_received",
  "selected",
  "declined",
];
export { STAGES as SPECIALIST_STAGES };
// Extend the SAME opportunity record. A declared contact/meeting is never an app-sent message.
export async function updateSpecialist(orgId, body, account, d = {}) {
  if (
    !account?.email ||
    !["owner", "partner", "manager"].includes(account.role)
  )
    throw fail("NOT_THE_MISSION_MANAGER", 403);
  const opps = d.opportunities || (await import("./opportunities.js"));
  const o = await opps.getOpportunity(String(body.opportunity_id || ""), d);
  if (!opps.mayManageOpportunity(o, account))
    throw fail("NOT_THE_MISSION_MANAGER", 403);
  if (!STAGES.includes(body.stage)) throw fail("INVALID_SPECIALIST_STAGE");
  const note = String(body.note || "").trim();
  if (!note || note.length > 1000) throw fail("FOLLOWUP_NOTE_REQUIRED");
  const gap = String(body.gap || ""),
    id = String(body.specialist_id || "");
  const specialist = o.team?.specialists?.[gap]?.list?.find((s) => s.id === id);
  if (!specialist) throw fail("SPECIALIST_NOT_FOUND", 404);
  const version = Number(specialist.followup?.version || 0);
  if (Number(body.expected_version) !== version)
    throw fail("FOLLOWUP_CHANGED_RELOAD", 409);
  const at = new Date().toISOString();
  const entry = {
    stage: body.stage,
    note,
    at,
    by: account.email,
    version: version + 1,
    declared: true,
  };
  await opps.updateOpportunityRecord(
    o.id,
    (current) => {
      const s = current.team?.specialists?.[gap]?.list?.find(
        (x) => x.id === id,
      );
      if (!s || Number(s.followup?.version || 0) !== version)
        throw fail("FOLLOWUP_CHANGED_RELOAD", 409);
      s.followup = {
        ...entry,
        history: [...(s.followup?.history || []), entry],
      };
      return current;
    },
    d,
  );
  const notification = await (d.emit || (await import("./event-bus.js")).emit)(
    orgId,
    {
      type: "SPECIALIST_FOLLOWUP_RECORDED",
      agent: "mission-controller",
      actor: account.email,
      engagement_id: o.mission_id || null,
      object_type: "opportunity",
      object_id: o.id,
      idempotency_key: `specialist:${o.id}:${id}:${version + 1}`,
      payload: { specialist_id: id, stage: body.stage, declared: true },
    },
    d,
  );
  return { saved: true, followup: entry, notification };
}
export async function recordQuotationChange(orgId, body, account, d = {}) {
  if (
    !account?.email ||
    !["owner", "partner", "manager"].includes(account.role)
  )
    throw fail("NOT_THE_MISSION_MANAGER", 403);
  const opps = d.opportunities || (await import("./opportunities.js"));
  const o = await opps.getOpportunity(String(body.opportunity_id || ""), d);
  if (!opps.mayManageOpportunity(o, account))
    throw fail("NOT_THE_MISSION_MANAGER", 403);
  const reason = String(body.reason || "").trim();
  if (!reason || reason.length > 1000) throw fail("QUOTATION_REASON_REQUIRED");
  const file = o.quotation?.file;
  if (!file?.id) throw fail("QUOTATION_FILE_REQUIRED", 409);
  const drive = d.drive || (await import("./drive-adapter.js")).driveAdapter;
  const meta = await drive.getMeta(file.id);
  if (!meta || meta.trashed || !meta.modifiedTime)
    throw fail("QUOTATION_VERSION_UNVERIFIED", 409);
  const key = createHash("sha256")
    .update(file.id + "|" + meta.modifiedTime + "|" + (meta.version || ""))
    .digest("hex");
  const previous = (o.quotation.changes || []).at(-1);
  // An unchanged Drive version cannot be reported as a new revision, even with a new reason.
  const duplicate = (o.quotation.changes || []).find(
    (x) => x.version_key === key,
  );
  const entry = duplicate || {
    version_key: key,
    file_id: file.id,
    modified_time: meta.modifiedTime,
    drive_version: meta.version || null,
    at: new Date().toISOString(),
    by: account.email,
    reason,
    previous_version_key: previous?.version_key || null,
  };
  if (duplicate?.observed) {
    entry.reason = reason;
    entry.by = account.email;
    entry.explained_at = new Date().toISOString();
    entry.observed = false;
  }
  await opps.updateOpportunityRecord(
    o.id,
    (current) => {
      const index = (current.quotation.changes || []).findIndex(
        (x) => x.version_key === key,
      );
      if (index < 0) (current.quotation.changes ||= []).push(entry);
      else if (!entry.observed) current.quotation.changes[index] = entry;
      return current;
    },
    d,
  );
  const notification = await (d.emit || (await import("./event-bus.js")).emit)(
    orgId,
    {
      type: "QUOTATION_UPDATED",
      agent: "mission-controller",
      actor: account.email,
      engagement_id: o.mission_id || null,
      object_type: "opportunity",
      object_id: o.id,
      idempotency_key: `quotation:${o.id}:${key}${entry.explained_at ? ":explanation" : ""}`,
      source: file.id,
      payload: {
        file_id: file.id,
        modified_time: meta.modifiedTime,
        version: meta.version || null,
        reason: entry.reason,
        review_required: true,
      },
    },
    d,
  );
  await opps.updateOpportunityRecord(
    o.id,
    (current) => {
      current.quotation.notification = notification;
      return current;
    },
    d,
  );
  return {
    saved: true,
    duplicate: Boolean(duplicate),
    change: entry,
    notification,
  };
}
// Delivered as factual context to SIKA; acknowledgement is separate from financial approval.
export async function quotationInbox(orgId, d = {}) {
  const rows = d.fetchRows || (await import("./supabase.js")).rest;
  return rows(
    "office_events?org_id=eq." +
      encodeURIComponent(orgId) +
      "&consumer=eq.sika&event_type=eq.QUOTATION_UPDATED&status=in.(new,failed)&select=id,object_id,source_reference,small_payload,occurred_at&order=occurred_at.asc&limit=30",
  );
}
export async function acknowledgeQuotations(orgId, events, d = {}) {
  if (!events.length) return;
  const rows = d.fetchRows || (await import("./supabase.js")).rest;
  await rows(
    "office_events?org_id=eq." +
      encodeURIComponent(orgId) +
      "&consumer=eq.sika&status=in.(new,failed)&id=in.(" +
      events.map((e) => encodeURIComponent(e.id)).join(",") +
      ")",
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "handled",
        result:
          "Cotation transmise au contexte d’une réponse réussie de SIKA ; aucune approbation financière.",
        handled_at: new Date().toISOString(),
      }),
    },
  );
}

// Called by existing preparation/rounds, not a second scanner or a second quotation file.
export async function observeQuotationVersion(orgId, opportunity, d = {}) {
  const file = opportunity.quotation?.file;
  if (!file?.id) return { skipped: "NO_QUOTATION" };
  const drive = d.drive || (await import("./drive-adapter.js")).driveAdapter;
  const meta = await drive.getMeta(file.id);
  if (!meta || meta.trashed || !meta.modifiedTime)
    return { skipped: "VERSION_UNVERIFIED" };
  const key = createHash("sha256")
    .update(file.id + "|" + meta.modifiedTime + "|" + (meta.version || ""))
    .digest("hex");
  if (
    opportunity.quotation.observed_version === key &&
    !opportunity.quotation.notification?.error
  )
    return { skipped: "UNCHANGED" };
  const notification = await (d.emit || (await import("./event-bus.js")).emit)(
    orgId,
    {
      type: "QUOTATION_UPDATED",
      agent: "mission-controller",
      object_type: "opportunity",
      object_id: opportunity.id,
      engagement_id: opportunity.mission_id || null,
      source: file.id,
      idempotency_key: `quotation:${opportunity.id}:${key}`,
      payload: {
        file_id: file.id,
        modified_time: meta.modifiedTime,
        version: meta.version || null,
        reason:
          "Version Drive observée ; motif et validation à confirmer par le responsable.",
        review_required: true,
      },
    },
    d,
  );
  const opps = d.opportunities || (await import("./opportunities.js"));
  await opps.updateOpportunityRecord(
    opportunity.id,
    (current) => {
      // Do not replace a newer, concurrently selected quotation file.
      if (current.quotation?.file?.id !== file.id) return current;
      current.quotation.observed_version = key;
      current.quotation.notification = notification;
      if (!(current.quotation.changes || []).some((x) => x.version_key === key))
        (current.quotation.changes ||= []).push({
          version_key: key,
          file_id: file.id,
          modified_time: meta.modifiedTime,
          drive_version: meta.version || null,
          at: new Date().toISOString(),
          by: "mission-controller",
          reason: "Version Drive observée ; motif à confirmer.",
          observed: true,
        });
      return current;
    },
    d,
  );
  return { observed: true, notification };
}
