// ROLES IN THE FIRM — one source of truth for the server (Paul, 2026-10-10: « tout le monde ne peut pas
// avoir la même interface dans un cabinet ; celui qui met les noms met aussi les rôles et les positions »).
// Specification §5 (human roles) and §58 (permissions). Three things are kept apart:
//   - the ROLE (what a person sees and may do in the application: below);
//   - the POSITION (grade or title in the firm: « Senior 2 », « Manager confirmé »… free text);
//   - the role ON A MISSION (an assignment: a manager may supervise another mission) — mission data.
// Who reports to whom (reports_to) decides whose performance a manager may see, when the firm allows it.

import { rest } from './supabase.js';

export const ROLES = Object.freeze(['owner', 'partner', 'quality_reviewer', 'manager', 'supervisor', 'senior', 'auditor', 'secretary', 'it_admin', 'collaborator']);
export const ROLE_LABELS = Object.freeze({
  owner: 'Propriétaire du cabinet', partner: 'Associé', quality_reviewer: 'Revue qualité (EQR)', manager: 'Manager', supervisor: 'Superviseur',
  senior: 'Senior', auditor: 'Auditeur', secretary: 'Secrétariat / administration', it_admin: 'Responsable informatique', collaborator: 'Collaborateur (ancien rôle)'
});

// Families used by the routes (a route names a family, never a list typed again).
export const FIRM_LEAD = Object.freeze(['owner', 'partner']);
export const MANAGERS = Object.freeze(['owner', 'partner', 'manager', 'supervisor']);
export const ACCOUNT_ADMINS = Object.freeze(['owner', 'partner', 'it_admin']);
// Everyone who works on the firm's engagements (the IT administrator manages accounts and connections,
// not client files).
export const WORKERS = Object.freeze(['owner', 'partner', 'quality_reviewer', 'manager', 'supervisor', 'senior', 'auditor', 'secretary', 'collaborator']);
export const EVERYONE = ROLES;

const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const q = encodeURIComponent;

// Who may give which role: only an owner makes an owner; the IT administrator manages accounts but
// never gives (nor changes) the firm's leading roles. Nobody raises their own role.
export function mayGrant(actor, targetRole, currentRole = null, isSelf = false) {
  const a = actor?.role;
  if (!ROLES.includes(targetRole)) return false;
  if (isSelf && targetRole !== currentRole) return false;
  if (targetRole === 'owner' || currentRole === 'owner') return a === 'owner';
  if (a === 'owner' || a === 'partner') return true;
  if (a === 'it_admin') return !FIRM_LEAD.includes(targetRole) && !FIRM_LEAD.includes(currentRole);
  return false;
}

// The firm's position titles mapped to a role (the team sheet says « Associé gérant », « Assistante de
// direction », « Auditeur junior »…). A proposal only: a person confirms it in Paramètres.
export function roleFromTitle(title) {
  const t = String(title || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!t.trim()) return null;
  if (/qualit|eqr|engagement quality/.test(t)) return 'quality_reviewer';
  if (/informati|\bit\b|systeme|reseau|admin(istrateur)? (systeme|reseau)/.test(t)) return 'it_admin';
  if (/associe|partner|gerant|fondateur|directeur general|\bdg\b/.test(t)) return 'partner';
  if (/supervis/.test(t)) return 'supervisor';
  if (/manager|chef de mission|directeur de mission/.test(t)) return 'manager';
  if (/senior/.test(t)) return 'senior';
  if (/secretari|assistante? de direction|administrati|comptab(le|ilite) interne|accueil|office manager/.test(t)) return 'secretary';
  if (/auditeur|assistant|junior|stagiaire|consultant|collaborateur|analyste/.test(t)) return 'auditor';
  return null;
}

// ---- The firm's settings for people (who sees whose performance) ----
export const DEFAULT_SETTINGS = Object.freeze({ managers_see_direct_reports: true });

export async function firmSettings(orgId, fetchRows = rest) {
  const rows = await fetchRows('office_firm_settings?org_id=eq.' + q(orgId) + '&select=settings&limit=1').catch(() => null);
  return { ...DEFAULT_SETTINGS, ...(rows?.[0]?.settings || {}) };
}
export async function saveFirmSettings(orgId, input = {}, by = null, fetchRows = rest) {
  const cur = await firmSettings(orgId, fetchRows);
  const next = { ...cur };
  if ('managers_see_direct_reports' in input) next.managers_see_direct_reports = Boolean(input.managers_see_direct_reports);
  try {
    await fetchRows('office_firm_settings?on_conflict=org_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ org_id: orgId, settings: next, updated_by: by, updated_at: new Date().toISOString() }]) });
  } catch (e) { throw fail(/office_firm_settings|relation|PGRST205|42P01/i.test(String(e.message)) ? 'ROLES_SQL_NOT_INSTALLED' : String(e.message || e), 409); }
  return next;
}

// Whose people-data (indicators, Management Cards) an account may see:
//   null = everybody (owner, partners); a Set of e-mails otherwise (the person, and — for a manager or
//   a supervisor, when the firm allows it — the people who report to them directly).
export async function visiblePeople(orgId, account, fetchRows = rest) {
  if (FIRM_LEAD.includes(account?.role)) return null;
  const me = String(account?.email || '').toLowerCase();
  const out = new Set(me ? [me] : []);
  if (!MANAGERS.includes(account?.role)) return out;
  const settings = await firmSettings(orgId, fetchRows);
  if (!settings.managers_see_direct_reports || !account?.auth_user_id) return out;
  const rows = await fetchRows('office_app_users?org_id=eq.' + q(orgId) + '&reports_to=eq.' + q(account.auth_user_id) + '&active=eq.true&select=email&limit=500').catch(() => []) || [];
  for (const r of rows) if (r.email) out.add(String(r.email).toLowerCase());
  return out;
}
