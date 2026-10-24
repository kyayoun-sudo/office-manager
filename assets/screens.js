// Small shared helpers for the new screens. DOM is built with textContent only.
(function () {
  var OM = window.OfficeManager;
  var UI = {
    el: function (tag, text, cls) {
      var e = document.createElement(tag);
      if (text != null) e.textContent = text;
      if (cls) e.className = cls;
      return e;
    },
    date: function (iso) {
      if (!iso) return '';
      var d = new Date(iso);
      return isNaN(d) ? String(iso) : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    },
    dateTime: function (iso) {
      if (!iso) return '';
      var d = new Date(iso);
      return isNaN(d) ? String(iso) : d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    },
    dateRange: function (a, b) {
      if (!a && !b) return 'Dates à renseigner';
      return (UI.date(a) || '?') + ' → ' + (UI.date(b) || '?');
    },
    richText: function (box, md) {
      box.textContent = ''; box.classList.add('rich');
      var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
      var i = 0, list = null, para = [];
      function inline(parent, text) {
        var re = /(\*\*|__)(.+?)\1|\+\+(.+?)\+\+|<u>(.+?)<\/u>|(\*|_)([^*_\s][^*_]*?)\5|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
        var last = 0, m;
        while ((m = re.exec(text))) {
          if (m.index > last) parent.appendChild(document.createTextNode(clean(text.slice(last, m.index))));
          if (m[2] != null) { var b = document.createElement('strong'); inline(b, m[2]); parent.appendChild(b); }
          else if (m[3] != null || m[4] != null) { var u = document.createElement('u'); inline(u, m[3] != null ? m[3] : m[4]); parent.appendChild(u); }
          else if (m[6] != null) { var e = document.createElement('em'); inline(e, m[6]); parent.appendChild(e); }
          else if (m[7] != null) parent.appendChild(UI.el('code', m[7]));
          else if (m[8] != null) { var a = UI.el('a', m[8]); a.href = m[9]; a.target = '_blank'; a.rel = 'noopener'; parent.appendChild(a); }
          last = re.lastIndex;
        }
        if (last < text.length) parent.appendChild(document.createTextNode(clean(text.slice(last))));
      }
      function clean(t) { return t.replace(/\*{1,3}/g, ''); }
      function flushPara() { if (!para.length) return; var p = document.createElement('p'); inline(p, para.join(' ')); box.appendChild(p); para = []; }
      function closeList() { list = null; }
      var cells = function (l) { return l.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); };
      while (i < lines.length) {
        var line = lines[i], t = line.trim(), h, li;
        if (!t) { flushPara(); closeList(); i++; continue; }
        if ((h = /^(#{1,4})\s+(.*)$/.exec(t))) { flushPara(); closeList(); var hn = document.createElement('h' + Math.min(6, h[1].length + 2)); inline(hn, h[2].replace(/[#*]+$/, '').trim()); box.appendChild(hn); i++; continue; }
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flushPara(); closeList(); box.appendChild(document.createElement('hr')); i++; continue; }
        if (/^\|.*\|$/.test(t) && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) {
          flushPara(); closeList();
          var wrap = UI.el('div', null, 'rich-table'), table = document.createElement('table'), thead = document.createElement('thead'), tr = document.createElement('tr');
          cells(t).forEach(function (c) { var th = document.createElement('th'); inline(th, c); tr.appendChild(th); });
          thead.appendChild(tr); table.appendChild(thead); var tb = document.createElement('tbody'); i += 2;
          while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { var r = document.createElement('tr'); cells(lines[i]).forEach(function (c) { var td = document.createElement('td'); inline(td, c); r.appendChild(td); }); tb.appendChild(r); i++; }
          table.appendChild(tb); wrap.appendChild(table); box.appendChild(wrap); continue;
        }
        if ((li = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line))) {
          flushPara();
          var ordered = /\d/.test(li[2]);
          if (!list || list.ordered !== ordered) { list = { el: document.createElement(ordered ? 'ol' : 'ul'), ordered: ordered }; box.appendChild(list.el); }
          var item = document.createElement('li'); inline(item, li[3]); list.el.appendChild(item); i++; continue;
        }
        if (/^>\s?/.test(t)) { flushPara(); closeList(); var q = document.createElement('blockquote'); inline(q, t.replace(/^>\s?/, '')); box.appendChild(q); i++; continue; }
        closeList(); para.push(t); i++;
      }
      flushPara();
    },
    poll: function (url, onData, every) {
      var stop = false, timer = null;
      function tick() {
        OM.api(url).then(function (d) {
          if (stop) return; onData(d);
          if (d && d.status === 'running' || d && d.status === 'reading') timer = setTimeout(tick, every || 4000);
        }).catch(function (e) { if (!stop) onData({ status: 'error', error: e.message }); });
      }
      tick();
      return function () { stop = true; clearTimeout(timer); };
    },
    driveIds: function (text) {
      var out = [];
      String(text || '').split(/[\s,;]+/).forEach(function (t) {
        var m = t.match(/\/d\/([-\w]{20,})/) || t.match(/[?&]id=([-\w]{20,})/) || t.match(/^([-\w]{25,})$/);
        if (m && out.indexOf(m[1]) < 0) out.push(m[1]);
      });
      return out;
    },
    table: function (head, rows) {
      var box = UI.el('div', null, 'table-box'), t = document.createElement('table'), tr = document.createElement('tr');
      head.forEach(function (h) { tr.appendChild(UI.el('th', h)); });
      var th = document.createElement('thead'); th.appendChild(tr); t.appendChild(th);
      var tb = document.createElement('tbody');
      rows.forEach(function (r) { var row = document.createElement('tr'); r.forEach(function (c) { var td = document.createElement('td'); if (c && c.nodeType) td.appendChild(c); else td.textContent = c == null || c === '' ? '–' : String(c); row.appendChild(td); }); tb.appendChild(row); });
      t.appendChild(tb); box.appendChild(t); return box;
    },
    plain: function (md) { return String(md || '').replace(/\*\*|__|\+\+|`|^#+\s*/gm, '').replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2').replace(/\*/g, ''); },
    fail: function (box, err) {
      box.textContent = '';
      box.appendChild(UI.el('p', 'Indisponible : ' + (err && err.message ? err.message : 'erreur'), 'empty'));
    },
    safeLink: function (href, text) {
      var a = UI.el('a', text);
      if (/^https:\/\//.test(href || '')) { a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      return a;
    },
    renderSearch: function (box, data) {
      box.textContent = '';
      var labels = { documents: 'Documents', missions: 'Missions', people: 'Personnes' };
      Object.keys(data.results || {}).forEach(function (g) {
        var rows = data.results[g];
        if (!rows.length) return;
        box.appendChild(UI.el('h2', labels[g] + ' · ' + rows.length, 'meta'));
        rows.slice(0, 5).forEach(function (r) {
          var item = UI.el(g === 'missions' ? 'a' : 'div', null, 'item' + (g === 'missions' ? ' link-item' : ''));
          if (g === 'missions') item.href = '/mission.html?id=' + encodeURIComponent(r.id);
          var t = UI.el('div', null, 't');
          if (g === 'documents') {
            t.appendChild(UI.el('span', r.name || 'Sans nom'));
            t.appendChild(UI.el('span', [r.mission, r.type, r.folder_path].filter(Boolean).join(' · '), 'meta'));
            if (r.summary) t.appendChild(UI.el('span', r.summary, 'meta'));
          } else if (g === 'missions') {
            t.appendChild(UI.el('span', r.name || r.mission_code || 'Mission'));
            t.appendChild(UI.el('span', [r.mission_code, r.status].filter(Boolean).join(' · '), 'meta'));
          } else {
            t.appendChild(UI.el('span', r.full_name || 'Personne'));
            t.appendChild(UI.el('span', [r.role_title, r.department].filter(Boolean).join(' · '), 'meta'));
          }
          item.appendChild(t);
          if (g === 'documents' && r.web_url) item.appendChild(UI.safeLink(r.web_url, 'Ouvrir'));
          if (g === 'documents' && r.folder_url) item.appendChild(UI.safeLink(r.folder_url, 'Dossier'));
          box.appendChild(item);
        });
      });
      if (data.query) { var more = UI.el('a', 'Voir tous les résultats et filtrer'); more.href = '/recherche.html?q=' + encodeURIComponent(data.query); box.appendChild(more); }
    },
    assignPicker: function (actionId, onDone) {
      var box = UI.el('div', null, 'assign');
      var sel = document.createElement('select'); sel.setAttribute('aria-label', 'Personne à qui confier cette action');
      sel.appendChild(UI.el('option', 'À qui la confier ?')); sel.firstChild.value = '';
      var b = UI.el('button', 'Confier', 'btn ghost'); b.type = 'button';
      var st = UI.el('span', '', 'meta');
      box.appendChild(sel); box.appendChild(b); box.appendChild(st);
      OM.api('/api/app?route=mission-contacts').then(function (c) { (c.all || []).forEach(function (p) { var o = UI.el('option', p.name + (p.role ? ' — ' + p.role : '')); o.value = p.email; sel.appendChild(o); }); }).catch(function () {});
      b.addEventListener('click', function () {
        if (!sel.value) { st.textContent = 'Choisissez une personne.'; return; }
        b.disabled = true;
        OM.api('/api/app?route=assign-action', { method: 'POST', body: JSON.stringify({ id: actionId, staff_profile_id: sel.value }) })
          .then(function (r) { st.textContent = 'Confiée à ' + r.assigned_to + '.'; if (onDone) onDone(r); })
          .catch(function (e) { b.disabled = false; st.textContent = 'Impossible : ' + e.message; });
      });
      return box;
    },
    requireLogin: function (start) {
      // opportunites.html currently has no #list-view wrapper. Keep the legacy list in place,
      // but repair the parsed DOM: malformed closing tags can leave #detail-view outside <main>.
      // Moving it back into <main> makes the detail replace the list at the same vertical position.
      if (location.pathname === '/opportunites.html' && !document.getElementById('list-view')) {
        var main = document.querySelector('main.main');
        var detail = document.getElementById('detail-view');
        if (main && detail) {
          var listView = document.createElement('div');
          listView.id = 'list-view';
          listView.hidden = true;
          listView.style.display = 'none';
          if (detail.parentNode === main) main.insertBefore(listView, detail);
          else {
            main.appendChild(listView);
            main.appendChild(detail);
          }

          // On a detail URL, hide the list/create blocks where they already are. Nothing else is
          // moved, so there is no blank layout region above the opened opportunity.
          if (new URLSearchParams(location.search).get('id')) {
            var head = main.querySelector('.page-head');
            var signals = document.getElementById('signals-card');
            var list = document.getElementById('list');
            var listSection = list && list.closest('section');
            if (head) head.hidden = true;
            if (signals) signals.hidden = true;
            if (listSection) listSection.hidden = true;
          }
        }
      }
      var login = document.getElementById('login');
      var btn = document.getElementById('connect');
      if (btn) btn.addEventListener('click', function () {
        OM.setToken(document.getElementById('token').value);
        login.hidden = true;
        start();
      });
      if (!OM.getToken()) { if (login) login.hidden = false; } else { start(); }
    }
  };

  // Planning order (2026-10-23): mission -> analytical review -> work programme.
  // This is injected from the shared screen helper so the existing mission/programme files stay intact.
  function planningOrderEnhancements() {
    var path = location.pathname;
    var params = new URLSearchParams(location.search);
    if (path === '/mission.html') {
      var missionId = params.get('id');
      var programme = document.getElementById('sec-programme');
      if (!missionId || !programme || document.getElementById('sec-analytical-review')) return;
      var review = UI.el('section', null, 'card'); review.id = 'sec-analytical-review'; review.setAttribute('aria-labelledby', 'h-analytical-review');
      var head = UI.el('div', null, 'card-head'), h = UI.el('h2', 'Revue analytique'); h.id = 'h-analytical-review';
      var open = UI.el('a', 'Commencer', 'btn'); open.href = '/revue-analytique.html?mission_id=' + encodeURIComponent(missionId);
      head.appendChild(h); head.appendChild(open); review.appendChild(head);
      review.appendChild(UI.el('p', 'Étape 1 de la planification. Faites la revue directement dans Firm Manager ou déposez votre Excel. Les documents nécessaires peuvent être déposés dans cet espace et ceux déjà présents dans la mission sont réutilisés.', 'meta'));
      programme.parentNode.insertBefore(review, programme);
      var meta = programme.querySelector('.meta');
      if (meta) meta.textContent = 'Étape 2, après la revue analytique : cycles, contrôles, matérialité, responsables et revues. Vous pouvez construire le programme ici ou déposer/importer votre fichier Excel.';
      var pl = document.getElementById('prog-link'); if (pl) pl.textContent = 'Étape 2 · Ouvrir';
      return;
    }
    if (path !== '/programme.html') return;
    var mid = params.get('mission_id') || params.get('mission') || params.get('id');
    var card = document.getElementById('import-card');
    if (!mid || !card || document.getElementById('programme-direct-upload')) return;

    var reviewBar = UI.el('div', null, 'note');
    reviewBar.appendChild(document.createTextNode('Étape précédente : '));
    var reviewLink = UI.el('a', 'Revue analytique'); reviewLink.href = '/revue-analytique.html?mission_id=' + encodeURIComponent(mid); reviewBar.appendChild(reviewLink);
    card.insertBefore(reviewBar, card.firstChild.nextSibling || card.firstChild);

    var direct = UI.el('div', null, 'field'); direct.id = 'programme-direct-upload';
    direct.appendChild(UI.el('label', 'Déposer directement un programme de travail (Excel, Word ou PDF)'));
    var row = UI.el('div', null, 'row'), input = document.createElement('input'); input.type = 'file'; input.accept = '.xlsx,.xls,.xlsm,.csv,.doc,.docx,.pdf'; input.setAttribute('aria-label', 'Fichier du programme de travail');
    var button = UI.el('button', 'Déposer et importer', 'btn ghost'); button.type = 'button'; var status = UI.el('span', '', 'status');
    row.appendChild(input); row.appendChild(button); direct.appendChild(row); direct.appendChild(status);
    var found = document.getElementById('found-progs'); card.insertBefore(direct, found ? found.nextSibling : card.children[2] || null);

    function readB64(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1] || ''); }; r.onerror = rej; r.readAsDataURL(file); }); }
    function upload(file) {
      var name = 'PROGRAMME_DE_TRAVAIL_' + file.name.replace(/^PROGRAMME[_\s-]*DE[_\s-]*TRAVAIL[_\s-]*/i, '');
      var mime = file.type || 'application/octet-stream';
      if (file.size <= 3 * 1024 * 1024) return readB64(file).then(function (data) {
        return OM.api('/api/app?route=mission-quick', { method: 'POST', body: JSON.stringify({ action: 'piece', mission_id: mid, name: name, mime: mime, base64: data }) });
      });
      return OM.api('/api/app?route=mission-quick', { method: 'POST', body: JSON.stringify({ action: 'piece-start', mission_id: mid, name: name, mime: mime, size: file.size }) })
        .then(function (s) { return fetch(s.upload_url, { method: 'PUT', body: file }).then(function (r) { if (!r.ok) throw new Error('Envoi vers Google refusé (' + r.status + ')'); return r.json(); }).then(function (g) { return { file_id: g.id, name: g.name || s.name }; }); });
    }
    button.addEventListener('click', function () {
      var file = input.files && input.files[0]; if (!file) { status.textContent = 'Choisissez un fichier.'; return; }
      button.disabled = true; status.textContent = 'Dépôt dans la mission…';
      upload(file).then(function (r) {
        return OM.api('/api/app?route=mission-quick', { method: 'POST', body: JSON.stringify({ action: 'pieces-done', mission_id: mid, note: 'Programme de travail déposé directement depuis l’étape Programme. Le reconnaître comme programme de travail et le conserver comme source de planification.', files: [{ id: r.file_id }] }) }).then(function () { return r; });
      }).then(function (r) {
        var link = document.getElementById('imp-file'); if (link) link.value = 'https://drive.google.com/file/d/' + r.file_id;
        status.textContent = 'Programme déposé. Lecture des procédures…';
        var imp = document.getElementById('imp'); if (imp) imp.click();
      }).catch(function (e) { status.textContent = 'Impossible : ' + e.message; }).then(function () { button.disabled = false; });
    });

    // Reuse an imported analytical review as a planning source when it is already attached to the mission.
    OM.api('/api/app?route=mission-view&mission_id=' + encodeURIComponent(mid)).then(function (d) {
      var src = document.getElementById('planning-sources'); if (!src) return;
      var reviews = (d.documents || []).filter(function (x) { return /REVUE[_\s-]*ANALYTIQUE|analytical\s*review/i.test([x.name, x.document_type].filter(Boolean).join(' ')); });
      var urls = reviews.map(function (x) { return x.web_url; }).filter(Boolean).slice(0, 2);
      if (urls.length && !src.value.trim()) src.value = urls.join('\n');
    }).catch(function () {});
  }

  window.OMScreens = UI;
  setTimeout(planningOrderEnhancements, 0);
})();