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
  var st = { data: null, say: '', busy: false, autoRead: false, polls: 0, declined: false, imports: {}, asked: {} };

  function place() {
    var left = document.getElementById('wf-left');
    if (!left) return false;
    var sop = left.querySelector('.wf-sop');
    if (box.parentNode !== left) left.insertBefore(box, sop ? sop.nextSibling : left.firstChild);
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

  var KIND = { gl: 'le grand livre', budget: 'le budget' };
  function fmt(n) { return Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 }); }
  function imports(d) {
    var list = d.data_sheets || []; if (!list.length) return '';
    return '<div class="wf-assist-block"><h3>Les feuilles de données à remplir</h3>' + list.map(function (x) {
      var p = st.imports[x.sheet], what = KIND[x.kind] || 'la pièce';
      if (!p) return '<p class="wf-assist-busy">' + esc(x.sheet) + ' : je cherche ' + esc(what) + ' parmi les pièces de la mission (par ses colonnes, pas par son nom)…</p>';
      if (p.error) return '<p>' + esc(x.sheet) + ' : ' + esc(p.error) + '</p>';
      if (p.status === 'READY') {
        var g = p.gl_summary;
        return '<div class="wf-assist-prop"><p>J’ai identifié <b>' + esc(what) + '</b> : <b>' + esc(p.source.name) + '</b>' + (p.source.sheet ? ' (feuille « ' + esc(p.source.sheet) + ' »)' : '') + ' — ' + fmt(p.rows) + ' ligne(s)' +
          (g ? ' ; débit ' + fmt(g.debit) + ', crédit ' + fmt(g.credit) + (g.difference ? ', <b>écart ' + fmt(g.difference) + '</b>' : ', équilibré') : '') + '.</p>' +
          '<p>Je propose de le mettre dans <b>' + esc(p.sheet) + '</b> à partir de la ligne ' + esc(p.start_row) + ' :</p><ul class="wf-agent-list">' +
          p.mapping.map(function (m) { return '<li>' + esc(m.label) + ' ← « ' + esc(m.source_label) + ' »</li>'; }).join('') + '</ul>' +
          (p.unmatched.length ? '<p class="meta">Sans correspondance sûre, laissées vides : ' + esc(p.unmatched.join(', ')) + '.</p>' : '') +
          (x.capacity && p.rows > x.capacity ? '<p><b>Attention :</b> le tableau de ' + esc(p.sheet) + ' a ' + fmt(x.capacity) + ' lignes et la pièce en a ' + fmt(p.rows) + '. Je n’importe pas une partie seulement : il faut d’abord agrandir le tableau dans le modèle.</p>' : '') +
          (d.editable && !(x.capacity && p.rows > x.capacity) ? '<div class="row"><button type="button" class="btn" data-a="import" data-sheet="' + esc(p.sheet) + '">Oui, importe</button><button type="button" class="btn ghost" data-a="import-detail">Changer la correspondance</button></div>' : '') + '</div>';
      }
      if (p.status === 'SEVERAL_SOURCES' || p.status === 'SOURCE_SHEET_TO_CHOOSE') return '<div class="wf-assist-prop"><p>' + esc(x.sheet) + ' : plusieurs pièces ressemblent à ' + esc(what) + '. Laquelle ?</p><div class="row">' +
        (p.candidates || []).map(function (c) { return '<button type="button" class="btn ghost" data-a="import-pick" data-sheet="' + esc(x.sheet) + '" data-file="' + esc(c.file_id) + '">' + esc(c.name) + '</button>'; }).join('') + '</div></div>';
      if (p.status === 'NO_SOURCE_FOUND') return '<p>' + esc(x.sheet) + ' : je n’ai trouvé ' + esc(what) + ' dans aucune pièce Excel ou CSV de la mission (' + (x.kind === 'gl' ? 'colonnes débit, crédit, compte ou date' : 'colonnes de budget') + '). Déposez-le plus bas, ou je prépare la demande au client.</p>';
      if (p.status === 'NO_COLUMN_MATCH') return '<p>' + esc(x.sheet) + ' : j’ai trouvé ' + esc(p.source && p.source.name) + ', mais aucune colonne ne correspond sûrement. Utilisez « Importer les données client » pour choisir les colonnes.</p>';
      return '<p>' + esc(x.sheet) + ' : ' + esc(p.status) + '</p>';
    }).join('') + '</div>';
  }
  var ERR = { HUMAN_CONFIRMATION_REQUIRED: 'une écriture précédente attend votre confirmation (voir le travail de l’agent)', DOCUMENT_INVENTORY_UNAVAILABLE: 'la liste des pièces de la mission n’est pas lisible pour l’instant', IN_REVIEW_OR_NOT_EDITABLE: 'le test est en revue ou vous n’en êtes pas le préparateur', TABLE_CAPACITY_OR_OCCUPIED_CELL: 'le tableau du modèle est trop petit ou des cases sont déjà remplies', SOURCE_TYPE_MISMATCH: 'la pièce ne ressemble pas au contenu attendu par cette feuille', WORK_CHANGED_PREPARE_AGAIN: 'le fichier ou la pièce a changé, je refais la proposition' };
  function propose(sheet, fileId) {
    st.imports[sheet] = null; render();
    return api('workfile-import-propose', { sheet: sheet, source_file_id: fileId || null }).then(function (p) { st.imports[sheet] = p; render(); })
      .catch(function (e) { var m = String(e && e.message || e); st.imports[sheet] = { error: 'proposition impossible — ' + (ERR[m] || m) }; render(); });
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
    box.innerHTML = '<h2>L’agent</h2>' + (d ? known(d) + imports(d) + pieces(d) : '<p class="meta">Lecture de ce qu’il sait et des pièces reçues…</p>') +
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
      (d.data_sheets || []).forEach(function (x) { if (!st.asked[x.sheet]) { st.asked[x.sheet] = true; propose(x.sheet); } });
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
    if (b.dataset.a === 'import-pick') propose(b.dataset.sheet, b.dataset.file);
    if (b.dataset.a === 'import-detail') { var ib = Array.prototype.find.call(document.querySelectorAll('button'), function (x) { return /^Importer les données/.test(x.textContent); }); if (ib) { ib.scrollIntoView({ behavior: 'smooth' }); ib.click(); } }
    if (b.dataset.a === 'import') {
      var p = st.imports[b.dataset.sheet]; if (!p) return;
      b.disabled = true; st.say = 'J’importe ' + (KIND[p.kind] || 'la pièce') + ' dans ' + p.sheet + '…'; render();
      api('workfile-import-accept', { sheet: p.sheet, step: p.step, source_file_id: p.source.file_id, revision: p.revision }).then(function (r) {
        st.say = fmt(r.rows) + ' ligne(s) importée(s) dans ' + r.sheet + ', écrites et relues' + (r.confirmed ? '.' : ' — confirmez-les dans le travail de l’agent.');
        delete st.imports[p.sheet];
        try { document.dispatchEvent(new CustomEvent('wf-written', { detail: { sheet: r.sheet } })); } catch (_) {}
        return refresh();
      }).catch(function (e) { var m = String(e && e.message || e); st.say = 'Import refusé : ' + (ERR[m] || m) + '. Rien n’a été forcé.'; render(); });
    }
  });

  var tries = 0;
  (function wait() { if (place()) { render(); refresh(); return; } if (++tries < 40) setTimeout(wait, 250); })();
  // The guide re-reads the sheet after a write: the known facts are published again so they stay visible.
  document.addEventListener('wf-written', function () { setTimeout(publish, 1500); });
})();
