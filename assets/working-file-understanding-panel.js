(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);
  var missionId = qs.get('mission_id') || '';
  var code = qs.get('code') || '';
  var workspace = document.getElementById('procedure-workspace');
  var dialogue = workspace && workspace.querySelector('.audit-dialogue');
  if (!missionId || !code || !workspace || !dialogue || !window.OfficeManager) return loadAgentPanel();

  var board = document.createElement('section');
  board.className = 'wf-agent-board wf-understanding-board';
  board.setAttribute('aria-label', 'Compréhension globale du Working File');
  board.innerHTML = '' +
    '<div class="wf-agent-head">' +
      '<div><h2>Compréhension du Working File</h2><p class="meta">Avant tout test, l’agent lit le classeur comme un dossier d’audit complet.</p></div>' +
      '<span class="wf-agent-status" id="wf-understanding-status" data-state="working">Lecture</span>' +
    '</div>' +
    '<div id="wf-understanding-body" class="wf-agent-body"><section class="wf-agent-block"><h3>Lecture globale</h3><p>Guide → synthèse mission → programme/PGA → risques → PBC → populations → rapprochements → tests.</p></section></div>' +
    '<p id="wf-understanding-message" class="status" role="status" aria-live="polite"></p>';
  dialogue.insertBefore(board, dialogue.firstChild);

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function status(label, kind) {
    var n = document.getElementById('wf-understanding-status');
    if (!n) return;
    n.textContent = label;
    n.dataset.state = kind || 'working';
  }
  function block(title, html) {
    return '<section class="wf-agent-block"><h3>' + esc(title) + '</h3>' + html + '</section>';
  }
  function list(items) {
    return '<ul class="wf-agent-list">' + (items || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
  }
  function render(u) {
    var body = document.getElementById('wf-understanding-body');
    if (!body) return;
    var html = '';
    html += block('Ordre compris', '<p>' + esc(u.start_message || '') + '</p>' + list((u.read_order || []).slice(0, 20)));

    var p = u.active_procedure || {};
    var pg = p.programme || {};
    var wf = p.working_file || {};
    var activation = pg.active === true ? 'Activée' : pg.active === false ? 'Non activée' : 'À confirmer selon le programme';
    html += block('Programme / PGA', '<p><strong>' + esc(p.code || code) + '</strong> · ' + esc(activation) +
      (pg.level ? ' · Niveau ' + esc(pg.level) : '') + '</p>' +
      (pg.text ? '<p class="wf-agent-source">' + esc(pg.text) + '</p>' : '') +
      (wf.objective_hint ? '<p>' + esc(wf.objective_hint) + '</p>' : ''));

    var pops = (u.populations || []).map(function (x) {
      var kind = x.likely_ledger ? 'GL / population comptable' : x.likely_budget ? 'Budget' : 'Population';
      return x.sheet + ' — ' + kind + ' — ' + x.rows + ' ligne(s)' + (x.headers && x.headers.length ? ' — ' + x.headers.slice(0, 8).join(', ') : '');
    });
    html += block('Populations identifiées', pops.length ? list(pops) : '<p>Aucune feuille de population D* identifiée.</p>');

    var dependencies = (wf.population_dependencies || []).slice();
    var evidence = (wf.required_evidence || []).slice();
    var sop = (p.sop_steps || []).map(function (s) { return s.n + '. ' + s.text; });
    html += block('Procédure courante : ce qu’elle utilise',
      (dependencies.length ? '<p><strong>Populations :</strong></p>' + list(dependencies) : '<p>Aucune dépendance de population explicite détectée dans la feuille.</p>') +
      (evidence.length ? '<p><strong>Preuves/PBC :</strong></p>' + list(evidence) : '') +
      (sop.length ? '<p><strong>Étapes SOP :</strong></p>' + list(sop.slice(0, 20)) : ''));

    var risks = u.foundation && u.foundation.risks && u.foundation.risks.items || [];
    if (risks.length) html += block('Risques compris', list(risks.slice(0, 12).map(function (r) { return (r.code ? r.code + ' — ' : '') + r.text; })));

    var pbc = u.foundation && u.foundation.pbc && u.foundation.pbc.items || [];
    if (pbc.length) html += block('PBC / pièces', list(pbc.slice(0, 15).map(function (r) { return (r.ids && r.ids.length ? r.ids.join(', ') + ' — ' : '') + r.text; })));

    if (u.missing_foundation && u.missing_foundation.length) {
      html += block('Attention', '<p>Le moteur n’a pas identifié : ' + esc(u.missing_foundation.join(', ')) + '. L’exécution automatique ne doit pas se substituer à cette compréhension.</p>');
      status('À clarifier', 'blocked');
    } else {
      status('Working File compris', 'done');
    }
    body.innerHTML = html;
  }

  // 2026-10-24 : d'abord l'écran construit depuis le working file (carte lue par le code, route procedure — même porte
  // que le reste de la page). L'ancienne lecture ci-dessous ne sert plus que si la carte ne peut pas être lue.
  function loadGuide() {
    return new Promise(function (resolve, reject) {
      if (window.OfficeManager.workfileGuide) return resolve(window.OfficeManager.workfileGuide);
      var s = document.createElement('script'); s.src = '/assets/workfile-guide.js'; s.dataset.workfileGuide = '1';
      s.onload = function () { window.OfficeManager.workfileGuide ? resolve(window.OfficeManager.workfileGuide) : reject(new Error('WORKFILE_GUIDE_NOT_LOADED')); };
      s.onerror = function () { reject(new Error('WORKFILE_GUIDE_NOT_LOADED')); };
      document.head.appendChild(s);
    });
  }

  async function understand() {
    var message = document.getElementById('wf-understanding-message');
    var before = board.innerHTML;
    try {
      var guide = await loadGuide();
      board.setAttribute('aria-label', 'Le working file, feuille par feuille');
      await guide.mount(board, { missionId: missionId, code: code, sheet: code });
      loadAgentPanel();
      return true;
    } catch (e) {
      // The earlier reading below stays available: give it back its frame.
      board.innerHTML = before; board.setAttribute('aria-label', 'Compréhension globale du Working File');
      message = document.getElementById('wf-understanding-message');
    }
    try {
      var data = await window.OfficeManager.api('/api/working-file-understanding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mission_id: missionId, code: code })
      });
      var understanding = data && data.understanding;
      if (!understanding) throw new Error('WORKING_FILE_UNDERSTANDING_EMPTY');
      window.OfficeManager.workingFileUnderstanding = understanding;
      render(understanding);
      if (message) message.textContent = 'Cette carte est construite par code à partir du classeur et du SOP courant, avant le travail d’étape.';
      return understanding;
    } catch (e) {
      status('Compréhension indisponible', 'blocked');
      if (message) message.textContent = 'La lecture globale n’a pas pu être terminée : ' + String(e && e.message || e || 'erreur') + '. Le moteur existant reste disponible.';
      return null;
    } finally {
      loadAgentPanel();
    }
  }

  function loadAgentPanel() {
    if (document.querySelector('script[data-working-file-agent]')) return;
    var script = document.createElement('script');
    script.src = '/assets/working-file-agent-panel.js';
    script.defer = true;
    script.dataset.workingFileAgent = '1';
    document.head.appendChild(script);
  }

  window.OfficeManager.workingFileUnderstandingReady = understand();
})();
