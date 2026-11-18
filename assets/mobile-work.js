/* Firm Manager Lite E6 — small genuine tasks within the current validated work programme.
 * Same /api/app?route=procedure backend, organisation and server ACLs as desktop.
 * No duplicate WP, second task database, hidden approvals or client-side fake completion. */
(function () {
  'use strict';
  var om = null;
  var busy = false, loaded = false, serial = 0, detailsSerial = 0;
  var current = null, detail = null, review = null;
  var $ = function (id) { return document.getElementById(id); };
  function make(tag, value, className) {
    var n = document.createElement(tag);
    if (value != null) n.textContent = String(value);
    if (className) n.className = className;
    return n;
  }
  function placeholder(id, message, error) {
    $(id).replaceChildren(make('p', message, error ? 'mobile-error' : 'mobile-muted'));
  }
  function notice(message, error) {
    var n = $('mobile-work-detail-status');
    n.textContent = message || '';
    n.dataset.state = error ? 'error' : 'neutral';
  }
  function endpoint(mission, code, extra) {
    return '/api/app?route=procedure&mission_id=' + encodeURIComponent(mission) +
      '&code=' + encodeURIComponent(code) + (extra || '');
  }
  function normaliseSelection(item, type) {
    if (!item || !item.mission_id || !item.code) return null;
    return {
      mission_id: String(item.mission_id),
      code: String(item.code),
      title: String(item.title || item.code),
      mission_name: String(item.mission_name || ''),
      status: String(item.status || ''),
      review: type === 'review',
      level: item.level || null
    };
  }
  function itemCard(item, type) {
    var info = normaliseSelection(item, type);
    if (!info) return null;
    var b = make('button', null, 'mobile-work-item');
    b.type = 'button';
    var content = make('span', null, 'mobile-work-item-main');
    content.appendChild(make('strong', info.code + ' — ' + info.title));
    content.appendChild(make('small', info.mission_name + (info.status ? ' · ' + info.status : '') +
      (info.review ? ' · revue ' + (info.level || '') : '')));
    b.appendChild(content);
    var arrow = make('span', '›', 'mobile-chat-chevron');
    arrow.setAttribute('aria-hidden', 'true');
    b.appendChild(arrow);
    b.addEventListener('click', function () { open(info); });
    return b;
  }
  function cards(target, items, type) {
    var box = $(target);
    box.replaceChildren();
    if (!items.length) {
      box.appendChild(make('p', type === 'review' ? 'Aucune revue à effectuer.' : 'Aucune procédure attribuée.', 'mobile-muted'));
      return;
    }
    items.slice(0, 40).forEach(function (item) {
      var b = itemCard(item, type);
      if (b) box.appendChild(b);
    });
  }
  function refresh(force) {
    if (!om || !navigator.onLine || document.hidden) return Promise.resolve();
    if (loaded && !force) return Promise.resolve();
    var seq = ++serial;
    placeholder('mobile-work-mine', 'Chargement de vos procédures…', false);
    placeholder('mobile-work-reviews', 'Chargement des revues…', false);
    return Promise.allSettled([
      om.api('/api/app?route=procedure&mine=1'),
      om.api('/api/app?route=procedure&reviews=1')
    ]).then(function (results) {
      if (seq !== serial) return;
      var mine = results[0].status === 'fulfilled' && Array.isArray(results[0].value.procedures)
        ? results[0].value.procedures : [];
      var reviews = results[1].status === 'fulfilled' && Array.isArray(results[1].value.reviews)
        ? results[1].value.reviews : [];
      if (results[0].status === 'fulfilled') {
        cards('mobile-work-mine', mine.filter(function (p) { return ['to_do', 'in_progress', 'returned'].includes(p.status); }), 'mine');
      } else placeholder('mobile-work-mine', 'Impossible de consulter vos procédures.', true);
      if (results[1].status === 'fulfilled') cards('mobile-work-reviews', reviews, 'review');
      else placeholder('mobile-work-reviews', 'Impossible de consulter vos revues.', true);
      loaded = results.every(function (r) { return r.status === 'fulfilled'; });
    });
  }
  function listView() {
    detailsSerial++;
    current = null;
    detail = null; review = null;
    $('mobile-work-list').hidden = false;
    $('mobile-work-detail').hidden = true;
    notice('', false);
  }
  function open(info) {
    if (!om || busy) return;
    current = info;
    var seq = ++detailsSerial;
    $('mobile-work-list').hidden = true;
    $('mobile-work-detail').hidden = false;
    $('mobile-work-title').textContent = info.code + ' — ' + info.title;
    $('mobile-work-subtitle').textContent = info.mission_name + (info.review ? ' · Revue' : ' · Ma procédure');
    $('mobile-work-open-full').href = '/procedure.html?mission_id=' +
      encodeURIComponent(info.mission_id) + '&code=' + encodeURIComponent(info.code) +
      (info.review ? '#revue' : '');
    $('mobile-work-conclusion-form').hidden = true;
    $('mobile-work-review-form').hidden = true;
    placeholder('mobile-work-points', 'Chargement des points de revue…', false);
    notice('Lecture du dossier en cours…', false);
    Promise.all([
      om.api(endpoint(info.mission_id, info.code)),
      om.api(endpoint(info.mission_id, info.code, '&review=1'))
    ]).then(function (results) {
      if (seq !== detailsSerial || current !== info) return;
      detail = results[0];
      review = results[1];
      renderDetail();
    }).catch(function (error) {
      if (seq !== detailsSerial || current !== info) return;
      notice('Lecture impossible : ' + (error && error.message || 'dossier indisponible') +
        '. Utilisez la version complète si nécessaire.', true);
      placeholder('mobile-work-points', 'Impossible de charger les points.', true);
    });
  }
  function pointElement(p, isPreparer, mayReview) {
    var card = make('div', null, 'mobile-work-point');
    var head = make('strong', (p.id || 'Point') + ' · ' + (p.status || 'ouvert'));
    card.appendChild(head);
    card.appendChild(make('p', p.text || 'Point de revue'));
    if (p.response) card.appendChild(make('p', 'Réponse : ' + p.response, 'mobile-work-response'));
    if (isPreparer && p.status !== 'cleared') {
      var form = make('form', null, 'mobile-work-point-form');
      var label = make('label', 'Réponse au point ' + p.id);
      var textarea = make('textarea');
      textarea.maxLength = 2000;
      textarea.rows = 3;
      textarea.required = true;
      textarea.value = p.response || '';
      label.appendChild(textarea);
      var send = make('button', 'Enregistrer ma réponse');
      send.type = 'submit';
      form.append(label, send);
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var text = textarea.value.trim();
        if (!text) return notice('Écrivez votre réponse.', true);
        commit('answer-point', { id: p.id, response: text }, 'Réponse enregistrée dans la procédure.');
      });
      card.appendChild(form);
    } else if (mayReview && p.status === 'answered' && p.level === review.next) {
      var clear = make('button', 'Confirmer la résolution du point', 'mobile-work-clear');
      clear.type = 'button';
      clear.addEventListener('click', function () {
        if (!window.confirm('Avez-vous vérifié la réponse et ses preuves dans le Working Paper ?')) return;
        commit('clear-point', { id: p.id }, 'Point de revue marqué comme résolu.');
      });
      card.appendChild(clear);
    }
    return card;
  }
  function renderDetail() {
    if (!current || !detail || !review) return;
    var status = detail.work && detail.work.status || review.status || 'à faire';
    notice('Statut actuel : ' + status + '. Toute modification sera enregistrée dans la procédure du cabinet.', false);
    var points = $('mobile-work-points');
    points.replaceChildren();
    var list = Array.isArray(review.points) ? review.points : [];
    var isPreparer = Boolean(review.me && review.me.is_preparer);
    var mayReview = Boolean(review.me && review.me.may_review);
    if (list.length) {
      points.appendChild(make('h3', 'Points de revue'));
      list.forEach(function (p) { points.appendChild(pointElement(p, isPreparer, mayReview)); });
    } else points.appendChild(make('p', 'Aucun point de revue.', 'mobile-muted'));
    var canEdit = Boolean(detail.editable) && !['submitted', 'reviewed'].includes(status);
    $('mobile-work-conclusion-form').hidden = !canEdit;
    $('mobile-work-conclusion').value = detail.work && detail.work.conclusion || '';
    $('mobile-work-review-form').hidden = !mayReview || !current.review;
    $('mobile-work-point').value = '';
  }
  function commit(action, values, message) {
    if (!om || busy || !current) return Promise.resolve();
    if (!navigator.onLine) { notice('Hors ligne : aucune action enregistrée.', true); return Promise.resolve(); }
    var original = current;
    busy = true;
    $('mobile-work-detail').setAttribute('aria-busy', 'true');
    $('mobile-work-detail').querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    notice('Enregistrement en cours, ne renvoyez pas la demande…', false);
    return om.api('/api/app?route=procedure', {
      method: 'POST',
      body: JSON.stringify(Object.assign({ action: action, mission_id: original.mission_id, code: original.code }, values))
    }).then(function (response) {
      if (!response || !response.work) throw new Error('Enregistrement non confirmé.');
      loaded = false;
      notice(message, false);
      // Read back from the canonical server rather than pretending local state is authoritative.
      openAfterCommit(original);
    }).catch(function (e) {
      notice('Résultat non confirmé (' + (e && e.message || 'réseau') +
        '). Vérifiez la procédure avant de réessayer pour éviter un doublon.', true);
    }).finally(function () {
      busy = false;
      $('mobile-work-detail').removeAttribute('aria-busy');
      $('mobile-work-detail').querySelectorAll('button').forEach(function (b) { b.disabled = false; });
    });
  }
  function openAfterCommit(original) {
    // The fresh read occurs when the write has finished; it cannot launch a second write.
    var seq = ++detailsSerial;
    Promise.all([
      om.api(endpoint(original.mission_id, original.code)),
      om.api(endpoint(original.mission_id, original.code, '&review=1'))
    ]).then(function (data) {
      if (seq !== detailsSerial || current !== original) return;
      detail = data[0]; review = data[1];
      renderDetail();
      refresh(true);
    }).catch(function () {
      if (seq !== detailsSerial || current !== original) return;
      notice('Action enregistrée ; relecture impossible. Actualisez avant toute nouvelle action.', true);
    });
  }
  function init(officeManager) {
    if (om) return;
    om = officeManager;
    $('mobile-work-refresh').addEventListener('click', function () { refresh(true); });
    $('mobile-work-back').addEventListener('click', function () { listView(); refresh(true); });
    $('mobile-work-conclusion-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var content = $('mobile-work-conclusion').value.trim();
      if (!content) return notice('Une conclusion ne peut pas être vide.', true);
      commit('conclusion', { conclusion: content }, 'Conclusion enregistrée dans la procédure.');
    });
    $('mobile-work-review-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var point = $('mobile-work-point').value.trim();
      if (!point) return notice('Décrivez le point de revue.', true);
      if (!window.confirm('Renvoyer cette procédure au préparateur avec ce point de revue ?')) return;
      commit('return', { point: point, severity: $('mobile-work-severity').value }, 'Point envoyé au préparateur. Procédure renvoyée.');
    });
  }
  window.FirmMobileWork = { init: init, refresh: refresh };
})();
