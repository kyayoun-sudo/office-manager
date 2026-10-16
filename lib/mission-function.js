// Presentation follows the current assignment, never grants permissions or signing rights.
export function missionFunction(role) {
  const value = String(role || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (/partner|associe/.test(value)) return "partner";
  if (/manager|chef de mission/.test(value)) return "manager";
  if (/supervis|senior/.test(value)) return "senior";
  if (/junior|auditeur|auditor|collaborat/.test(value)) return "auditor";
  if (/quality|qualite/.test(value)) return "quality_reviewer";
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
