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
  var st = { data: null, say: '', busy: false, autoRead: false, polls: 0, declined: false, imports: {}, asked: {}, pick: {} };

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
    return '<div class="wf-assist-block"><h3>Ce que je sais déjà</h3><p>Je peux remplir ' + d.known.length + ' case(s) sans rien inventer — ce que l’application sait (préparateur, mission) et les décisions du programme de travail validé ; elles sont en pointillés dans la feuille, à droite :</p><ul class="wf-agent-list">' +
      d.known.map(function (k) { return '<li><b>' + esc(k.label) + '</b> (' + esc(k.sheet) + ' ' + esc(k.address) + ') : ' + esc(k.value) + (k.replaces ? ' <span class="meta">(remplace « ' + esc(k.replaces) + ' »)</span>' : '') + ' <span class="meta">— ' + esc(k.source) + '</span></li>'; }).join('') + '</ul>' +
      (d.editable ? '<div class="row"><button type="button" class="btn" data-a="fill">Oui, remplis</button><button type="button" class="btn ghost" data-a="no">Pas maintenant</button></div>' : '<p class="meta">Seul le préparateur peut l’accepter.</p>') +
      (d.never.length ? '<p class="meta">Je ne remplis jamais : ' + esc(d.never.filter(function (x, i, a) { return a.map(function (y) { return y.label; }).indexOf(x.label) === i; }).map(function (x) { return x.label; }).join(', ')) + '.</p>' : '') + '</div>';
  }

  var KIND = { gl: 'le grand livre', budget: 'le budget' };
  function fmt(n) { return Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 }); }
  // Every piece that may fill the sheet, each with its years, rows and balance; the ones of the mission's years are ticked; the person
  // ticks or unticks; what the AI understood is marked « selon l'IA ».
  // The imports made on this procedure, each with « Annuler cet import » (only the cells it wrote, if nobody changed them since).
  function done(d) {
    var list = (d.imports_done || []).filter(function (x) { return x.status !== 'undone'; }); if (!list.length) return '';
    return '<div class="wf-assist-block"><h3>Imports faits</h3><ul class="wf-agent-list">' + list.map(function (x) {
      return '<li><b>' + esc(x.sheet || '') + '</b> ← ' + esc(x.source || 'pièce') + ' — ' + fmt(x.rows) + ' ligne(s)' + (x.at ? ' <span class="meta">(' + esc(String(x.at).slice(0, 16).replace('T', ' ')) + ')</span>' : '') +
        (d.editable ? (st.undoAsk === x.plan_id ? ' <button type="button" class="btn" data-a="undo-yes" data-plan="' + esc(x.plan_id) + '">Confirmer : vider ces lignes</button> <button type="button" class="btn ghost" data-a="undo-no">Garder</button>'
          : ' <button type="button" class="btn ghost" data-a="undo-ask" data-plan="' + esc(x.plan_id) + '">Annuler cet import</button>') : '') + '</li>';
    }).join('') + '</ul><p class="meta">Annuler vide seulement les cases écrites par l’import, si personne ne les a modifiées depuis ; le reste du fichier ne change pas.</p></div>';
  }
  function imports(d) {
    var list = d.data_sheets || []; if (!list.length) return '';
    return '<div class="wf-assist-block"><h3>Les feuilles de données à remplir</h3>' + list.map(function (x) {
      var p = st.imports[x.sheet], what = KIND[x.kind] || 'la pièce';
      if (!p) { var sc = st.scan[x.sheet] || {}; return '<p class="wf-assist-busy">' + esc(x.sheet) + ' : l’application ouvre les pièces Excel / CSV une par une pour trouver ' + esc(what) + ' (par leurs colonnes et leurs dates, pas par leur nom)' +
        (sc.total ? ' — ' + sc.done + ' / ' + sc.total + (sc.found ? ', ' + sc.found + ' trouvée(s)' : '') : '') + '…</p>' + (sc.current ? '<p class="meta">' + esc(sc.current) + '</p>' : ''); }
      if (p.error) return '<p class="wf-assist-err">' + esc(x.sheet) + ' : ' + esc(p.error) + '</p>';
      if (p.status === 'NO_SOURCE_FOUND') return '<p>' + esc(x.sheet) + ' : je n’ai trouvé ' + esc(what) + ' dans aucune pièce Excel ou CSV de la mission' + (p.ai === 'unavailable' ? ' (l’IA n’a pas répondu : je n’ai regardé que les colonnes reconnues par le code)' : '') + '. Déposez-le plus bas, ou je prépare la demande au client.</p>';
      if (p.status !== 'READY') return '<p>' + esc(x.sheet) + ' : ' + esc(p.status) + '</p>';
      var picked = p.items.filter(function (it, i) { return st.pick[x.sheet + '|' + i]; });
      var total = picked.reduce(function (n, it) { return n + (it.rows || 0); }, 0), tooBig = x.capacity && total > x.capacity;
      var yrs = (p.mission_years || []).join(', ');
      return '<div class="wf-assist-prop"><p>Pour <b>' + esc(x.sheet) + '</b>, j’ai trouvé ' + p.items.length + ' pièce(s) qui ressemblent à ' + esc(what) + (yrs ? ' ; la mission porte sur <b>' + esc(yrs) + '</b>' : '') + '. Cochez celles à importer :</p>' +
        p.items.map(function (it, i) {
          var key = x.sheet + '|' + i, g = it.gl_summary, ys = Object.keys(it.years || {});
          return '<div class="wf-assist-src"><label><input type="checkbox" data-pick="' + esc(key) + '"' + (st.pick[key] ? ' checked' : '') + (it.error || !it.mapping.length ? ' disabled' : '') + '> <b>' + esc(it.name) + '</b>' + (it.sheet ? ' — feuille « ' + esc(it.sheet) + ' »' : '') + '</label>' +
            '<p class="meta">' + (ys.length ? 'Années : <b>' + esc(ys.join(', ')) + '</b>' : 'Années non lues') + (it.in_mission_period === false ? ' (hors période de la mission)' : '') + ' · ' + fmt(it.rows) + ' ligne(s)' +
            (g ? ' · débit ' + fmt(g.debit) + ', crédit ' + fmt(g.credit) + (g.difference ? ', <b>écart ' + fmt(g.difference) + '</b>' : ', équilibré') : '') +
            (it.set_aside && it.set_aside.count ? ' · ' + it.set_aside.count + ' ligne(s) de total mises de côté' : '') + '</p>' +
            (it.check ? '<p class="' + (it.check.ok ? 'meta' : 'wf-assist-err') + '">' + (it.check.ok ? 'Vérifié par l’IA : correct' : 'L’IA signale un problème') + (it.check.remarks ? ' — ' + esc(it.check.remarks) : '') + '</p>' : '') +
            (it.understood ? '<p class="meta">Selon l’IA : ' + esc(it.understood.what) + (it.understood.period ? ' (' + esc(it.understood.period) + ')' : '') + (it.understood.why ? ' — ' + esc(it.understood.why) : '') + '</p>' : '') +
            (it.coverage != null && it.coverage < 40 ? '<p class="wf-assist-err">Cette pièce ne remplit que ' + it.coverage + ' % des colonnes de la feuille : probablement pas le bon genre de document.</p>' : '') +
            (it.same_period_as ? '<p class="meta">Même période que « ' + esc(it.same_period_as) + ' » : décochée pour ne pas importer deux fois.</p>' : '') +
            (it.error ? '<p class="wf-assist-err">Lecture impossible : ' + esc(ERR[it.error] || it.error) + '</p>' :
            '<details><summary>Colonnes : ' + it.mapping.length + ' rattachée(s)' + (it.unmatched.length ? ', ' + it.unmatched.length + ' laissée(s) vide(s)' : '') + '</summary><ul class="wf-agent-list">' +
              it.mapping.map(function (m) { return '<li>' + esc(m.label) + ' ← « ' + esc(m.source_label) + ' »' + (m.by === 'ia' ? ' <em>selon l’IA' + (m.why ? ' : ' + esc(m.why) : '') + '</em>' : '') + '</li>'; }).join('') + '</ul>' +
              (it.unmatched.length ? '<p class="meta">Laissées vides : ' + esc(it.unmatched.join(', ')) + '.</p>' : '') + '</details>') + '</div>';
        }).join('') +
        (p.ai === 'unavailable' ? '<p class="meta">L’IA n’a pas répondu : seules les colonnes reconnues par le code sont rattachées.</p>' : '') +
        (tooBig ? '<p class="wf-assist-warn">Le tableau de ' + esc(x.sheet) + ' a ' + fmt(x.capacity) + ' lignes ; les pièces cochées en ont ' + fmt(total) + '. Je peux d’abord l’agrandir de ' + fmt(total - x.capacity) + ' lignes, comme dans Excel : mêmes formats, listes et formules recopiées, et les totaux des autres feuilles prolongés. Je n’importe jamais une partie seulement.</p>' : '') +
        (p.run_error ? '<p class="wf-assist-err">Import arrêté : ' + esc(p.run_error) + '</p>' : '') +
        (d.editable ? '<div class="row"><button type="button" class="btn" data-a="import" data-sheet="' + esc(x.sheet) + '"' + (tooBig ? ' data-extend="1"' : '') + (!picked.length ? ' disabled' : '') + '>' + (tooBig ? 'Oui, agrandis le tableau et importe ' : 'Oui, importe ') + (picked.length > 1 ? 'les ' + picked.length + ' pièces cochées (à la suite)' : 'la pièce cochée') + '</button><button type="button" class="btn ghost" data-a="import-detail" data-sheet="' + esc(x.sheet) + '">Choisir les colonnes moi-même</button></div>' : '') + '</div>';
    }).join('') + '</div>';
  }
  var ERR = { HUMAN_CONFIRMATION_REQUIRED: 'une écriture précédente attend votre confirmation (voir le travail de l’agent)', DOCUMENT_INVENTORY_UNAVAILABLE: 'la liste des pièces de la mission n’est pas lisible pour l’instant', IN_REVIEW_OR_NOT_EDITABLE: 'le test est en revue ou vous n’en êtes pas le préparateur', TABLE_CAPACITY_OR_OCCUPIED_CELL: 'des cases du tableau sont déjà remplies', TABLE_TOO_SMALL: 'le tableau du modèle est trop petit', ROWS_BELOW_TABLE_NOT_EMPTY: 'il y a déjà quelque chose sous le tableau : je ne l’agrandis pas par-dessus', SOURCE_TYPE_MISMATCH: 'la pièce ne ressemble pas au contenu attendu par cette feuille', WORK_CHANGED_PREPARE_AGAIN: 'le fichier ou la pièce a changé, je refais la proposition' };
  // (2026-10-25, Paul : « l'application peut importer sans que ce soit l'IA ; l'IA vérifie que c'est bon ») The CODE opens the pieces one
  // by one (progress shown, no request too long for 90 pieces), then the AI checks what the code found and fills what it could not.
  st.scan = {};
  function propose(sheet) {
    st.imports[sheet] = null; st.scan[sheet] = { done: 0, total: 0, found: 0, current: '' }; render();
    var items = [];
    return api('workfile-import-candidates', { sheet: sheet }).then(function (c) {
      var files = c.files || []; st.scan[sheet].total = files.length; render();
      var i = 0;
      function next() {
        if (i >= files.length) return null;
        var f = files[i++]; st.scan[sheet].current = f.name; render();
        return api('workfile-import-inspect', { sheet: sheet, file_id: f.file_id, name: f.name }).then(function (r) {
          (r.items || []).forEach(function (it) { items.push(it); if (it.by) st.scan[sheet].found++; });
        }).catch(function () {}).then(function () { st.scan[sheet].done = i; render(); return next(); });
      }
      return next();
    }).then(function () {
      st.scan[sheet].current = 'l’IA vérifie ce que l’application a trouvé…'; render();
      var ds = (st.data && st.data.data_sheets || []).filter(function (x) { return x.sheet === sheet; })[0];
      return api('workfile-import-finish', { sheet: sheet, items: items, profile: ds ? ds.profile : null });
    }).then(function (p) {
      st.imports[sheet] = p; (p.items || []).forEach(function (it, i) { st.pick[sheet + '|' + i] = !!it.recommended; }); render();
    }).catch(function (e) { var m = String(e && e.message || e); st.imports[sheet] = { error: 'proposition impossible — ' + (ERR[m] || m) }; render(); });
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

  // « Comment j'importe, comment je remplis ? » (Paul, 2026-10-25): the path, in three lines, always at hand.
  function howto() {
    return '<details class="wf-howto"' + (st.howtoOpen ? ' open' : '') + '><summary>Comment importer et remplir</summary><ol>' +
      '<li><b>Les feuilles de données</b> (D1 grand livre, D2 budget…) : l’application trouve les pièces ci-dessous ; cochez-les, puis « Oui, importe ». À la main : « Choisir les colonnes moi-même » ouvre « Importer les données client » sur la bonne feuille (fichier, feuille du fichier, étape, « Examiner », colonnes, confirmer).</li>' +
      '<li><b>Le test</b> (PRJ-01…) : dans « Travail de l’agent », l’agent lit les pièces et propose les cases en pointillés dans la feuille à droite ; « Valider et écrire ».</li>' +
      '<li><b>Vos décisions</b> (Conforme ? Oui / Non / N/A, votre conclusion) : directement dans la feuille à droite, puis « Enregistrer dans le fichier ». L’agent ne les remplit jamais.</li></ol></details>';
  }
  function render() {
    var d = st.data;
    box.innerHTML = '<h2>L’agent</h2>' + howto() + (d ? known(d) + imports(d) + done(d) + pieces(d) : '<p class="meta">Lecture de ce qu’il sait et des pièces reçues…</p>') +
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

  box.addEventListener('toggle', function (ev) { if (ev.target && ev.target.classList && ev.target.classList.contains('wf-howto')) st.howtoOpen = ev.target.open; }, true);
  box.addEventListener('change', function (ev) { var c = ev.target; if (c && c.dataset && c.dataset.pick) { st.pick[c.dataset.pick] = c.checked; render(); } });
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
    if (b.dataset.a === 'undo-ask') { st.undoAsk = b.dataset.plan; render(); }
    if (b.dataset.a === 'undo-no') { st.undoAsk = null; render(); }
    if (b.dataset.a === 'undo-yes') {
      b.disabled = true; st.say = 'J’annule l’import…'; render();
      api('workfile-import-undo', { plan_id: b.dataset.plan }).then(function (r) {
        st.undoAsk = null; st.asked = {}; st.imports = {};
        st.say = 'Import annulé : ' + r.cleared + ' case(s) vidée(s)' + (r.kept_changed ? ', ' + r.kept_changed + ' modifiée(s) depuis, gardée(s)' : '') + '.';
        try { document.dispatchEvent(new CustomEvent('wf-written', { detail: {} })); } catch (_) {}
        return refresh();
      }).catch(function (e) { var m = String(e && e.message || e); st.say = 'Annulation refusée : ' + (ERR[m] || m) + '.'; render(); });
    }
    if (b.dataset.a === 'import-detail') { var sel = document.getElementById('audit-sheet'); if (sel && b.dataset.sheet) { sel.value = b.dataset.sheet; sel.dispatchEvent(new Event('change')); } var ib = Array.prototype.find.call(document.querySelectorAll('button'), function (x) { return /^Importer les données/.test(x.textContent); }); if (ib) { ib.scrollIntoView({ behavior: 'smooth' }); setTimeout(function () { ib.click(); }, sel && b.dataset.sheet ? 1800 : 0); } }
    if (b.dataset.a === 'import') {
      var sh = b.dataset.sheet, p = st.imports[sh]; if (!p || !p.items) return;
      var items = p.items.filter(function (it, i) { return st.pick[sh + '|' + i]; }).map(function (it) { return { file_id: it.file_id, sheet: it.sheet, rows: it.rows, mapping: it.mapping }; });
      b.disabled = true; p.run_error = null; st.say = 'J’importe ' + items.length + ' pièce(s) dans ' + sh + ', l’une après l’autre…'; render();
      api('workfile-import-accept', { sheet: sh, step: p.step, items: items, extend: b.dataset.extend === '1' }).then(function (r) {
        st.say = (r.done || []).map(function (x) { return (x.extended ? 'tableau agrandi de ' + fmt(x.extended.added) + ' lignes, ' : '') + fmt(x.rows) + ' ligne(s) de ' + x.name + ' (à partir de la ligne ' + x.start_row + ')' + (x.set_aside ? ', ' + x.set_aside + ' ligne(s) de total écartée(s)' : ''); }).join(' ; ') + ' — écrites et relues dans ' + sh + '.';
        delete st.imports[sh];
        try { document.dispatchEvent(new CustomEvent('wf-written', { detail: { sheet: sh } })); } catch (_) {}
        return refresh();
      }).catch(function (e) { var m = String(e && e.message || e); p.run_error = (ERR[m] || m) + '. Rien n’a été forcé.'; st.say = ''; render(); });
    }
  });

  var tries = 0;
  (function wait() { if (place()) { render(); refresh(); return; } if (++tries < 40) setTimeout(wait, 250); })();
  // The guide re-reads the sheet after a write: the known facts are published again so they stay visible.
  document.addEventListener('wf-written', function () { setTimeout(publish, 1500); });
})();
