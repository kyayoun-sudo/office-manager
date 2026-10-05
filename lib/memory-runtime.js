// Runtime access to the Orpailleur memory (MAP / RULES / REGISTER) for tools
// and endpoints. Configuration is generic (no tenant hardcode):
//   OFFICE_MANAGER_MEMORY_FOLDER_ID  folder holding the two memory files
//                                    (default: root of the configured Shared Drive)
//   OWNER_APPROVAL_SECRET            HMAC secret, held only by the server; used
//                                    to sign/verify owner rules
//   OFFICE_MANAGER_REQUIRE_MAPPING   "false" = LEGACY mode (pilot before first
//                                    mapping): business writes not gated
import { configuredDriveId, driveAdapter } from "./drive-adapter.js";
import {
  documentaryActionsAllowed,
  openMemory,
  resolveSemanticRole
} from "./orpailleur-memory.js";

export function memoryFolderId() {
  return process.env.OFFICE_MANAGER_MEMORY_FOLDER_ID || configuredDriveId();
}

export function ownerSecret() {
  return process.env.OWNER_APPROVAL_SECRET || null;
}

export async function loadMemory(drive = driveAdapter) {
  return openMemory(drive, { memoryFolderId: memoryFolderId() });
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
