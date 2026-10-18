import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { rest } from "./supabase.js";
import { driveAdapter } from "./drive-adapter.js";
import { memoryFolderId } from "./memory-runtime.js";
import { saveJsonFile } from "./mapping-scan.js";
import { acquireReaderLease } from "./inspection-runtime.js";
import { accessibleMissionIds } from "./mission-access.js";
import { effectiveMatrix, loadOverrides } from "./permissions.js";
import { audit } from "./audit-log.js";
import { writeCells, readCells } from "./acceptance-workbook.js";

const q = encodeURIComponent,
  XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const fail = (s, statusCode = 400) =>
  Object.assign(new Error(s), { statusCode });
const clean = (s, n = 300) =>
  String(s || "")
    .trim()
    .slice(0, n);
const rank = (s) =>
  ["none", "view", "prepare", "review", "approve", "sign", "admin"].indexOf(s);
const FILE = (org) => "OFFICE_MANAGER_SIKA_EXPENSES_" + org + ".json";
export const ACCOUNTING_FIELDS = [
  "id",
  "mission",
  "date",
  "description",
  "amount",
  "currency",
  "paid_by",
  "receipt",
  "approved_by",
  "billable",
];
function scope(s, org) {
  if (s && s.org_id !== org) throw fail("SIKA_SCOPE_MISMATCH", 403);
  return (
    s || { schema: 1, org_id: org, expenses: [], history: [], accounting: null }
  );
}
function context(org, a, d) {
  if (!org || !a?.email || !a.auth_user_id || a.role === "it_admin")
    throw fail("PERSONAL_SESSION_REQUIRED", 403);
  return {
    drive: d.drive || driveAdapter,
    folder: d.folder || memoryFolderId(),
    fetchRows: d.fetchRows || rest,
  };
}
async function rights(org, a, d) {
  const overrides = await (d.loadOverrides || loadOverrides)(
    org,
    d.fetchRows || rest,
  );
  const matrix = effectiveMatrix(overrides);
  const cell = matrix[a.role]?.billing || { level: "none", mine: true };
  const ids = await accessibleMissionIds(org, a, d.fetchRows || rest);
  return {
    cell,
    ids,
    finance: rank(cell.level) >= rank("prepare"),
    reviewer:
      ["owner", "partner", "manager"].includes(a.role) &&
      rank(cell.level) >= rank("view") &&
      rank(matrix[a.role]?.mission?.level) >= rank("approve"),
  };
}
async function mission(org, id, r, ctx) {
  if (!/^[\w-]{1,80}$/.test(String(id || ""))) throw fail("MISSION_REQUIRED");
  // Billing access can be cabinet-wide only when the configured permission explicitly is not "mine".
  if (r.ids !== null && !r.ids.has(id) && !(r.finance && !r.cell.mine))
    throw fail("NOT_ON_THIS_MISSION", 403);
  const m = (
    await ctx.fetchRows(
      "office_missions?org_id=eq." +
        q(org) +
        "&id=eq." +
        q(id) +
        "&select=id,name,drive_folder_id&limit=1",
    )
  )?.[0];
  if (!m) throw fail("MISSION_NOT_FOUND", 404);
  return m;
}
function canSee(e, a, r) {
  return r.finance || r.reviewer || e.created_by === a.email;
}
async function load(org, ctx, d) {
  if (!ctx.folder) throw fail("MEMORY_FOLDER_NOT_CONFIGURED", 409);
  if (d.load) return d.load(FILE(org), ctx.drive, ctx.folder);
  const found = await ctx.drive.findFilesByExactName(FILE(org), ctx.folder);
  if (found.length > 1) throw fail("SIKA_MEMORY_DUPLICATE", 409);
  if (!found.length) return { state: null, fileId: null };
  const meta = await ctx.drive.getMeta(found[0].id);
  const raw = await ctx.drive.downloadBuffer(found[0].id);
  if (!meta?.modifiedTime) throw fail("SIKA_MEMORY_VERSION_REQUIRED", 409);
  const after = await ctx.drive.getMeta(found[0].id);
  if (after.modifiedTime !== meta.modifiedTime)
    throw fail("SIKA_MEMORY_CHANGED_RETRY", 409);
  let state;
  try {
    state = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch {
    throw fail("SIKA_MEMORY_UNREADABLE", 409);
  }
  if (!state || !Array.isArray(state.expenses) || !Array.isArray(state.history))
    throw fail("SIKA_MEMORY_UNREADABLE", 409);
  return { state, fileId: meta.id, modifiedTime: meta.modifiedTime };
}
async function read(org, ctx, d) {
  return scope((await load(org, ctx, d)).state, org);
}
async function change(org, ctx, d, fn) {
  if (d.update) return d.update(FILE(org), (s) => fn(scope(s, org)), ctx);
  const loaded = await load(org, ctx, d);
  const state = fn(scope(loaded.state, org));
  await d.guard?.();
  await saveJsonFile(
    FILE(org),
    ctx.drive,
    ctx.folder,
    loaded.fileId,
    state,
    loaded.modifiedTime,
  );
  return state;
}
export function expenseInput(b) {
  const amount = String(b.amount ?? "").replace(",", ".");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)
    throw fail("POSITIVE_AMOUNT_REQUIRED");
  const date = String(b.date || "");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw fail("VALID_DATE_REQUIRED");
  const currency = clean(b.currency, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw fail("CURRENCY_REQUIRED");
  if (!clean(b.description) || !clean(b.paid_by))
    throw fail("DESCRIPTION_AND_PAYER_REQUIRED");
  return {
    amount_minor: Math.round(Number(amount) * 100),
    date,
    currency,
    description: clean(b.description),
    paid_by: clean(b.paid_by, 150),
    type: b.type === "advance" ? "advance" : "expense",
  };
}
export async function expenseView(org, query, a, d = {}) {
  const ctx = context(org, a, d),
    r = await rights(org, a, d),
    s = await read(org, ctx, d);
  const id = String(query.mission_id || "");
  let missions = [];
  if (id) missions = [await mission(org, id, r, ctx)];
  else {
    const filter =
      r.ids === null || (r.finance && !r.cell.mine)
        ? ""
        : "&id=in.(" + [...r.ids].map(q).join(",") + ")";
    if (!filter || r.ids?.size)
      missions = await ctx.fetchRows(
        "office_missions?org_id=eq." +
          q(org) +
          filter +
          "&select=id,name,drive_folder_id&order=created_at.desc&limit=200",
      );
  }
  const allowed = new Set(missions.map((m) => m.id));
  const expenses = s.expenses.filter(
    (e) => allowed.has(e.mission_id) && canSee(e, a, r),
  );
  return {
    missions,
    expenses,
    accounting: r.finance ? s.accounting : null,
    accounting_fields: ACCOUNTING_FIELDS,
    may_review: r.reviewer,
    may_account: r.finance,
    may_configure: ["owner", "partner"].includes(a.role) && r.finance,
    history: s.history
      .filter((h) => expenses.some((e) => e.id === h.id))
      .slice(-100)
      .reverse(),
  };
}

export async function expenseAction(org, b, a, d = {}) {
  context(org, a, d);
  let lease;
  try {
    lease = await (d.lease || acquireReaderLease)(org, "sika-expenses:" + org, {
      fetchRows: d.fetchRows || rest,
      ttl: 240,
    });
  } catch {
    throw fail("SIKA_LOCK_UNAVAILABLE", 409);
  }
  if (!lease) throw fail("SIKA_BUSY_RETRY", 409);
  try {
    await lease.assertOwner();
    return await act(org, b, a, { ...d, guard: () => lease.assertOwner() });
  } finally {
    await lease.release();
  }
}
async function act(org, b, a, d) {
  const ctx = context(org, a, d),
    r = await rights(org, a, d),
    action = String(b.action || "");
  if (action === "configure") {
    if (!["owner", "partner"].includes(a.role) || !r.finance)
      throw fail("PARTNERS_ONLY", 403);
    let ref = clean(b.file_id, 500);
    if (/^https:\/\//.test(ref)) {
      const url = new URL(ref);
      if (!["drive.google.com", "docs.google.com"].includes(url.hostname))
        throw fail("ACCOUNTING_GOOGLE_LINK_REQUIRED");
      ref = url.pathname.match(/\/d\/([\w-]+)/)?.[1] || "";
    }
    const fileId = ref,
      sheet = clean(b.sheet, 80),
      start = Number(b.start_row),
      end = Number(b.end_row);
    const cols = b.columns || {};
    if (
      !fileId ||
      !sheet ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 2 ||
      end < start ||
      end > start + 499 ||
      end > 1048576
    )
      throw fail("ACCOUNTING_MAPPING_REQUIRED");
    if (
      ACCOUNTING_FIELDS.some((k) => !/^[A-Z]{1,3}$/.test(cols[k] || "") || [...cols[k]].reduce((n,c) => n * 26 + c.charCodeAt(0) - 64, 0) > 16384) ||
      new Set(Object.values(cols)).size !== ACCOUNTING_FIELDS.length ||
      Object.keys(cols).length !== ACCOUNTING_FIELDS.length
    )
      throw fail("ACCOUNTING_COLUMNS_INVALID");
    const meta = await ctx.drive.getMeta(fileId);
    if (!meta || meta.trashed || meta.mimeType !== XLSX)
      throw fail("ACCOUNTING_XLSX_REQUIRED");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await ctx.drive.downloadBuffer(fileId));
    if (!wb.getWorksheet(sheet)) throw fail("ACCOUNTING_SHEET_NOT_FOUND");
    await change(org, ctx, d, (s) => {
      s.history.push({
        id: "configuration",
        action: "configure",
        by: a.email,
        at: new Date().toISOString(),
        previous: s.accounting,
      });
      s.accounting = {
        file_id: fileId,
        sheet,
        start_row: start,
        end_row: end,
        columns: cols,
        configured_by: a.email,
        at: new Date().toISOString(),
      };
      return s;
    });
    return { configured: true };
  }
  const m = await mission(org, b.mission_id, r, ctx);
  const at = new Date().toISOString();
  if (action === "create") {
    const input = expenseInput(b),
      id = String(b.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw fail("REQUEST_ID_REQUIRED");
    const prior = (await read(org, ctx, d)).expenses.find((e) => e.id === id);
    if (prior) {
      if (
        prior.created_by !== a.email ||
        prior.mission_id !== m.id ||
        Object.entries(input).some(([k, v]) => prior[k] !== v) ||
        (b.receipt?.base64 &&
          prior.receipt?.sha256 !==
            createHash("sha256")
              .update(Buffer.from(String(b.receipt.base64), "base64"))
              .digest("hex"))
      )
        throw fail("EXPENSE_ID_CONFLICT", 409);
      return { saved: true, expense: prior, replay: true };
    }
    let receipt = null;
    if (input.type === "expense" && !b.receipt?.base64)
      throw fail("RECEIPT_REQUIRED");
    if (b.receipt?.base64) {
      if (!m.drive_folder_id) throw fail("MISSION_DRIVE_FOLDER_REQUIRED", 409);
      const bytes = Buffer.from(String(b.receipt.base64), "base64");
      const mime = String(b.receipt.mime || "");
      if (
        !bytes.length ||
        bytes.length > 2 * 1024 * 1024 ||
        !["application/pdf", "image/jpeg", "image/png"].includes(mime)
      )
        throw fail("RECEIPT_PDF_IMAGE_MAX_2MB");
      const signature =
        mime === "application/pdf"
          ? bytes.subarray(0, 5).toString() === "%PDF-"
          : mime === "image/png"
            ? bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!signature) throw fail("RECEIPT_CONTENT_TYPE_MISMATCH");
      const ext = {
        "application/pdf": "pdf",
        "image/jpeg": "jpg",
        "image/png": "png",
      }[mime];
      // Deterministic name + verified parent makes retries reuse the same original, never move someone else's receipt.
      const name = "DEBOURS_" + id + "." + ext;
      const found = await ctx.drive.findFilesByExactName(
        name,
        m.drive_folder_id,
      );
      if (found.length > 1) throw fail("RECEIPT_DUPLICATE_REVIEW", 409);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (
        (await read(org, ctx, d)).expenses.some(
          (x) => x.receipt?.sha256 === hash && x.mission_id === m.id,
        )
      )
        throw fail("POSSIBLE_DUPLICATE_RECEIPT", 409);
      await d.guard?.();
      const f =
        found[0] ||
        (await ctx.drive.createBinary({
          name,
          parentId: m.drive_folder_id,
          buffer: bytes,
          mimeType: mime,
        }));
      const meta = await ctx.drive.getMeta(f.id);
      if (
        !meta ||
        meta.trashed ||
        !(meta.parents || []).includes(m.drive_folder_id)
      )
        throw fail("RECEIPT_SAVE_NOT_VERIFIED", 409);
      const saved = await ctx.drive.downloadBuffer(f.id);
      if (createHash("sha256").update(saved).digest("hex") !== hash)
        throw fail("RECEIPT_CONTENT_MISMATCH", 409);
      receipt = {
        id: f.id,
        folder_id: m.drive_folder_id,
        url:
          meta.webViewLink ||
          (/^local:/.test(f.id)
            ? null
            : "https://drive.google.com/file/d/" + q(f.id) + "/view"),
        sha256: hash,
      };
    }
    const e = {
      id,
      org_id: org,
      mission_id: m.id,
      mission_name: m.name,
      ...input,
      receipt,
      created_by: a.email,
      created_at: at,
      status: "submitted",
      version: 1,
      reimbursement: null,
      invoice: null,
      sync: null,
    };
    await change(org, ctx, d, (s) => {
      if (s.expenses.some((x) => x.id === id))
        throw fail("EXPENSE_CHANGED_RELOAD", 409);
      if (
        receipt &&
        s.expenses.some(
          (x) => x.receipt?.sha256 === receipt.sha256 && x.mission_id === m.id,
        )
      )
        throw fail("POSSIBLE_DUPLICATE_RECEIPT", 409);
      s.expenses.push(e);
      s.history.push({ id, action, by: a.email, at });
      return s;
    });
    await (d.audit || audit)(org, {
      agent: "sika",
      mission_id: m.id,
      action_type: "EXPENSE_SUBMITTED",
      source_ref: id,
      reviewer: a.email,
      status: "proposed",
    });
    return { saved: true, expense: e };
  }
  if (action === "sync") return syncAccounting(org, b, a, ctx, r, d);
  if (action === "approve") {
    if (!r.reviewer || (a.role === "manager" && !r.ids?.has(m.id)))
      throw fail("EXPENSE_REVIEW_NOT_ALLOWED", 403);
    const current = (await read(org, ctx, d)).expenses.find(
      (x) => x.id === b.id && x.mission_id === m.id,
    );
    if (current?.receipt) {
      const meta = await ctx.drive.getMeta(current.receipt.id);
      if (
        !meta ||
        meta.trashed ||
        !(meta.parents || []).includes(current.receipt.folder_id)
      )
        throw fail("RECEIPT_CHANGED_REVIEW_REQUIRED", 409);
      const bytes = await ctx.drive.downloadBuffer(current.receipt.id);
      if (
        createHash("sha256").update(bytes).digest("hex") !==
        current.receipt.sha256
      )
        throw fail("RECEIPT_CHANGED_REVIEW_REQUIRED", 409);
    }
  }
  let result;
  await change(org, ctx, d, (s) => {
    const e = s.expenses.find((x) => x.id === b.id && x.mission_id === m.id);
    if (!e || !canSee(e, a, r)) throw fail("EXPENSE_NOT_FOUND", 404);
    if (e.version !== Number(b.expected_version))
      throw fail("EXPENSE_CHANGED_RELOAD", 409);
    if (action === "revise") {
      if (e.created_by !== a.email) throw fail("ONLY_EXPENSE_AUTHOR", 403);
      if (!["submitted", "rejected"].includes(e.status))
        throw fail("APPROVED_EXPENSE_IMMUTABLE", 409);
      if (!clean(b.note, 1000)) throw fail("DECISION_REASON_REQUIRED");
      s.history.push({
        id: e.id,
        action: "previous_version",
        by: a.email,
        at,
        previous: structuredClone(e),
      });
      const revised = expenseInput(b);
      if (revised.type !== e.type) throw fail("EXPENSE_TYPE_IMMUTABLE", 409);
      Object.assign(e, revised, { status: "submitted", approval: null });
    } else if (["approve", "reject"].includes(action)) {
      if (!r.reviewer || (a.role === "manager" && !r.ids?.has(m.id)))
        throw fail("EXPENSE_REVIEW_NOT_ALLOWED", 403);
      if (e.created_by === a.email) throw fail("NO_SELF_APPROVAL", 403);
      if (e.status !== "submitted") throw fail("EXPENSE_NOT_PENDING", 409);
      if (!clean(b.note, 1000)) throw fail("DECISION_REASON_REQUIRED");
      if (action === "approve" && e.type === "advance")
        throw fail("ADVANCE_NOT_ACTUAL_EXPENSE", 409);
      if (
        action === "approve" &&
        !["yes", "no", "pending"].includes(b.billable)
      )
        throw fail("BILLABLE_DECISION_REQUIRED");
      if (
        action === "approve" &&
        b.billable === "yes" &&
        !clean(b.contract_basis, 1000)
      )
        throw fail("CONTRACT_BASIS_REQUIRED");
      e.status = action === "approve" ? "approved" : "rejected";
      e.approval = {
        by: a.email,
        at,
        note: clean(b.note, 1000),
        billable: action === "approve" ? b.billable : "no",
        contract_basis: clean(b.contract_basis, 1000),
      };
    } else if (["reimburse", "invoice"].includes(action)) {
      if (!r.finance) throw fail("BILLING_PERMISSION_REQUIRED", 403);
      if (e.status !== "approved") throw fail("APPROVED_EXPENSE_REQUIRED", 409);
      if (!clean(b.reference, 300) || !clean(b.evidence, 500))
        throw fail("REFERENCE_AND_EVIDENCE_REQUIRED");
      const key = action === "invoice" ? "invoice" : "reimbursement";
      if (e[key]) throw fail("EXPENSE_ALREADY_RECORDED", 409);
      if (action === "invoice" && e.approval.billable !== "yes")
        throw fail("EXPENSE_NOT_BILLABLE", 409);
      e[key] = {
        reference: clean(b.reference),
        evidence: clean(b.evidence, 500),
        by: a.email,
        at,
        status: "human_recorded",
      };
    } else throw fail("UNKNOWN_ACTION");
    e.version++;
    s.history.push({
      id: e.id,
      action,
      by: a.email,
      at,
      note: clean(b.note, 1000),
      version: e.version,
    });
    result = e;
    return s;
  });
  await (d.audit || audit)(org, {
    agent: "sika",
    mission_id: m.id,
    action_type: "EXPENSE_" + action.toUpperCase(),
    source_ref: result.id,
    approved_by: result.approval?.by,
    reviewer: a.email,
    status: "executed",
  });
  let accounting = null;
  if (action === "approve" && r.finance) {
    try {
      accounting = await syncAccounting(
        org,
        { ...b, expected_version: result.version },
        a,
        ctx,
        r,
        d,
      );
    } catch (e) {
      accounting = { pending: true, error: e.message };
    }
  }
  return { saved: true, expense: result, accounting };
}

