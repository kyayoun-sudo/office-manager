(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); }, running = {}, busy = false;
  var labels = { cataloguing: 'Inventaire', reading: 'Lecture par l’IA', review: 'À revoir par vous', validated: 'Mémoire validée' };
  function node(tag, value) { var n = document.createElement(tag); if (value) n.textContent = value; return n; }
  function api(body) { return OM.api('/api/app?route=completed-mission-learning', body ? { method: 'POST', body: JSON.stringify(body) } : undefined); }
  function say(value) { $('message').textContent = value; }
  function button(parent, label, action) { var b = node('button', label); b.className = 'btn ghost'; b.type = 'button'; b.addEventListener('click', function () { if (busy) return; busy = true; b.disabled = true; Promise.resolve().then(action).catch(function (e) { say(e.message); }).finally(function () { busy = false; b.disabled = false; }); }); parent.appendChild(b); return b; }
  function act(s, action, extra) { return api(Object.assign({ id: s.id, seq: s.seq, action: action }, extra || {})).then(function () { return load(); }); }
  function tick(s, remaining) {
    if (!running[s.id] || remaining <= 0) { delete running[s.id]; say('Lecture mise en pause. Cliquez sur Continuer pour reprendre.'); return load(); }
    return api({ action: 'step', id: s.id, seq: s.seq }).then(function (next) {
      say(next.name + ' : ' + next.read + ' / ' + next.documents + ' pièces avec des passages lus ; ' + next.folders_left + ' dossiers à parcourir.');
      if (['cataloguing', 'reading'].includes(next.status)) return tick(next, remaining - 1);
      delete running[s.id]; return load();
    }).catch(function (e) { delete running[s.id]; say(e.message); return load(); });
  }
  function draw(s) {
    var card = node('article'); card.className = 'sample'; card.appendChild(node('h3', s.name));
    card.appendChild(node('p', labels[s.status] + ' · ' + s.read + ' / ' + s.documents + ' pièces avec des passages lus.'));
    (s.errors || []).forEach(function (e) { card.appendChild(node('p', 'Lecture à reprendre : ' + e.file_id + ' — ' + e.error)); });
    if (['cataloguing', 'reading'].includes(s.status)) {
      button(card, 'Lire / continuer', function () { running[s.id] = true; return tick(s, 20); });
      button(card, 'Recommencer après correction des sources', function () { return act(s, 'restart'); });
    }
    if (s.result) {
      card.appendChild(node('p', s.result.summary)); card.appendChild(node('p', s.result.coverage));
      (s.result.questions || []).forEach(function (q) { card.appendChild(node('p', 'À confirmer : ' + q)); });
      (s.result.lessons || []).forEach(function (l) {
        var detail = node('details'); detail.appendChild(node('summary', l.agent + ' : ' + l.rule));
        l.evidence.forEach(function (e) { detail.appendChild(node('p', e.file_id + ' · ' + JSON.stringify(e.request) + ' · « ' + e.quote + ' »')); }); card.appendChild(detail);
      });
    }
    if (s.status === 'review') {
      var label = node('label'), cabinet = node('input'); cabinet.type = 'checkbox'; label.appendChild(cabinet); label.appendChild(document.createTextNode(' J’ai vérifié que ces méthodes peuvent être réutilisées dans les autres missions du cabinet. Sinon, elles restent limitées à cette mission.')); card.appendChild(label);
      button(card, 'Valider la compréhension et les leçons affichées', function () { return act(s, 'validate', { confirm: true, cabinet_method: cabinet.checked }); });
      button(card, 'Recommencer l’étude', function () { return act(s, 'restart'); });
    }
    if (s.status === 'validated') {
      card.appendChild(node('p', 'Compréhension enregistrée dans la mémoire de mission ; leçons disponibles aux agents dans le périmètre validé.'));
      var details = node('details'); details.appendChild(node('summary', 'Proposer une méthode générique à EYNOWA Lab'));
      var area = node('textarea'); area.value = s.share ? s.share.text : ''; area.maxLength = 6000; area.setAttribute('aria-label', 'Méthode générique destinée à EYNOWA Lab'); details.appendChild(area);
      var attest = node('label'), consent = node('input'); consent.type = 'checkbox'; attest.appendChild(consent); attest.appendChild(document.createTextNode(' J’ai relu ce texte et confirme qu’il ne contient aucune donnée confidentielle ou identifiante du cabinet ou de ses clients.')); details.appendChild(attest);
      button(details, 'Préparer ce texte pour le centre', function () { if (!consent.checked) throw Error('Confirmez la revue du texte générique.'); return act(s, 'prepare-share', { text: area.value, non_confidential: true }); });
      if (s.share) {
        details.open = true; details.appendChild(node('pre', s.share.text));
        details.appendChild(node('p', s.share.status === 'sent' ? 'Réception confirmée par EYNOWA Lab — candidat en attente de revue centrale.' : 'État du partage : ' + s.share.status + (s.share.error ? ' — ' + s.share.error : '')));
        if (s.share.status !== 'sent') button(details, 'Transmettre le texte préparé ci-dessus', function () { return act(s, 'send-share', { confirm: true }); });
      }
      card.appendChild(details);
    }
    return card;
  }
  function load() { return api().then(function (r) {
    $('progress').textContent = r.validated + ' / ' + r.target + ' missions étudiées et validées.';
    $('lab-state').textContent = r.lab_connected ? 'Connexion directe au Lab configurée. Chaque transmission attend votre revue.' : 'La connexion de mémoire au Lab reste à configurer. L’apprentissage local reste disponible ; aucune réception centrale n’est annoncée avant confirmation.';
    $('samples').textContent = ''; r.samples.forEach(function (s) { $('samples').appendChild(draw(s)); });
  }); }
  $('add-form').addEventListener('submit', function (e) {
    e.preventDefault(); if (busy) return; busy = true;
    var folder = $('sample-folder').value.trim(), match = folder.match(/\/folders\/([\w-]+)/); if (match) folder = match[1];
    api({ action: 'add', name: $('sample-name').value, folder_id: folder, completed: $('sample-completed').checked }).then(function () { $('add-form').reset(); return load(); }).catch(function (e) { say(e.message); }).finally(function () { busy = false; });
  });
  UI.requireLogin(function () { if (!OM.isOwner()) { $('add-form').hidden = true; say('Le propriétaire ou un associé du cabinet présente et valide les missions d’apprentissage.'); return; } load().catch(function (e) { say(e.message); }); });
})();
