import { rest } from "./supabase.js";
import { audit } from "./audit-log.js";

// The function READ FROM THE FREE LABEL mission_role: presentation only (which tabs first). It never gives a right:
// authority reads the controlled mission_function column (below).
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
// Read from the CONTROLLED column mission_function (db/mission-functions.sql), written only by setMissionFunction below —
// never from the free label mission_role, which the person may have typed about themselves at creation. The function
// decides WHO reviews or validates among the qualified grades; it never gives a right the grade does not have
// (« signature = qualification », 2026-10-11, ISQM 1). Firm administration stays on the account.
export const MISSION_FUNCTIONS = { partner: "Associé", manager: "Manager", supervisor: "Superviseur", senior: "Senior",
  auditor: "Auditeur", quality_reviewer: "Revue qualité", specialist: "Spécialiste", secretary: "Secrétariat", finance: "Finance" };
// Where the supervisor stands is the FIRM's choice (Paul, 2026-10-19: « réglable par cabinet »), Paramètres →
// office_firm_settings.settings.supervisor_position:
//   above_manager (default, specification §29: Manager sign-off → Supervisor review → Partner);
//   below_manager (the common grade ladder: Senior → Superviseur → Manager → Associé).
// A grade is qualified to sign its own level and every level below it.
export const SUPERVISOR_POSITIONS = ["above_manager", "below_manager"];
export function reviewHierarchy(position) {
  const below = position === "below_manager";
  const order = below ? ["senior", "supervisor", "manager", "partner"] : ["senior", "manager", "supervisor", "partner"];
  const ladder = [...order, "owner"];
  const qualified = Object.fromEntries(order.map((level) => [level, ladder.slice(ladder.indexOf(level))]));
  return { position: below ? "below_manager" : "above_manager", order, qualified };
}
// Grades qualified to sign each level, with the default position (kept for readers that have no firm setting).
export const SIGN_QUALIFIED = reviewHierarchy().qualified;
// When nobody holds the level on the mission: the account's grade, as before 2026-10-19.
const BY_GRADE = { senior: ["senior"], manager: ["manager"], supervisor: ["supervisor"], partner: ["partner", "owner"] };
// Only a partner of the firm gives or takes away these functions.
const LEAD_FUNCTIONS = ["partner", "manager"];
const ENDED = ["cancelled", "canceled", "rejected", "completed"];
const low = (v) => String(v || "").trim().toLowerCase();
const live = (team) => (team || []).filter((t) => !ENDED.includes(t.status));
const fnOf = (t) => (Object.hasOwn(MISSION_FUNCTIONS, t?.mission_function || "") ? t.mission_function : null);
export const onTeam = (account, team) => Boolean(low(account?.email)) && live(team).some((t) => low(t.email) === low(account.email));
export const functionsOf = (account, team) => new Set(live(team).filter((t) => low(account?.email) && low(t.email) === low(account.email))
  .map(fnOf).filter(Boolean));
export const holdersOf = (team, fn) => live(team).filter((t) => fnOf(t) === fn);

// null = may act at that review level; otherwise the reason (a code the screens translate).
export function reviewAuthority(account, level, team, hierarchy = reviewHierarchy()) {
  const qualified = hierarchy.qualified;
  if (!account || !qualified[level]) return "NOT_THIS_REVIEW_LEVEL";
  if (!qualified[level].includes(account.role)) return functionsOf(account, team).has(level) ? "NOT_QUALIFIED_FOR_LEVEL" : "NOT_THIS_REVIEW_LEVEL";
  const holders = holdersOf(team, level);
  if (holders.length) return holders.some((h) => low(h.email) === low(account.email)) ? null : "LEVEL_HELD_BY_OTHER";
  if (!BY_GRADE[level].includes(account.role)) return "NOT_THIS_REVIEW_LEVEL";
  if (!["owner", "partner"].includes(account.role) && !onTeam(account, team)) return "NOT_ON_THIS_MISSION";
  return null;
}

