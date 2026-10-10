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
      const duplicate = td.findContentDuplicate ? await td.findContentDuplicate(p.file_id, toParent || p.from_parent) : null;
      if (duplicate) {
        await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(action.id), {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: 'blocked' }) });
        await (deps.emit || (await import('./event-bus.js')).emit)(orgId, {
          type: 'POSSIBLE_DUPLICATE', agent: 'orpailleur', object_type: 'drive_file', object_id: p.file_id,
          source: 'office_action_queue:' + action.id, idempotency_key: 'CONTENT_DUPLICATE:' + p.file_id + ':' + duplicate.id,
          payload: { existing_file_id: duplicate.id, existing_name: duplicate.name, checksum: duplicate.checksum }
        }, { fetchRows });
        return { executed: false, duplicate: true, effect: 'Doublon de contenu détecté : « ' + duplicate.name + ' ». Aucun déplacement ni renommage ; les deux fichiers sont conservés pour décision humaine.' };
      }
      // Same name already in the destination: both versions are KEPT (Orpailleur: « je n'écrase pas
      // les versions… je préfère conserver deux versions et signaler une anomalie »).
      let finalName = p.new_name || null, anomaly = '';
      const wanted = finalName || p.file_name;
      const where = toParent || p.from_parent;
      if (wanted && where && td.nameTaken && await td.nameTaken(where, wanted, p.file_id)) {
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
      // Event bus (2026-10-09): only a VERIFIED filing is announced; the Mission Controller reacts.
      if (verified) {
        const where = toParent || p.from_parent || null;
        await (deps.emit || (await import('./event-bus.js')).emit)(orgId, { type: 'DOCUMENT_CLASSIFIED', agent: action.agent_key || 'orpailleur', actor: deps.decidedBy || null,
          engagement_id: action.office_mission_id || null, object_type: 'drive_file', object_id: p.file_id, source: 'office_action_queue:' + action.id,
          idempotency_key: 'DOCUMENT_CLASSIFIED:' + p.file_id + ':' + (where || '') + ':' + (finalName || p.file_name || ''),
          payload: { name: finalName || p.file_name, url: p.web_url || null, folder_id: where, folder_path: p.to_name || null, ...(p.classification || {}) } }, { fetchRows }).catch(() => null);
      }
      return { executed: true, verified, effect: (p.create ? 'Dossier « ' + p.create.names.join(' / ') + ' » créé ou retrouvé. ' : '') + done + emptied };
    } catch (e) {
      await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(action.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: 'blocked' }) }).catch(() => null);
      return { executed: false, effect: 'Rangement interrompu (' + String(e.message || e).slice(0, 80) + '). Vérifier le Drive avant de reprendre : certaines étapes ont pu être réalisées.' };
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
