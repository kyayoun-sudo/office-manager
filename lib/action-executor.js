import { rest } from './supabase.js';
import { proposeMessage } from './agent-mail.js';
import { getPersona, isInternal } from './agent-persona.js';
import { isColleague, missionClientContacts } from './agent-mail.js';
import { depositMail, PBC_MAIL_RECEIVED } from './agent-mailbox.js';
import { tidyDrive } from './tidy-drive.js';

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

// work_state allowed by the database: requested | executed | verified | blocked | cancelled
// (an approved action still to be done = status approved + work_state requested + no executed_at).
async function patchAction(orgId, id, fields, fetchRows) {
  const rows = await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(id) + '&status=in.(proposed,awaiting_approval)', {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(fields)
  });
  return rows?.[0] || null;
}

// The mission manager's e-mail, from the mission team (manager / chef de mission role).
async function missionManagerEmail(orgId, action, fetchRows, persona) {
  const named = action.payload?.recipients?.find(r => r.role === 'mission_manager');
  if (named?.email && isColleague(named.email, persona)) return named.email.toLowerCase();
  if (!action.office_mission_id) return null;
  const team = await fetchRows('office_mission_assignments?org_id=eq.' + q(orgId) + '&office_mission_id=eq.' + q(action.office_mission_id) +
    '&select=staff_profile_id,mission_role&limit=50') || [];
  const lead = team.find(t => /manager|chef|responsable|lead|associ/i.test(String(t.mission_role || ''))) || null;
  if (!lead) return null;
  const staff = (await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&id=eq.' + q(lead.staff_profile_id) + '&select=email&limit=1'))?.[0];
  const email = String(staff?.email || '').toLowerCase();
  return email && isColleague(email, persona) ? email : null;
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
    const item = action.payload?.pbc_item || {};
    // Who chases this item: the person named in the work programme, else the mission manager.
    const named = String(item.responsible_email || '').toLowerCase();
    const responsible = named && isColleague(named, persona) ? named : await missionManagerEmail(orgId, action, fetchRows, persona).catch(() => null);
    const propose = deps.proposeMessage || proposeMessage;
    const ids = [];
    if (responsible) {
      const internal = await propose(orgId, {
        recipients: [responsible],
        subject: 'Relance PBC : ' + (item.reference || '') + ' ' + (item.document || ''),
        body: 'Bonjour,\n\nLa pièce PBC ' + (item.reference || '') + ' (' + (item.document || 'document') + ') est toujours attendue' +
          (item.deadline ? ' depuis le ' + item.deadline : '') + ' (état : ' + (item.lifecycle_state || 'non reçue') + ').\n' +
          'Tu es responsable de son suivi. Un brouillon de relance au client attend la validation d’un responsable dans « À valider ».\n\n' + (action.summary || ''),
        source: 'agent', requested_by: 'Validation de ' + (by || 'un responsable')
      }, null, deps.mailDeps || {});
      if (internal?.id) ids.push(internal.id);
    }
    // Draft to the client (rule of 2026-10-07): proposed, never sent before a manager validates it,
    // and only to the client contact registered on the mission.
    let clientDraft = null;
    const contacts = action.office_mission_id ? await missionClientContacts(orgId, action.office_mission_id, fetchRows).catch(() => []) : [];
    if (contacts.length) {
      clientDraft = await propose(orgId, {
        audience: 'client', office_mission_id: action.office_mission_id, recipients: contacts,
        subject: 'Relance — documents attendus' + (item.reference ? ' (' + item.reference + ')' : ''),
        body: 'Madame, Monsieur,\n\nDans le cadre de notre mission, nous restons dans l’attente du document suivant :\n- ' +
          (item.reference ? item.reference + ' — ' : '') + (item.document || 'document demandé') + (item.deadline ? ' (attendu le ' + item.deadline + ')' : '') + '.\n\n' +
          'Pourriez-vous nous le transmettre en réponse à ce message ? N’hésitez pas à nous signaler toute difficulté.\n\n' +
          'Nous vous remercions par avance et restons à votre disposition.\n\nCordialement,\n' + (persona.agent_display_name || 'Le cabinet'),
        source: 'agent', requested_by: 'Validation de ' + (by || 'un responsable')
      }, null, deps.mailDeps || {});
      if (clientDraft?.id) ids.push(clientDraft.id);
    }
    // Proposed first (an error leaves the action pending, nothing lost), then the action is closed.
    if (!await patchAction(orgId, action.id, { status: 'approved', approved_at: now, work_state: 'requested' }, fetchRows)) return ALREADY;
    const parts = [];
    if (responsible) parts.push('un message à ' + responsible);
    if (clientDraft) parts.push('un brouillon de relance au client (' + contacts.join(', ') + ')');
    return { executed: true, message_id: ids[0] || null, message_ids: ids,
      effect: parts.length ? 'Relance validée : ' + parts.join(' et ') + ' attendent votre validation dans « Messages de l’agent ». Rien n’est envoyé avant.'
        : 'Relance validée. Ni responsable ni contact client enregistré sur la mission : la relance reste dans la liste des actions de l’équipe.' };
  }

  if (action.action_type === PBC_MAIL_RECEIVED) {
    if (!await patchAction(orgId, action.id, { status: 'approved', approved_at: now, work_state: 'requested' }, fetchRows)) return ALREADY;
    const r = await (deps.depositMail || depositMail)(orgId, action, deps.mailboxDeps || {}).catch(e => ({ deposited: false, waiting: String(e.message || e) }));
    if (r.deposited) {
      await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(action.id), {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: 'executed', executed_at: now })
      });
      return { executed: true, effect: 'Pièces déposées dans le Drive (' + r.files.length + ' fichier(s), dossier à revoir) : l’Orpailleur les classera.' };
    }
    const why = { MAPPING_REVIEW_REQUIRED: 'dès que la cartographie du Drive sera validée', REVIEW_FOLDER_NOT_FOUND: 'dès que le dossier 00_A_REVOIR_AGENT sera trouvé' }[r.waiting] || 'au prochain passage (' + r.waiting + ')';
    return { executed: true, effect: 'Validé. Les pièces seront déposées dans le Drive ' + why + '.' };
  }

  // An Orpailleur proposal to move / rename a file: done only now, after a manager's approval.
  if (action.action_type === 'FILE_MOVE') {
    const p = action.payload || {};
    if (!await patchAction(orgId, action.id, { status: 'approved', approved_at: now, work_state: 'requested' }, fetchRows)) return ALREADY;
    try {
      const td = deps.tidyDrive || tidyDrive;
      let toParent = p.to_parent || null;
      // A mission folder to create first (following the firm's structure), level by level.
      if (p.create && p.create.parent_id && (p.create.names || []).length) {
        let parent = p.create.parent_id;
        for (const name of p.create.names) parent = (await td.findOrCreateFolder(parent, name)).id;
        toParent = parent;
      }
      await td.move(p.file_id, toParent ? p.from_parent : null, toParent, p.new_name || null);
      await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(action.id), {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: 'executed', executed_at: now }) });
      const done = (p.to_parent || p.create ? 'Rangé dans « ' + (p.to_name || 'le dossier') + ' »' : 'Renommé') + (p.new_name ? ' sous le nom « ' + p.new_name + ' »' : '') + '.';
      return { executed: true, effect: (p.create ? 'Dossier « ' + p.create.names.join(' / ') + ' » créé ou retrouvé. ' : '') + done };
    } catch (e) {
      return { executed: false, effect: 'Validé, mais Google a refusé le déplacement (' + String(e.message || e).slice(0, 80) + ') : rien n’a changé dans le Drive.' };
    }
  }

  // A document deposited for a mission (engagement letter, contract) gives new dates: validated,
  // the mission's dates change — only those two fields, nothing else (lib/mission-files.js).
  if (action.action_type === 'MISSION_UPDATE') {
    const p = action.payload || {};
    const patch = {};
    for (const k of ['planned_start', 'planned_end']) if (/^\d{4}-\d{2}-\d{2}$/.test(String(p[k] || ''))) patch[k] = p[k];
    const missionId = p.mission_id || action.office_mission_id;
    if (!missionId || !Object.keys(patch).length) return { executed: false, effect: 'Rien à mettre à jour : dates absentes.' };
    if (!await patchAction(orgId, action.id, { status: 'approved', approved_at: now, work_state: 'requested' }, fetchRows)) return ALREADY;
    await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(action.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: 'executed', executed_at: now }) }).catch(() => null);
    return { executed: true, effect: 'Dates de la mission mises à jour : ' + (patch.planned_start || 'début inchangé') + ' → ' + (patch.planned_end || 'fin inchangée') + '.' };
  }

  // A work file left open in Excel: validated, the panel in that Excel saves and closes it.
  if (action.action_type === 'WORKFILE_SAVE_CLOSE') {
    if (!await patchAction(orgId, action.id, { status: 'approved', approved_at: now, work_state: 'requested' }, fetchRows)) return ALREADY;
    const { requestSaveClose } = await import('./workfiles.js');
    await requestSaveClose(orgId, action.payload?.session_id, fetchRows).catch(() => null);
    return { executed: true, effect: 'Le panneau Excel enregistre et ferme « ' + (action.payload?.file_name || 'le fichier') + ' » dès que l’ordinateur répond.' };
  }

  if (action.action_type === 'REVIEW_FILE') {
    if (!await patchAction(orgId, action.id, { status: 'approved', approved_at: now, work_state: 'requested' }, fetchRows)) return ALREADY;
    return { executed: true, effect: 'Pièce contrôlée : l’Orpailleur pourra la classer à son prochain passage.' };
  }

  if (!await patchAction(orgId, action.id, { status: 'approved', approved_at: now, work_state: 'requested' }, fetchRows)) return ALREADY;
  return { executed: true, effect: 'Action validée : elle devient une tâche active de l’équipe.' };
}

export { PBC_EXTERNAL_REMINDER };
