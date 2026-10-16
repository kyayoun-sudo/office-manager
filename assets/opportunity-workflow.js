(function () {
  'use strict';
  function node(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
  function link(text, href) { var a = node('a', text, 'btn ghost'); a.href = href; return a; }
  function post(o, action, extra, button, status) {
    button.disabled = true; status.textContent = 'En cours…';
    return window.OfficeManager.api('/api/app?route=opportunities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ action: action, opportunity_id: o.id }, extra || {})) })
      .then(function (result) {
        if (action === 'prepare-quotation') {
          status.textContent = quotationMessage(result || {});
          if (result && result.file && result.file.id) status.appendChild(link('Ouvrir le budget', result.file.url || 'https://drive.google.com/file/d/' + encodeURIComponent(result.file.id) + '/view'));
        } else status.textContent = 'Enregistré.';
        if (window.reloadOpportunity) window.reloadOpportunity();
      })
      .catch(function (e) { var messages = { RESULT_DOCUMENT_REQUIRED: 'Indiquez le lien Drive du document reçu.', COMMERCIAL_TRANSITION_INVALID: 'Cette étape a changé. Actualisez le dossier.', QUOTATION_XLSX_REQUIRED: 'Confirmez le modèle Excel (.xlsx) de cotation.', QUOTATION_PREPARING: 'La cotation est déjà en préparation.', AGENTS_NOT_AUTHORIZED: 'Le cabinet doit autoriser les agents dans les paramètres.', DOCUMENT_ALREADY_LINKED: 'Ce document appartient déjà à une autre opportunité.' }; status.textContent = messages[e.code || e.message] || e.message; })
      .then(function () { button.disabled = false; });
  }
  function quotationMessage(q) {
    var started = Date.parse((q.status === 'queued' ? q.requested_at : q.started_at) || '');
    if (['preparing', 'queued'].indexOf(q.status) >= 0 && Number.isFinite(started) && Date.now() - started >= 300000) return 'La préparation n’a pas abouti dans le délai attendu. Aucun remplissage réussi n’est confirmé. Vous pouvez relancer ; le fichier existant sera réutilisé.';
    if (q.error) return 'Préparation interrompue : ' + ({ NO_AI_PROVIDER_CONFIGURED: 'aucun fournisseur IA disponible ; vérifiez les paramètres du cabinet', TARGET_FOLDER_NOT_KNOWN: 'le dossier Drive de l’opportunité n’est pas identifié', QUOTATION_COPY_NOT_VERIFIED: 'l’emplacement de la copie du modèle n’a pas pu être vérifié', AGENTS_NOT_AUTHORIZED: 'les agents ne sont pas autorisés par le cabinet' }[q.error] || q.error) + '. Le fichier éventuellement créé reste accessible ci-dessous.';
    if (q.status === 'prepared' && typeof q.written !== 'number') return 'Le budget est signalé préparé. Ouvrez-le pour vérifier les noms, jours et tarifs.';
    if (q.status === 'prepared') return 'Budget préparé : ' + q.written + ' cellule(s) écrite(s), ' + q.verified + ' vérifiée(s) par relecture. Vérifiez les noms, jours et tarifs avant validation.';
    if (q.status === 'unverified') return 'Des écritures ont été tentées, mais leur vérification est incomplète. Ouvrez le budget avant de continuer.';
    if (q.question) return q.question;
    if (q.status === 'queued' && !Number.isFinite(started)) return 'Une demande de préparation existe, sans heure de démarrage confirmée. Vous pouvez relancer la préparation.';
    if (q.status === 'queued') return 'Demande enregistrée. Mission Controller doit encore démarrer le remplissage du budget.';
    if (q.status === 'preparing') return 'Mission Controller prépare le budget. Le résultat apparaîtra ici après vérification.';
    return 'Aucun budget préparé n’est confirmé pour ce dossier. Le bouton ci-dessous prépare une copie du modèle dans le dossier de l’opportunité.';
  }
  function button(text, fn) { var b = node('button', text, 'btn ghost'); b.type = 'button'; b.addEventListener('click', function () { fn(b); }); return b; }
  function documentId(value) { var v = String(value || '').trim(), m = v.match(/\/(?:d|folders)\/([-\w]+)|[?&]id=([-\w]+)/); return m ? m[1] || m[2] : /^[-\w]{25,}$/.test(v) ? v : ''; }
  function render(o) {
    var anchor = document.getElementById('mine-card'), c = o.commercial;
    if (!anchor || !c) return;
    var box = document.getElementById('workflow-overview');
    if (box && box.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (!box) { box = node('section', null, 'card'); box.id = 'workflow-overview'; anchor.parentNode.insertBefore(box, anchor); }
    box.textContent = ''; box.appendChild(node('h2', c.label));
    var nav = node('nav', null, 'btn-row'); nav.setAttribute('aria-label', 'Rubriques du dossier');
    [['Vue d’ensemble', '#workflow-overview'], ['Équipe', '#team-card'], ['Acceptation / KYC', '#kyc-card'], ['Offre et documents', '#continuity-card'], ['Historique', '#opp-log']].forEach(function (x) { var a = link(x[0], x[1]); if (x[1] === '#opp-log') a.addEventListener('click', function () { var log = document.getElementById('opp-log'); if (log && log.closest('details')) log.closest('details').open = true; }); nav.appendChild(a); }); box.appendChild(nav);
    box.appendChild(node('p', 'Équipe, KYC et préparation commerciale avancent en parallèle. Les décisions d’acceptation et de démarrage restent distinctes.', 'meta'));
    var list = node('ul');
    (o.parallel_tasks || []).forEach(function (t) { var li = node('li'); li.appendChild(link(t.label, t.href || t.anchor)); li.appendChild(node('span', ' — ' + t.state)); list.appendChild(li); }); box.appendChild(list);
    var summary = o.kyc_summary || {};
    var kyc = node('details'); kyc.appendChild(node('summary', (summary.prepared || 0) + ' informations préparées · ' + (summary.remaining || []).length + ' confirmations demandées · ' + (summary.risks || 0) + ' propositions de risque'));
    (summary.remaining || []).forEach(function (r) { kyc.appendChild(node('p', r.question)); });
    kyc.appendChild(link('Examiner et corriger le classeur', '#all-sheets')); box.appendChild(kyc);
    var status = node('p', '', 'status'); status.setAttribute('role', 'status');
    if (c.analysis) {
      box.appendChild(node('p', c.analysis.status === 'ready' ? 'Demande de proposition analysée : ' + c.analysis.summary : c.analysis.status === 'failed' ? 'Analyse du nouveau document à reprendre : ' + (c.analysis.error || '') : 'Analyse de la demande de proposition en cours…'));
      if (c.analysis.team_review_required) box.appendChild(node('p', 'Vérifiez l’adéquation de l’équipe validée aux nouvelles exigences. Les affectations ont été conservées.', 'meta'));
      if (c.analysis.proposed_deadline && o.viewer && o.viewer.may_manage) box.appendChild(button('Confirmer l’échéance proposée : ' + c.analysis.proposed_deadline, function (b) { post(o, 'commercial', { milestone: 'confirm-deadline', deadline: c.analysis.proposed_deadline }, b, status); }));
    }
    if (o.viewer && o.viewer.may_manage) {
      if (!o.phase1) box.appendChild(button('Préparer le KYC en parallèle', function (b) { post(o, 'parallel-kyc', {}, b, status); }));
      if (c.stage === 'identify') {
        box.appendChild(node('p', 'Les TDR seuls ne précisent pas toujours la réponse attendue. Confirmez le parcours :'));
        [['ami', 'Répondre à un AMI'], ['proposal', 'Déposer directement une offre']].forEach(function (x) { box.appendChild(button(x[1], function (b) { post(o, 'commercial', { milestone: 'classify', entry_kind: x[0] }, b, status); })); });
      }
      if (['mi_waiting', 'shortlisted', 'proposal_waiting'].indexOf(c.stage) >= 0) {
        var label = node('label', 'Document reçu (lien Drive)'); label.htmlFor = 'commercial-proof'; box.appendChild(label);
        var proof = node('input'); proof.type = 'url'; proof.id = 'commercial-proof'; proof.placeholder = 'https://drive.google.com/file/d/…'; box.appendChild(proof);
        var actions = c.stage === 'mi_waiting' ? [['shortlisted', 'Enregistrer la présélection'], ['proposal_received', 'Rattacher la demande de proposition et les TDR'], ['lost', 'Enregistrer la non-sélection']] : c.stage === 'shortlisted' ? [['proposal_received', 'Rattacher la demande de proposition et les TDR'], ['lost', 'Enregistrer la non-sélection']] : [['lost', 'Enregistrer le refus']];
        actions.forEach(function (x) { box.appendChild(button(x[1], function (b) { var id = documentId(proof.value); if (!id) { status.textContent = 'Indiquez le lien du document reçu.'; proof.focus(); return; } post(o, 'commercial', { milestone: x[0], file_id: id }, b, status); })); });
      }
    }
    if (c.document_kind) box.appendChild(link(c.label, c.href));
    if (c.stage === 'awarded') {
      box.appendChild(node('p', o.agreement && o.agreement.status === 'verified' ? 'Accord écrit vérifié par ' + o.agreement.by + ' — version ' + o.agreement.version : 'Avant le démarrage : accord écrit du client à recevoir et vérifier. L’attribution et l’envoi de la lettre ne suffisent pas.'));
      if (o.agreement && o.agreement.url) box.appendChild(link('Consulter l’accord reçu', o.agreement.url));
      if (o.viewer && ['owner', 'partner'].indexOf(o.viewer.role) >= 0 && o.viewer.may_manage) {
        var agreement = {};
        [['file_id', 'Lien Drive de l’accord reçu'], ['signatory', 'Signataire habilité du client'], ['version', 'Version des termes acceptés']].forEach(function (f) {
          var l = node('label', f[1]), input = node('input'); input.type = 'text'; input.id = 'agreement-' + f[0]; l.htmlFor = input.id; agreement[f[0]] = input; box.appendChild(l); box.appendChild(input);
        });
        var checkLabel = node('label'), check = node('input'); check.type = 'checkbox'; checkLabel.appendChild(check); checkLabel.appendChild(document.createTextNode('J’ai vérifié l’accord écrit du client, la bonne version et l’habilitation du signataire.')); box.appendChild(checkLabel);
        box.appendChild(button('Enregistrer ma vérification de l’accord', function (b) { post(o, 'confirm-agreement', { file_id: documentId(agreement.file_id.value), signatory: agreement.signatory.value, version: agreement.version.value, confirm: check.checked }, b, status); }));
      }
    }
    if (c.stage === 'proposal_prepare' || c.stage === 'proposal_waiting') box.appendChild(link('Enregistrer l’attribution reçue', '#won-card'));
    box.appendChild(status);
    var quote = document.getElementById('quotation-card');
    if (!quote) { quote = node('section', null, 'card'); quote.id = 'quotation-card'; box.parentNode.insertBefore(quote, box.nextSibling); }
    quote.textContent = ''; quote.appendChild(node('h2', 'Budget — Mission Controller'));
    quote.appendChild(node('p', 'Préparation automatique dès la validation de l’équipe, avant le KYC et les déclarations d’indépendance. Le modèle est recherché dans le dossier Budget du cabinet.', 'meta'));
    quote.appendChild(node('p', 'Le classeur du cabinet est copié une seule fois pour ce dossier. Ses tarifs et formules restent en place ; les données connues sont préparées, les jours et montants non établis restent à compléter.', 'meta'));
    var q = o.quotation || {}, qs = node('p', quotationMessage(q), 'status'); qs.setAttribute('role', 'status');
    if (q.file && q.file.id) quote.appendChild(link('Ouvrir le budget', q.file.url || 'https://drive.google.com/file/d/' + encodeURIComponent(q.file.id) + '/view'));
    if (o.folder && o.folder.id) quote.appendChild(link('Ouvrir le dossier de l’opportunité', o.folder.url || 'https://drive.google.com/drive/folders/' + encodeURIComponent(o.folder.id)));
    if (q.configuration_href) quote.appendChild(link('Indiquer le modèle budget', q.configuration_href));
    (q.questions || []).forEach(function (s) { quote.appendChild(node('p', s)); });
    if (o.viewer && o.viewer.may_manage) { var b = button(q.file ? 'Compléter les entrées encore vides' : 'Préparer le budget', function (b) { post(o, 'prepare-quotation', {}, b, qs); }); b.disabled = ['preparing', 'queued'].indexOf(q.status) >= 0 && (Number.isFinite(Date.parse((q.status === 'queued' ? q.requested_at : q.started_at) || '')) && Date.now() - Date.parse(q.status === 'queued' ? q.requested_at : q.started_at) < 300000); quote.appendChild(b); }
    quote.appendChild(qs);
    var workspace = document.getElementById('mission-workspace-card');
    if (!workspace) { workspace = node('section', null, 'card'); workspace.id = 'mission-workspace-card'; quote.parentNode.insertBefore(workspace, quote.nextSibling); }
    workspace.textContent = ''; workspace.appendChild(node('h2', 'Dossier et fichiers de travail — Mission Controller'));
    workspace.appendChild(node('p', 'Après l’autorisation de démarrage et le transfert des documents : modèle adapté à la mission → structure du dossier → fichiers de travail applicables → préremplissage des informations connues.', 'meta'));
    var w = o.workspace || {}, labels = { queued: 'Préparation en attente.', preparing: 'Mission Controller inspecte le modèle et prépare les fichiers.', reported: 'Compte rendu disponible — vérifiez les fichiers préparés et les points restant à traiter.' };
    workspace.appendChild(node('p', w.error || labels[w.status] || 'La préparation commencera après la création autorisée du dossier de mission.', 'status'));
    if (w.summary) { var report = node('details'); report.appendChild(node('summary', 'Voir le travail réalisé et les prochaines actions')); var content = node('p', w.summary); content.style.whiteSpace = 'pre-wrap'; report.appendChild(content); workspace.appendChild(report); }
    if (o.handoff && o.handoff.url) workspace.appendChild(link('Ouvrir le dossier de mission', o.handoff.url));
    if (o.viewer && o.viewer.may_manage && o.mission_id && o.handoff && o.handoff.status === 'complete') {
      var status = node('p', '', 'status'); var prepare = button(w.status ? 'Reprendre la préparation des fichiers' : 'Préparer les fichiers de travail', function (b) { post(o, 'prepare-mission-files', {}, b, status); });
      prepare.disabled = ['queued', 'preparing'].indexOf(w.status) >= 0 && Date.now() - Date.parse(w.started_at || w.requested_at) < 600000; workspace.appendChild(prepare); workspace.appendChild(status);
    }
  }
  window.OMWorkflow = { render: render };
})();
