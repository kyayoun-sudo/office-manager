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
