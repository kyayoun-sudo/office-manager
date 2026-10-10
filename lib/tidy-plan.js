    const answered = a && ['answered', 'resolved'].includes(a.status) ? '\nRÉPONSE HUMAINE OBTENUE (' + (a.answer_by || a.to || '') + ', ' + String(a.answered_at || '').slice(0, 10) + ', question : « ' + (a.missing || '') + ' ») : ' + (a.answer || '') +
      (a.moved?.from ? '\n(le fichier attend dans ' + REVIEW_FOLDER + ' ; sa place d’origine : ' + a.moved.from + ')' : '') : '';
    lines.push('### ' + f.id + ' | ' + f.path + answered + '\nLECTURE : ' + got.inspection.status + '\n' + ex);
  }
  const profileScope = readerScope;
  const profiles = await understandDocuments(inspections, { scope: d.readerScope || profileScope, analyze: d.understandAI || d.runAI || runAI });
  st.document_profiles ||= {};
  for (const profile of profiles) { st.document_profiles[profile.document_id] = profile; if (st.understanding_queue?.[profile.document_id]) st.understanding_queue[profile.document_id].status = profile.status === 'UNDERSTANDING_FAILED' ? 'ERROR' : 'DONE'; }
  const pbc = await pbcContext(scan?.items || [], batch, read, d).catch(() => '');
  // Corrections validated by a human become lessons (Shadow); the Orpailleur applies its own.
  const lessons = await (d.activeLessons || (async a => (await import('./shadow.js')).activeLessons(a, { drive, folder })))('orpailleur').catch(() => []);
  const input = (lessons?.length ? 'LEÇONS APPRISES DE CORRECTIONS VALIDÉES (applique-les ; une leçon propre à une mission ne vaut que pour elle) :\n- ' + lessons.slice(0, 30).join('\n- ') + '\n\n' : '') + (pbc ? pbc + '\n\n' : '') + (structure.pattern ? 'HYPOTHÈSE DE STRUCTURE DU CABINET (indices dans les chemins, non validée ; ne donne aucune autorisation) : ' + structure.pattern + '\nExemples réels : ' + structure.examples.join(' ; ') +
      (structure.models.length ? '\nMODÈLE DE DOSSIER DE MISSION du cabinet (une nouvelle mission en reçoit les sous-dossiers ; nomme le dossier comme les exemples, ex. CLIENT_TYPE_ANNEE ; range le fichier dans le bon sous-dossier, en le mettant comme dernier niveau de create_names) : ' + structure.models.map(m => m.path + ' → ' + m.subfolders.join(', ')).join(' | ') : '') + '\n\n' : '') +
    'DOSSIERS (id | chemin) :\n' + folders + '\n\nEXEMPLES DE DOSSIERS DE MISSION DU CABINET :\n' + missionRoots +
    '\n\nCE QUE TU SAIS DU CABINET :\n' + context + '\n\nPROFILS DOCUMENTAIRES (faits appuyés par des passages ; interprétations signalées, couverture parfois partielle ; absence de faits = inconnu) :\n' + JSON.stringify(profiles).slice(0, 30000) + '\n\nFICHIERS À DÉCIDER (id | chemin, puis extrait du contenu) :\n' + lines.join('\n\n');
  let plan = null, lastError = null;
  for (const provider of ['auto', 'openai', 'anthropic']) {
    try { plan = parseJson((await (d.runAI || runAI)({ agentKey: 'orpailleur', instructions: INSTRUCTIONS, input: input.slice(0, 150000), provider, maxTokens: 16000 })).text); break; }
    catch (e) { lastError = e; }
  }
  if (!plan) { st.status = 'failed'; st.error = String(lastError?.message || lastError).slice(0, 200); await save(st); return st; }
  plan.decisions = (Array.isArray(plan.decisions) ? plan.decisions : []).filter(x => batch.some(f => f.id === x?.file_id));
  const byId = new Map(items.map(i => [i.id, i]));
  const now = new Date().toISOString();
  // What each file IS, kept for the search (added 2026-10-08; never blocks the filing).
  await (d.recordFiles || (await import('./file-index.js')).recordFiles)(batch.map(f => {
    const x = (plan.decisions || []).find(y => y.file_id === f.id) || {};
    return { id: f.id, name: f.name, path: f.path, url: f.webViewLink || null, parent: (f.parents || [])[0] || null, doc_type: x.doc_type, client: x.client, period: x.period, summary: x.summary,
      read_method: methods.get(f.id) || null, confidence: x.confidence || null, reference: x.reference || null, md5: f.md5Checksum || null,
      excerpt: null };
  }), { drive, folder }).catch(() => null);
  const propose = d.proposeMessage || proposeMessage, meta = d.getMeta || getDriveFileMetadata;
  // « Rangement automatique » (owner's explicit stored switch): a SURE decision is carried out
  // at once — recorded as a decision of the
  // Orpailleur (journal, audit, reversible); anything less than sure stays in « À valider ».
  const settings = await (d.agentSettings || (async () => (await import('./agent-persona.js')).agentSettings(orgId)))().catch(() => ({ auto_filing: false }));
  // Sure = the document was READ (Paul: « il doit être sûr s'il lit la feuille »): a name alone,
  // an unreadable file or a doubt stays in « À valider ».
  const readable = id => { const ex = excerpts.get(id) || ''; return ex !== '(illisible)' && ex.trim().length >= 40; };
  const askDeps = { autoSend: Boolean(settings.auto_filing), ...(d.askDeps || {}), leaveInPlace: true };
  const autoFile = async (action, x) => {
    await d.assertReaderLease?.();
    if (!action?.id || settings.auto_filing !== true || st.inspections?.[x.file_id]?.status !== 'READ_SUCCESS' || x.action === 'create_and_move' || x.confidence !== 'haute' || x.content_read !== true || !readable(x.file_id)) return;
    try {
      const r = await (d.recordDecision || (await import('./action-decisions.js')).recordDecision)(orgId,
        { action_id: action.id, decision: 'approve', decided_by: 'Orpailleur (rangement automatique)', note: 'Décision sûre (document lu) : ' + String(x.reason || '').slice(0, 300) });
      if (r?.executed) {
        st.auto = (st.auto || 0) + 1;
        if (['move', 'move_rename'].includes(x.action)) st.applied_moves = (st.applied_moves || 0) + 1;
        if (['rename', 'move_rename'].includes(x.action)) st.applied_renames = (st.applied_renames || 0) + 1;
        if (r.verified) st.verified = (st.verified || 0) + 1;
      }
      const fx = byId.get(x.file_id);
      if (r?.executed && fx) noteFile(st, fx, r.verified ? 'déplacé et vérifié' : 'déplacé', String(r.effect || '').slice(0, 300));
      // The person who helped is thanked only once the result is checked in the Drive.
      const a = (st.asked || {})[x.file_id];
      if (r?.executed && r.verified && a?.status === 'answered') await (d.thankAfterVerified || thankAfterVerified)(orgId, a, r.effect, askDeps).catch(() => null);
    } catch { /* stays in « À valider » */ }
  };
  st.seen = st.seen || {};
  // A scan not yet looked at (vision budget spent) is NOT « seen »: it comes back at the next pass.
  st.pending_read = st.pending_read || {};
  for (const f of batch) {
    if (String(methods.get(f.id) || '').startsWith('scan —') || st.inspections?.[f.id]?.status === 'ERROR_RETRYABLE' || st.inspections?.[f.id]?.quality?.pending_ocr_pages?.length || st.inspection_queue?.[f.id]?.retry_at) { st.pending_read[f.id] = { name: f.name, path: f.path, parents: f.parents || [], mimeType: f.mimeType || null, webViewLink: f.webViewLink || null, at: now }; continue; }
    delete st.pending_read[f.id];
    st.seen[f.id] = f.modifiedTime || now;
  }
  for (const x of plan.decisions || []) {
    await d.assertReaderLease?.();
    const f = byId.get(x.file_id); if (!f) continue;
    if (x.action === 'ok') { st.ok++; if (st.states?.[f.id]?.state !== 'illisible') noteFile(st, f, 'en place', x.pbc_role ? 'rôle PBC : ' + x.pbc_role + (x.pbc_ref ? ' (' + x.pbc_ref + ')' : '') : ''); continue; }
    if (x.action === 'ask') {
      // Only what is missing, to the right person (mission manager, else who saved it, else the
      // referent); the file waits in 00_A_REVOIR_AGENT; never the same question twice.
      try {
        let by = f.by;
        if (!by) { const m = await meta(f.id).catch(() => null); by = String(m?.lastModifyingUser?.emailAddress || m?.owners?.[0]?.emailAddress || '').toLowerCase() || null; }
        const r = await (d.askMissing || askMissing)(orgId, { ...f, by }, x, st, { ...askDeps, proposeMessage: d.proposeMessage || askDeps.proposeMessage, fetchRows: d.fetchRows || askDeps.fetchRows });
        if (!r?.skipped) { st.questions++; noteFile(st, f, r.sent ? 'en REVIEW — question envoyée' : 'en REVIEW — question en attente d’envoi', 'à ' + (r.to || 'personne trouvée') + ' : ' + (r.missing || '')); }
      } catch { /* stays for the owner */ }
      continue;
    }
    // The mission's folder does not exist yet: created on approval, following the firm's structure.
    if (x.action === 'create_and_move') {
      const parent = byId.get(x.create_parent_id);
      const names = (Array.isArray(x.create_names) ? x.create_names : []).map(n => String(n || '').replace(/[\\/]/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 4);
      if (parent && parent.mimeType === FOLDER && names.length) {
        const newName = x.new_name && x.new_name !== f.name ? String(x.new_name).slice(0, 250) : null;
        const target = parent.path + '/' + names.join('/');
        // IDEMPOTENCE (architecture, phase 5): never a second structure for the same TDR / mission.
        const dup = possibleDuplicate(f, x, names, items, st, parent.path);
        if (dup) {
          st.duplicates = st.duplicates || {};
          st.duplicates[f.id] = { at: now, file: f.name, path: f.path, wanted: target, ...dup };
          await (d.emit || emit)(orgId, { type: 'POSSIBLE_DUPLICATE', agent: 'orpailleur', object_type: 'drive_file', object_id: f.id, source: 'drive:' + f.id, idempotency_key: 'POSSIBLE_DUPLICATE:' + f.id + ':' + dup.kind,
            payload: { name: f.name, why: dup.why, existing_path: dup.existing_path || null, wanted: target } }, { fetchRows }).catch(() => null);
          noteFile(st, f, 'doublon possible — revue requise', dup.why);
          // An existing structure was found: filing there is PROPOSED (never automatic), nothing is created.
          if (dup.existing_folder_id && !(f.parents || []).includes(dup.existing_folder_id)) {
            await fetchRows('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
              body: JSON.stringify([{ org_id: orgId, agent_key: 'orpailleur', action_type: 'FILE_MOVE', status: 'proposed', work_state: 'requested', requested_at: now,
                idempotency_key: 'file-move:' + f.id + ':' + dup.existing_folder_id + ':' + (newName || ''),
                summary: ('POSSIBLE DUPLICATE — REVIEW REQUIRED : « ' + f.name + ' » — ' + dup.why + ' Proposition : le ranger dans « ' + dup.existing_path + ' » au lieu de créer « ' + target + ' ».').slice(0, 500),
                payload: { file_id: f.id, file_name: f.name, from_parent: (f.parents || [])[0] || null, to_parent: dup.existing_folder_id, to_name: dup.existing_path, new_name: newName, web_url: f.webViewLink || null },
                evidence: { reason: String(x.reason || '').slice(0, 300), source, confidence: x.confidence || null, duplicate: dup } }]) }).catch(() => null);
            st.moves++;
          }
          continue;
        }
        if (x.reference) { st.references = st.references || {}; st.references[normRef(x.reference)] = { file_id: f.id, file: f.name, target, client: x.client || null, period: x.period || null, at: now }; }
        const summary = 'Créer « ' + target + ' » et y ranger « ' + f.name + ' »' + (newName ? ' sous le nom « ' + newName + ' »' : '') + ' — ' + String(x.reason || '').slice(0, 200);
        const queued = await fetchRows('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
          body: JSON.stringify([{ org_id: orgId, agent_key: 'orpailleur', action_type: 'FILE_MOVE', status: 'proposed', work_state: 'requested', requested_at: now,
            idempotency_key: 'file-move:' + f.id + ':new:' + target.slice(-80) + ':' + (newName || ''), summary: summary.slice(0, 500),
            payload: { file_id: f.id, file_name: f.name, from_parent: (f.parents || [])[0] || null, to_parent: null, to_name: target, new_name: newName, web_url: f.webViewLink || null, classification: classOf(x, methods.get(f.id)),
              create: { parent_id: parent.id, names, ...((m => m ? { model_subfolders: m.subfolders, model: m.path } : {})(structure.models.find(m => m.parent === parent.id) || structure.models.find(m => byId.get(m.parent)?.parents?.[0] === (parent.parents || [])[0]) || null)) } },
            evidence: { reason: String(x.reason || '').slice(0, 500), source, confidence: x.confidence || null } }]) }).catch(() => null);
        st.moves++; st.created = (st.created || 0) + 1; if (newName) st.renames++;
        noteFile(st, f, 'proposé (À valider)', summary); noteMisplaced(st, x, f);
        await autoFile(queued?.[0], x);
      }
      continue;
    }
    const dest = x.to_folder_id && byId.get(x.to_folder_id);
    const move = (x.action === 'move' || x.action === 'move_rename') && dest && dest.mimeType === FOLDER && !(f.parents || []).includes(dest.id);
    const newName = (x.action === 'rename' || x.action === 'move_rename') && x.new_name && x.new_name !== f.name ? String(x.new_name).slice(0, 250) : null;
    if (!move && !newName) continue;
    const summary = (move ? 'Ranger « ' + f.name + ' » dans « ' + dest.path + ' »' : 'Renommer « ' + f.name + ' »') + (newName ? (move ? ' et le renommer « ' : ' en « ') + newName + ' »' : '') + ' — ' + String(x.reason || '').slice(0, 200);
    const queued = await fetchRows('office_action_queue?on_conflict=org_id,idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify([{ org_id: orgId, agent_key: 'orpailleur', action_type: 'FILE_MOVE', status: 'proposed', work_state: 'requested', requested_at: now,
        idempotency_key: 'file-move:' + f.id + ':' + (move ? dest.id : '') + ':' + (newName || ''), summary: summary.slice(0, 500),
        payload: { file_id: f.id, file_name: f.name, from_parent: (f.parents || [])[0] || null, to_parent: move ? dest.id : null, to_name: move ? dest.path : null, new_name: newName, web_url: f.webViewLink || null, classification: classOf(x, methods.get(f.id)) },
        evidence: { reason: String(x.reason || '').slice(0, 500), source, confidence: x.confidence || null } }]) }).catch(() => null);
    if (move) { st.moves++; noteMisplaced(st, x, f); } if (newName) st.renames++;
    noteFile(st, f, 'proposé (À valider)', summary);
    await autoFile(queued?.[0], x);
  }
  st.done += batch.length; st.total = all.length; st.updated_at = new Date().toISOString();
  if (st.done >= all.length) finish();
  await save(st);
  // Several batches in one invocation while time remains (the chain of calls is only the fallback).
  if (st.status === 'planning' && Date.now() - (d._t0 || __t0) < (d.budgetMs ?? 150000) && !d.noLoop) return tidyPlanStepLocked(orgId, req, { ...d, _t0: d._t0 || __t0 });
  if (st.status === 'planning') await (d.fire || fireInternal)(req, '/api/app?route=tidy-plan-step', {});
  return st;
}

// The owner answers the Orpailleur's questions; the answers are kept in its Drive memory and
// used by the next reading and tidy-up.
export async function answerQuestion(body = {}, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const { fileId, state } = await loadJsonFile(KNOWLEDGE, drive, folder);
  if (!state) throw Object.assign(new Error('NOTHING_TO_ANSWER'), { statusCode: 409 });
  const question = String(body.question || '').slice(0, 500), answer = String(body.answer || '').trim().slice(0, 2000);
  if (!answer) throw Object.assign(new Error('ANSWER_REQUIRED'), { statusCode: 400 });
  state.answers = [...(state.answers || []).filter(a => a.question !== question), { question, answer, by: String(body.by || '').slice(0, 120) || null, at: new Date().toISOString() }];
  await saveJsonFile(KNOWLEDGE, drive, folder, fileId, state);
  return { saved: true, answers: state.answers };
}