// Work programme. Edit: a partner of the firm, or a manager / supervisor GRADE on the team (as before) — the function
// gives no editing right. Validate: a partner of the firm, or a manager grade on the team; when the mission names its
// manager or partner, only them.
export function programmeAuthority(account, team, action = "edit") {
  if (!account) return "ROLE_NOT_ALLOWED";
  if (["owner", "partner"].includes(account.role)) return null;
  const allowed = action === "edit" ? ["manager", "supervisor"] : ["manager"];
  if (!allowed.includes(account.role)) return "ROLE_NOT_ALLOWED";
  if (!onTeam(account, team)) return "NOT_ON_THIS_MISSION";
  if (action === "edit") return null;
  const mine = functionsOf(account, team);
  const named = [...holdersOf(team, "manager"), ...holdersOf(team, "partner")];
  return !named.length || mine.has("manager") || mine.has("partner") ? null : "PROGRAMME_VALIDATED_BY_MISSION_MANAGER";
}

// Change the function of a person on a mission. A partner of the firm; or a manager GRADE holding the manager function
// on THIS mission, for the other functions only (Partner and Manager are given or taken away by a partner of the firm).
// Never one's own (nobody raises their own rights). Before → after in the audit log. Pending reviews and validations
// follow at once: they are computed from the current assignments, nothing to migrate.
export async function setMissionFunction(orgId, body = {}, account, d = {}) {
  const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });
  if (!account?.email) throw fail("USER_SESSION_REQUIRED", 401);
  const fetchRows = d.fetchRows || rest, q = encodeURIComponent;
  const fn = String(body.function || "");
  if (!Object.hasOwn(MISSION_FUNCTIONS, fn)) throw fail("UNKNOWN_MISSION_FUNCTION", 400);
  const missionId = String(body.mission_id || ""), assignmentId = String(body.assignment_id || "");
  const base = `office_mission_assignments?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}`;
  let rows;
  try { rows = await fetchRows(base + "&select=id,staff_profile_id,mission_role,mission_function,status") || []; }
  catch { throw fail("MISSION_FUNCTION_SQL_NOT_INSTALLED", 503); }
  const target = rows.find((r) => String(r.id) === assignmentId);
  if (!target) throw fail("ASSIGNMENT_NOT_FOUND", 404);
  const ids = [...new Set(rows.map((r) => r.staff_profile_id).filter(Boolean))];
  const people = ids.length ? await fetchRows(`office_staff_profiles?org_id=eq.${q(orgId)}&id=in.(${ids.map(q).join(",")})&select=id,full_name,email`) || [] : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const team = rows.map((r) => ({ ...r, email: byId.get(r.staff_profile_id)?.email || null }));
  const firmPartner = ["owner", "partner"].includes(account.role);
  if (!firmPartner && !(account.role === "manager" && functionsOf(account, team).has("manager")))
    throw fail("MISSION_MANAGER_OR_PARTNER_REQUIRED", 403);
  const person = byId.get(target.staff_profile_id) || {};
  if (low(person.email) && low(person.email) === low(account.email)) throw fail("NO_SELF_FUNCTION_CHANGE", 403);
  const before = fnOf(target);
  if (!firmPartner && (LEAD_FUNCTIONS.includes(fn) || LEAD_FUNCTIONS.includes(before))) throw fail("PARTNER_SETS_LEAD_FUNCTIONS", 403);
  if (before === fn) return { changed: false, assignment_id: assignmentId, mission_function: fn, mission_role: target.mission_role || null };
  const at = new Date().toISOString(), by = String(account.email).slice(0, 200);
  await fetchRows(`office_mission_assignments?org_id=eq.${q(orgId)}&id=eq.${q(assignmentId)}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ mission_function: fn, mission_function_set_by: by, mission_function_set_at: at, mission_role: MISSION_FUNCTIONS[fn] }) });
  const label = (f, role) => (f ? MISSION_FUNCTIONS[f] : role ? `aucune (libellé « ${role} »)` : "aucune");
  await (d.audit || audit)(orgId, { agent: "office-manager", mission_id: missionId, action_type: "MISSION_FUNCTION_CHANGED", status: "succeeded",
    decision: `${person.full_name || person.email || target.staff_profile_id} : ${label(before, target.mission_role)} → ${MISSION_FUNCTIONS[fn]}`.slice(0, 900),
    approved_by: String(account.display_name || account.email).slice(0, 120), approved_at: at }, { fetchRows }).catch(() => null);
  return { changed: true, assignment_id: assignmentId, before: before ? MISSION_FUNCTIONS[before] : target.mission_role || null, mission_function: fn, mission_role: MISSION_FUNCTIONS[fn],
    note: "Les revues et validations en attente suivent la nouvelle fonction ; les signatures déjà données restent valables." };
}
