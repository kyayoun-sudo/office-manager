/* Firm Manager Lite: minimum "Mon travail" — read existing personal tasks
 * and hand off an explicit user instruction to the SAME server-side agent.
 * No new task database, no automatic AI signatures or hidden action execution. */
(function () {
  'use strict';
  var om = null, loaded = false, seq = 0;
  var $ = function (id) { return document.getElementById(id); };
  function make(tag, text, className) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = String(text);
    if (className) e.className = className;
    return e;
  }
  function alertText(text) {
    $('mobile-my-tasks').replaceChildren(make('p', text, 'mobile-muted'));
  }
  function safeTaskLink(href) {
    if (typeof href !== 'string' || href.startsWith('//')) return null;
    try {
      var u = new URL(href, location.origin);
      if (u.origin === location.origin && /^\/[a-z0-9-]+\.html$/i.test(u.pathname)) return u.href;
      if (u.protocol === 'https:' && u.hostname === 'drive.google.com') return u.href;
    } catch (_) { /* no valid link */ }
    return null;
  }
  function toAgent(instruction) {
    if (!window.FirmMobileAI || !window.FirmMobileAI.prefill) {
      $('mobile-my-tasks').appendChild(make('p', 'Assistant indisponible : réessayez depuis l’onglet IA.', 'mobile-error'));
      return;
    }
    window.FirmMobileAI.prefill(instruction, 'auto');
    var tab = document.querySelector('[data-tab="ia"]');
    if (tab) tab.click();
  }
  function render(questions) {
    var root = $('mobile-my-tasks');
    root.replaceChildren();
    if (!questions.length) {
      root.appendChild(make('p', 'Aucune tâche urgente à afficher. Consultez vos notifications pour les autres suivis.', 'mobile-muted'));
      return;
    }
    questions.slice(0, 18).forEach(function (q) {
      if (!q || !q.question) return;
      var card = make('div', null, 'mobile-task-card');
      card.appendChild(make('strong', q.title || 'À traiter'));
      card.appendChild(make('p', q.question));
      if (q.context) card.appendChild(make('small', q.context));
      var actions = make('div', null, 'mobile-task-buttons');
      var url = safeTaskLink(q.href);
      if (url) {
        var link = make('a', 'Voir le dossier');
        link.href = url;
        if (new URL(url).origin !== location.origin) {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
        actions.appendChild(link);
      }
      var ask = make('button', 'Demander à l’IA');
      ask.type = 'button';
      ask.addEventListener('click', function () {
        toAgent('Dans le Firm Manager existant, prends en charge cette tâche déjà créée (ne crée pas une nouvelle job note) : ' +
          'identifiant ' + String(q.id || 'non fourni').slice(0, 160) +
          ' ; mission ' + String(q.title || '').slice(0, 140) +
          ' ; demande : ' + String(q.question).slice(0, 650) +
          (q.context ? ' ; contexte : ' + String(q.context).slice(0, 240) : '') +
          (q.href ? ' ; lien interne du dossier : ' + String(q.href).slice(0, 330) : '') +
          '. Utilise les outils, job notes, pièces et workflows déjà présents dans Firm Manager. ' +
          'Exécute uniquement les opérations permises pour mon rôle et vérifie le résultat réellement enregistré ; ' +
          'sinon dis-moi précisément quelle approbation ou signature reste à faire. ' +
          'N’attribue jamais une signature humaine à l’IA.');
      });
      actions.appendChild(ask);
      card.appendChild(actions);
      root.appendChild(card);
    });
  }
  function refresh(force) {
    if (!om || !navigator.onLine || document.hidden) return Promise.resolve();
    if (loaded && !force) return Promise.resolve();
    var mySeq = ++seq;
    alertText('Chargement de vos tâches…');
    return om.api('/api/app?route=my-questions')
      .then(function (result) {
        if (mySeq !== seq) return;
        render(Array.isArray(result.questions) ? result.questions : []);
        loaded = true;
      }).catch(function () {
        if (mySeq !== seq) return;
        alertText('Les tâches ne sont pas accessibles actuellement. Réessayez.');
      });
  }
  function init(officeManager) {
    if (om) return;
    om = officeManager;
    $('mobile-tasks-refresh').addEventListener('click', function () { refresh(true); });
    $('mobile-instruction-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var text = $('mobile-instruction-text').value.trim();
      if (!text) return;
      toAgent(text);
    });
  }
  window.FirmMobileTasks = { init: init, refresh: refresh };
})();
