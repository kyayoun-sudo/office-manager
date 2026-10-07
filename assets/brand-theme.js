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
  function onLoginPage() { return location.pathname === LOGIN_PAGE; }

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
            var err = new Error(code); err.status = r.status; throw err;
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
    b.style.cssText = 'display:block;margin-top:8px;font:inherit;font-size:13px;background:transparent;border:1px solid #2C433A;color:#D3DDD9;border-radius:8px;padding:8px 12px;min-height:36px;cursor:pointer';
    b.addEventListener('click', OM.logout);
    who.appendChild(b);
  }

  if (!onLoginPage()) {
    if (!readSession()) { OM.forget(true); return; }
    var ready = function () { addLogout(); OM.paintUser(); OM.checkSession(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
  }
})();
