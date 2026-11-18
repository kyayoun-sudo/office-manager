(function () {
  var OM = window.OfficeManager, $ = function (id) { return document.getElementById(id); };
  if (!OM || !$('training-simulation')) return;
  var ERR = { CABINETS_NOT_ENABLED: 'Le mode plusieurs cabinets n’est pas encore activé sur ce serveur.', NOT_IN_PARENT: 'Vous n’êtes pas membre de ce cabinet.',
    PARENT_IS_SIMULATION: 'Quittez la simulation avant d’en créer une autre.', TRAINING_PARENT_REQUIRED: 'Le dossier « Entraînements » du Drive n’est pas connu : connectez le Drive du cabinet.',
    EMAIL_NOT_VERIFIED: 'Confirmez votre adresse e-mail.', SIMULATION_NAME_REQUIRED: 'Donnez un nom à la simulation.' };
  var msg = function (e) { var m = (e && (e.code || e.message)) || String(e); return ERR[m] || m; };
  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }

  // The Entraînement tabs script is limited to owners / partners / IT; everyone else (juniors are the target) gets this panel here.
  var button = document.querySelector('[data-training-view="simulation"]');
  if (button && ['owner', 'partner', 'it_admin'].indexOf(OM.getRole()) < 0) {
    button.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.training-panel'), function (p) { p.hidden = p.id !== 'training-simulation'; });
      button.setAttribute('aria-pressed', 'true');
    });
  }

  function paint(list) {
    var box = $('simulation-list'); box.textContent = '';
    if (!list.length) { box.appendChild(el('p', 'Aucune simulation pour l’instant.', 'small')); return; }
    list.forEach(function (s) {
      var row = el('div', null, 'item');
      var t = el('div', null, 't'); t.appendChild(el('span', s.name)); t.appendChild(el('span', s.archived ? ' — archivée' : ' — rôle : ' + s.role, 'small')); row.appendChild(t);
      if (!s.archived) {
        var go = el('button', 'Entrer dans la simulation', 'btn'); go.type = 'button';
        go.addEventListener('click', function () { OM.switchCabinet(s.org_id, '/accueil.html'); });
        row.appendChild(go);
      }
      box.appendChild(row);
    });
  }
  function load() { OM.api('/api/app?route=simulation').then(function (d) { paint(d.simulations || []); }).catch(function (e) { $('simulation-say').textContent = msg(e); }); }

  $('simulation-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var b = $('simulation-create'), say = $('simulation-say'); b.disabled = true; say.textContent = 'Création en cours…';
    OM.api('/api/app?route=simulation', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', name: $('simulation-name').value, source: { client: $('simulation-client').value, period: $('simulation-period').value } }) })
      .then(function (r) { say.textContent = r.created === false ? 'Cette simulation existe déjà.' : 'Simulation créée.'; load(); })
      .catch(function (e) { say.textContent = msg(e); })
      .then(function () { b.disabled = false; });
  });
  window.OMSimulation = { init: load };
  load();
})();
