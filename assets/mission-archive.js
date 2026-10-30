// « Archivage » card of a mission (2026-10-30, spec §38-42): the closing controls, the request (manager / partner), the
// manifest produced by the Orpailleur, the partner's validation. Everything is decided on the server (lib/mission-archive.js).
(function () {
  var OM = window.OfficeManager;
  var host = document.getElementById('sec-archive');
  var missionId = new URLSearchParams(location.search).get('id');
  if (!OM || !host || !missionId) return;
  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
  var ERR = {
    MANAGER_OR_PARTNER_ONLY: 'Seuls un manager ou un associé demandent l’archivage.', PARTNER_ONLY: 'Seul un associé valide l’archivage.',
    ARCHIVE_CHECKS_NOT_MET: 'Des contrôles de clôture ne sont pas remplis : un associé peut passer outre en donnant une raison pour chacun.',
    PARTNER_REQUIRED_TO_PASS_A_CONTROL: 'Seul un associé peut passer outre un contrôle de clôture.', REASON_TOO_SHORT: 'Expliquez la raison en quelques mots (10 caractères au moins).',
    ARCHIVE_CHECK_BLOCKING: 'Le dossier Drive de la mission n’est pas connu : reliez-le d’abord (carte « À compléter plus tard »).',
    MANIFEST_CHANGED_RELOAD: 'Le manifeste a changé depuis votre lecture : rechargez la page.', MANIFEST_NOT_READY: 'Le manifeste n’est pas encore prêt.',
    MISSION_QUICK_SQL_NOT_INSTALLED: 'La base n’a pas encore la colonne des points ouverts (db/mission-quick.sql) : voir docs/A_FAIRE_DE_VOTRE_COTE.txt.'
  };
  var STATUS = { none: 'Pas demandé', ready: 'Demandé — l’Orpailleur prépare le manifeste au prochain passage', manifest_ready: 'Manifeste prêt — à valider par un associé', archived: 'Archivée — lecture seule' };
  var say = el('p', null, 'note'); say.setAttribute('role', 'status'); say.setAttribute('aria-live', 'polite');
  var body = el('div', null, 'stack');
  host.appendChild(body); host.appendChild(say);
  function msg(e) { return ERR[e.code || e.message] || ('Impossible : ' + (e.message || e)); }
  function post(payload) {
    say.textContent = 'En cours…';
    return OM.api('/api/app?route=mission-archive', { method: 'POST', body: JSON.stringify(Object.assign({ mission_id: missionId }, payload)) })
      .then(function () { say.textContent = 'Enregistré.'; load(); }).catch(function (e) { say.textContent = msg(e); });
  }
  function draw(v) {
    body.textContent = '';
    host.hidden = false;
    var a = v.archive || { status: 'none' };
    body.appendChild(el('p', 'État : ' + (STATUS[a.status] || a.status), 'meta'));
    if (a.status === 'archived') {
      body.appendChild(el('p', 'Archivée le ' + String(a.archived_at || '').slice(0, 10) + ' par ' + (a.archived_by || '—') + '. Toute modification demande un associé et une raison (tracée).', 'note'));
      if ((a.changes || []).length) body.appendChild(el('p', (a.changes || []).length + ' changement(s) constaté(s) dans le dossier depuis l’archivage : voir le journal d’audit.', 'note'));
    }
    if (a.manifest && a.manifest.file_id) {
      var p = el('p', null, 'meta'), link = el('a', a.manifest.name || 'Manifeste');
      link.href = a.manifest.url || ('https://drive.google.com/file/d/' + encodeURIComponent(a.manifest.file_id) + '/view'); link.target = '_blank'; link.rel = 'noopener';
      p.appendChild(document.createTextNode('Manifeste : ')); p.appendChild(link);
      p.appendChild(document.createTextNode(' — ' + (a.manifest.files || 0) + ' fichier(s) ; à regarder : ' + (a.manifest.temporary || 0) + ' temporaire(s), ' + (a.manifest.to_file || 0) + ' encore à ranger, ' + (a.manifest.unclassified || 0) + ' non classé(s)' + (a.manifest.truncated ? ' ; liste incomplète' : '')));
      body.appendChild(p);
    }
    if (a.status === 'none') {
      var list = el('ul');
      var reasons = {};
      (v.checks || []).forEach(function (c) {
        var li = el('li', (c.ok ? '✓ ' : '✗ ') + c.label + (c.detail ? ' — ' + c.detail : ''));
        if (!c.ok && c.overridable) {
          var input = el('input'); input.type = 'text'; input.placeholder = 'Raison pour passer outre (associé)'; input.setAttribute('aria-label', 'Raison pour passer outre : ' + c.label);
          input.addEventListener('input', function () { reasons[c.key] = input.value; });
          li.appendChild(document.createElement('br')); li.appendChild(input);
        }
        list.appendChild(li);
      });
      body.appendChild(list);
      var go = el('button', 'Demander l’archivage', 'btn'); go.type = 'button';
      go.addEventListener('click', function () { post({ action: 'request', overrides: reasons }); });
      body.appendChild(go);
    }
    if (a.status === 'manifest_ready') {
      var ok = el('button', 'J’ai relu le manifeste : archiver (lecture seule)', 'btn'); ok.type = 'button';
      ok.addEventListener('click', function () { post({ action: 'freeze', manifest_file_id: a.manifest.file_id }); });
      body.appendChild(ok);
    }
  }
  function load() {
    OM.api('/api/app?route=mission-archive&mission_id=' + encodeURIComponent(missionId)).then(draw).catch(function (e) { host.hidden = false; say.textContent = msg(e); });
  }
  load();
})();
