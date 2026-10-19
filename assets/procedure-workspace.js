(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var view, book, cell = null, history = [], sequence = 0;
  function node(tag, value) { var n = document.createElement(tag); if (value != null) n.textContent = value; return n; }
  function post(body) {
    return window.OfficeManager.api('/api/app?route=procedure', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ mission_id: view.mission_id, code: view.line.code }, body)) });
  }
  function error(e) {
    return ({ AGENTS_NOT_AUTHORIZED: 'L’utilisation des agents doit être autorisée dans les paramètres du cabinet.',
      NO_WORKPAPER_FOR_CYCLE: 'Le fichier de travail de ce cycle n’est pas encore préparé.',
      PROCEDURE_SHEET_NOT_FOUND: 'La feuille de cette procédure est introuvable dans le fichier.',
      WORKBOOK_TOO_LARGE: 'Ce classeur dépasse la taille prise en charge par cette vue.' })[e.message] || e.message || 'Service indisponible.';
  }
  function bubble(role, value) {
    var p = node('div', (role === 'user' ? 'Vous\n' : 'Enhanced Auditor\n') + value);
    p.className = 'audit-bubble ' + role; $('audit-conversation').appendChild(p);
    p.scrollIntoView({ block: 'nearest' });
  }
  function brief(r) {
    var host = $('audit-brief'); host.textContent = ''; host.hidden = false;
    var b = r.brief || {}, u = r.understanding || {};
    function section(title, lines) {
      host.appendChild(node('h3', title));
      (lines.length ? lines : ['Aucun élément documenté à ce stade.']).forEach(function (s) { host.appendChild(node('p', s)); });
    }
    if (u.sop) section('Ce que le SOP demande', [u.sop]);
    if (u.workfile) section('Ce que le work file demande', [u.workfile]);
    if ((u.evidence || []).length) section('Pièces / informations nécessaires', u.evidence);
    section('Ce que j’ai reçu', (b.population ? ['Population : ' + b.population] : []).concat((b.received || []).map(function (e) { return e.sample_id + ' : ' + (e.name || e.file_id); })));
    section('Ce que j’ai vu', (b.observed || []).map(function (o) { return o.sample_id + ' : ' + o.observation; }));
    if (r.assessment) section('Mon avis provisoire', [r.assessment]);
    var names = { 'prepare-observations': 'Préparer les observations', 'add-note': 'Ajouter votre précision', 'write-workpaper': 'Écrire dans Excel', 'draw-sample': 'Tirer l’échantillon' };
    section('Ce que j’ai fait', (r.outcomes || []).map(function (o) {
      var label = names[o.action] || o.action;
      return label + (o.sample_id ? ' · ' + o.sample_id : '') + ' : ' +
        ({ done: 'réalisé', unchanged: 'travail existant conservé', blocked: 'non réalisé — ' + o.reason, 'needs-review': 'écriture à vérifier' }[o.status] || o.status) +
        (o.cells != null ? ' · ' + o.cells + ' cellule(s) traitée(s)' : '') +
        ((o.conflicts || []).length ? ' · conflits : ' + o.conflicts.join(', ') : '');
    }));
    section('Pour avancer', (b.missing || []).concat((b.observed || []).flatMap(function (o) { return (o.missing || []).map(function (s) { return o.sample_id + ' : ' + s; }); })).concat(r.next ? [r.next] : []));
  }
  function column(n) { var s = ''; for (; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
  function render(data) {
    book = data; cell = null; $('audit-selection').textContent = 'Sélectionnez une cellule pour en parler avec l’agent.';
    var select = $('audit-sheet'); select.textContent = '';
    data.sheets.forEach(function (s) { var o = node('option', s); o.value = s; select.appendChild(o); }); select.value = data.sheet;
    var grid = $('audit-grid'); grid.textContent = '';
    var table = node('table'), head = node('thead'), line = node('tr'); line.appendChild(node('th', ''));
    for (var c = 1; c <= data.columns; c++) line.appendChild(node('th', column(c)));
    head.appendChild(line); table.appendChild(head); var body = node('tbody');
    data.rows.forEach(function (r) {
      var tr = node('tr'); tr.appendChild(node('th', r.number));
      r.cells.forEach(function (v) {
        var td = node('td'), b = node('button', (v.formula ? 'ƒ ' : '') + v.value);
        b.type = 'button'; b.setAttribute('aria-label', v.address + ' : ' + (v.formula && !v.value ? 'Formule sans résultat enregistré' : v.value || 'vide'));
        if (v.input) td.className = 'input';
        b.addEventListener('click', function () {
          grid.querySelectorAll('.selected').forEach(function (n) { n.classList.remove('selected'); }); td.classList.add('selected');
          cell = v.address; $('audit-selection').textContent = data.sheet + ' ! ' + cell + ' — ' + (v.value || (v.formula ? 'Formule sans résultat enregistré' : 'vide'));
        });
        td.appendChild(b); tr.appendChild(td);
      }); body.appendChild(tr);
    }); table.appendChild(body); grid.appendChild(table);
    $('audit-file-status').textContent = data.name + ' · lignes ' + data.start_row + '–' + data.end_row + ' sur ' + data.total_rows +
      (data.modified_at ? ' · version du ' + new Date(data.modified_at).toLocaleString('fr-FR') : '') + (data.columns === 40 ? ' · 40 premières colonnes' : '');
    $('audit-prev').disabled = data.start_row <= 1; $('audit-more').disabled = data.end_row >= data.total_rows;
  }
  function refresh(sheet, start) {
    var request = ++sequence;
    $('audit-file-status').textContent = 'Lecture du fichier enregistré…';
    // An old grid must not be presented as the current file when the reload fails.
    $('audit-grid').textContent = ''; cell = null;
    return post({ action: 'workbook-view', sheet: sheet || view.line.code, start_row: start || 1 })
      .then(function (r) { if (request === sequence) render(r); })
      .catch(function (e) { if (request === sequence) { book = null; $('audit-file-status').textContent = error(e); } });
  }
  $('audit-ask').addEventListener('submit', function (e) {
    e.preventDefault(); if (!view || $('audit-send').disabled) return;
    var message = $('audit-question').value.trim(); if (!message) return;
    bubble('user', message); $('audit-send').disabled = true; $('audit-message').textContent = 'L’agent lit le SOP et le work file avant d’agir…';
    post({ action: 'ask-procedure', message: message, history: history, cell: cell, sheet: book && book.sheet })
      .then(function (r) {
        bubble('assistant', r.answer); history.push({ role: 'user', text: message }, { role: 'assistant', text: r.answer }); history = history.slice(-8);
        if (r.brief || r.understanding) brief(r);
        if (r.work) window.dispatchEvent(new CustomEvent('procedure-assistant-updated', { detail: r }));
        if ((r.outcomes || []).length) refresh(book && book.sheet, book && book.start_row);
        if ($('audit-question').value.trim() === message) $('audit-question').value = '';
        $('audit-message').textContent = '';
      }).catch(function (err) { $('audit-message').textContent = error(err); })
      .then(function () { $('audit-send').disabled = false; });
  });
  $('audit-next').addEventListener('click', function () {
    $('audit-question').value = 'Fais le point sur ce test. Commence par me dire clairement ce que le SOP exige et ce que le work file Excel me demande de documenter. Ensuite dis-moi les informations déjà documentées, celles qui manquent, les questions à poser et la prochaine action utile. Ne modifie rien.';
    $('audit-ask').requestSubmit();
  });
  $('audit-continue').addEventListener('click', function () {
    $('audit-question').value = 'Continue le travail. Avant d’agir, confirme brièvement ce que le SOP exige pour cette étape et ce que le work file demande de renseigner. Puis lis la prochaine pièce disponible, prépare uniquement les observations justifiées et écris-les dans Excel sans toucher aux formules ni aux saisies humaines. Dis-moi ensuite ce que tu as reçu, vu, fait et ce qui manque.';
    $('audit-ask').requestSubmit();
  });
  $('audit-explain').addEventListener('click', function () {
    $('audit-question').value = 'Je ne comprends pas. Explique simplement : 1) l’objectif et l’exigence du SOP pour cette étape, 2) ce que le work file Excel demande de documenter, 3) pourquoi on le fait, 4) ce que tu as constaté et 5) ce que tu me demandes. Ne modifie rien.';
    $('audit-ask').requestSubmit();
  });
  $('audit-write').addEventListener('click', function () { $('wp-write').click(); });
  $('audit-refresh').addEventListener('click', function () { refresh(book && book.sheet, book && book.start_row); });
  $('audit-sheet').addEventListener('change', function () { refresh(this.value, 1); });
  $('audit-prev').addEventListener('click', function () { if (book) refresh(book.sheet, Math.max(1, book.start_row - 100)); });
  $('audit-more').addEventListener('click', function () { if (book) refresh(book.sheet, book.end_row + 1); });
  window.addEventListener('procedure-ready', function (e) {
    view = e.detail; $('procedure-workspace').hidden = false;
    $('audit-context').textContent = view.line.code + ' — ' + view.line.title + ' · préparateur : ' + (view.preparer || 'à affecter');
    $('audit-write').disabled = view.editable === false || ['submitted', 'reviewed'].includes(view.work.status) || !view.workpaper;
    var items = view.work.items || [], card = view.card || {};
    var sopSummary = card.objective ? 'Objectif : ' + card.objective : '';
    if ((card.ask || []).length) sopSummary += (sopSummary ? ' · ' : '') + 'À obtenir : ' + card.ask.slice(0, 4).join(' ; ');
    if ((card.steps || []).length) sopSummary += (sopSummary ? ' · ' : '') + 'Travail prévu : ' + card.steps.slice(0, 3).map(function (s) { return s.text || s; }).join(' ; ');
    brief({ understanding: { sop: sopSummary, workfile: '', evidence: [] }, brief: { population: (view.work.population || {}).file_name,
      received: items.flatMap(function (i) { return (i.evidence || []).map(function (e) { return { sample_id: i.sample_id, name: e.name, file_id: e.file_id }; }); }),
      observed: items.filter(function (i) { return i.comment || i.ai; }).map(function (i) { return { sample_id: i.sample_id, observation: i.comment || i.ai.reason, missing: (i.ai || {}).missing || [] }; }),
      missing: items.filter(function (i) { return !(i.evidence || []).length; }).map(function (i) { return 'Pièce de ' + i.sample_id; }) },
      next: 'L’agent lira le SOP et le work file ensemble avant toute action. Vous pouvez lui demander de poursuivre ou d’expliquer le test.' });
    refresh();
  });
  window.addEventListener('procedure-written', function () { refresh(book && book.sheet, book && book.start_row); });
  window.addEventListener('procedure-updated', function (e) {
    view = e.detail;
    $('audit-write').disabled = view.editable === false || ['submitted', 'reviewed'].includes(view.work.status) || !view.workpaper;
  });
})();