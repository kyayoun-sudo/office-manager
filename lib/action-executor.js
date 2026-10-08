import { rest } from './supabase.js';
import { proposeMessage } from './agent-mail.js';
import { getPersona, isInternal } from './agent-persona.js';
import { isColleague, missionClientContacts } from './agent-mail.js';
import { depositMail, PBC_MAIL_RECEIVED } from './agent-mailbox.js';
import { tidyDrive } from './tidy-drive.js';
import { canMove, canonicalStatus, LABELS } from './mission-status.js';

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

export async function responsibleFor(orgId, action, fetchRows) {
  const org = 'org_id=eq.' + q(orgId);
  const p = action.payload || {};
  const email = String(p.assignee_email || p.responsible_email || p.pbc_item?.responsible_email || (p.recipients || []).find(r => r.role === 'mission_manager')?.email || '').toLowerCase();
  if (email) {
    const s = (await fetchRows('office_staff_profiles?' + org + '&email=eq.' + q(email) + '&active=eq.true&select=id,full_name&limit=1'))?.[0];
    if (s) return s;
  }
  if (!action.office_mission_id) return null;
  const team = await fetchRows('office_mission_assignments?' + org + '&office_mission_id=eq.' + q(action.office_mission_id) + '&status=not.in.(rejected,cancelled,completed)&select=staff_profile_id,mission_role&limit=50') || [];
  const lead = team.find(t => /manager|chef|responsable|lead/i.test(String(t.mission_role || ''))) || team.find(t => /associ|partner/i.test(String(t.mission_role || ''))) || (team.length === 1 ? team[0] : null);
  if (!lead) return null;
  return (await fetchRows('office_staff_profiles?' + org + '&id=eq.' + q(lead.staff_profile_id) + '&select=id,full_name&limit=1'))?.[0] || null;
}

// Repair (each tick): validated items still without anybody get the person named in them or the
// mission's manager; those for which nobody can be found stay listed with « À qui la confier ? ».
export async function assignValidatedOrphans(orgId, deps = {}) {
  const fetchRows = deps.fetchRows || rest;
  const { needsPerson } = await import('./kpi.js');
  const rows = await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&status=eq.approved&assigned_staff_profile_id=is.null&executed_at=is.null&verified_at=is.null&select=id,action_type,status,work_state,office_mission_id,payload&limit=100') || [];
  let assigned = 0, asked = 0;
  for (const a of rows.filter(needsPerson)) {
    const owner = await responsibleFor(orgId, a, fetchRows).catch(() => null);
    if (!owner) { asked++; continue; }
    await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(a.id) + '&assigned_staff_profile_id=is.null', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ assigned_staff_profile_id: owner.id }) }).then(() => { assigned++; }, () => null);
  }
  return { assigned, to_ask: asked };
}

// A manager gives an action to a person (from « Sans responsable » or right after a validation).
export async function assignAction(orgId, actionId, staffId, by, deps = {}) {
  const fetchRows = deps.fetchRows || rest;
  const key = /@/.test(String(staffId)) ? '&email=eq.' + q(String(staffId).toLowerCase()) : '&id=eq.' + q(staffId);
  const s = (await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + key + '&active=eq.true&select=id,full_name&limit=1'))?.[0];
  if (!s) throw Object.assign(new Error('STAFF_NOT_FOUND'), { statusCode: 404 });
  const rows = await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(actionId), { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ assigned_staff_profile_id: s.id }) });
  if (!rows?.[0]) throw Object.assign(new Error('ACTION_NOT_FOUND'), { statusCode: 404 });
  return { id: actionId, assigned_to: s.full_name, by: by || null };
}