async function syncAccounting(org, b, a, ctx, r, d) {
  if (!r.finance) throw fail("BILLING_PERMISSION_REQUIRED", 403);
  const s = await read(org, ctx, d),
    cfg = s.accounting;
  const e = s.expenses.find(
    (x) => x.id === b.id && x.mission_id === b.mission_id,
  );
  if (!e || e.status !== "approved")
    throw fail("APPROVED_EXPENSE_REQUIRED", 409);
  if (e.version !== Number(b.expected_version))
    throw fail("EXPENSE_CHANGED_RELOAD", 409);
  if (!cfg) throw fail("ACCOUNTING_MAPPING_REQUIRED", 409);
  const receiptMeta = await ctx.drive.getMeta(e.receipt.id);
  if (
    !receiptMeta ||
    receiptMeta.trashed ||
    !(receiptMeta.parents || []).includes(e.receipt.folder_id)
  )
    throw fail("RECEIPT_CHANGED_REVIEW_REQUIRED", 409);
  const receiptBytes = await ctx.drive.downloadBuffer(e.receipt.id);
  if (
    createHash("sha256").update(receiptBytes).digest("hex") !== e.receipt.sha256
  )
    throw fail("RECEIPT_CHANGED_REVIEW_REQUIRED", 409);

  const meta = await ctx.drive.getMeta(cfg.file_id);
  if (!meta || meta.trashed || meta.mimeType !== XLSX)
    throw fail("ACCOUNTING_XLSX_REQUIRED", 409);
  const raw = await ctx.drive.downloadBuffer(cfg.file_id),
    wb = new ExcelJS.Workbook();
  await wb.xlsx.load(raw);
  const ws = wb.getWorksheet(cfg.sheet);
  if (!ws || ws.sheetProtection)
    throw fail("ACCOUNTING_SHEET_PROTECTED_OR_MISSING", 409);
  const values = {
    id: e.id,
    mission: e.mission_name,
    date: e.date,
    description: e.description,
    amount: e.amount_minor / 100,
    currency: e.currency,
    paid_by: e.paid_by,
    receipt: e.receipt.url || e.receipt.id,
    approved_by: e.approval.by,
    billable: e.approval.billable,
  };
  const matches = [];
  let free = null;
  for (let row = cfg.start_row; row <= cfg.end_row; row++) {
    const cells = ACCOUNTING_FIELDS.map((k) =>
      ws.getCell(cfg.columns[k] + row),
    );
    if (ws.getCell(cfg.columns.id + row).value === e.id) matches.push(row);
    if (free === null && cells.every((c) => c.value == null && !c.isMerged))
      free = row;
  }
  if (matches.length > 1) throw fail("ACCOUNTING_DUPLICATE_REVIEW", 409);
  const row = matches[0] ?? free;
  if (row == null) throw fail("ACCOUNTING_NO_EMPTY_ROW", 409);
  const writes = ACCOUNTING_FIELDS.map((k) => ({
    sheet: cfg.sheet,
    cell: cfg.columns[k] + row,
    value: values[k],
  }));
  if (matches.length) {
    if (
      !writes.every(
        (w) => String(ws.getCell(w.cell).value ?? "") === String(w.value),
      )
    )
      throw fail("ACCOUNTING_ROW_CONFLICT", 409);
  } else {
    const latest = await ctx.drive.getMeta(cfg.file_id);
    if (!meta.modifiedTime || latest.modifiedTime !== meta.modifiedTime)
      throw fail("ACCOUNTING_CHANGED_RETRY", 409);
    await d.guard?.();
    await ctx.drive.updateBinary(cfg.file_id, {
      buffer: await writeCells(raw, writes),
      mimeType: XLSX,
      expectedModifiedTime: meta.modifiedTime,
    });
  }
  const back = await readCells(
    await ctx.drive.downloadBuffer(cfg.file_id),
    writes,
  );
  if (
    !writes.every(
      (w) => String(back[w.sheet + "!" + w.cell]) === String(w.value),
    )
  )
    throw fail("ACCOUNTING_WRITE_NOT_VERIFIED", 409);
  await change(org, ctx, d, (state) => {
    const x = state.expenses.find((x) => x.id === e.id);
    if (!x || x.version !== e.version)
      throw fail("EXPENSE_CHANGED_RELOAD", 409);
    x.sync = {
      file_id: cfg.file_id,
      sheet: cfg.sheet,
      row,
      verified_at: new Date().toISOString(),
      by: a.email,
    };
    state.history.push({
      id: e.id,
      action: "sync",
      by: a.email,
      at: x.sync.verified_at,
    });
    return state;
  });
  await (d.audit || audit)(org, {
    agent: "sika",
    mission_id: e.mission_id,
    action_type: "EXPENSE_ACCOUNTING_SYNC",
    source_ref: e.id,
    output_ref: cfg.file_id + "!" + cfg.sheet + ":" + row,
    reviewer: a.email,
    status: "verified",
  });
  return { synced: true, row };
}
