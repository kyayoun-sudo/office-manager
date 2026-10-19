import { rest } from "./supabase.js";
import { audit } from "./audit-log.js";

// The FUNCTION a person holds on one mission, read from the mission_role of the assignment. The presentation follows it;
// the authority helpers below (reviews, programme) use it too — never the browser, never the account alone.
export function missionFunction(role) {
  const value = String(role || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  // Quality review first: « associé revue qualité » is an EQR, not the engagement partner.
  if (/quality|qualite|\beqr\b/.test(value)) return "quality_reviewer";
  if (/partner|associe/.test(value)) return "partner";
  if (/manager|chef de mission/.test(value)) return "manager";
  // A supervisor is not a senior (fixed 2026-10-19: both were « senior », so a supervisor could not hold the supervisor review).
  if (/supervis/.test(value)) return "supervisor";
  if (/senior/.test(value)) return "senior";
  if (/junior|auditeur|auditor|collaborat/.test(value)) return "auditor";
  if (/secret/.test(value)) return "secretary";
  if (/financ/.test(value)) return "finance";
  if (/special/.test(value)) return "specialist";
  return null;
}
export async function missionPresentation(
  orgId,
  missionId,
  account,
  fetchRows,
) {
  const q = encodeURIComponent,
    email = String(account.email || "")
      .trim()
      .toLowerCase();
  const staff = await fetchRows(
    `office_staff_profiles?org_id=eq.${q(orgId)}&email=eq.${q(email)}&active=eq.true&select=id`,
  );
  if (!staff?.length)
    return { role: account.role, source: "account", label: null };
  const rows = await fetchRows(
    `office_mission_assignments?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&staff_profile_id=in.(${staff.map((s) => q(s.id)).join(",")})&select=mission_role,status`,
  );
  const active = (rows || []).filter(
    (r) =>
      !["cancelled", "canceled", "rejected", "completed"].includes(r.status),
  );
  const roles = [
    ...new Set(
      active.map((r) => missionFunction(r.mission_role)).filter(Boolean),
    ),
  ];
  // Conflicting concurrent assignments require clarification, not silent promotion.
  if (roles.length !== 1)
    return {
      role: account.role,
      source: roles.length ? "ambiguous" : "account",
      label: null,
    };
  return {
    role: roles[0],
    source: "mission",
    label: active.find((r) => missionFunction(r.mission_role) === roles[0])
      .mission_role,
  };
}

// ---- Authority on ONE mission (Paul, 2026-10-19, point 2: « superviseur sur une mission, manager sur une autre ») ----
// The function on the mission decides WHO reviews or validates there. Signing a level still needs the account's
// qualification (« signature = qualification », 2026-10-11, ISQM 1: competent people at each function).
// Firm administration (accounts, settings) stays on the account and is not decided here.
export const MISSION_FUNCTIONS = { partner: "Associé", manager: "Manager", supervisor: "Superviseur", senior: "Senior",
  auditor: "Auditeur", quality_reviewer: "Revue qualité", specialist: "Spécialiste", secretary: "Secrétariat", finance: "Finance" };
// Grades qualified to sign a review level. Between manager and supervisor no order is assumed (the firm decides).
export const SIGN_QUALIFIED = { senior: ["senior", "supervisor", "manager", "partner", "owner"], manager: ["manager", "partner", "owner"],
  supervisor: ["supervisor", "partner", "owner"], partner: ["partner", "owner"] };
// When nobody holds the level on the mission: the account's grade, as before 2026-10-19.
const BY_GRADE = { senior: ["senior"], manager: ["manager"], supervisor: ["supervisor"], partner: ["partner", "owner"] };
const ENDED = ["cancelled", "canceled", "rejected", "completed"];
const low = (v) => String(v || "").trim().toLowerCase();
const live = (team) => (team || []).filter((t) => !ENDED.includes(t.status));
export const onTeam = (account, team) => Boolean(low(account?.email)) && live(team).some((t) => low(t.email) === low(account.email));
export const functionsOf = (account, team) => new Set(live(team).filter((t) => low(account?.email) && low(t.email) === low(account.email))
  .map((t) => missionFunction(t.mission_role)).filter(Boolean));
export const holdersOf = (team, fn) => live(team).filter((t) => missionFunction(t.mission_role) === fn);

// null = may act at that review level; otherwise the reason (a code the screens translate).
export function reviewAuthority(account, level, team) {
  if (!account || !SIGN_QUALIFIED[level]) return "NOT_THIS_REVIEW_LEVEL";
  if (!SIGN_QUALIFIED[level].includes(account.role)) return functionsOf(account, team).has(level) ? "NOT_QUALIFIED_FOR_LEVEL" : "NOT_THIS_REVIEW_LEVEL";
  const holders = holdersOf(team, level);
  if (holders.length) return holders.some((h) => low(h.email) === low(account.email)) ? null : "LEVEL_HELD_BY_OTHER";
  if (!BY_GRADE[level].includes(account.role)) return "NOT_THIS_REVIEW_LEVEL";
  if (!["owner", "partner"].includes(account.role) && !onTeam(account, team)) return "NOT_ON_THIS_MISSION";
  return null;
}

// Work programme: edit = a partner of the firm, a manager / supervisor / partner FUNCTION on this mission, or (as before)
// a manager / supervisor grade on its team. Validate = a qualified grade (manager / partner) and, when the mission names
// its manager or partner, being one of them.
export function programmeAuthority(account, team, action = "edit") {
  if (!account) return "ROLE_NOT_ALLOWED";
  if (["owner", "partner"].includes(account.role)) return null;
  const mine = functionsOf(account, team);
  if (action === "edit") {
    if (["manager", "supervisor", "partner"].some((f) => mine.has(f))) return null;
    if (!["manager", "supervisor"].includes(account.role)) return "ROLE_NOT_ALLOWED";
    return onTeam(account, team) ? null : "NOT_ON_THIS_MISSION";
  }
  if (account.role !== "manager") return "ROLE_NOT_ALLOWED";
  if (!onTeam(account, team)) return "NOT_ON_THIS_MISSION";
  const named = [...holdersOf(team, "manager"), ...holdersOf(team, "partner")];
  return !named.length || mine.has("manager") || mine.has("partner") ? null : "PROGRAMME_VALIDATED_BY_MISSION_MANAGER";
}

// Change the function of a person on a mission. A partner of the firm, or the manager / partner of THIS mission;
// never one's own function (nobody raises their own rights). Before → after in the audit log. Pending reviews and
// validations follow at once: they are computed from the current assignments, nothing to migrate.
export async function setMissionFunction(orgId, body = {}, account, d = {}) {
  const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });
  if (!account?.email) throw fail("USER_SESSION_REQUIRED", 401);
  const fetchRows = d.fetchRows || rest, q = encodeURIComponent;
  const fn = String(body.function || "");
  if (!MISSION_FUNCTIONS[fn]) throw fail("UNKNOWN_MISSION_FUNCTION", 400);
  const missionId = String(body.mission_id || ""), assignmentId = String(body.assignment_id || "");
  const rows = await fetchRows(`office_mission_assignments?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&select=id,staff_profile_id,mission_role,status`) || [];
  const target = rows.find((r) => String(r.id) === assignmentId);
  if (!target) throw fail("ASSIGNMENT_NOT_FOUND", 404);
  const ids = [...new Set(rows.map((r) => r.staff_profile_id).filter(Boolean))];
  const people = ids.length ? await fetchRows(`office_staff_profiles?org_id=eq.${q(orgId)}&id=in.(${ids.map(q).join(",")})&select=id,full_name,email`) || [] : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const team = rows.map((r) => ({ ...r, email: byId.get(r.staff_profile_id)?.email || null }));
  const mine = functionsOf(account, team);
  if (!["owner", "partner"].includes(account.role) && !mine.has("manager") && !mine.has("partner")) throw fail("MISSION_MANAGER_OR_PARTNER_REQUIRED", 403);
  const person = byId.get(target.staff_profile_id) || {};
  if (low(person.email) && low(person.email) === low(account.email)) throw fail("NO_SELF_FUNCTION_CHANGE", 403);
  const before = target.mission_role || null, after = MISSION_FUNCTIONS[fn];
  if (missionFunction(before) === fn) return { changed: false, assignment_id: assignmentId, mission_role: before };
  await fetchRows(`office_mission_assignments?org_id=eq.${q(orgId)}&id=eq.${q(assignmentId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ mission_role: after }) });
  await (d.audit || audit)(orgId, { agent: "office-manager", mission_id: missionId, action_type: "MISSION_FUNCTION_CHANGED", status: "succeeded",
    decision: `${person.full_name || person.email || target.staff_profile_id} : « ${before || "—"} » → « ${after} »`.slice(0, 900),
    approved_by: String(account.display_name || account.email).slice(0, 120), approved_at: new Date().toISOString() }, { fetchRows }).catch(() => null);
  return { changed: true, assignment_id: assignmentId, before, mission_role: after,
    note: "Les revues et validations en attente suivent la nouvelle fonction ; les signatures déjà données restent valables." };
}
