// Shared white-label loader for the new pages (parametres.html, recherche.html).
// Reads /api/branding and applies the firm's name, colour and logo.
// Uses the same session token key as index.html ("officeManagerToken").
(function () {
  var TOKEN_KEY = 'officeManagerToken';
  var USER_KEY = 'officeManagerUserName';

  function safeGet(store, key) { try { return store.getItem(key) || ''; } catch (e) { return ''; } }
  function safeSet(store, key, value) { try { store.setItem(key, value); } catch (e) { /* storage unavailable */ } }

  var OM = {
    getToken: function () { return safeGet(window.sessionStorage, TOKEN_KEY); },
    setToken: function (t) { safeSet(window.sessionStorage, TOKEN_KEY, String(t || '').trim()); },
    // Display name is personal to this device: no user accounts exist yet.
    getUserName: function () { return safeGet(window.localStorage, USER_KEY); },
    setUserName: function (n) { safeSet(window.localStorage, USER_KEY, String(n || '').trim().slice(0, 80)); },

    api: function (path, options) {
      options = options || {};
      var headers = Object.assign({ 'x-office-manager-token': OM.getToken() }, options.headers || {});
      return fetch(path, Object.assign({}, options, { headers: headers })).then(function (r) {
        return r.text().then(function (raw) {
          var data = null;
          try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = { error: 'INVALID_RESPONSE' }; }
          if (!r.ok) { var err = new Error((data && data.error) || ('HTTP_' + r.status)); err.status = r.status; throw err; }
          return data;
        });
      });
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
      var user = OM.getUserName();
      document.querySelectorAll('[data-user-name]').forEach(function (el) { el.textContent = user || 'Utilisateur'; });
      if (b.firm_name) document.title = document.title.split(' · ')[0] + ' · ' + b.firm_name;
    },

    loadBranding: function () {
      if (!OM.getToken()) return Promise.resolve(null);
      return OM.api('/api/branding').then(function (b) { OM.applyBranding(b); return b; });
    }
  };
  window.OfficeManager = OM;
})();
