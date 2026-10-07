// Owner endpoint — the ONLY way to create, reject or deactivate an owner rule
// in OFFICE_MANAGER_MAP (RULES sheet) and to mark the mapping as reviewed.
//
// It requires the OWNER credential (header x-office-manager-owner-token =
// OFFICE_MANAGER_OWNER_TOKEN), distinct from the pilot access token, and signs
// each rule with OWNER_APPROVAL_SECRET. No agent tool can reach this endpoint
// or the secret, so an AI-generated sentence can never become an approval.
//
// GET  -> mapping report + pending AI proposals (what needs a decision)
// POST { action: "approve_role",   semantic_role, target_file_id, approved_by, notes? }
// POST { action: "reject_role",    semantic_role, target_file_id, approved_by, notes? }
// POST { action: "deactivate_rule", rule_id }
// POST { action: "mark_mapping_reviewed", approved_by }
import crypto from "node:crypto";
import { driveAdapter } from "../lib/drive-adapter.js";
import { loadGoogleConnection } from "../lib/google-connection.js";
import { loadMemory, ownerSecret } from "../lib/memory-runtime.js";
import {
  buildMappingReport,
  ownerApproveRole,
  ownerDeactivateRule,
  ownerMarkMappingReviewed,
  ownerRejectRole,
  saveMemory
} from "../lib/orpailleur-memory.js";

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function requireOwnerAccess(req) {
  const expected = process.env.OFFICE_MANAGER_OWNER_TOKEN;
  if (!expected) {
    const error = new Error("OFFICE_MANAGER_OWNER_TOKEN_MISSING");
    error.statusCode = 500;
    throw error;
  }
  if (!safeEqual(req.headers["x-office-manager-owner-token"], expected)) {
    const error = new Error("OWNER_UNAUTHORIZED");
    error.statusCode = 401;
    throw error;
  }
}

export async function handleOwnerRequest(req, { drive = driveAdapter, now = new Date() } = {}) {
  requireOwnerAccess(req);
  const secret = ownerSecret();
  if (!secret) {
    const error = new Error("OWNER_APPROVAL_SECRET_MISSING");
    error.statusCode = 500;
    throw error;
  }

  const memory = await loadMemory(drive);
  if (!memory.exists) {
    const error = new Error("NO_MAP: run the Orpailleur first mapping before owner decisions");
    error.statusCode = 409;
    throw error;
  }

  if (req.method === "GET") {
    return {
      report: buildMappingReport(memory, secret),
      pending_proposals: memory.map.sheets.MAP.filter(
        row => row.canonical_status === "AI_HYPOTHESIS" && row.owner_approval_status === "PENDING"
      )
    };
  }

  const body = req.body || {};
  const nowIso = now.toISOString();
  let rule;
  try {
  switch (body.action) {
    case "approve_role":
      rule = ownerApproveRole(memory, {
        semanticRole: body.semantic_role,
        targetFileId: body.target_file_id,
        approvedBy: body.approved_by,
        notes: body.notes || "",
        secret,
        now: nowIso
      });
      break;
    case "reject_role":
      rule = ownerRejectRole(memory, {
        semanticRole: body.semantic_role,
        targetFileId: body.target_file_id,
        approvedBy: body.approved_by,
        notes: body.notes || "",
        secret,
        now: nowIso
      });
      break;
    case "deactivate_rule":
      rule = ownerDeactivateRule(memory, { ruleIdToDeactivate: body.rule_id, secret, now: nowIso });
      break;
    case "mark_mapping_reviewed":
      rule = ownerMarkMappingReviewed(memory, { approvedBy: body.approved_by, secret, now: nowIso });
      break;
    default: {
      const error = new Error("UNKNOWN_OWNER_ACTION");
      error.statusCode = 400;
      throw error;
    }
  }
  } catch (error) {
    // Business refusals (unknown role, target not in REGISTER, ...) -> 409.
    if (!error.statusCode) error.statusCode = 409;
    throw error;
  }

  const saved = await saveMemory(drive, memory);
  return { recorded: true, rule: { ...rule, signature: "[signed]" }, ...saved };
}

export default async function handler(req, res) {
  try {
    if (!["GET", "POST"].includes(req.method)) {
      return res.status(405).json({ error: "Method not allowed" });
    }
    // The firm's Google connection (Paramètres → Connecter Google) for the memory files.
    if (process.env.DEFAULT_ORG_ID) await loadGoogleConnection(process.env.DEFAULT_ORG_ID).catch(() => null);
    return res.status(200).json(await handleOwnerRequest(req));
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ error: String(error.message || error) });
  }
}
