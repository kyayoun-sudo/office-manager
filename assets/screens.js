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
    // Agents' answers, written in Markdown, shown as a formatted document (Paul, 2026-10-07: « les
    // réponses ne sont pas belles… gras, souligné, mais pas ces étoiles partout »): titles,
    // paragraphs, bold, underline, italics, lists, tables, links. Built element by element (no HTML
    // is injected); stray asterisks are removed.
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
    // Follows a background job (engagement preparation, review…) until it is done or failed.
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
    // Drive file ids from pasted links or ids (one per line, or separated by spaces).
    driveIds: function (text) {
      var out = [];
      String(text || '').split(/[\s,;]+/).forEach(function (t) {
        var m = t.match(/\/d\/([-\w]{20,})/) || t.match(/[?&]id=([-\w]{20,})/) || t.match(/^([-\w]{25,})$/);
        if (m && out.indexOf(m[1]) < 0) out.push(m[1]);
      });
      return out;
    },
    // A small table from rows of cells (strings or elements).
    table: function (head, rows) {
      var box = UI.el('div', null, 'table-box'), t = document.createElement('table'), tr = document.createElement('tr');
      head.forEach(function (h) { tr.appendChild(UI.el('th', h)); });
      var th = document.createElement('thead'); th.appendChild(tr); t.appendChild(th);
      var tb = document.createElement('tbody');
      rows.forEach(function (r) { var row = document.createElement('tr'); r.forEach(function (c) { var td = document.createElement('td'); if (c && c.nodeType) td.appendChild(c); else td.textContent = c == null || c === '' ? '–' : String(c); row.appendChild(td); }); tb.appendChild(row); });
      t.appendChild(tb); box.appendChild(t); return box;
    },
    // One line of text without Markdown signs (lists, previews).
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
            t.appendChild(UI.el('span', r.folder_path || '', 'meta'));
          } else if (g === 'missions') {
            t.appendChild(UI.el('span', r.name || r.mission_code || 'Mission'));
            t.appendChild(UI.el('span', [r.mission_code, r.status].filter(Boolean).join(' · '), 'meta'));
          } else {
            t.appendChild(UI.el('span', r.full_name || 'Personne'));
            t.appendChild(UI.el('span', [r.role_title, r.department].filter(Boolean).join(' · '), 'meta'));
          }
          item.appendChild(t);
          if (g === 'documents' && r.web_url) item.appendChild(UI.safeLink(r.web_url, 'Ouvrir'));
          box.appendChild(item);
        });
      });
    },
    // Shows the login card when no token is stored, then calls start().
    requireLogin: function (start) {
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
  window.OMScreens = UI;
})();
