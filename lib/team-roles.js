// THE FIRM MANAGER SETS THE INTERFACES UP FROM THE FIRM'S OWN TEAM SHEET (Paul, 2026-10-10: « Firm
// Manager met même l'interface en place quand on remplit la feuille »). The team sheet (HR folder,
// e.g. TATY_EQUIPE_RESPONSABLES, read by lib/firm-members.js) says who is who: title, grade, e-mail,
// direct manager. From it, the Firm Manager PROPOSES for each person: the role in the application
// (which decides the interface), the position, who they report to — and the accounts still to create.
// A proposal only: the owner, a partner or the IT administrator confirms it in Paramètres.

import { rest } from './supabase.js';
import { roleFromTitle, ROLE_LABELS } from './roles.js';
import { teamSheetMembers, sameName } from './firm-members.js';
import { listAccounts } from './accounts.js';

export async function proposeTeamRoles(orgId, d = {}) {
  const sheet = await (d.teamSheetMembers || teamSheetMembers)(d).catch(e => ({ members: [], reason: String(e.message || e).slice(0, 80) }));
  const { users = [], roles_installed } = await (d.listAccounts || listAccounts)(orgId, d.fetchRows || rest);
  const findAccount = m => users.find(u => (m.email && String(u.email).toLowerCase() === m.email) || sameName(u.display_name, m.full_name));
  const proposals = (sheet.members || []).map(m => {
    const account = findAccount(m) || null;
    const title = [m.role, m.grade].filter(Boolean).join(' — ');
    const role = roleFromTitle(m.role) || roleFromTitle(m.grade);
    const boss = m.reports_to ? users.find(u => sameName(u.display_name, m.reports_to)) || null : null;
    const changes = account ? {
      role: role && role !== account.role && account.role !== 'owner' ? role : null,
      position: title && title !== account.position ? title : null,
      reports_to: boss && boss.auth_user_id !== account.reports_to && boss.auth_user_id !== account.auth_user_id ? boss.auth_user_id : null
    } : null;
    return {
      full_name: m.full_name, email: m.email || null, title: title || null, reports_to_name: m.reports_to || null,
      proposed_role: role, proposed_role_label: role ? ROLE_LABELS[role] : null, proposed_reports_to: boss?.auth_user_id || null,
      account: account ? { auth_user_id: account.auth_user_id, role: account.role, position: account.position || null, reports_to: account.reports_to || null, active: account.active } : null,
      status: !account ? 'no_account' : (changes.role || changes.position || changes.reports_to) ? 'differs' : 'ok', changes
    };
  });
  return { source: sheet.source || null, reason: sheet.reason || null, roles_installed: Boolean(roles_installed), proposals,
    note: 'Proposé par le Firm Manager d’après le tableau de l’équipe du cabinet. Rien n’est appliqué sans votre confirmation.' };
}
