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
  // « L'IA doit apprendre à utiliser l'Excel pour cette mission » (Paul, 2026-10-25): the person fills in Excel, the agent compares
  // before / after, finds where each value comes from, writes the logic; the person confirms or corrects; then the agent does the same.
  function learning(d) {
    var L = d.learning; if (!L) return '';
    var html = '<div class="wf-assist-block"><h3>Apprendre en vous regardant</h3>';
    if (L.watch) html += '<p>Je regarde depuis ' + esc(String(L.watch.at).slice(11, 16)) + '. Remplissez le working file directement dans Excel' + (d.workbook_url ? ' (<a href="' + esc(d.workbook_url) + '" target="_blank" rel="noopener">ouvrir le fichier</a>)' : '') + ', enregistrez, puis :</p>' +
      '<div class="row"><button type="button" class="btn" data-a="learn">J’ai fini — apprends</button><button type="button" class="btn ghost" data-a="learn-cancel">Annuler</button></div>';
    else html += '<p>Faites-le une fois vous-même dans le fichier Excel : je compare avant / après, je cherche d’où vient chaque valeur dans les pièces, j’écris la logique (quelle colonne de quelle pièce va où, quelles lignes sont prises) et, une fois que vous l’avez validée, je la refais seul pour ce modèle.</p>' +
      (d.editable ? '<div class="row"><button type="button" class="btn ghost" data-a="learn-start">Je remplis dans Excel — regarde-moi</button></div>' : '');
    (st.learned || L.lessons.filter(function (x) { return x.status === 'to_confirm'; })).forEach(function (x) {
      html += '<div class="wf-assist-prop"><p><b>' + esc(x.sheet) + '</b> — ' + (x.filled || 0) + ' case(s) remplie(s) par vous. Voici ce que j’ai compris :</p>' +
        (x.logic && x.logic.summary ? '<p>' + esc(x.logic.summary) + '</p>' : '') +
        '<ul class="wf-agent-list">' + (x.mappings || []).map(function (m) { return '<li>' + esc(m.dest_header) + ' ← « ' + esc(m.source_header || '?') + ' » de ' + esc(m.source_name || 'la pièce') + ' <span class="meta">(' + esc(m.support) + ' valeurs retrouvées' + (m.sure ? '' : ', à confirmer') + ')</span></li>'; }).join('') +
        ((x.logic && x.logic.rules) || []).filter(function (r) { return r.rows; }).map(function (r) { return '<li>' + esc(r.column) + ' : ' + esc(r.rows) + (r.note ? ' — ' + esc(r.note) : '') + '</li>'; }).join('') + '</ul>' +
        ((x.unmatched || []).length ? '<p class="meta">Je n’ai pas retrouvé d’où viennent : ' + esc(x.unmatched.join(', ')) + '.</p>' : '') +
        ((x.logic && x.logic.questions) || []).map(function (q) { return '<p class="meta">Question : ' + esc(q) + '</p>'; }).join('') +
        (d.editable ? '<textarea class="wf-learn-note" data-sheet="' + esc(x.sheet) + '" rows="2" placeholder="Si c’est faux : la bonne règle, en une phrase (facultatif)">' + esc((st.notes || {})[x.sheet] || '') + '</textarea>' +
          '<div class="row"><button type="button" class="btn" data-a="lesson-ok" data-sheet="' + esc(x.sheet) + '">Oui, c’est ça — retiens</button><button type="button" class="btn ghost" data-a="lesson-no" data-sheet="' + esc(x.sheet) + '">Non, oublie</button></div>' : '') + '</div>';
    });
    var kept = L.lessons.filter(function (x) { return x.status === 'validated'; });
    if (kept.length) html += '<p class="meta">Déjà appris pour ce modèle : ' + esc(kept.map(function (x) { return x.sheet; }).join(', ')) + '.</p>';
    return html + '</div>';
  }

  // (2026-10-25, Paul : « quand on ouvre le working file, il doit savoir de quelle pièce il a besoin pour y travailler ») The pieces the
  // working file names (its PBC list and test ↔ piece matrix), and where each one is in the mission's memory.
  var STATUS = { linked: '✓ trouvée', probable: '? à confirmer', missing: '✗ manquante' };
  function needItem(x, d) {
    var html = '<li><b>' + esc(x.id) + '</b> ' + esc(x.name) + ' — <span class="wf-need-' + x.status + '">' + STATUS[x.status] + '</span>' + (x.tests && x.tests.length ? ' <span class="meta">(' + esc(x.tests.join(', ')) + ')</span>' : '');
    (x.docs || []).forEach(function (doc) {
      html += '<br>→ ' + (doc.url ? '<a href="' + esc(doc.url) + '" target="_blank" rel="noopener">' + esc(doc.name) + '</a>' : esc(doc.name)) + (doc.title ? ' — ' + esc(doc.title) : '') +
        (doc.location ? ' <span class="meta">· rangé dans ' + esc(doc.location) + '</span>' : '') + (doc.why ? ' <span class="meta">· ' + esc(doc.why) + (doc.ai === true ? ', confirmé par l’IA' : '') + '</span>' : '') +
        (x.status === 'probable' && d.editable ? ' <button type="button" class="btn ghost" data-a="need-yes" data-pbc="' + esc(x.id) + '" data-file="' + esc(doc.id) + '">C’est bien ça</button> <button type="button" class="btn ghost" data-a="need-no" data-pbc="' + esc(x.id) + '" data-file="' + esc(doc.id) + '">Ce n’est pas ça</button>' : '');
    });
    if (x.status === 'missing') html += ' <button type="button" class="btn ghost" data-a="need-ask">Déposer ou demander</button>';
    return html + '</li>';
  }
  function needs(d) {
    var n = st.needs; if (!n) return st.needsAsked ? '<div class="wf-assist-block"><h3>Pièces dont ce working file a besoin</h3><p class="wf-assist-busy">Je lis la liste des pièces du working file et je les cherche dans la mémoire de la mission…</p></div>' : '';
    if (n.error) return '<div class="wf-assist-block"><h3>Pièces dont ce working file a besoin</h3><p class="meta">' + esc(n.error) + '</p></div>';
    var byId = {}; n.items.forEach(function (x) { byId[x.id] = x; });
    var cur = n.current_test ? n.current_test.pieces.map(function (id) { return byId[id]; }).filter(Boolean) : [];
    var html = '<details class="wf-assist-block"><summary><b>Pièces que demande ce working file</b> — ' + n.counts.found + ' trouvée(s), ' + n.counts.missing + ' manquante(s)</summary>';
    if (cur.length) html += '<p><b>Pour ' + esc(n.current_test.code) + ' :</b></p><ul class="wf-agent-list">' + cur.map(function (x) { return needItem(x, d); }).join('') + '</ul>';
    var sheets = []; // the data sheets are shown column by column in « Les feuilles de données à remplir »
    if (sheets.length) html += '<p><b>Pour les feuilles de données :</b></p><ul class="wf-agent-list">' + sheets.map(function (s) {
      var main = byId[s.pieces[0]];
      if (s.chosen && s.chosen.length) return '<li><b>' + esc(s.sheet) + '</b> : <span class="wf-need-linked">✓ vous avez choisi</span> ' + esc(s.chosen.map(function (c) { return c.name; }).join(', ')) + '</li>';
      return '<li><b>' + esc(s.sheet) + '</b> se remplit, selon le working file, avec ' + (main ? esc(main.id) + ' « ' + esc(main.name) + ' » — <span class="wf-need-' + main.status + '">' + STATUS[main.status] + '</span>' + ((main.docs || [])[0] ? ' : ' + esc(main.docs[0].name) : '') : '?') + ' <span class="meta">(si c’est une autre pièce, choisissez-la ci-dessous : votre choix passe avant)</span></li>'; }).join('') + '</ul>';
    html += '<p><b>Toutes les pièces du working file (' + n.items.length + ')</b></p><ul class="wf-agent-list">' + n.items.map(function (x) { return needItem(x, d); }).join('') + '</ul>';
    return html + '</details>';
  }
  function loadNeeds() {
    st.needsAsked = true; render();
    return api('workfile-needs').then(function (n) { st.needs = n; render(); }).catch(function (e) { st.needs = { error: 'Liste des pièces non lisible : ' + (e && e.message || e) }; render(); });
  }

  // The mission's PDFs for this sheet: a PDF cannot be imported as it is; « Extraire le tableau » makes a checked Excel next to it.
  function pdfBlock(x, d, force) {
    var list = st.pdfs[x.sheet] || []; if (!list.length) return '';
    var ex = st.extract[x.sheet] || {};
    return '<details class="wf-assist-pdfs"' + (ex.open || force ? ' open' : '') + ' data-sheet="' + esc(x.sheet) + '"><summary>Les PDF de la mission (' + list.length + ') — pour remplir ' + esc(x.sheet) + ' avec un PDF</summary>' +
      '<p class="meta">Un PDF ne s’importe pas tel quel : je lis le tableau du PDF, je le recopie dans les colonnes de ' + esc(x.sheet) + ' et je vérifie que chaque montant se retrouve dans le PDF. Le résultat est un fichier Excel rangé à côté du PDF, que vous pouvez ouvrir avant d’importer ; les lignes douteuses n’y sont pas importées.</p>' +
      '<ul class="wf-agent-list">' + list.map(function (f) {
        var r = ex[f.file_id];
        return '<li>' + esc(f.name) + (f.read_as ? ' <span class="meta">— ' + esc(f.read_as) + '</span>' : '') + (f.chosen ? ' <b>✓ choisi par vous</b>' : '') +
          (r && r.busy ? ' <span class="wf-assist-busy">je lis le PDF et je vérifie les montants…</span>' :
           r && r.error ? ' <span class="wf-assist-err">' + esc(r.error) + '</span>' :
           r && r.done ? ' — <b>' + fmt(r.done.rows) + ' ligne(s) vérifiée(s)</b>' + (r.done.to_check ? ', ' + fmt(r.done.to_check) + ' à vérifier (feuille A_VERIFIER)' : '') + ' → ' + (r.done.url ? '<a href="' + esc(r.done.url) + '" target="_blank" rel="noopener">' + esc(r.done.name) + '</a>' : esc(r.done.name)) + (r.done.fits === false ? ' <span class="wf-assist-warn">L’IA doute que ce document remplisse ' + esc(x.sheet) + (r.done.why ? ' : ' + esc(r.done.why) : '') + '</span>' : '') :
           (d.editable ? ' <button type="button" class="btn ghost" data-a="pdf-extract" data-sheet="' + esc(x.sheet) + '" data-file="' + esc(f.file_id) + '">Extraire le tableau pour ' + esc(x.sheet) + '</button>' : '')) + '</li>';
      }).join('') + '</ul></details>';
  }
  function chooseBtn(x, it, d) {
    if (!d.editable) return '';
    return it.chosen ? ' <b>✓ choisi par vous</b> <button type="button" class="link" data-a="unchoose" data-sheet="' + esc(x.sheet) + '" data-file="' + esc(it.file_id) + '">retirer ce choix</button>'
      : ' <button type="button" class="link" data-a="choose" data-sheet="' + esc(x.sheet) + '" data-file="' + esc(it.file_id) + '">c’est cette pièce qui remplit ' + esc(x.sheet) + '</button>';
  }
  function imports(d) {
    var list = (d.data_sheets || []).filter(function (x) { return st.asked[x.sheet]; }); if (!list.length) return '';
    return '<div class="wf-assist-block"><h3>Recherche pièce par pièce</h3>' + list.map(function (x) {
      var p = st.imports[x.sheet], what = KIND[x.kind] || 'la pièce';
      if (!p) { var sc = st.scan[x.sheet] || {}; return '<p class="wf-assist-busy">' + esc(x.sheet) + ' : l’application ouvre les pièces Excel / CSV une par une pour trouver ' + esc(what) + ' (par leurs colonnes et leurs dates, pas par leur nom)' +
        (sc.total ? ' — ' + sc.done + ' / ' + sc.total + (sc.found ? ', ' + sc.found + ' trouvée(s)' : '') : '') + '…</p>' + (sc.current ? '<p class="meta">' + esc(sc.current) + '</p>' : ''); }
      if (p.error) return '<p class="wf-assist-err">' + esc(x.sheet) + ' : ' + esc(p.error) + '</p>';
      if (p.status === 'NO_SOURCE_FOUND') return '<p>' + esc(x.sheet) + ' : je n’ai trouvé ' + esc(what) + ' dans aucune pièce Excel ou CSV de la mission' + (p.ai === 'unavailable' ? ' (l’IA n’a pas répondu : je n’ai regardé que les colonnes reconnues par le code)' : '') + '. Si la pièce est un PDF, extrayez son tableau ci-dessous ; sinon déposez-la, ou je prépare la demande au client.</p>' + pdfBlock(x, d);
      if (p.status !== 'READY') return '<p>' + esc(x.sheet) + ' : ' + esc(p.status) + '</p>';
      var picked = p.items.filter(function (it, i) { return st.pick[x.sheet + '|' + i]; });
      var total = picked.reduce(function (n, it) { return n + (it.rows || 0); }, 0), tooBig = x.capacity && total > x.capacity;
      var yrs = (p.mission_years || []).join(', ');
      // Nothing in Excel really fills the sheet (Paul, 2026-10-25: « il choisit la même pièce » — a PTBA filling 0 % of D2): the PDFs come first.
      var noneFits = !p.items.some(function (it) { return it.recommended; });
      if (noneFits && (st.pdfs[x.sheet] || []).length) return '<div class="wf-assist-prop"><p>Aucune pièce Excel ne remplit vraiment <b>' + esc(x.sheet) + '</b> (' + esc(p.items.map(function (it) { return it.name + ' : ' + (it.coverage || 0) + ' % des colonnes'; }).join(' ; ')) + '). La bonne pièce est sans doute un PDF : choisissez-le, j’extrais et je vérifie son tableau.</p>' + pdfBlock(x, d, true) +
        '<details><summary>Voir quand même les pièces Excel</summary>' + p.items.map(function (it) { return '<p class="meta">' + esc(it.name) + chooseBtn(x, it, d) + '</p>'; }).join('') + '</details></div>';
      return '<div class="wf-assist-prop"><p>Pour <b>' + esc(x.sheet) + '</b>, j’ai trouvé ' + p.items.length + ' pièce(s) qui ressemblent à ' + esc(what) + (yrs ? ' ; la mission porte sur <b>' + esc(yrs) + '</b>' : '') + '. Cochez celles à importer :</p>' +
        p.items.map(function (it, i) {
          var key = x.sheet + '|' + i, g = it.gl_summary, ys = Object.keys(it.years || {});
          return '<div class="wf-assist-src"><label><input type="checkbox" data-pick="' + esc(key) + '"' + (st.pick[key] ? ' checked' : '') + (it.error || !it.mapping.length ? ' disabled' : '') + '> <b>' + esc(it.name) + '</b>' + (it.sheet ? ' — feuille « ' + esc(it.sheet) + ' »' : '') + '</label>' + chooseBtn(x, it, d) +
            '<p class="meta">' + (ys.length ? 'Années : <b>' + esc(ys.join(', ')) + '</b>' : 'Années non lues') + (it.in_mission_period === false ? ' (hors période de la mission)' : '') + ' · ' + fmt(it.rows) + ' ligne(s)' +
            (g ? ' · débit ' + fmt(g.debit) + ', crédit ' + fmt(g.credit) + (g.difference ? ', <b>écart ' + fmt(g.difference) + '</b>' : ', équilibré') : '') +
            (it.set_aside && it.set_aside.count ? ' · ' + it.set_aside.count + ' ligne(s) de total mises de côté' : '') + '</p>' +
            (it.check ? '<p class="' + (it.check.ok ? 'meta' : 'wf-assist-err') + '">' + (it.check.ok ? 'Vérifié par l’IA : correct' : 'L’IA signale un problème') + (it.check.remarks ? ' — ' + esc(it.check.remarks) : '') + '</p>' : '') +
            (it.understood ? '<p class="meta">Selon l’IA : ' + esc(it.understood.what) + (it.understood.period ? ' (' + esc(it.understood.period) + ')' : '') + (it.understood.why ? ' — ' + esc(it.understood.why) : '') + '</p>' : '') +
            (it.coverage != null && it.coverage < 40 ? '<p class="wf-assist-err">Cette pièce ne remplit que ' + it.coverage + ' % des colonnes de la feuille : probablement pas le bon genre de document.</p>' : '') +
            (it.same_period_as ? '<p class="meta">Même période que « ' + esc(it.same_period_as) + ' » : décochée pour ne pas importer deux fois.</p>' : '') +
            (it.error ? '<p class="wf-assist-err">Lecture impossible : ' + esc(ERR[it.error] || it.error) + '</p>' :
            '<details' + (it.recommended ? ' open' : '') + '><summary>Colonnes : ' + it.mapping.length + ' rattachée(s)' + (it.unmatched.length ? ', ' + it.unmatched.length + ' laissée(s) vide(s)' : '') + '</summary><ul class="wf-agent-list">' +
              it.mapping.map(function (m) { return '<li>' + esc(m.label) + ' ← « ' + esc(m.source_label) + ' »' + (m.by === 'ia' ? ' <em>selon l’IA' + (m.why ? ' : ' + esc(m.why) : '') + '</em>' : m.why ? ' <span class="meta">' + (m.to_confirm ? '<b>à confirmer</b> — ' : '') + esc(m.why) + '</span>' : '') + '</li>'; }).join('') + '</ul>' +
              (it.unmatched.length ? '<p class="meta">Laissées vides : ' + esc(it.unmatched.join(', ')) + '.</p>' : '') + '</details>') + '</div>';
        }).join('') +
        (p.ai === 'unavailable' ? '<p class="meta">L’IA n’a pas répondu : seules les colonnes reconnues par le code sont rattachées.</p>' : '') +
        (tooBig ? '<p class="wf-assist-warn">Le tableau de ' + esc(x.sheet) + ' a ' + fmt(x.capacity) + ' lignes ; les pièces cochées en ont ' + fmt(total) + '. Je peux d’abord l’agrandir de ' + fmt(total - x.capacity) + ' lignes, comme dans Excel : mêmes formats, listes et formules recopiées, et les totaux des autres feuilles prolongés. Je n’importe jamais une partie seulement.</p>' : '') +
        (p.run_error ? '<p class="wf-assist-err">Import arrêté : ' + esc(p.run_error) + '</p>' : '') +
        pdfBlock(x, d) +
        (d.editable ? '<div class="row"><button type="button" class="btn" data-a="import" data-sheet="' + esc(x.sheet) + '"' + (tooBig ? ' data-extend="1"' : '') + (!picked.length ? ' disabled' : '') + '>' + (tooBig ? 'Oui, agrandis le tableau et importe ' : 'Oui, importe ') + (picked.length > 1 ? 'les ' + picked.length + ' pièces cochées (à la suite)' : 'la pièce cochée') + '</button><button type="button" class="btn ghost" data-a="import-detail" data-sheet="' + esc(x.sheet) + '">Choisir les colonnes moi-même</button></div>' : '') + '</div>';
    }).join('') + '</div>';
  }

  // (Paul, 2026-10-25 : « peu importe la mission et les pièces, l'agent doit comprendre, analyser et remplir ») Each data sheet: what the
  // tests do with each column (read in the formulas), which document of the mission holds it and under which heading, what is missing.
  // The person changes any column (document, heading, or empty); the plan is rebuilt by the server; nothing is written before « Oui, remplis ».
  st.plans = {}; st.planEdit = {};
  var PST = { sure: '', to_confirm: '<b>à confirmer</b> — ', missing: '', heading_to_choose: '<b>choisir la colonne</b> — ', needs_extraction: '', unreadable: '' };
  // (Paul, 2026-10-25 : « je ne veux pas d'autre panneaux ; l'IA sert à comprendre le working file et à le remplir ») The agent's work is
  // shown IN the sheet (dotted cells, each with its source). Here: what it did in two lines, what is missing, « Oui, remplis », and a
  // sentence box to tell it what is wrong — the AI redoes the work from the person's words.
  function planBlock(x, d) {
    var P = st.plans[x.sheet];
    if (!P) return '<p class="wf-assist-busy"><b>' + esc(x.sheet) + '</b> : je lis les pièces de la mission et je prépare la feuille…</p>';
    if (P.error) return '<p class="wf-assist-err"><b>' + esc(x.sheet) + '</b> : ' + esc(P.error) + ' <button type="button" class="link" data-a="plan-redo" data-sheet="' + esc(x.sheet) + '">réessayer</button></p>';
    var pv = P.preview || {}, got = P.plan.filter(function (p) { return p.document_id && p.heading; }), miss = P.plan.filter(function (p) { return !p.document_id; });
    var doubt = P.plan.filter(function (p) { return p.document_id && p.status !== 'sure'; });
    var docs = []; got.forEach(function (p) { if (docs.indexOf(p.document) < 0) docs.push(p.document); });
    var tooBig = pv.capacity && pv.rows > pv.capacity;
    var html = '<div class="wf-assist-prop"><p><b>' + esc(x.sheet) + '</b> — ' + (got.length && pv.rows ? 'j’ai préparé <b>' + fmt(pv.rows) + ' ligne(s)</b>, en pointillés dans la feuille à droite, depuis ' + esc(docs.join(', ')) + ' : ' + esc(got.map(function (p) { return p.header + ' ← « ' + p.heading + ' »'; }).join(' ; ')) + '.' : 'je n’ai trouvé aucune pièce de la mission qui contienne ces colonnes.') + '</p>' +
      (miss.length ? '<p class="meta">Pas dans les pièces : ' + esc(miss.map(function (p) { return p.header + (p.missing ? ' (il faut : ' + p.missing + ')' : ''); }).join(' ; ')) + '.</p>' : '') +
      (doubt.length ? '<p class="wf-assist-warn">À vérifier : ' + esc(doubt.map(function (p) { return p.header + ' — ' + (p.why || ''); }).join(' ; ')) + '</p>' : '') +
      (Object.keys(pv.unmatched || {}).length ? '<p class="meta">Lignes sans correspondance laissées vides : ' + esc(Object.keys(pv.unmatched).map(function (k) { return k + ' (' + pv.unmatched[k].length + ')'; }).join(', ')) + '.</p>' : '') +
      (P.run_error ? '<p class="wf-assist-err">' + esc(P.run_error) + '</p>' : '') +
      '<details><summary>Pourquoi, colonne par colonne</summary><ul class="wf-agent-list">' + P.plan.map(function (p) { return '<li><b>' + esc(p.header) + '</b> : ' + (p.document_id ? '« ' + esc(p.heading || '?') + ' » de ' + esc(p.document) : 'vide') + (p.why ? ' — <span class="meta">' + esc(p.why) + '</span>' : '') + '</li>'; }).join('') + '</ul></details>';
    if (d.editable) html += '<div class="row">' + (got.length && pv.rows ? '<button type="button" class="btn" data-a="plan-fill" data-sheet="' + esc(x.sheet) + '"' + (tooBig ? ' data-extend="1"' : '') + '>Oui, remplis ' + esc(x.sheet) + (tooBig ? ' (tableau agrandi à ' + fmt(pv.rows) + ' lignes)' : '') + '</button>' : '') + '</div>' +
      '<div class="row"><input type="text" class="wf-plan-hint" data-sheet="' + esc(x.sheet) + '" placeholder="Pas juste ? Dites-le : « le budget est dans le TEB 2024 »…" aria-label="Dire à l’agent ce qui ne va pas pour ' + esc(x.sheet) + '" style="flex:1;min-width:12em"><button type="button" class="btn ghost" data-a="plan-hint" data-sheet="' + esc(x.sheet) + '">Refaire</button></div>';
    return html + '</div>';
  }
  function publishPlans() {
    var cells = []; Object.keys(st.plans).forEach(function (k) { var P = st.plans[k]; if (P && P.cells) cells = cells.concat(P.cells); });
    try { document.dispatchEvent(new CustomEvent('wf-proposals', { detail: { channel: 'plan', cells: cells } })); } catch (_) {}
  }
  function plans(d) {
    var list = d.data_sheets || []; if (!list.length) return '';
    return '<div class="wf-assist-block"><h3>Ce que je remplis pour vous</h3>' + list.map(function (x) { return planBlock(x, d); }).join('') + '</div>';
  }
  function plan(sheet, columns, extract) {
    st.plans[sheet] = null; render();
    return api('workfile-sheet-plan', Object.assign({ sheet: sheet }, columns ? { columns: columns } : {}, extract ? { extract: extract } : {}, st.hints && st.hints[sheet] ? { hint: st.hints[sheet] } : {})).then(function (P) {
      st.plans[sheet] = P; render(); publishPlans();
      // A PDF the AI chose and not yet turned into a table: the agent does it itself, then prepares again.
      var pdf = (P.plan || []).filter(function (p) { return p.status === 'needs_extraction' && p.pdf; })[0];
      if (pdf && !(st.extracted || {})[pdf.pdf]) { st.extracted = st.extracted || {}; st.extracted[pdf.pdf] = true; return plan(sheet, null, pdf.pdf); }
    })
      .catch(function (e) { var m = String(e && e.message || e); st.plans[sheet] = { error: 'analyse impossible — ' + (ERR[m] || m) }; render(); });
  }
  function currentColumns(sheet) {
    var P = st.plans[sheet]; if (!P || !P.plan) return null;
    return P.plan.map(function (p) { return { col: p.col, document_id: p.document_id || null, heading: p.heading || null }; });
  }
  var ERR = { SAME_SOURCE_ON_BOTH_SIDES: 'la même colonne d’une pièce ne peut pas remplir une colonne recalculée et celle à laquelle elle est comparée', SOURCE_HEADING_NOT_FOUND: 'une colonne choisie n’existe pas dans la pièce', SOURCE_TABLE_UNREADABLE: 'une pièce choisie n’est pas lisible comme tableau (un PDF doit d’abord être extrait : « Refaire l’analyse »)', HUMAN_CONFIRMATION_REQUIRED: 'une écriture précédente attend votre confirmation (voir le travail de l’agent)', DOCUMENT_INVENTORY_UNAVAILABLE: 'la liste des pièces de la mission n’est pas lisible pour l’instant', IN_REVIEW_OR_NOT_EDITABLE: 'le test est en revue ou vous n’en êtes pas le préparateur', TABLE_CAPACITY_OR_OCCUPIED_CELL: 'des cases du tableau sont déjà remplies', TABLE_TOO_SMALL: 'le tableau du modèle est trop petit', ROWS_BELOW_TABLE_NOT_EMPTY: 'il y a déjà quelque chose sous le tableau : je ne l’agrandis pas par-dessus', SOURCE_TYPE_MISMATCH: 'la pièce ne ressemble pas au contenu attendu par cette feuille', WORK_CHANGED_PREPARE_AGAIN: 'le fichier ou la pièce a changé, je refais la proposition' };
  // (2026-10-25, Paul : « l'application peut importer sans que ce soit l'IA ; l'IA vérifie que c'est bon ») The CODE opens the pieces one
  // by one (progress shown, no request too long for 90 pieces), then the AI checks what the code found and fills what it could not.
  st.scan = {}; st.pdfs = {}; st.extract = {};
  function propose(sheet) {
    st.imports[sheet] = null; st.scan[sheet] = { done: 0, total: 0, found: 0, current: '' }; render();
    var items = [];
    var prefer = []; if (st.needs && st.needs.sheets) { var sh = st.needs.sheets.filter(function (x) { return x.sheet === sheet; })[0]; if (sh) st.needs.items.filter(function (x) { return sh.pieces.indexOf(x.id) >= 0; }).forEach(function (x) { (x.docs || []).forEach(function (doc) { prefer.push(doc.id); }); }); }
    return api('workfile-import-candidates', { sheet: sheet, prefer: prefer }).then(function (c) {
      var files = c.files || []; st.pdfs[sheet] = c.pdfs || []; st.scan[sheet].total = files.length; render();
      var i = 0;
      function next() {
        if (i >= files.length) return null;
        var f = files[i++]; st.scan[sheet].current = f.name; render();
        return api('workfile-import-inspect', { sheet: sheet, file_id: f.file_id, name: f.name, chosen: !!f.chosen }).then(function (r) {
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

  // The pieces just deposited (PIECES_RECUES): how many, how many not read yet; each is read, understood, renamed and filed.
  function pieces(d) {
    var p = d.pieces, list = p.pieces || [];
    var html = '<div class="wf-assist-block"><h3>Pièces déposées à ranger (' + list.length + ')</h3>';
    if (p.error) return html + '<p class="meta">Dossier des pièces non lisible : ' + esc(p.error) + '.</p></div>';
    if (!list.length) return html + '<p class="meta">Aucune pièce en attente dans « Pièces reçues » : tout ce qui a été déposé a été rangé (voir la mémoire de la mission ci-dessous).</p></div>';
    html += '<p>' + list.length + ' pièce(s) dans « Pièces reçues »' + (p.to_read ? ', dont ' + p.to_read + ' pas encore lue(s)' : '') + '. Chaque pièce est lue, comprise, renommée d’après ce qu’elle est et rangée dans le bon dossier de la mission.</p>';
    if (p.reading) html += '<p class="wf-assist-busy">Je lis les pièces, je les identifie, je les renomme et je les range…</p>';
    else if (d.editable) html += '<div class="row"><button type="button" class="btn' + (p.to_read ? '' : ' ghost') + '" data-a="review">' + (p.to_read ? 'Lire, renommer et ranger les ' + p.to_read + ' pièce(s)' : 'Revoir, renommer et ranger les pièces') + '</button></div>';
    return html + '</div>';
  }

  // (2026-10-25, Paul : « une mémoire unique dans la mission, que tous les agents remplissent, pour comprendre ce qui a été rangé »)
  function memory(d) {
    var list = d.memory || []; if (!list.length) return '';
    var q = (st.memQ || '').toLowerCase();
    var shown = list.filter(function (x) { return !q || [x.name, x.title, x.location, x.summary].join(' ').toLowerCase().indexOf(q) >= 0; });
    return '<div class="wf-assist-block"><h3>Mémoire de la mission (' + list.length + ' document(s))</h3><p class="meta">Ce que chaque document est, où il est rangé, et ce que les agents en ont fait — la même mémoire pour tous les agents.</p>' +
      '<input type="search" class="wf-mem-q" placeholder="Chercher : budget, grand livre, convention…" value="' + esc(st.memQ || '') + '" aria-label="Chercher dans la mémoire de la mission">' +
      '<ul class="wf-agent-list wf-mem">' + shown.slice(0, st.memAll ? 200 : 12).map(function (x) {
        var last = (x.history || []).slice(-1)[0];
        return '<li>' + (x.url ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.name) + '</a>' : esc(x.name)) +
          (x.title ? ' — <b>' + esc(x.title) + '</b>' : (x.read ? '' : ' — <span class="meta">pas encore lu</span>')) + (x.period ? ' · ' + esc(x.period) : '') +
          (x.location ? '<br><span class="meta">Rangé dans : ' + esc(x.location) + '</span>' : '') +
          ((x.uses || []).length ? '<br><span class="meta">Utilisé : ' + esc(x.uses.map(function (u) { return u.what + ' ' + (u.where || ''); }).join(' ; ')) + '</span>' : '') +
          (last ? '<br><span class="meta">Dernier : ' + esc(last.what) + (last.agent ? ' (' + esc(last.agent) + ')' : '') + (last.detail ? ' — ' + esc(last.detail) : '') + '</span>' : '') + '</li>';
      }).join('') + '</ul>' + (shown.length > 12 && !st.memAll ? '<button type="button" class="btn ghost" data-a="mem-all">Voir les ' + shown.length + ' documents</button>' : '') + '</div>';
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
    box.innerHTML = '<h2>L’agent</h2>' + howto() + (d ? needs(d) + known(d) + plans(d) + imports(d) + learning(d) + done(d) + pieces(d) + memory(d) : '<p class="meta">Lecture de ce qu’il sait et des pièces reçues…</p>') +
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
        st.say = 'Pièces lues et identifiées : je prépare l’étape avec elles.'; render(); loadNeeds();
        try { document.dispatchEvent(new CustomEvent('wf-written', { detail: {} })); } catch (_) {}
        // The step of the SOP is prepared again with what was just read (facts proposed in the sheet, permission asked before writing).
        var agent = OM.workingFileAgent; if (agent && agent.prepareCurrent && !(agent.state && agent.state.busy)) agent.prepareCurrent();
      }
      // The pieces the working file needs are looked up first: the data sheets' proposals then start from them.
      // One sheet after the other (each analysis asks the AI once).
      var startImports = function () { (d.data_sheets || []).filter(function (x) { return !(x.sheet in st.plans); }).reduce(function (chain, x) { st.plans[x.sheet] = null; return chain.then(function () { return plan(x.sheet); }); }, Promise.resolve()); };
      if (!st.needsAsked) loadNeeds().then(startImports, startImports); else startImports();
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

  box.addEventListener('keydown', function (ev) { var t = ev.target; if (ev.key === 'Enter' && t && t.classList && t.classList.contains('wf-plan-hint')) { ev.preventDefault(); var bt = box.querySelector('button[data-a="plan-hint"][data-sheet="' + t.dataset.sheet + '"]'); if (bt) bt.click(); } });
  box.addEventListener('toggle', function (ev) { if (ev.target && ev.target.classList && ev.target.classList.contains('wf-howto')) st.howtoOpen = ev.target.open; }, true);
  box.addEventListener('input', function (ev) { var t = ev.target; if (t && t.classList && t.classList.contains('wf-mem-q')) { st.memQ = t.value; var pos = t.selectionStart; render(); var n = box.querySelector('.wf-mem-q'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) {} } return; } if (t && t.classList && t.classList.contains('wf-learn-note')) { st.notes = st.notes || {}; st.notes[t.dataset.sheet] = t.value; } });
  box.addEventListener('change', function (ev) {
    var c = ev.target; if (c && c.dataset && c.dataset.pick) { st.pick[c.dataset.pick] = c.checked; render(); return; }
  });
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
    if (b.dataset.a === 'need-yes' || b.dataset.a === 'need-no') {
      b.disabled = true;
      api('workfile-need-link', { pbc: b.dataset.pbc, file_id: b.dataset.file, decision: b.dataset.a === 'need-yes' ? 'yes' : 'no' }).then(function () { st.say = b.dataset.a === 'need-yes' ? 'Noté dans la mémoire de la mission : ' + b.dataset.pbc + ' trouvée.' : 'Écarté : je ne le proposerai plus pour ' + b.dataset.pbc + '.'; return loadNeeds(); })
        .catch(function (e) { st.say = 'Impossible : ' + (e && e.message || e); render(); });
    }
    if (b.dataset.a === 'need-ask') { var nc = document.getElementById('needs-card'); if (nc) nc.scrollIntoView({ behavior: 'smooth' }); }
    if (b.dataset.a === 'mem-all') { st.memAll = true; render(); }
    if (b.dataset.a === 'choose' || b.dataset.a === 'unchoose') {
      var csh = b.dataset.sheet; b.disabled = true;
      api('workfile-designate', { sheet: csh, file_id: b.dataset.file, remove: b.dataset.a === 'unchoose' }).then(function (r) {
        st.say = r.chosen ? 'Noté dans la mémoire de la mission : « ' + r.name + ' » remplit ' + csh + '. Je ne propose plus que ce que vous avez choisi.' : 'Choix retiré pour ' + csh + '.';
        loadNeeds(); return propose(csh);
      }).catch(function (e) { st.say = 'Impossible : ' + (e && e.message || e); render(); });
    }
    if (b.dataset.a === 'pdf-extract') {
      var esh = b.dataset.sheet, fid = b.dataset.file; st.extract[esh] = st.extract[esh] || {}; st.extract[esh].open = true; st.extract[esh][fid] = { busy: true }; render();
      api('workfile-pdf-extract', { sheet: esh, file_id: fid }).then(function (r) {
        st.extract[esh][fid] = { done: r };
        st.say = r.reused ? 'Ce PDF a déjà été transformé : ' + r.name + '.' : 'Tableau extrait du PDF : ' + r.rows + ' ligne(s) vérifiée(s)' + (r.to_check ? ', ' + r.to_check + ' à vérifier' : '') + '. Je le propose maintenant pour ' + esh + '.';
        loadNeeds(); return propose(esh);
      }).catch(function (e) { var m = String(e && e.message || e); st.extract[esh][fid] = { error: ({ NOT_A_PDF: 'ce n’est pas un PDF', PDF_UNREADABLE: 'je n’arrive pas à lire ce PDF', NO_TABLE_IN_PDF: 'je n’ai trouvé aucun tableau dans ce PDF', AI_UNAVAILABLE_FOR_PDF: 'l’IA n’a pas répondu : réessayez', READER_TOO_LARGE: 'PDF trop lourd (100 Mo maximum)' })[m] || ERR[m] || m }; render(); });
    }
    if (b.dataset.a === 'learn-start') { b.disabled = true; api('workfile-learn-start').then(function (r) { st.learned = null; st.say = 'Je regarde. Remplissez dans Excel, enregistrez, puis « J’ai fini — apprends ».'; if (r.url) window.open(r.url, '_blank', 'noopener'); return refresh(); }).catch(function (e) { st.say = 'Impossible : ' + (e && e.message || e); render(); }); }
    if (b.dataset.a === 'learn-cancel') { api('workfile-learn-cancel').then(refresh); }
    if (b.dataset.a === 'learn') {
      b.disabled = true; st.say = 'Je compare avant / après et je cherche d’où viennent les valeurs…'; render();
      api('workfile-learn').then(function (r) {
        st.learned = r.learned || []; st.learnTemplate = r.template;
        st.say = r.nothing_changed ? r.note : (st.learned.length + ' feuille(s) comprise(s) : vérifiez ce que j’ai compris.');
        return refresh();
      }).catch(function (e) { st.say = 'Apprentissage impossible : ' + (e && e.message || e); render(); });
    }
    if (b.dataset.a === 'lesson-ok' || b.dataset.a === 'lesson-no') {
      var note = box.querySelector('.wf-learn-note[data-sheet="' + b.dataset.sheet + '"]');
      api('workfile-learn-confirm', { template: st.learnTemplate || (st.data.learning && st.data.learning.template), sheet: b.dataset.sheet, decision: b.dataset.a === 'lesson-ok' ? 'validated' : 'rejected', note: note && note.value ? note.value : null }).then(function () {
        st.learned = (st.learned || []).filter(function (x) { return x.sheet !== b.dataset.sheet; });
        st.say = b.dataset.a === 'lesson-ok' ? 'Retenu : je ferai ' + b.dataset.sheet + ' de cette façon pour ce modèle.' : 'Oublié.';
        return refresh();
      }).catch(function (e) { st.say = 'Impossible : ' + (e && e.message || e); render(); });
    }
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
    if (b.dataset.a === 'plan-redo') { plan(b.dataset.sheet); }
    if (b.dataset.a === 'plan-hint') { var hi = box.querySelector('.wf-plan-hint[data-sheet="' + b.dataset.sheet + '"]'); st.hints = st.hints || {}; st.hints[b.dataset.sheet] = hi && hi.value ? hi.value : ''; plan(b.dataset.sheet); }
    if (b.dataset.a === 'old-way') { st.asked[b.dataset.sheet] = true; propose(b.dataset.sheet); }
    if (b.dataset.a === 'plan-fill') {
      var psh = b.dataset.sheet, P = st.plans[psh]; if (!P) return;
      b.disabled = true; P.run_error = null; st.say = 'Je remplis ' + psh + ' colonne par colonne, depuis les pièces retenues…'; render();
      api('workfile-sheet-plan-accept', { sheet: psh, columns: currentColumns(psh), extend: b.dataset.extend === '1' }).then(function (r) {
        st.say = fmt(r.rows) + ' ligne(s) écrites et relues dans ' + psh + ' : ' + (r.filled || []).map(function (f) { return f.col + ' ← « ' + f.heading + ' » (' + f.document + ')'; }).join(' ; ') + ((r.left_empty || []).length ? ' ; laissées vides : ' + r.left_empty.map(function (f) { return f.header; }).join(', ') : '') + '. Chaque case garde sa pièce d’origine.';
        delete st.plans[psh]; publishPlans();
        try { document.dispatchEvent(new CustomEvent('wf-written', { detail: { sheet: psh } })); } catch (_) {}
        return refresh();
      }).catch(function (e) { var m = String(e && e.message || e); P.run_error = (ERR[m] || m) + '. Rien n’a été écrit.'; st.say = ''; render(); });
    }
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
  document.addEventListener('wf-sheet-cleared', function () { st.asked = {}; st.imports = {}; st.plans = {}; refresh(); });
  // The guide re-reads the sheet after a write: the known facts are published again so they stay visible.
  document.addEventListener('wf-written', function () { setTimeout(publish, 1500); });
})();
