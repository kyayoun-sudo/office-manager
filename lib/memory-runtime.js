// Runtime access to the Orpailleur memory (MAP / RULES / REGISTER) for tools
// and endpoints. Configuration is generic (no tenant hardcode):
//   OFFICE_MANAGER_MEMORY_FOLDER_ID  folder holding the two memory files
//                                    (default: root of the configured Shared Drive)
//   OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY "true" = after migration, fail
//                                    if either memory file is missing; no reset
//   OWNER_APPROVAL_SECRET            HMAC secret, held only by the server; used
//                                    to sign/verify owner rules
//   OFFICE_MANAGER_REQUIRE_MAPPING   "false" = LEGACY mode (pilot before first
//                                    mapping): business writes not gated
import { configuredDriveId, driveAdapter } from "./drive-adapter.js";
import { firmDriveId, firmMemoryId, firmHomeId } from "./google-connection.js";
import { isTestMode } from "./test-mode.js";
import {
  documentaryActionsAllowed,
  openMemory,
  resolveSemanticRole
} from "./orpailleur-memory.js";

export function memoryFolderId() {
  // The Drive chosen by the firm in the app wins over the server setting.
  // Everything the agents use lives in ONE folder of the firm's Drive (00_OFFICE_MANAGER).
  // No silent fallback on another Drive's memory (2026-10-09): the old server setting
  // (OFFICE_MANAGER_MEMORY_FOLDER_ID) is used only in a preview or when explicitly allowed.
  const chosen = firmMemoryId() || firmDriveId();
  if (chosen) return chosen;
  const envAllowed = isTestMode() || String(process.env.OFFICE_MANAGER_ALLOW_ENV_DRIVE || "").toLowerCase() === "true";
  if (envAllowed && process.env.OFFICE_MANAGER_MEMORY_FOLDER_ID) return process.env.OFFICE_MANAGER_MEMORY_FOLDER_ID;
  try { return configuredDriveId(); } catch { return null; }
}

// The agents' home (e.g. 00_TATY_AI_MANAGER): their reports, audit log, drop folder and trainings,
// beside their MEMORY folder. Before the home is known: the memory folder itself (as before).
export function homeFolderId() {
  return firmHomeId() || memoryFolderId();
}

export function ownerSecret() {
  return process.env.OWNER_APPROVAL_SECRET || null;
}

export async function loadMemory(drive = driveAdapter) {
  const folderId = memoryFolderId();
  if (String(process.env.OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY || "").toLowerCase() === "true" &&
      !process.env.OFFICE_MANAGER_MEMORY_FOLDER_ID) {
    throw new Error("MEMORY_FOLDER_NOT_CONFIGURED");
  }
  const memory = await openMemory(drive, { memoryFolderId: folderId });
  if (String(process.env.OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY || "").toLowerCase() === "true" &&
      (!memory.map.fileId || !memory.register.fileId)) {
    throw new Error("EXISTING_MEMORY_REQUIRED");
  }
  return memory;
}

// Resolution of a semantic role through MAP/RULES. Never throws: a missing or
// unreadable MAP means "no owner approval", i.e. normal discovery.
export async function resolveRoleViaMap(role, drive = driveAdapter) {
  try {
    const memory = await loadMemory(drive);
    if (!memory.exists) return { status: "NO_MAP", semantic_role: role };
    return resolveSemanticRole(memory, role, ownerSecret());
  } catch (error) {
    return { status: "MAP_UNREADABLE", semantic_role: role, error: String(error.message || error) };
  }
}

// Business documentary writes start only after MAPPING_REVIEWED (owner-signed).
export async function mappingGate(drive = driveAdapter) {
  if (String(process.env.OFFICE_MANAGER_REQUIRE_MAPPING || "").toLowerCase() === "false") {
    return { allowed: true, state: "LEGACY_MAPPING_NOT_REQUIRED" };
  }
  try {
    const memory = await loadMemory(drive);
    return documentaryActionsAllowed(memory, ownerSecret());
  } catch (error) {
    return { allowed: false, state: "MAP_UNREADABLE", reason: String(error.message || error) };
  }
}

export function gateBlockedResult(gate) {
  return {
    written: false,
    status: "MAPPING_REVIEW_REQUIRED",
    mapping_state: gate.state,
    reason:
      "Business documentary writes start after the owner reviewed the Drive mapping (MAPPING_REVIEWED). Run/complete the Orpailleur mapping and ask the owner to review it.",
    detail: gate.reason || null
  };
}
