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
      if (!s.archived && s.role === 'owner') {
        var team = el('button', 'Collaborateurs', 'btn ghost'); team.type = 'button';
        var panel = el('div', null, 'card'); panel.hidden = true;
        team.addEventListener('click', function () { panel.hidden = !panel.hidden; if (!panel.hidden) members(s.org_id, panel); });
        row.appendChild(team); row.appendChild(panel);
      }
      box.appendChild(row);
    });
  }

  var ROLE_NAMES = { owner: 'Propriétaire', partner: 'Associé', quality_reviewer: 'Revue qualité', bdm: 'BDM', manager: 'Manager', supervisor: 'Superviseur',
    senior: 'Senior', auditor: 'Auditeur', secretary: 'Secrétariat', it_admin: 'Informatique' };
  var post = function (body) {
    return OM.api('/api/app?route=simulation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  };
  function roleSelect(current) {
    var sel = el('select'); Object.keys(ROLE_NAMES).forEach(function (r) { var o = el('option', ROLE_NAMES[r]); o.value = r; if (r === current) o.selected = true; sel.appendChild(o); });
    return sel;
  }
  // Members and open invitations of one simulation; the owner invites by address (link), changes roles, removes. Texts only via textContent.
  function members(simOrg, panel) {
    panel.textContent = 'Chargement…';
    OM.api('/api/app?route=simulation&members=' + encodeURIComponent(simOrg)).then(function (d) {
      panel.textContent = '';
      panel.appendChild(el('p', 'Une personne invitée voit tout ce que contient le dossier d’entraînement : n’y déposez pas de vraies pièces de client si vous invitez quelqu’un d’extérieur au cabinet. Maximum ' + d.max + ' personnes.', 'small'));
      var say = el('p', '', 'small'); say.setAttribute('role', 'status');
      var redo = function () { members(simOrg, panel); };
      var fail = function (e) { say.textContent = msg(e); };
      (d.members || []).filter(function (m) { return m.active; }).forEach(function (m) {
        var row = el('div', null, 'item'); row.appendChild(el('span', (m.display_name || m.email) + ' — ' + m.email, 'small'));
        var sel = roleSelect(m.role);
        sel.addEventListener('change', function () { post({ action: 'set-role', org_id: simOrg, user_id: m.auth_user_id, role: sel.value }).then(redo).catch(function (e) { fail(e); sel.value = m.role; }); });
        var out = el('button', 'Retirer', 'btn ghost'); out.type = 'button';
        out.addEventListener('click', function () { post({ action: 'remove', org_id: simOrg, user_id: m.auth_user_id }).then(redo).catch(fail); });
        row.appendChild(sel); row.appendChild(out); panel.appendChild(row);
      });
      (d.invitations || []).forEach(function (i) {
        var row = el('div', null, 'item'); row.appendChild(el('span', 'Invitation en attente : ' + i.email + ' (' + (ROLE_NAMES[i.role] || i.role) + ')', 'small'));
        var no = el('button', 'Annuler', 'btn ghost'); no.type = 'button';
        no.addEventListener('click', function () { post({ action: 'revoke', org_id: simOrg, id: i.id }).then(redo).catch(fail); });
        row.appendChild(no); panel.appendChild(row);
      });
      var form = el('div', null, 'item'); var mail = el('input'); mail.type = 'email'; mail.placeholder = 'adresse e-mail'; mail.setAttribute('aria-label', 'Adresse e-mail de la personne à inviter');
      var role = roleSelect('auditor'); role.setAttribute('aria-label', 'Rôle dans la simulation');
      var go = el('button', 'Inviter', 'btn'); go.type = 'button';
      go.addEventListener('click', function () {
        go.disabled = true;
        post({ action: 'invite', org_id: simOrg, email: mail.value, role: role.value }).then(function (r) {
          var link = location.origin + '/cabinets.html?invitation=' + encodeURIComponent(r.token);
          panel.textContent = ''; panel.appendChild(el('p', 'Invitation créée. Envoyez ce lien à ' + r.email + ' (affiché une seule fois, valable 7 jours) :', 'small'));
          var inp = el('input'); inp.readOnly = true; inp.value = link; inp.setAttribute('aria-label', 'Lien d’invitation'); panel.appendChild(inp);
          var back = el('button', 'Terminé', 'btn ghost'); back.type = 'button'; back.addEventListener('click', redo); panel.appendChild(back);
        }).catch(function (e) { fail(e); go.disabled = false; });
      });
      form.appendChild(mail); form.appendChild(role); form.appendChild(go); panel.appendChild(form); panel.appendChild(say);
    }).catch(function (e) { panel.textContent = msg(e); });
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