export async function executeDecision(orgId, action, decision, by, deps = {}) {
  const fetchRows = deps.fetchRows || rest;
  const now = (deps.now || (() => new Date()))().toISOString();
  // deps.reexecute (lib/recovery.js): an action ALREADY approved whose execution was interrupted is
  // carried out again, without approving it a second time.
  const approve = fields => deps.reexecute ? Promise.resolve({ id: action.id }) : patchAction(orgId, action.id, fields, fetchRows);
  if (decision === 'defer') return { executed: false, effect: 'Reporté : rien ne change.' };
  if (decision === 'reject') {
    if (!await approve({ status: 'rejected' })) return ALREADY;
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
    if (!await approve({ status: 'approved', approved_at: now, work_state: 'requested' })) return ALREADY;
    const parts = [];
    if (responsible) parts.push('un message à ' + responsible);
    if (clientDraft) parts.push('un brouillon de relance au client (' + contacts.join(', ') + ')');
    return { executed: true, message_id: ids[0] || null, message_ids: ids,
      effect: parts.length ? 'Relance validée : ' + parts.join(' et ') + ' attendent votre validation dans « Messages de l’agent ». Rien n’est envoyé avant.'
        : 'Relance validée. Ni responsable ni contact client enregistré sur la mission : la relance reste dans la liste des actions de l’équipe.' };
  }

  if (action.action_type === PBC_MAIL_RECEIVED) {
    if (!await approve({ status: 'approved', approved_at: now, work_state: 'requested' })) return ALREADY;
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
    if (!await approve({ status: 'approved', approved_at: now, work_state: 'requested' })) return ALREADY;
    try {
      const td = deps.tidyDrive || tidyDrive;
      let toParent = p.to_parent || null;
      // A mission folder to create first (following the firm's structure), level by level.
      if (p.create && p.create.parent_id && (p.create.names || []).length) {
        let parent = p.create.parent_id;
        // The mission folder (first level created) gets the sub-folders of the firm's model.
        const missionLevel = p.create.names.findIndex(n => !/^(?:fy|ex(?:ercice)?)?[\s_-]*(19|20)\d\d$/i.test(String(n).trim()));
        for (const [i, name] of p.create.names.entries()) {
          parent = (await td.findOrCreateFolder(parent, name)).id;
          if (i === missionLevel && Array.isArray(p.create.model_subfolders)) for (const sub of p.create.model_subfolders.slice(0, 20)) await td.findOrCreateFolder(parent, String(sub).slice(0, 120)).catch(() => null);
        }
        toParent = parent;
      }
      // Same name already in the destination: both versions are KEPT (Orpailleur: « je n'écrase pas
      // les versions… je préfère conserver deux versions et signaler une anomalie »).
      let finalName = p.new_name || null, anomaly = '';
      const wanted = finalName || p.file_name;
      const where = toParent || p.from_parent;
      if (wanted && where && td.nameTaken && await td.nameTaken(where, wanted, p.file_id).catch(() => false)) {
        const dot = wanted.lastIndexOf('.');
        const [base, ext] = dot > 0 ? [wanted.slice(0, dot), wanted.slice(dot)] : [wanted, ''];
        finalName = base + ' (version ' + now.slice(0, 10) + ')' + ext;
        anomaly = ' Anomalie : un autre fichier « ' + wanted + ' » existe déjà à cet endroit ; les deux versions sont conservées (celui-ci s’appelle « ' + finalName + ' »), à vérifier.';
      }
      await td.move(p.file_id, toParent ? p.from_parent : null, toParent, finalName);
      // Verified in Drive (« je ne dis pas c'est fait simplement parce que j'ai demandé à une API »):
      // the file is read back: same id, expected name, expected folder.
      let verified = null;
      if (td.getFile) {
        const m = await td.getFile(p.file_id).catch(() => null);
        verified = Boolean(m && !m.trashed && (!toParent || (m.parents || []).includes(toParent)) && (!finalName || m.name === finalName));
      }
      await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(action.id), {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: 'executed', executed_at: now, ...(verified ? { verified_at: now } : {}) }) });
      const done = (p.to_parent || p.create ? 'Rangé dans « ' + (p.to_name || 'le dossier') + ' »' : 'Renommé') + (finalName ? ' sous le nom « ' + finalName + ' »' : '') + '.' +
        (verified === true ? ' Vérifié dans le Drive.' : verified === false ? ' Attention : la vérification dans le Drive ne retrouve pas le fichier à l’endroit attendu.' : '') + anomaly;
      // The folder it left, now empty: to the bin (recoverable), for a clean Drive.
      let emptied = '';
      if (toParent && p.from_parent && p.from_parent !== toParent && td.binEmptyFolder) {
        const b = await td.binEmptyFolder(p.from_parent, { protect: deps.protectFolders || [] }).catch(() => ({ binned: false }));
        if (b.binned) emptied = ' Le dossier « ' + (b.name || 'vide') + ' », resté vide, est mis à la corbeille.';
      }
      return { executed: true, verified, effect: (p.create ? 'Dossier « ' + p.create.names.join(' / ') + ' » créé ou retrouvé. ' : '') + done + emptied };
    } catch (e) {
      return { executed: false, effect: 'Validé, mais Google a refusé le déplacement (' + String(e.message || e).slice(0, 80) + ') : rien n’a changé dans le Drive.' };
    }
  }

  // A document deposited for a mission (engagement letter, contract) gives new dates: validated,
  // the mission's dates change — only those two fields, nothing else (lib/mission-files.js).
  // Lifecycle (added 2026-10-08): a validated status change, only along the allowed moves
  // (archive only after closing). Closing builds the final mission memory and its learnings.
  // Only a proposal made AS a status change (kind « status_change ») moves the status: a status
  // slipped into a dates proposal is still ignored.
  if (action.action_type === 'MISSION_UPDATE' && (action.payload || {}).kind === 'status_change' && (action.payload || {}).status) {
    const p = action.payload || {};
    const missionId = p.mission_id || action.office_mission_id;
    const cur = missionId ? (await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId) + '&select=id,status&limit=1'))?.[0] : null;
    if (!cur) return { executed: false, effect: 'Mission introuvable : rien n’a changé.' };
    if (!canMove(cur.status, p.status)) return { executed: false, effect: 'Changement refusé : « ' + (LABELS[canonicalStatus(cur.status)] || cur.status) + ' » ne peut pas passer à « ' + (LABELS[p.status] || p.status) + ' ».' };
    if (!await approve({ status: 'approved', approved_at: now, work_state: 'requested' })) return ALREADY;
    const full = { status: p.status, status_changed_at: now, ...(p.status === 'closed' ? { closed_at: now } : {}), ...(p.status === 'archived' ? { archived_at: now } : {}) };
    const url = 'office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId);
    // Without db/memory.sql the dates of status do not exist yet: the status alone changes.
    try { await fetchRows(url, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(full) }); }
    catch { await fetchRows(url, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: p.status }) }); }
    await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(action.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: 'executed', executed_at: now }) }).catch(() => null);
    let extra = '';
    if (p.status === 'closed') {
      const close = deps.closeMission || (await import('./mission-memory.js')).closeMission;
      const r = await close(orgId, missionId, deps.memoryDeps || {}).catch(e => ({ error: String(e.message || e).slice(0, 80) }));
      extra = r.error ? ' Mémoire finale à refaire (' + r.error + ').' : r.memory === 'written' ? ' Mémoire finale de la mission enregistrée ; ' + ((r.learnings?.recorded || []).length) + ' apprentissage(s) proposé(s).' : ' Mémoire finale en attente du dossier Drive de la mission.';
    }
    return { executed: true, effect: 'Mission passée à « ' + LABELS[p.status] + ' ».' + extra };
  }

  // The mission's Drive folder confirmed by a person: the mission memory is kept there.
  if (action.action_type === 'MISSION_FOLDER_LINK') {
    const p = action.payload || {};
    const missionId = p.mission_id || action.office_mission_id;
    if (!missionId || !p.folder_id) return { executed: false, effect: 'Aucun dossier proposé : indiquez le dossier de la mission à Mission Controller.' };
    if (!await approve({ status: 'approved', approved_at: now, work_state: 'requested' })) return ALREADY;
    try {
      await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(p.kind === 'client' ? { client_folder_id: p.folder_id } : { drive_folder_id: p.folder_id }) });
    } catch { return { executed: false, effect: 'Validé, mais la base n’a pas encore la colonne du dossier (exécuter db/memory.sql).' }; }
    await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(action.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: 'executed', executed_at: now }) }).catch(() => null);
    return { executed: true, effect: (p.kind === 'client' ? 'Dossier du client enregistré (« ' + (p.folder_path || p.folder_id) + ' ») : sa mémoire permanente y sera gardée, pour cette mission et les suivantes.' : 'Dossier de la mission enregistré (« ' + (p.folder_path || p.folder_id) + ' »).') };
  }

  if (action.action_type === 'MISSION_UPDATE') {
    const p = action.payload || {};
    const patch = {};
    for (const k of ['planned_start', 'planned_end']) if (/^\d{4}-\d{2}-\d{2}$/.test(String(p[k] || ''))) patch[k] = p[k];
    const missionId = p.mission_id || action.office_mission_id;
    if (!missionId || !Object.keys(patch).length) return { executed: false, effect: 'Rien à mettre à jour : dates absentes.' };
    if (!await approve({ status: 'approved', approved_at: now, work_state: 'requested' })) return ALREADY;
    await fetchRows('office_missions?org_id=eq.' + q(orgId) + '&id=eq.' + q(missionId), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
    await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(action.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: 'executed', executed_at: now }) }).catch(() => null);
    return { executed: true, effect: 'Dates de la mission mises à jour : ' + (patch.planned_start || 'début inchangé') + ' → ' + (patch.planned_end || 'fin inchangée') + '.' };
  }

  if (action.action_type === 'REVIEW_FILE') {
    if (!await approve({ status: 'approved', approved_at: now, work_state: 'requested' })) return ALREADY;
    return { executed: true, effect: 'Pièce contrôlée : l’Orpailleur pourra la classer à son prochain passage.' };
  }

  // Who does it (2026-10-08): an item validated by the owner must not stay « Sans responsable ».
  // The person named in the proposal, else the mission's manager; nobody found → asked now.
  const owner = await responsibleFor(orgId, action, fetchRows).catch(() => null);
  if (!await approve({ status: 'approved', approved_at: now, work_state: 'requested', ...(owner ? { assigned_staff_profile_id: owner.id } : {}) })) return ALREADY;
  if (owner) return { executed: true, assigned_to: owner.full_name, effect: 'Action validée : elle devient une tâche active de l’équipe, confiée à ' + owner.full_name + '.' };
  return { executed: true, needs_assignee: true, effect: 'Action validée : elle devient une tâche active de l’équipe. À qui la confier ? Choisissez la personne : elle ne restera pas « sans responsable ».' };
}

export { PBC_EXTERNAL_REMINDER };
