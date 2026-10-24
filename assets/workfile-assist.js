// L'agent qui aide (Paul, 2026-10-24 : « il sait qui prépare, pourquoi il ne remplit pas ? il doit demander la permission avant de
// remplir ; j'ai déposé les pièces, il devait les comprendre, les renommer, me dire ce qu'il doit remplir »).
// À gauche, en haut : 1) « Ce que je sais déjà » — les cases que l'application peut remplir sans IA, montrées en pointillés dans la feuille
// à droite, écrites seulement sur « Oui, remplis » ; 2) « Les pièces reçues » — ce que l'agent en a compris, celles qu'il n'a pas encore
// lues ; il les lit, les identifie et les renomme lui-même dès l'ouverture (une fois), puis la feuille est relue.
(function () {
  'use strict';
  var OM = window.OfficeManager; if (!OM) return;
  var qs = new URLSearchParams(location.search), missionId = qs.get('mission_id') || '', code = qs.get('code') || '';
  if (!missionId || !code) return;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function api(action, extra) {
    return OM.api('/api/app?route=procedure', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ mission_id: missionId, code: code, action: action }, extra || {})) });
  }
  var box = document.createElement('section');
  box.id = 'wf-assist'; box.className = 'card wf-assist'; box.setAttribute('aria-label', 'Ce que l’agent fait pour vous');
  box.innerHTML = '<h2>L’agent</h2><p class="meta">Lecture de ce qu’il sait et des pièces reçues…</p>';
  var st = { data: null, say: '', busy: false, autoRead: false, polls: 0, declined: false };

  function place() {
    var left = document.getElementById('wf-left');
    if (!left) return false;
    var dialogue = left.querySelector('.audit-dialogue');
    if (box.parentNode !== left) left.insertBefore(box, dialogue || null);
    return true;
  }

  function known(d) {
    if (!d.known.length) return '';
    if (st.declined) return '<div class="wf-assist-block"><h3>Ce que je sais déjà</h3><p class="meta">Pas maintenant. <button type="button" class="link" data-a="undo">Me le reproposer</button></p></div>';
    return '<div class="wf-assist-block"><h3>Ce que je sais déjà</h3><p>Je peux remplir ' + d.known.length + ' case(s) sans rien inventer — elles sont en pointillés dans la feuille, à droite :</p><ul class="wf-agent-list">' +
      d.known.map(function (k) { return '<li><b>' + esc(k.label) + '</b> (' + esc(k.sheet) + ' ' + esc(k.address) + ') : ' + esc(k.value) + ' <span class="meta">— ' + esc(k.source) + '</span></li>'; }).join('') + '</ul>' +
      (d.editable ? '<div class="row"><button type="button" class="btn" data-a="fill">Oui, remplis</button><button type="button" class="btn ghost" data-a="no">Pas maintenant</button></div>' : '<p class="meta">Seul le préparateur peut l’accepter.</p>') +
      (d.never.length ? '<p class="meta">Je ne remplis jamais : ' + esc(d.never.filter(function (x, i, a) { return a.map(function (y) { return y.label; }).indexOf(x.label) === i; }).map(function (x) { return x.label; }).join(', ')) + '.</p>' : '') + '</div>';
  }

  function pieces(d) {
    var p = d.pieces, list = p.pieces || [];
    var html = '<div class="wf-assist-block"><h3>Les pièces reçues de la mission (' + list.length + ')</h3>';
    if (p.error) return html + '<p class="meta">Dossier des pièces non lisible : ' + esc(p.error) + '.</p></div>';
    if (!list.length) return html + '<p>Aucune pièce dans « Pièces reçues » pour l’instant. Déposez-les plus bas, ou je prépare la demande au client.</p></div>';
    html += '<ul class="wf-agent-list">' + list.slice(0, 12).map(function (x) {
      return '<li>' + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.name) + '</a>' : esc(x.name)) + ' — ' +
        (x.understood ? '<b>' + esc(x.type || 'identifiée') + '</b>' + (x.period ? ' · ' + esc(x.period) : '') + (x.summary ? '<br><span class="meta">' + esc(x.summary) + '</span>' : '') : '<span class="meta">pas encore lue</span>') + '</li>';
    }).join('') + '</ul>' + (list.length > 12 ? '<p class="meta">… et ' + (list.length - 12) + ' autre(s).</p>' : '');
    if (p.reading) html += '<p class="wf-assist-busy">Je lis les pièces, je les identifie et je les renomme d’après leur contenu…</p>';
    else if (d.editable) html += '<div class="row"><button type="button" class="btn' + (p.to_read ? '' : ' ghost') + '" data-a="review">' + (p.to_read ? 'Lire et identifier les ' + p.to_read + ' pièce(s) non lues' : 'Revoir et renommer les pièces') + '</button></div>';
    return html + '</div>';
  }

  function render() {
    var d = st.data;
    box.innerHTML = '<h2>L’agent</h2>' + (d ? known(d) + pieces(d) : '<p class="meta">Lecture de ce qu’il sait et des pièces reçues…</p>') +
      '<p class="status" role="status" aria-live="polite">' + esc(st.say) + '</p>';
  }

  function publish() {
    var d = st.data; if (!d) return;
    try { document.dispatchEvent(new CustomEvent('wf-proposals', { detail: { channel: 'known', cells: st.declined ? [] : d.known } })); } catch (_) {}
  }

  function refresh() {
    return api('workfile-assist').then(function (d) {
      var wasReading = st.data && st.data.pieces && st.data.pieces.reading;
      st.data = d; render(); publish();
      if (wasReading && !d.pieces.reading) {
        st.say = 'Pièces lues et identifiées : je prépare l’étape avec elles.'; render();
        try { document.dispatchEvent(new CustomEvent('wf-written', { detail: {} })); } catch (_) {}
        // The step of the SOP is prepared again with what was just read (facts proposed in the sheet, permission asked before writing).
        var agent = OM.workingFileAgent; if (agent && agent.prepareCurrent && !(agent.state && agent.state.busy)) agent.prepareCurrent();
      }
      // Once per opening: the pieces nobody read yet are read, identified and renamed without waiting for a click.
      if (d.editable && !st.autoRead && d.pieces.to_read > 0 && !d.pieces.reading) { st.autoRead = true; review(); }
      if (d.pieces.reading && st.polls < 30) { st.polls++; setTimeout(refresh, 20000); }
    }).catch(function (e) { st.say = 'L’agent ne peut pas lire le fichier : ' + (e && e.message || e); render(); });
  }

  function review() {
    st.say = 'Je lis les pièces reçues…'; render();
    return api('workfile-review-pieces').then(function (r) {
      st.say = (r.renamed && r.renamed.length ? r.renamed.length + ' pièce(s) renommée(s) d’après leur contenu. ' : '') + (r.to_read ? r.to_read + ' pièce(s) en lecture.' : (r.reason === 'NO_PIECES' ? '' : 'Pièces revues.'));
      return refresh();
    }).catch(function (e) { st.say = 'Lecture des pièces impossible : ' + (e && e.message || e); render(); });
  }

  box.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.a === 'fill') {
      b.disabled = true; st.say = 'J’écris dans le fichier…'; render();
      api('workfile-fill-known', { cells: st.data.known.map(function (k) { return { sheet: k.sheet, address: k.address }; }) }).then(function (r) {
        st.say = (r.written || []).length + ' case(s) écrite(s) et relue(s) dans le fichier.';
        try { document.dispatchEvent(new CustomEvent('wf-written', { detail: {} })); } catch (_) {}
        return refresh();
      }).catch(function (e) { st.say = 'Écriture refusée : ' + (e && e.message || e) + '. Rien n’a été forcé.'; render(); });
    }
    if (b.dataset.a === 'no') { st.declined = true; render(); publish(); }
    if (b.dataset.a === 'undo') { st.declined = false; render(); publish(); }
    if (b.dataset.a === 'review') review();
  });

  var tries = 0;
  (function wait() { if (place()) { render(); refresh(); return; } if (++tries < 40) setTimeout(wait, 250); })();
  // The guide re-reads the sheet after a write: the known facts are published again so they stay visible.
  document.addEventListener('wf-written', function () { setTimeout(publish, 1500); });
})();
