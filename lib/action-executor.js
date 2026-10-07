import { rest } from './supabase.js';
import { proposeMessage } from './agent-mail.js';
import { getPersona, isInternal } from './agent-persona.js';
import { depositMail, PBC_MAIL_RECEIVED } from './agent-mailbox.js';

// What happens AFTER a person validates a proposal in "À valider".
// The decision itself is journaled by action-decisions.js (append-only, content hash).
// Here, the validated action is carried out, safely and only inside the firm:
//
//   REVIEW_FILE (Orpailleur)          → approved: the file can be filed at the next
//                                       Orpailleur pass (nothing is moved here).
//   PBC_EXTERNAL_REMINDER             → NEVER an e-mail to the client (rule of 2026-10-07):
//                                       a message to the mission manager (a colleague) is
//                                       PROPOSED, to be validated in "Messages de l'agent";
//                                       the manager chases the client himself.
//   PBC_MAIL_RECEIVED                 → attachments + original e-mail deposited in the Drive
//                                       review folder for the Orpailleur (now, or as soon as
//                                       the Drive mapping is reviewed).
//   any other internal follow-up      → approved: becomes an active task of the team
//                                       (visible in coordination and indicators).
//   reject                            → the proposal is closed (status rejected).
//   defer                             → nothing changes.
// Nothing is deleted, nothing is sent outside the firm.

const q = v => encodeURIComponent(v);
const PBC_EXTERNAL_REMINDER = 'PBC_EXTERNAL_REMINDER';
// Another decision got there first (two clicks at once): nothing is done twice.
const ALREADY = { executed: false, effect: 'Déjà traitée par une autre décision : rien n’a été refait.' };

async function patchAction(orgId, id, fields, fetchRows) {
  const rows = await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(id) + '&status=in.(proposed,awaiting_approval)', {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(fields)
  });
  return rows?.[0] || null;
}

// The mission manager's e-mail, from the mission team (manager / chef de mission role).
async function missionManagerEmail(orgId, action, fetchRows, persona) {
  const named = action.payload?.recipients?.find(r => r.role === 'mission_manager');
  if (named?.email && isInternal(named.email, persona)) return named.email.toLowerCase();
  if (!action.office_mission_id) return null;
  const team = await fetchRows('office_mission_assignments?org_id=eq.' + q(orgId) + '&office_mission_id=eq.' + q(action.office_mission_id) +
    '&select=staff_profile_id,mission_role&limit=50') || [];
  const lead = team.find(t => /manager|chef|responsable|lead|associ/i.test(String(t.mission_role || ''))) || null;
  if (!lead) return null;
  const staff = (await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&id=eq.' + q(lead.staff_profile_id) + '&select=email&limit=1'))?.[0];
  const email = String(staff?.email || '').toLowerCase();
  return email && isInternal(email, persona) ? email : null;
}

export async function executeDecision(orgId, action, decision, by, deps = {}) {
  const fetchRows = deps.fetchRows || rest;
  const now = (deps.now || (() => new Date()))().toISOString();
  if (decision === 'defer') return { executed: false, effect: 'Reporté : rien ne change.' };
  if (decision === 'reject') {
    if (!await patchAction(orgId, action.id, { status: 'rejected' }, fetchRows)) return ALREADY;
    return { executed: true, effect: 'Proposition fermée.' };
  }
  if (decision !== 'approve') return { executed: false, effect: null };

  if (action.action_type === PBC_EXTERNAL_REMINDER) {
    const persona = await (deps.getPersona || getPersona)(orgId);
    const manager = await missionManagerEmail(orgId, action, fetchRows, persona).catch(() => null);
    if (!manager) {
      if (!await patchAction(orgId, action.id, { status: 'approved', approved_at: now, work_state: 'approved' }, fetchRows)) return ALREADY;
      return { executed: true, effect: 'Relance validée. Aucun e-mail au client (règle du cabinet). Chef de mission introuvable : la relance reste dans la liste des actions de l’équipe.' };
    }
    const item = action.payload?.pbc_item || {};
    const message = await (deps.proposeMessage || proposeMessage)(orgId, {
      recipients: [manager],
      subject: 'Relance PBC à faire : ' + (item.reference || '') + ' ' + (item.document || ''),
      body: 'Bonjour,\n\nLa pièce PBC ' + (item.reference || '') + ' (' + (item.document || 'document') + ') est toujours attendue' +
        (item.deadline ? ' depuis le ' + item.deadline : '') + ' (état : ' + (item.lifecycle_state || 'non reçue') + ').\n' +
        'Peux-tu relancer le client ? L’agent ne lui écrit pas directement.\n\n' + (action.summary || ''),
      source: 'agent', requested_by: 'Validation de ' + (by || 'un responsable')
    }, null, deps.mailDeps || {});
    // Proposed first (an error leaves the action pending, nothing lost), then the action is closed.
    if (!await patchAction(orgId, action.id, { status: 'approved', approved_at: now, work_state: 'approved' }, fetchRows)) return ALREADY;
    return { executed: true, effect: 'Relance validée. Aucun e-mail au client : un message au chef de mission (' + manager + ') attend votre validation dans « Messages de l’agent ».', message_id: message?.id || null };
  }

  if (action.action_type === PBC_MAIL_RECEIVED) {
    if (!await patchAction(orgId, action.id, { status: 'approved', approved_at: now, work_state: 'awaiting_drive' }, fetchRows)) return ALREADY;
    const r = await (deps.depositMail || depositMail)(orgId, action, deps.mailboxDeps || {}).catch(e => ({ deposited: false, waiting: String(e.message || e) }));
    if (r.deposited) {
      await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(action.id), {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: 'deposited', executed_at: now })
      });
      return { executed: true, effect: 'Pièces déposées dans le Drive (' + r.files.length + ' fichier(s), dossier à revoir) : l’Orpailleur les classera.' };
    }
    const why = { MAPPING_REVIEW_REQUIRED: 'dès que la cartographie du Drive sera validée', REVIEW_FOLDER_NOT_FOUND: 'dès que le dossier 00_A_REVOIR_AGENT sera trouvé' }[r.waiting] || 'au prochain passage (' + r.waiting + ')';
    return { executed: true, effect: 'Validé. Les pièces seront déposées dans le Drive ' + why + '.' };
  }

  if (action.action_type === 'REVIEW_FILE') {
    if (!await patchAction(orgId, action.id, { status: 'approved', approved_at: now, work_state: 'approved' }, fetchRows)) return ALREADY;
    return { executed: true, effect: 'Pièce contrôlée : l’Orpailleur pourra la classer à son prochain passage.' };
  }

  if (!await patchAction(orgId, action.id, { status: 'approved', approved_at: now, work_state: 'approved' }, fetchRows)) return ALREADY;
  return { executed: true, effect: 'Action validée : elle devient une tâche active de l’équipe.' };
}

export { PBC_EXTERNAL_REMINDER };
