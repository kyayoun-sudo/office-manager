// Shared loader for the application pages: session, firm branding, logout.
//
// Session: after login (login.html, e-mail + password), the browser keeps the
// session in localStorage until "Se déconnecter". Each page re-checks it with the
// refresh token (/api/app?route=session); a deactivated account is logged out.
// The pilot token received at login is still sent as x-office-manager-token, so
// the existing endpoints work unchanged.
(function () {
  var SESSION_KEY = 'officeManagerSession';
  var LEGACY_TOKEN_KEY = 'officeManagerToken'; // same key as index.html (sessionStorage)
  var USER_KEY = 'officeManagerUserName';
  var LOGIN_PAGE = '/login.html';

  function safeGet(store, key) { try { return store.getItem(key) || ''; } catch (e) { return ''; } }
  function safeSet(store, key, value) { try { store.setItem(key, value); } catch (e) { /* storage unavailable */ } }
  function safeRemove(store, key) { try { store.removeItem(key); } catch (e) { /* storage unavailable */ } }

  function readSession() {
    try { var s = JSON.parse(safeGet(window.localStorage, SESSION_KEY) || 'null'); return s && s.pilot_token ? s : null; }
    catch (e) { return null; }
  }
  // The setup page (Démarrer) is open without a session, like the login page.
  function onLoginPage() { return location.pathname === LOGIN_PAGE || location.pathname === '/demarrer.html'; }

  var OM = {
    getSession: readSession,
    saveSession: function (s) {
      if (!s || !s.pilot_token) return;
      safeSet(window.localStorage, SESSION_KEY, JSON.stringify({
        user: s.user, refresh_token: s.refresh_token, access_token: s.access_token || null,
        pilot_token: s.pilot_token, owner_token: s.owner_token || null
      }));
      // Lets the original console (index.html) reuse the same login.
      safeSet(window.sessionStorage, LEGACY_TOKEN_KEY, s.pilot_token);
    },
    getToken: function () { var s = readSession(); return s ? s.pilot_token : ''; },
    // Kept for compatibility with older page code; the login page replaces it.
    setToken: function () {},
    getOwnerToken: function () { var s = readSession(); return (s && s.owner_token) || ''; },
    getRole: function () { var s = readSession(); return (s && s.user && s.user.role) || ''; },
    isOwner: function () { var r = OM.getRole(); return r === 'owner' || r === 'partner'; },
    isManager: function () { var r = OM.getRole(); return r === 'owner' || r === 'partner' || r === 'manager'; },
    hasPersonalSession: function () { var s = readSession(); return Boolean(s && s.access_token); },
    getUserName: function () {
      var s = readSession();
      return (s && s.user && s.user.display_name) || safeGet(window.localStorage, USER_KEY);
    },
    setUserName: function (n) { safeSet(window.localStorage, USER_KEY, String(n || '').trim().slice(0, 80)); },

    api: function (path, options, retried) {
      options = options || {};
      var s = readSession();
      var base = { 'x-office-manager-token': OM.getToken() };
      // Personal token: lets the server check who you are on sensitive routes.
      if (s && s.access_token) base.Authorization = 'Bearer ' + s.access_token;
      var headers = Object.assign(base, options.headers || {});
      return fetch(path, Object.assign({}, options, { headers: headers })).then(function (r) {
        return r.text().then(function (raw) {
          var data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = { error: 'INVALID_RESPONSE' }; }
          if (!r.ok) {
            var code = (data && data.error) || ('HTTP_' + r.status);
            // Expired personal token: refresh once, then retry.
            if (r.status === 401 && code === 'TOKEN_EXPIRED' && !retried) {
              return OM.checkSession().then(function (fresh) {
                if (fresh) return OM.api(path, options, true);
                var e1 = new Error('SESSION_EXPIRED'); e1.status = 401; throw e1;
              });
            }
            // Wrong or changed access code: back to the login page.
            if (r.status === 401 && (code === 'UNAUTHORIZED' || code === 'SESSION_EXPIRED') && !onLoginPage()) OM.forget(true);
            var err = new Error(data && data.detail ? code + ' (' + data.detail + ')' : code); err.status = r.status; err.code = code; throw err;
          }
          return data;
        });
      });
    },

    forget: function (redirect) {
      safeRemove(window.localStorage, SESSION_KEY);
      safeRemove(window.sessionStorage, LEGACY_TOKEN_KEY);
      safeRemove(window.sessionStorage, 'officeManagerOwnerToken');
      if (redirect) location.replace(LOGIN_PAGE + '?next=' + encodeURIComponent(location.pathname + location.search));
    },

    logout: function () {
      var s = readSession();
      var done = function () { OM.forget(false); location.replace(LOGIN_PAGE); };
      fetch('/api/app?route=logout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s ? s.refresh_token : '' }) }).then(done, done);
    },

    // Re-checks the session with Supabase; logs out if the account was deactivated.
    checkSession: function () {
      var s = readSession();
      if (!s || !s.refresh_token) return Promise.resolve(null);
      return fetch('/api/app?route=session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token }) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
        .then(function (x) {
          if (x.ok) { OM.saveSession(x.d); OM.paintUser(); return x.d; }
          if (x.status === 401 || x.status === 403) OM.forget(true);
          return null;
        }).catch(function () { return null; }); // offline: keep the session
    },

    paintUser: function () {
      var name = OM.getUserName() || 'Utilisateur';
      document.querySelectorAll('[data-user-name]').forEach(function (el) { el.textContent = name; });
      // Settings are visible to the owner and managing partners only.
      if (!OM.isOwner()) document.querySelectorAll('.nav a[href="/parametres.html"], .nav a[href="/mise-en-service.html"]').forEach(function (a) { a.hidden = true; });
      // The training page needs a personal session (e-mail + password).
      if (!OM.hasPersonalSession()) document.querySelectorAll('.nav a[href="/entrainement.html"]').forEach(function (a) { a.hidden = true; });
    },

    applyBranding: function (b) {
      if (!b) return;
      var root = document.documentElement;
      if (/^#[0-9A-Fa-f]{6}$/.test(b.primary_color || '')) root.style.setProperty('--brand', b.primary_color);
      if (b.text_on_primary) root.style.setProperty('--on-brand', b.text_on_primary);
      document.querySelectorAll('[data-firm-name]').forEach(function (el) { el.textContent = b.firm_name; });
      document.querySelectorAll('[data-firm-logo]').forEach(function (el) {
        el.textContent = '';
        if (b.logo_data_url && /^data:image\/(png|jpeg|webp);base64,/.test(b.logo_data_url)) {
          var img = document.createElement('img');
          img.src = b.logo_data_url;
          img.alt = 'Logo ' + b.firm_name;
          img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'contain';
          el.appendChild(img);
        } else {
          el.textContent = b.initial || 'C';
        }
      });
      OM.paintUser();
      if (b.firm_name) document.title = document.title.split(' · ')[0] + ' · ' + b.firm_name;
    },

    loadBranding: function () {
      if (!OM.getToken()) return Promise.resolve(null);
      return OM.api('/api/app?route=branding').then(function (b) { OM.applyBranding(b); return b; });
    }
  };
  window.OfficeManager = OM;

  // Logout button under the user's name in the side menu.
  function addLogout() {
    var who = document.querySelector('.nav .who');
    if (!who || document.getElementById('logout-btn')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'logout-btn'; b.textContent = 'Se déconnecter';
    b.style.cssText = 'display:block;margin-top:8px;font:inherit;font-size:13px;background:transparent;border:1px solid var(--nav-line);color:var(--nav-text);border-radius:8px;padding:8px 12px;min-height:36px;cursor:pointer';
    b.addEventListener('click', OM.logout);
    who.appendChild(b);
  }

  // ---- Workspace shell: icons in the rail, a menu button on small screens, tabs for long pages ----
  var ICONS = {
    '/accueil.html': 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    '/recherche.html': 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm10 17l-5-5',
    '/mission.html': 'M4 7h16v12H4zM9 7V5h6v2M4 12h16',
    '/rangement.html': 'M3 6h7l2 2h9v11H3zM8 13h8',
    '/equipe.html': 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 0a2.5 2.5 0 1 0 0-5M3 20c0-3 3-5 6-5s6 2 6 5m2-5c2 0 4 1.5 4 4',
    '/validations.html': 'M5 12l4 4 10-10M4 20h16',
    '/messagerie.html': 'M4 5h16v11H8l-4 4z',
    '/assistant.html': 'M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z',
    '/entrainement.html': 'M4 19V9l8-5 8 5v10M9 19v-6h6v6',
    '/mise-en-service.html': 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l3 3m6 6l3 3M18 6l-3 3M9 15l-3 3',
    '/parametres.html': 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6l1.4 1.4m0-11.4l-1.4 1.4m-8.6 8.6l-1.4 1.4'
  };
  function decorateShell() {
    var nav = document.querySelector('.nav');
    if (!nav || nav.dataset.decorated) return;
    nav.dataset.decorated = '1';
    nav.querySelectorAll('a[href]').forEach(function (a) {
      var d = ICONS[a.getAttribute('href')]; if (!d || a.querySelector('svg')) return;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.appendChild(path);
      a.insertBefore(svg, a.firstChild);
    });
    var brand = nav.querySelector('.brand');
    if (brand && !nav.querySelector('.nav-toggle')) {
      var t = document.createElement('button'); t.type = 'button'; t.className = 'nav-toggle'; t.textContent = 'Menu'; t.setAttribute('aria-expanded', 'false');
      t.addEventListener('click', function () { var o = nav.classList.toggle('open'); t.setAttribute('aria-expanded', String(o)); });
      brand.after(t);
    }
  }
  // A page with many sections shows them as tabs instead of one long scroll.
  function autoTabs() {
    var main = document.querySelector('.main');
    if (!main || main.dataset.tabs) return;
    var groups = new Map();
    main.querySelectorAll('section.card').forEach(function (sec) {
      if (sec.id === 'login' || !sec.querySelector('h2')) return;
      var p = sec.parentElement; if (!groups.has(p)) groups.set(p, []); groups.get(p).push(sec);
    });
    var best = null;
    groups.forEach(function (list) { if (list.length >= 4 && (!best || list.length > best.length)) best = list; });
    if (!best) return;
    main.dataset.tabs = '1';
    var bar = document.createElement('div'); bar.className = 'tabs'; bar.setAttribute('role', 'tablist');
    var key = 'om_tab:' + location.pathname;
    var saved = 0; try { saved = Number(sessionStorage.getItem(key)) || 0; } catch (e) {}
    var buttons = best.map(function (sec, i) {
      var h = sec.querySelector('h2');
      var label = (h.firstChild && h.firstChild.nodeType === 3 ? h.firstChild.textContent : h.textContent).trim().replace(/\s*\(.*$/, '');
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = label;
      b.addEventListener('click', function () { select(i); try { sessionStorage.setItem(key, String(i)); } catch (e) {} });
      bar.appendChild(b); return b;
    });
    function select(i) {
      best.forEach(function (sec, j) { sec.style.display = j === i ? '' : 'none'; buttons[j].setAttribute('aria-selected', String(j === i)); });
    }
    // Sections the page itself hides (not ready yet, owner only…) lose their tab too.
    function sync() { buttons.forEach(function (b, j) { b.hidden = best[j].hidden; }); }
    new MutationObserver(sync).observe(main, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    best[0].parentElement.insertBefore(bar, best[0]);
    sync(); select(Math.min(saved, best.length - 1));
  }

  if (!onLoginPage()) {
    if (!readSession()) { OM.forget(true); return; }
    var ready = function () { decorateShell(); autoTabs(); addLogout(); OM.paintUser(); OM.checkSession(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
  }
})();
