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
    // A person without a firm yet has a personal session but no pilot token (several firms, « Mes cabinets »).
    try { var s = JSON.parse(safeGet(window.localStorage, SESSION_KEY) || 'null'); return s && (s.pilot_token || (s.needs_cabinet && s.access_token)) ? s : null; }
    catch (e) { return null; }
  }
  // The setup page (Démarrer) is open without a session, like the login page.
  // « Mes cabinets » (several firms, 2026-10-24): open with a session that has no firm yet.
  var CABINETS_PAGE = '/cabinets.html';
  function onLoginPage() { return location.pathname === LOGIN_PAGE || location.pathname === '/demarrer.html' || location.pathname === CABINETS_PAGE; }
  // The Office Manager panel inside Excel (/excel/…): no redirect to the login page, no menu —
  // the panel signs in through a small Office window.
  function inExcel() { return location.pathname.indexOf('/excel/') === 0; }

  var OM = {
    getSession: readSession,
    saveSession: function (s) {
      if (!s || !(s.pilot_token || (s.needs_cabinet && s.access_token))) return;
      var before = readSession() || {};
      // Several firms: the firm this session works on, the person's firms (selector), or none yet.
      var org = s.org_id !== undefined ? s.org_id : (before.org_id || null);
      safeSet(window.localStorage, SESSION_KEY, JSON.stringify({
        user: s.user, refresh_token: s.refresh_token, access_token: s.access_token || null,
        pilot_token: s.pilot_token, owner_token: s.owner_token || null,
        org_id: org, cabinets: s.cabinets || before.cabinets || null, needs_cabinet: Boolean(s.needs_cabinet && !org)
      }));
      // Lets the original console (index.html) reuse the same login.
      safeSet(window.sessionStorage, LEGACY_TOKEN_KEY, s.pilot_token);
    },
    getToken: function () { var s = readSession(); return s ? s.pilot_token : ''; },
    // Work on another of my firms: the session names it, the cached rights are dropped, the page starts again.
    switchCabinet: function (orgId, target) {
      var s = readSession(); if (!s) return;
      s.org_id = orgId; s.needs_cabinet = false;
      safeSet(window.localStorage, SESSION_KEY, JSON.stringify(s));
      try { window.sessionStorage.removeItem('officeManagerMyRights'); } catch (e) { /* no storage */ }
      return OM.checkSession().then(function () { location.replace(target || '/accueil.html'); });
    },
    // This person's screens and levels (cached for the session; refreshed at login).
    myRights: function () {
      var KEY = 'officeManagerMyRights', role = OM.getRole();
      try { var c = JSON.parse(window.sessionStorage.getItem(KEY) || 'null'); if (c && c.role === role && Date.now() - c.at < 600000) return Promise.resolve(c.mine); } catch (e) { /* no storage */ }
      return OM.api('/api/app?route=permissions').then(function (d) { try { window.sessionStorage.setItem(KEY, JSON.stringify({ role: role, at: Date.now(), mine: d.mine })); } catch (e) { /* no storage */ } return d.mine; }).catch(function () { return null; });
    },
    // Kept for compatibility with older page code; the login page replaces it.
    setToken: function () {},
    getOwnerToken: function () { var s = readSession(); return (s && s.owner_token) || ''; },
    getRole: function () { var s = readSession(); return (s && s.user && s.user.role) || ''; },
    isOwner: function () { var r = OM.getRole(); return r === 'owner' || r === 'partner'; },
    isManager: function () { var r = OM.getRole(); return r === 'owner' || r === 'partner' || r === 'manager' || r === 'supervisor'; },
    // Account administration: owner, partners and the IT administrator (2026-10-10).
    isAccountAdmin: function () { var r = OM.getRole(); return r === 'owner' || r === 'partner' || r === 'it_admin'; },
    ROLE_LABELS: { owner: 'Propriétaire du cabinet', partner: 'Associé', quality_reviewer: 'Revue qualité (EQR)', bdm: 'Business Development Manager', manager: 'Manager', supervisor: 'Superviseur', senior: 'Senior', auditor: 'Auditeur', secretary: 'Secrétariat / administration', it_admin: 'Responsable informatique', collaborator: 'Collaborateur (ancien rôle)' },
    roleLabel: function (r) { return OM.ROLE_LABELS[r || OM.getRole()] || r || ''; },
    hasPersonalSession: function () { var s = readSession(); return Boolean(s && s.access_token); },
    getUserName: function () {
      var s = readSession();
      return (s && s.user && s.user.display_name) || safeGet(window.localStorage, USER_KEY);
    },
    setUserName: function (n) { safeSet(window.localStorage, USER_KEY, String(n || '').trim().slice(0, 80)); },

    // Error codes in words a person can act on (2026-10-08).
    explain: function (code) {
      var c = String(code || '');
      var E = {
        MIGRATION_MISSING_DB_MEMORY_SQL: 'Base pas encore à jour : exécutez db/memory.sql dans Supabase (SQL Editor).',
        MAIL_NOT_CONFIGURED: 'Envoi non branché : connectez Google avec l’autorisation d’envoyer des e-mails (Paramètres → Google).',
        MAIL_SENDER_NOT_CONNECTED_ACCOUNT: 'L’adresse d’envoi de l’agent n’est pas le compte Google connecté : connectez Google avec la boîte de l’agent, ou indiquez sa vraie boîte (alias).',
        MAIL_DELEGATION_MISSING: 'Google refuse l’envoi : le super administrateur Google Workspace doit autoriser l’envoi au nom de l’agent.',
        MAIL_AUTH_FAILED: 'Google refuse la connexion de la boîte de l’agent : reconnectez Google.',
        ROLE_NOT_ALLOWED: 'Action réservée à un autre rôle (propriétaire, associé ou manager).',
        INVALID_BODY: 'Message vide ou trop long.'
      };
      if (E[c]) return E[c];
      if (/^GMAIL_SEND_\d+_API_DISABLED/.test(c)) return 'Gmail refuse l’envoi : l’API Gmail n’est pas activée dans le projet Google Cloud du cabinet (console.cloud.google.com → API et services → Gmail API → Activer).';
      if (/^GMAIL_SEND_\d+_SCOPE_MISSING/.test(c)) return 'Gmail refuse l’envoi : la connexion Google n’a pas l’autorisation d’envoyer. Reconnectez Google (Paramètres) et acceptez « Envoyer des e-mails ».';
      if (/^GMAIL_SEND_\d+_FROM_NOT_ALLOWED/.test(c)) return 'Gmail refuse l’adresse d’expédition : ajoutez l’adresse de l’agent comme alias « Envoyer en tant que » dans la boîte Gmail connectée.';
      if (/^GMAIL_SEND_\d+_NO_GMAIL/.test(c)) return 'Gmail refuse l’envoi : la boîte de l’agent n’a pas Gmail activé (licence Google Workspace).';
      if (/^GMAIL_SEND_403/.test(c)) return 'Gmail refuse l’envoi (403) : vérifiez que l’API Gmail est activée dans Google Cloud et reconnectez Google en acceptant l’envoi d’e-mails.';
      return c;
    },

    // One file to the Drive (2026-10-08): small files through the app, large ones straight to Google.
    // extra: { rel_path, deposit_label, wish, send_to }. Resolves { file_id, url, ... }.
    uploadFile: function (file, extra) {
      extra = extra || {};
      var meta = { name: file.name, mime: file.type || 'application/octet-stream', rel_path: extra.rel_path || file.webkitRelativePath || file.name, deposit_label: extra.deposit_label || null, wish: extra.wish || null, send_to: extra.send_to || null };
      if (file.size <= 2.5 * 1024 * 1024) {
        return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(file); })
          .then(function (b64) { return OM.api('/api/app?route=drop', { method: 'POST', body: JSON.stringify(Object.assign({ base64: b64 }, meta)) }); });
      }
      return OM.api('/api/app?route=drop', { method: 'POST', body: JSON.stringify(Object.assign({ action: 'start_upload', size: file.size }, meta)) })
        .then(function (s) {
          return fetch(s.upload_url, { method: 'PUT', body: file }).then(function (r) {
            if (!r.ok) throw new Error('Envoi vers Google refusé (' + r.status + ')');
            return r.json();
          }).then(function (g) {
            return OM.api('/api/app?route=drop', { method: 'POST', body: JSON.stringify(Object.assign({ action: 'finish_upload', file_id: g.id }, meta)) });
          });
        });
    },

    api: function (path, options, retried) {
      options = options || {};
      var s = readSession();
      var base = { 'x-office-manager-token': OM.getToken() };
      if (s && s.org_id) base['x-office-manager-org'] = s.org_id;
      if (OM.getLang && OM.getLang() === 'en') base['x-om-lang'] = 'en';
      // Personal token: lets the server check who you are on sensitive routes.
      if (s && s.access_token) base.Authorization = 'Bearer ' + s.access_token;
      // The owner's code (session, or typed in Paramètres) goes with every call: owner-only actions work from any page.
      var ot = OM.getOwnerToken(); if (!ot) { try { ot = window.sessionStorage.getItem('officeManagerOwnerToken') || ''; } catch (e) { ot = ''; } }
      if (ot) base['x-office-manager-owner-token'] = ot;
      var headers = Object.assign(base, options.headers || {});
      // A JSON body always says so (the server reads it as JSON).
      if (typeof options.body === 'string' && !Object.keys(headers).some(function (k) { return k.toLowerCase() === 'content-type'; })) headers['Content-Type'] = 'application/json';
      return fetch(path, Object.assign({}, options, { headers: headers })).catch(function (cause) {
        if (options.signal && options.signal.aborted || cause && cause.name === 'AbortError') throw cause;
        var error = new Error('NETWORK_REQUEST_FAILED'); error.code = 'NETWORK_REQUEST_FAILED'; throw error;
      }).then(function (r) {
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
            var known = OM.explain(code);
            var err = new Error(known !== code ? known : (data && data.detail ? code + ' (' + data.detail + ')' : code)); err.status = r.status; err.code = code; err.data = data; throw err;
          }
          // Shared content-brain preparations resume their persisted server job.
          // This never retries writes or unrelated API calls.
          if (data && data.document_brain && data.pending && (options.documentBrainPass || 0) < 20 && typeof options.body === 'string') {
            var nextBody = JSON.parse(options.body); nextBody.document_job = data.job_id;
            try { document.dispatchEvent(new CustomEvent('document-brain-progress', { detail: { phase: data.phase, read: (data.documents_read || []).length, total: data.documents_total } })); } catch (_) {}
            return new Promise(function (resolve) { setTimeout(resolve, 250); }).then(function () {
              if (options.signal && options.signal.aborted) throw new Error('READING_REQUEST_TIMEOUT');
              return OM.api(path, Object.assign({}, options, { body: JSON.stringify(nextBody), documentBrainPass: (options.documentBrainPass || 0) + 1 }), retried);
            });
          }
          return data;
        });
      });
    },

    forget: function (redirect) {
      safeRemove(window.localStorage, SESSION_KEY);
      safeRemove(window.sessionStorage, LEGACY_TOKEN_KEY);
      safeRemove(window.sessionStorage, 'officeManagerOwnerToken');
      if (redirect && inExcel()) { location.reload(); return; }
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
      var sh = { 'Content-Type': 'application/json' }; if (s.org_id) sh['x-office-manager-org'] = s.org_id;
      return fetch('/api/app?route=session', { method: 'POST', headers: sh,
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
      // Each role sees its own menu (2026-10-10: « tout le monde ne peut pas avoir la même interface »).
      // The server refuses what a role may not do; the menu only shows what it may.
      var role = OM.getRole();
      var taskLabels = { '/accueil.html': 'Mon travail', '/rangement.html': 'Documents', '/pilotage.html': 'Pilotage' };
      document.querySelectorAll('.nav a[href]').forEach(function (a) { var label = taskLabels[a.getAttribute('href')]; if (label) { a.textContent = label; a.setAttribute('aria-label', label); } });
      if (role) document.querySelectorAll('.nav a[href]').forEach(function (a) {
        var allowed = NAV_ROLES[a.getAttribute('href')];
        if (allowed && allowed.indexOf(role) < 0) a.hidden = true;
      });
      if (!OM.isAccountAdmin()) document.querySelectorAll('.nav a[href="/parametres.html"], .nav a[href="/mise-en-service.html"]').forEach(function (a) { a.hidden = true; });
      if (!OM.isOwner() && role !== 'quality_reviewer') document.querySelectorAll('.nav a[data-partners-only]').forEach(function (a) { a.hidden = true; });
      // The training page needs a personal session (e-mail + password).
      if (!OM.hasPersonalSession()) document.querySelectorAll('.nav a[href="/entrainement.html"]').forEach(function (a) { a.hidden = true; });
      // The firm's own rights (Paramètres → Droits, 2026-10-11): pages its matrix closes for this role.
      if (OM.hasPersonalSession()) OM.myRights().then(function (m) { (m && m.hidden_pages || []).forEach(function (p) { document.querySelectorAll('.nav a[href="' + p + '"]').forEach(function (a) { if (a.getAttribute('aria-current') !== 'page') a.hidden = true; }); }); });
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
  // ---- Settings wheel at the bottom of the menu (Paul, 2026-10-07: « une roue en bas où il y a
  // Se déconnecter, Paramètres avec les rubriques »): the setup and settings sections (owner), the
  // language, closing one's own account, logging out. ----
  var SETTINGS = [
    ['Mise en service', '/mise-en-service.html', [['h-sum', 'État'], ['h-steps', 'Les étapes'], ['h-map', 'Cartographie du Drive'], ['h-know', 'Ce que l’Orpailleur a compris']]],
    ['Paramètres', '/parametres.html', [['h-google', 'Accès Google (Drive et Gmail)'], ['h-id', 'Identité'], ['h-logo', 'Logo'], ['h-col', 'Couleur principale'], ['h-mail', 'E-mail de l’agent'],
      ['h-tone', 'Ton avec les collègues'], ['h-people', 'Gestion des personnes'], ['h-sched', 'Horaires des agents'], ['h-users', 'Comptes du cabinet'], ['h-try', 'Essayer']],
    ['Panneau Excel', '/excel/install.html', []]]
  ];
  function svgIcon(d) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.appendChild(path); return svg;
  }
  function node(tag, text, cls) { var n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; }
  function addLogout() {
    var who = document.querySelector('.nav .who');
    if (!who || document.getElementById('gear-btn')) return;
    var nameEl = who.querySelector('[data-user-name]');
    var me = node('div', null, 'me');
    var av = node('span', (OM.getUserName() || 'U').trim().charAt(0).toUpperCase(), 'avatar'); av.setAttribute('aria-hidden', 'true');
    me.appendChild(av); if (nameEl) me.appendChild(nameEl);
    var b = node('button', null, 'gear'); b.type = 'button'; b.id = 'gear-btn';
    b.setAttribute('aria-label', 'Réglages'); b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false');
    b.appendChild(svgIcon(ICONS['/parametres.html']));
    me.appendChild(b);
    who.textContent = ''; who.appendChild(me);
    addBell(me);
    setTimeout(askPopup, 1200);
    var menu = node('div', null, 'gear-menu'); menu.hidden = true; menu.id = 'gear-menu';
    who.appendChild(menu);
    function build() {
      menu.textContent = '';
      if (OM.isAccountAdmin()) SETTINGS.forEach(function (g) {
        var box = node('div', null, 'gm-group');
        var head = node('a', g[0], 'gm-head'); head.href = g[1]; box.appendChild(head);
        g[2].forEach(function (x) { var a = node('a', x[1], 'gm-link'); a.href = g[1] + '#' + x[0]; box.appendChild(a); });
        menu.appendChild(box);
      });
      // « Mon IA »: everyone can connect their own AI (warning first) — 2026-10-10.
      var mine = node('div', null, 'gm-group'); var ma = node('a', 'Mon IA', 'gm-head'); ma.href = '/mon-ia.html'; mine.appendChild(ma); menu.appendChild(mine);
      // The firm's methodology library (SOP read procedure by procedure) — 2026-10-12.
      // The secretariat (models, MI / letters / reports to prepare and send) — 2026-10-12.
      if (['owner', 'partner', 'manager', 'supervisor', 'bdm', 'secretary', 'senior'].indexOf(OM.getRole()) >= 0) { var sg = node('div', null, 'gm-group'); var sa = node('a', 'Secrétariat et modèles', 'gm-head'); sa.href = '/secretariat.html'; sg.appendChild(sa); menu.appendChild(sg); }
      if (OM.getRole()) { var mg = node('div', null, 'gm-group'); var mm = node('a', 'Méthodologie du cabinet', 'gm-head'); mm.href = '/methodologie.html'; mg.appendChild(mm); menu.appendChild(mg); }
      var lang = node('div', null, 'gm-group gm-row');
      lang.appendChild(node('span', 'Langue', 'gm-label'));
      var seg = node('div', null, 'seg');
      [['fr', 'Français'], ['en', 'English']].forEach(function (x) {
        var l = node('button', x[1]); l.type = 'button'; l.setAttribute('data-keep', ''); l.setAttribute('aria-pressed', String(OM.getLang() === x[0]));
        l.addEventListener('click', function () { OM.setLang(x[0]); }); seg.appendChild(l);
      });
      lang.appendChild(seg); menu.appendChild(lang);
      // Several firms: switch firm, or « Mes cabinets » (create one, join one, invite).
      var sess = readSession();
      if (sess && sess.cabinets) {
        var cg = node('div', null, 'gm-group');
        sess.cabinets.forEach(function (c) {
          if (c.org_id === sess.org_id) { cg.appendChild(node('span', 'Cabinet : ' + c.name, 'gm-label')); return; }
          var sw = node('button', 'Passer à ' + c.name, 'gm-link'); sw.type = 'button';
          sw.addEventListener('click', function () { OM.switchCabinet(c.org_id); }); cg.appendChild(sw);
        });
        var mine = node('a', 'Mes cabinets…', 'gm-link'); mine.href = CABINETS_PAGE; cg.appendChild(mine);
        menu.appendChild(cg);
      }
      var acc = node('div', null, 'gm-group');
      var close = node('button', 'Fermer mon compte…', 'gm-link gm-danger'); close.type = 'button'; close.addEventListener('click', function () { toggle(false); openClose(); });
      var out = node('button', 'Se déconnecter', 'gm-link'); out.type = 'button'; out.id = 'logout-btn'; out.addEventListener('click', OM.logout);
      acc.appendChild(close); acc.appendChild(out); menu.appendChild(acc);
    }
    function toggle(open) { if (open) build(); menu.hidden = !open; b.setAttribute('aria-expanded', String(open)); }
    b.addEventListener('click', function (e) { e.stopPropagation(); toggle(menu.hidden); });
    document.addEventListener('click', function (e) { if (!menu.hidden && !menu.contains(e.target)) toggle(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { toggle(false); b.focus(); } });
  }
  // Questions that POP UP on any page (Paul, 2026-10-11: « pop-up, pas notifications »): the person
  // answers right there with buttons — their independence declaration, the agents' questions, the
  // Associé's decision. « Plus tard » hides them for an hour on this device.
  var askLoading = false;
  function askPopup(onlyIndependence) {
    if (askLoading || document.hidden || document.querySelector('dialog[open]')) return;
    if (/\/(login|excel)\b/.test(location.pathname) || document.querySelector('dialog.om-ask[open]')) return;
    askLoading = true;
    var LATER = 'om_ask_later', later = {};
    try { later = JSON.parse(sessionStorage.getItem(LATER) || '{}') || {}; } catch (e) { later = {}; }
    var post = function (body) { return OM.api('/api/app?route=opportunities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); };
    OM.api('/api/app?route=my-questions' + (onlyIndependence === true ? '&independence_only=1' : '')).then(function (r) {
      var here = new URLSearchParams(location.search).get('id');
      var list = ((r && r.questions) || []).filter(function (q) { return !(later[q.id] > Date.now()) && !(/opportunites/.test(location.pathname) && here === q.opportunity_id) && !(q.kind === 'procedure' && /\/procedure\.html/.test(location.pathname)); });
      if (!list.length) return;
      var d = node('dialog', null, 'om-dialog om-ask'); d.setAttribute('aria-labelledby', 'om-ask-title');
      document.body.appendChild(d);
      var i = 0, indep = null;
      var close = function () { d.close(); d.remove(); };
      var snooze = function () {
        var finish = function () { list.slice(i).forEach(function (q) { later[q.id] = Date.now() + 3600000; }); try { sessionStorage.setItem(LATER, JSON.stringify(later)); } catch (e) {} close(); };
        if (indep && list[i] && list[i].kind === 'independence') post({ action: 'declaration-draft', opportunity_id: list[i].opportunity_id, answers: indep.answers, details: indep.details }).then(finish).catch(function () { var error = node('p', 'Brouillon non enregistré : réessayez avant de fermer.', 'status error'); d.appendChild(error); });
        else finish();
      };
      var btn = function (label, cls, fn) { var b = node('button', label, 'btn' + (cls ? ' ' + cls : '')); b.type = 'button'; b.addEventListener('click', fn); return b; };
      function next() { i++; indep = null; draw(); }
      function draw() {
        d.textContent = '';
        if (i >= list.length) { d.appendChild(node('h2', 'Merci, c’est enregistré.')); var row0 = node('div', null, 'om-actions'); row0.appendChild(btn('Fermer', '', close)); d.appendChild(row0); return; }
        var q = list[i], say = node('p', '', 'status'), lastAnswer = null, overrideShown = false;
        d.appendChild(node('p', (list.length > 1 ? (i + 1) + ' sur ' + list.length + ' · ' : '') + q.title, 'om-ask-ctx'));
        var fail = function (e) { say.className = 'status error'; say.textContent = { INVALID_DRIVE_LINK: 'Collez un lien Google Drive ou Google Docs valide.', DOCUMENT_FILE_REQUIRED: 'Ce besoin attend un fichier, et non un dossier.', MISSION_ROOT_FOLDER_REQUIRED: 'Collez le lien du dossier Drive demandé.', SEPARATION_OF_FUNCTIONS: 'Vous avez préparé ou relu ce dossier : un autre Associé doit décider, ou le propriétaire peut enregistrer une dérogation.', PARTNER_DECISION_ONLY: 'Seul un Associé peut décider.' }[e.message] || e.message; [].forEach.call(d.querySelectorAll('button'), function (b) { b.disabled = false; });
          if (!overrideShown && lastAnswer && window.OfficeManager.getRole() === 'owner' && ['SEPARATION_OF_FUNCTIONS', 'NOT_THE_DECIDING_PARTNER', 'NOT_THE_MISSION_MANAGER'].indexOf(e.message) >= 0) {
            overrideShown = true; opts.appendChild(btn('Valider par dérogation du propriétaire', '', function () { busy(); post(Object.assign({}, lastAnswer, { owner_override: true })).then(next).catch(fail); }));
          }
        };
        var busy = function () { [].forEach.call(d.querySelectorAll('button'), function (b) { b.disabled = true; }); say.className = 'status'; say.textContent = 'Enregistrement…'; };
        var opts = node('div', null, 'om-actions om-ask-opts');
        if (q.kind === 'document_location') {
          var title = node('h2', q.question); title.id = 'om-ask-title'; d.appendChild(title);
          if (q.context) d.appendChild(node('p', q.context));
          var label = node('label', 'Lien Drive du modèle ou du dossier demandé'); label.htmlFor = 'om-document-link'; d.appendChild(label);
          var locationInput = node('input'); locationInput.id = 'om-document-link'; locationInput.type = 'url'; locationInput.required = true; locationInput.placeholder = 'https://drive.google.com/…'; locationInput.className = 'om-ask-note'; d.appendChild(locationInput);
          opts.appendChild(btn('Mémoriser ce lien', '', function () {
            if (!locationInput.value.trim() || !locationInput.checkValidity()) { locationInput.reportValidity(); locationInput.focus(); return; }
            busy(); OM.api('/api/app?route=secretariat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, q.document_request, { action: 'confirm-document', file_link: locationInput.value.trim() })) }).then(next).catch(fail);
          }));
          var advanced = node('a', 'Rechercher ou choisir parmi les fichiers', 'om-ask-link'); advanced.href = q.href; opts.appendChild(advanced);
        } else if (q.kind === 'pbc_list') {
          var hl = node('h2', q.question); hl.id = 'om-ask-title'; d.appendChild(hl);
          if (q.context) d.appendChild(node('p', q.context));
          if (q.href) { var openFile = node('a', 'Ouvrir le fichier', 'om-ask-link'); openFile.href = q.href; openFile.target = '_blank'; openFile.rel = 'noopener'; d.appendChild(openFile); }
          var decide = function (decision) { return function () { busy(); OM.api('/api/app?route=secretariat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pbc-list-decide', file_id: q.file_id, mission_id: q.mission_id, decision: decision }) }).then(next).catch(fail); }; };
          opts.appendChild(btn('Oui, c’est une liste PBC', '', decide('confirm')));
          opts.appendChild(btn('Non, ce n’en est pas une', 'secondary', decide('reject')));
        } else if (q.kind === 'procedure') {
          var hp = node('h2', q.question); hp.id = 'om-ask-title'; d.appendChild(hp);
          if (q.context) d.appendChild(node('p', q.context));
          var go = node('a', String(q.id).indexOf('intro|') === 0 ? 'Répondre aux questions des agents' : String(q.id).indexOf('file|') === 0 ? 'Indiquer l’emplacement du fichier' : String(q.id).indexOf('rev|') === 0 ? 'Ouvrir la revue' : 'Ouvrir ma procédure', 'btn'); go.href = q.href; opts.appendChild(go);
        } else if (q.kind === 'independence_review') {
          var title = node('h2', q.question); title.id='om-ask-title'; d.appendChild(title);
          if (window.OMIndependence) window.OMIndependence.form(d,q.review,q.opportunity_id,next);
          else { d.appendChild(node('p',q.review.explanation)); var reviewLink=node('a','Examiner les garde-fous','btn'); reviewLink.href=q.href; opts.appendChild(reviewLink); }
        } else if (q.kind === 'independence') {
          indep = indep || { k: 0, answers: Object.assign({}, q.draft && q.draft.answers), details: Object.assign({}, q.draft && q.draft.details) };
          var iq = q.questions[indep.k];
          if (iq) {
            var h = node('h2', iq.label); h.id = 'om-ask-title'; d.appendChild(h);
            d.appendChild(node('p', 'Votre déclaration d’indépendance, pour vous-même · ' + (indep.k + 1) + ' sur ' + q.questions.length));
            var dt = node('input'); dt.type = 'text'; dt.maxLength = 600; dt.placeholder = 'Si « Oui » : précisez en quelques mots'; dt.className = 'om-ask-note'; d.appendChild(dt);
            dt.value = indep.details[iq.ref] || '';
            dt.addEventListener('input', function () { indep.details[iq.ref] = dt.value.trim(); });
            if (indep.answers[iq.ref]) d.appendChild(node('p', 'Réponse enregistrée : ' + indep.answers[iq.ref]));
            if (indep.k > 0) opts.appendChild(btn('Précédent', 'ghost', function () { indep.details[iq.ref] = dt.value.trim(); indep.k--; draw(); }));
            ['Non', 'Oui'].forEach(function (v) { opts.appendChild(btn(v, v === 'Oui' ? 'ghost' : '', function () { if (v === 'Oui' && !dt.value.trim()) { dt.required=true; dt.placeholder='Expliquez la situation avant de continuer'; dt.reportValidity(); dt.focus(); return; } indep.answers[iq.ref] = v; indep.details[iq.ref] = dt.value.trim(); indep.k++; draw(); })); });
          } else {
            var h2 = node('h2', 'Je certifie ces réponses'); h2.id = 'om-ask-title'; d.appendChild(h2);
            var n = Object.keys(indep.answers).filter(function (k) { return indep.answers[k] === 'Oui'; }).length;
            d.appendChild(node('p', n ? n + ' situation(s) déclarée(s) : le Partner ou le Owner décidera des garde-fous.' : 'Aucune menace déclarée.'));
            (q.questions || []).forEach(function (item, index) { opts.appendChild(btn('Corriger : ' + item.label, 'ghost', function () { indep.k = index; draw(); })); });
            opts.appendChild(btn('Je certifie et j’enregistre', '', function () { busy(); post({ action: 'declare', opportunity_id: q.opportunity_id, answers: indep.answers, details: indep.details, certify: true }).then(next).catch(fail); }));
          }
        } else {
          var h3 = node('h2', q.question); h3.id = 'om-ask-title'; d.appendChild(h3);
          if (q.context) q.context.split('\n').forEach(function (l) { d.appendChild(node('p', l)); });
          var date = null;
          if (q.date_cell) { date = node('input'); date.type = 'date'; date.required = true; date.className = 'om-ask-note'; date.setAttribute('aria-label', q.question || 'Date'); d.appendChild(date); }
          var note = null;
          if (q.note_cell && q.kind !== 'decision') { note = node('input'); note.type = 'text'; note.className = 'om-ask-note'; note.placeholder = q.options ? 'Précision (facultatif)' : 'Votre réponse, en quelques mots'; d.appendChild(note); }
          var send = function (v) { var values = {}; if (date) { if (!date.value || !date.checkValidity()) { date.reportValidity(); date.focus(); return; } values[q.date_cell] = date.value; } if (v && q.choice_cell) values[q.choice_cell] = v; if (note && note.value.trim()) values[q.note_cell] = note.value.trim(); if (!Object.keys(values).length) { if (note) note.focus(); return; } lastAnswer = { action: 'answer', opportunity_id: q.opportunity_id, sheet: q.sheet, row: q.row, values: values }; busy(); post(lastAnswer).then(next).catch(fail); };
          if (q.options) q.options.forEach(function (v) { opts.appendChild(btn(v.length > 34 ? v.slice(0, 32) + '…' : v, '', function () { send(v); })); });
          else opts.appendChild(btn('Enregistrer', '', function () { send(null); }));
        }
        d.appendChild(opts);
        var foot = node('div', null, 'om-actions');
        foot.appendChild(btn('Plus tard', 'ghost', snooze));
        if (q.opportunity_id) { var open = node('a', 'Voir l’opportunité', 'om-ask-link'); open.href = '/opportunites.html?id=' + encodeURIComponent(q.opportunity_id); foot.appendChild(open); }
        d.appendChild(foot); d.appendChild(say);
        var first = d.querySelector('#om-document-link, .om-ask-opts button, .om-ask-opts a'); if (first) first.focus();
      }
      d.addEventListener('cancel', function (e) { e.preventDefault(); snooze(); });
      draw(); d.showModal();
    }).catch(function () {}).finally(function () { askLoading = false; });
  }
  // Mini-presentation of a screen (2026-10-17): what it is for, by position; once, until « Ne plus afficher ».
  (function screenIntro() {
    var screen = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
    if (!screen || /^(login|excel|demarrer|bienvenue|index|presentation)$/.test(screen) || !OM.hasPersonalSession()) return;
    OM.api('/api/app?route=agent-intro&screen=' + encodeURIComponent(screen)).then(function (r) {
      if (!r || !r.text || document.getElementById('om-screen-intro')) return;
      var main = document.querySelector('main'); if (!main) return;
      var box = node('aside', null, 'card'); box.id = 'om-screen-intro'; box.setAttribute('role', 'note'); box.style.cssText = 'display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 14px;margin-bottom:12px';
      box.appendChild(node('span', r.text, 'small'));
      var hide = node('button', 'Ne plus afficher', 'btn ghost'); hide.type = 'button';
      hide.addEventListener('click', function () { box.remove(); OM.api('/api/app?route=agent-intro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'screen-seen', screen: screen }) }).catch(function () {}); });
      box.appendChild(hide); main.insertBefore(box, main.firstChild);
    }).catch(function () {});
  })();
  setInterval(function () { if (OM.hasPersonalSession() && (OM.getRole() === 'partner' || OM.getRole() === 'owner')) askPopup(true); }, 30000);
  // Shared notification centre: read state belongs to this person and this firm.
  function addBell(me) {
    if (document.getElementById('bell-btn') || /\/excel\//.test(location.pathname)) return;
    var seen = {}, storageKey = null, list = [], filter = 'all', expanded = false;
    var loaded = false, loading = false, error = '', lastAt = null;
    var toolbar = node('div', null, 'notification-tools');
    var bell = node('button', null, 'bell'); bell.type = 'button'; bell.id = 'bell-btn';
    bell.setAttribute('aria-label', 'Notifications'); bell.setAttribute('aria-haspopup', 'dialog');
    bell.setAttribute('aria-expanded', 'false'); bell.setAttribute('aria-controls', 'bell-panel');
    bell.appendChild(svgIcon('M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0'));
    bell.appendChild(node('span', 'Notifications', 'bell-label'));
    var badge = node('span', '', 'bell-badge'); badge.hidden = true; bell.appendChild(badge);
    toolbar.appendChild(bell);
    var host = document.querySelector('.main') || document.querySelector('main') || document.body;
    host.insertBefore(toolbar, host.firstChild);
    var panel = node('section', null, 'bell-panel'); panel.hidden = true; panel.id = 'bell-panel';
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'bell-title');
    document.body.appendChild(panel);
    // A redraw replaces the clicked filter. Keep that event inside the panel.
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    function readSeen() {
      try { var value = JSON.parse(localStorage.getItem(storageKey) || '{}'); seen = value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
      catch (e) { seen = {}; }
    }
    function reader(viewer) {
      if (!viewer || !viewer.org_id || !viewer.user_id) return;
      var next = 'om_seen_notifications:' + encodeURIComponent(viewer.org_id) + ':' + encodeURIComponent(viewer.user_id);
      if (next !== storageKey) { storageKey = next; readSeen(); }
    }
    function save() {
      if (!storageKey) return;
      try {
        var keys = Object.keys(seen).sort(function (a, b) { return seen[a] - seen[b]; });
        keys.slice(0, Math.max(0, keys.length - 800)).forEach(function (k) { delete seen[k]; });
        localStorage.setItem(storageKey, JSON.stringify(seen));
      } catch (e) { /* Reading notifications still works without device storage. */ }
    }
    function count() {
      var n = list.filter(function (x) { return !seen[x.key]; }).length;
      badge.hidden = !n; badge.textContent = n > 99 ? '99+' : String(n);
      bell.setAttribute('aria-label', 'Notifications' + (n ? ', ' + n + ' non lues' : ''));
    }
    function position() {
      var rect = bell.getBoundingClientRect();
      var top = Math.min(Math.max(12, rect.bottom + 8), Math.max(12, window.innerHeight - 180));
      panel.style.top = top + 'px'; panel.style.maxHeight = Math.max(140, window.innerHeight - top - 16) + 'px';
    }
    function button(text, cls, fn) {
      var b = node('button', text, cls); b.type = 'button'; b.addEventListener('click', fn); return b;
    }
    function href(value) {
      if (typeof value !== 'string' || value.charAt(0) !== '/' || value.slice(0, 2) === '//') return null;
      try { var url = new URL(value, location.origin); return url.origin === location.origin ? url.pathname + url.search + url.hash : null; }
      catch (e) { return null; }
    }
    function markRead(x) { seen[x.key] = Date.now(); save(); count(); }
    function draw() {
      var focused = document.activeElement && document.activeElement.getAttribute('data-bell-control');
      panel.textContent = '';
      var head = node('div', null, 'bell-head'); var title = node('h2', 'Notifications'); title.id = 'bell-title'; head.appendChild(title);
      var close = button('×', 'bell-close', function () { toggle(false); bell.focus(); });
      close.setAttribute('aria-label', 'Fermer les notifications'); close.setAttribute('data-bell-control', 'close'); head.appendChild(close); panel.appendChild(head);
      var filters = node('div', null, 'bell-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Filtrer les notifications');
      [['all', 'Toutes', list.length], ['unread', 'Non lues', list.filter(function (x) { return !seen[x.key]; }).length], ['action', 'À traiter', list.filter(function (x) { return x.action_required; }).length]].forEach(function (f) {
        var b = button(f[1] + ' (' + f[2] + ')', 'bell-filter', function () { filter = f[0]; expanded = false; draw(); });
        b.setAttribute('aria-pressed', String(filter === f[0])); b.setAttribute('data-bell-control', f[0]); filters.appendChild(b);
      });
      panel.appendChild(filters);
      var status = node('p', '', 'bell-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      if (error) { status.textContent = loaded ? 'Actualisation impossible. Les dernières notifications restent affichées.' : 'Les notifications sont indisponibles pour le moment.'; }
      else if (!loaded) status.textContent = 'Chargement des notifications…';
      else if (lastAt) status.textContent = 'Actualisé à ' + new Date(lastAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      panel.appendChild(status);
      if (error) panel.appendChild(button('Réessayer', 'bell-retry', load));
      var shown = list.filter(function (x) { return filter === 'unread' ? !seen[x.key] : filter === 'action' ? x.action_required : true; });
      var rows = node('div', null, 'bell-list');
      if (loaded && !shown.length) rows.appendChild(node('p', filter === 'unread' ? 'Toutes vos notifications sont lues.' : filter === 'action' ? 'Aucune notification ne demande une action.' : 'Aucune notification pour le moment.', 'bell-empty'));
      shown.slice(0, expanded ? shown.length : 12).forEach(function (x) {
        var row = node('article', null, 'bell-item' + (seen[x.key] ? ' read' : ''));
        var label = node('div', null, 'bell-item-label'); label.appendChild(node('span', x.label || 'Information', 'bell-type'));
        if (!seen[x.key]) { var dot = node('span', '', 'bell-unread'); dot.setAttribute('aria-label', 'Non lue'); label.appendChild(dot); }
        row.appendChild(label); row.appendChild(node('strong', x.title, 'bell-title'));
        if (x.meta) row.appendChild(node('span', x.meta, 'bell-meta'));
        if (x.at && Number.isFinite(Date.parse(x.at))) { var time = node('time', new Date(x.at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), 'bell-time'); time.dateTime = x.at; row.appendChild(time); }
        var actions = node('div', null, 'bell-item-actions'), link = href(x.href);
        if (link) {
          var a = node('a', x.action_label || 'Ouvrir', 'bell-open'); a.href = link;
          a.addEventListener('click', function () { markRead(x); }); actions.appendChild(a);
        }
        if (!seen[x.key]) {
          var read = button('Marquer comme lue', 'linkish', function () { markRead(x); draw(); });
          read.setAttribute('aria-label', 'Marquer comme lue : ' + x.title); actions.appendChild(read);
        }
        row.appendChild(actions); rows.appendChild(row);
      });
      panel.appendChild(rows);
      var foot = node('div', null, 'bell-footer');
      var all = button('Tout marquer comme lu', 'linkish', function () { list.forEach(markRead); draw(); });
      all.disabled = !list.some(function (x) { return !seen[x.key]; }); all.setAttribute('data-bell-control', 'mark-all'); foot.appendChild(all);
      if (shown.length > 12 && !expanded) foot.appendChild(button('Voir toutes les notifications', 'linkish', function () { expanded = true; draw(); }));
      panel.appendChild(foot); position();
      if (focused) { var replacement = panel.querySelector('[data-bell-control="' + focused + '"]'); if (replacement) replacement.focus(); }
    }
    function load() {
      if (!OM.getToken || !OM.getToken() || loading) return;
      loading = true;
      return OM.api('/api/app?route=notifications').then(function (d) {
        reader(d.viewer); list = Array.isArray(d.notifications) ? d.notifications : [];
        loaded = true; error = ''; lastAt = d.at || new Date().toISOString(); count();
        var link = document.querySelector('a[href="/validations.html"]');
        if (link && d.counts) {
          var tag = document.getElementById('nav-count');
          if (!tag) { tag = node('span', '', 'badge'); tag.id = 'nav-count'; link.appendChild(tag); }
          var pending = Number(d.counts.pending_actions) || 0; tag.hidden = !pending; tag.textContent = pending > 99 ? '99+' : String(pending);
        }
      }).catch(function (e) { error = String(e && e.message || 'NOTIFICATIONS_UNAVAILABLE'); })
        .then(function () { loading = false; if (!panel.hidden) draw(); });
    }
    function toggle(open) {
      panel.hidden = !open; bell.setAttribute('aria-expanded', String(open));
      if (open) { draw(); panel.querySelector('.bell-close').focus(); load(); }
    }
    bell.addEventListener('click', function (e) { e.stopPropagation(); toggle(panel.hidden); });
    document.addEventListener('click', function (e) { if (!panel.hidden && !panel.contains(e.target) && !bell.contains(e.target)) toggle(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { toggle(false); bell.focus(); } });
    window.addEventListener('resize', function () { if (!panel.hidden) position(); });
    window.addEventListener('storage', function (e) { if (storageKey && e.key === storageKey) { readSeen(); count(); if (!panel.hidden) draw(); } });
    setTimeout(load, 500); setInterval(function () { if (!document.hidden) load(); }, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  }

  function openClose() {
    var s = readSession() || {}, email = (s.user && s.user.email) || '';
    var d = node('dialog', null, 'om-dialog');
    d.appendChild(node('h2', 'Fermer mon compte'));
    d.appendChild(node('p', 'Votre accès à l’application s’arrête ; un propriétaire peut réactiver votre compte. Le Drive du cabinet reste tel quel.'));
    var owner = OM.getRole() === 'owner', firm = null, erase = null;
    if (owner) {
      var lab = node('label', null, 'om-check'); firm = node('input'); firm.type = 'checkbox';
      lab.appendChild(firm); lab.appendChild(document.createTextNode(' Je suis le dernier propriétaire : fermer et EFFACER l’espace du cabinet.'));
      d.appendChild(lab);
      // Erasing the space (Paul, 2026-10-11: « quand je ferme mon compte, toutes les données du cabinet partent »).
      var warn = node('div', null, 'om-erase'); warn.hidden = true;
      warn.appendChild(node('p', 'Seront effacés, sans retour : les missions, opportunités, personnes, rôles, décisions, réglages, la connexion Google et le choix du Drive, la veille, le journal, les comptes de connexion de tout le cabinet, et la mémoire des agents dans le Drive (mise à la corbeille du Drive). Restent : les documents du cabinet dans son Drive.'));
      warn.appendChild(node('p', 'Ensuite, créez un compte : vous serez le propriétaire d’un espace vierge et vous remplirez la configuration (compte, Google, Drive).'));
      var ef = node('div', null, 'field'); var el2 = node('label', 'Tapez EFFACER pour confirmer'); erase = node('input'); erase.type = 'text'; erase.id = 'close-erase'; erase.autocomplete = 'off'; el2.htmlFor = 'close-erase';
      ef.appendChild(el2); ef.appendChild(erase); warn.appendChild(ef); d.appendChild(warn);
      firm.addEventListener('change', function () { warn.hidden = !firm.checked; go.textContent = firm.checked ? 'Fermer et effacer le cabinet' : 'Fermer mon compte'; });
    }
    var f = node('div', null, 'field'); var l = node('label', 'Pour confirmer, tapez votre e-mail' + (email ? ' (' + email + ')' : '')); var inp = node('input'); inp.type = 'email'; inp.id = 'close-confirm'; l.htmlFor = 'close-confirm';
    f.appendChild(l); f.appendChild(inp); d.appendChild(f);
    var msg = node('p', '', 'status'); d.appendChild(msg);
    var row = node('div', null, 'om-actions');
    var cancel = node('button', 'Annuler', 'btn ghost'); cancel.type = 'button'; cancel.addEventListener('click', function () { d.close(); d.remove(); });
    var go = node('button', 'Fermer mon compte', 'btn danger'); go.type = 'button';
    go.addEventListener('click', function () {
      go.disabled = true; msg.className = 'status'; msg.textContent = 'Fermeture…';
      OM.api('/api/app?route=close-account', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: inp.value, close_firm: Boolean(firm && firm.checked), confirm_erase: erase ? erase.value : '' }) })
        .then(function () { OM.forget(false); location.replace(LOGIN_PAGE); })
        .catch(function (e) {
          go.disabled = false; msg.className = 'status error';
          msg.textContent = { CONFIRM_WITH_YOUR_EMAIL: 'L’e-mail tapé ne correspond pas à votre compte.', LAST_OWNER_CLOSES_FIRM: 'Vous êtes le dernier propriétaire : cochez la case pour fermer et effacer l’espace du cabinet, ou nommez d’abord un autre propriétaire.', TYPE_EFFACER_TO_CONFIRM: 'Tapez EFFACER pour confirmer l’effacement du cabinet.', PURGE_SQL_NOT_INSTALLED: 'L’effacement n’est pas encore installé dans Supabase (db/purge.sql) : rien n’a été effacé.', USER_SESSION_REQUIRED: 'Reconnectez-vous avec Google ou votre e-mail pour fermer votre compte.' }[e.message] || e.message;
        });
    });
    row.appendChild(cancel); row.appendChild(go); d.appendChild(row);
    document.body.appendChild(d); d.showModal(); inp.focus();
  }

  // ---- English (Paul, 2026-10-07: « il peut être français et anglais »). The pages are written in
  // French; in English, every French text shown is replaced by its translation: the login page
  // from a small built-in list, the other pages from the server (AI, once per text), kept in this
  // browser. Names (people, clients, missions, files) are not translated. ----
  var LANG_KEY = 'om_lang', I18N_KEY = 'om_i18n_en_v1';
  OM.getLang = function () { return safeGet(window.localStorage, LANG_KEY) === 'en' ? 'en' : 'fr'; };
  OM.setLang = function (l) { safeSet(window.localStorage, LANG_KEY, l === 'en' ? 'en' : 'fr'); location.reload(); };
  var LOGIN_EN = {
    'Connexion': 'Sign in', 'Espace du cabinet': 'Firm workspace',
    'Avec le compte Google du cabinet. Première fois ? Le même bouton crée votre compte : aucun mot de passe à retenir.': 'With the firm’s Google account. First time? The same button creates your account: no password to remember.',
    'Nouveau cabinet ? Démarrer ici': 'New firm? Start here', 'Continuer avec Google': 'Continue with Google',
    'Se connecter avec un e-mail et un mot de passe': 'Sign in with an e-mail and a password', 'ou': 'or',
    'Adresse e-mail': 'E-mail address', 'Mot de passe': 'Password', 'Afficher le mot de passe': 'Show password', 'Se connecter': 'Sign in',
    'Pas encore de compte ?': 'No account yet?', 'Créer un compte': 'Create an account', 'Autres options': 'Other options',
    'Je suis le propriétaire du cabinet': 'I am the firm’s owner',
    'Votre e-mail et votre mot de passe (créez d\'abord votre compte si besoin), puis le code propriétaire du cabinet, une seule fois.': 'Your e-mail and password (create your account first if needed), then the firm’s owner code, once.',
    'Votre adresse e-mail': 'Your e-mail address', 'Votre mot de passe': 'Your password', 'Code propriétaire du cabinet': 'Firm owner code',
    'Devenir propriétaire et entrer': 'Become owner and enter', 'Créer mon compte': 'Create my account',
    'Votre compte sera actif dès que le propriétaire du cabinet vous aura donné un rôle. Si vous êtes le propriétaire, créez votre compte puis cliquez sur « Je suis le propriétaire du cabinet ».': 'Your account becomes active once the firm’s owner gives you a role. If you are the owner, create your account, then click “I am the firm’s owner”.',
    'Votre nom': 'Your name', 'Choisissez un mot de passe (10 caractères minimum, avec lettres et chiffres)': 'Choose a password (at least 10 characters, letters and digits)',
    'Se connecter avec le code d\'accès du cabinet': 'Sign in with the firm’s access code',
    'Solution provisoire, tant que les comptes ne sont pas créés : le même code que l\'ancienne console pilote.': 'Temporary option until accounts exist: the same code as the old pilot console.',
    'Code d\'accès du cabinet': 'Firm access code', 'Entrer': 'Enter', 'Vérifier mon code': 'Check my code', 'Code à vérifier': 'Code to check', 'Vérifier': 'Check',
    'Tapez un code : l\'application vous dit si c\'est le code d\'accès, le code propriétaire, ou aucun des deux, et ce qui manque sur le serveur. Aucun secret n\'est affiché.': 'Type a code: the app tells you whether it is the access code, the owner code or neither, and what is missing on the server. No secret is shown.',
    'Connexion annulée dans Google.': 'Sign-in cancelled in Google.', 'Adresse e-mail invalide.': 'Invalid e-mail address.', 'E-mail ou mot de passe incorrect.': 'Wrong e-mail or password.',
    'Trop de tentatives. Réessayez dans quelques minutes.': 'Too many attempts. Try again in a few minutes.', 'Indisponible pour le moment.': 'Unavailable for now.',
    'Connexion impossible pour le moment (serveur de comptes).': 'Sign-in unavailable for now (accounts server).',
    'La demande a expiré : cliquez à nouveau sur « Continuer avec Google ».': 'The request expired: click “Continue with Google” again.',
    'Cette adresse n’a pas encore de compte ici. Cliquez sur « Continuer avec Google » : votre compte est créé en un clic.': 'This address has no account here yet. Click “Continue with Google”: your account is created in one click.',
    'Mot de passe trop faible : 10 caractères minimum, avec des lettres et des chiffres.': 'Password too weak: at least 10 characters, with letters and digits.',
    'Cette adresse a déjà un compte.': 'This address already has an account.', 'Indiquez votre nom.': 'Enter your name.', 'Vous avez déjà un compte : connectez-vous.': 'You already have an account: sign in.'
  };
  function startI18n() {
    if (OM.getLang() !== 'en') return;
    document.documentElement.lang = 'en';
    var cache = {}; try { cache = JSON.parse(safeGet(window.localStorage, I18N_KEY) || '{}') || {}; } catch (e) { cache = {}; }
    Object.keys(LOGIN_EN).forEach(function (k) { if (!cache[k]) cache[k] = LOGIN_EN[k]; });
    // Match the agent-name formatter before touching the DOM. Otherwise its
    // observer and the translator can alternate between two labels forever.
    var english = new Set(Object.keys(cache).map(function (k) { return renameText(cache[k]); }));
    var queue = new Set(), attempted = new Set(), timer = null, sending = false;
    var SKIP = 'script,style,textarea,code,pre,[data-keep],[data-user-name],[data-firm-name],.mtile .client,.mtile .name,.avatar';
    var worth = function (t) { return t.length > 1 && /[A-Za-zÀ-ÿ]{2}/.test(t) && !english.has(t) && !/^[\w.+-]+@[\w.-]+$/.test(t) && !/^[A-Z0-9_\-]{2,}$/.test(t) && !/^https?:/.test(t); };
    function tr(t) { var k = t.trim(); if (!worth(k)) return null; if (cache[k]) return t.replace(k, renameText(cache[k])); if (!attempted.has(k)) queue.add(k); return null; }
    function pass(root) {
      if (!root || root.nodeType !== 1 && root.nodeType !== 9) return;
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
      var n; while ((n = w.nextNode())) { var v = tr(n.nodeValue); if (v != null && v !== n.nodeValue) n.nodeValue = v; }
      (root.querySelectorAll ? root.querySelectorAll('[placeholder],[aria-label],[title]') : []).forEach(function (el) {
        if (el.closest(SKIP)) return;
        ['placeholder', 'aria-label', 'title'].forEach(function (a) { var x = el.getAttribute(a); if (!x) return; var v = tr(x); if (v != null && v !== x) el.setAttribute(a, v); });
      });
      if (document.title) { var tt = tr(document.title); if (tt) document.title = tt; }
      if (queue.size) send();
    }
    function send() {
      if (sending || !OM.getToken()) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        var batch = [], size = 0;
        queue.forEach(function (t) { if (batch.length < 120 && size + t.length < 20000) { batch.push(t); size += t.length; } });
        if (!batch.length) return;
        batch.forEach(function (t) { attempted.add(t); });
        sending = true;
        OM.api('/api/app?route=translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: 'en', texts: batch }) })
          .then(function (d) {
            var got = (d && d.translations) || {};
            Object.keys(got).forEach(function (k) {
              if (typeof got[k] !== 'string' || !got[k].trim()) return;
              cache[k] = got[k]; english.add(renameText(got[k]));
            });
            var keys = Object.keys(cache); if (keys.length > 6000) keys.slice(0, keys.length - 6000).forEach(function (k) { delete cache[k]; });
            safeSet(window.localStorage, I18N_KEY, JSON.stringify(cache));
          })
          .catch(function () {})
          .then(function () { batch.forEach(function (t) { queue.delete(t); }); sending = false; pass(document.body); });
      }, 250);
    }
    var pending = false;
    new MutationObserver(function () { if (pending) return; pending = true; setTimeout(function () { pending = false; pass(document.body); }, 60); })
      .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    pass(document.body);
  }
  // ---- Workspace shell: icons in the rail, a menu button on small screens, tabs for long pages ----
  // Which roles see which page in the menu (specification §55: one workspace per role).
  var WORKERS = ['owner', 'partner', 'quality_reviewer', 'bdm', 'manager', 'supervisor', 'senior', 'auditor', 'secretary', 'collaborator'];
  var NAV_ROLES = {
    '/recherche.html': WORKERS, '/mission.html': WORKERS, '/rangement.html': WORKERS, '/validations.html': WORKERS, '/messagerie.html': WORKERS, '/assistant.html': WORKERS,
    '/opportunites.html': ['owner', 'partner', 'bdm', 'manager', 'supervisor', 'senior', 'auditor', 'secretary', 'collaborator'],
    '/equipe.html': ['owner', 'partner', 'manager', 'supervisor'],
    '/preparation.html': ['owner', 'partner', 'manager', 'supervisor'],
    '/auditeur.html': ['owner', 'partner', 'quality_reviewer', 'bdm', 'manager', 'supervisor', 'senior', 'auditor', 'collaborator'],
    '/pilotage.html': ['owner', 'partner', 'quality_reviewer'],
    '/entrainement.html': ['owner', 'partner', 'it_admin'],
    '/veille.html': ['owner', 'partner', 'bdm'],
    '/mise-en-service.html': ['owner', 'partner', 'it_admin'], '/parametres.html': ['owner', 'partner', 'it_admin']
  };
  var ICONS = {
    '/accueil.html': 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    '/recherche.html': 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm10 17l-5-5',
    '/opportunites.html': 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h4',
    '/veille.html': 'M3 11h3l3-6 4 14 3-8h5',
    '/mission.html': 'M4 7h16v12H4zM9 7V5h6v2M4 12h16',
    '/rangement.html': 'M3 6h7l2 2h9v11H3zM8 13h8',
    '/equipe.html': 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 0a2.5 2.5 0 1 0 0-5M3 20c0-3 3-5 6-5s6 2 6 5m2-5c2 0 4 1.5 4 4',
    '/validations.html': 'M5 12l4 4 10-10M4 20h16',
    '/messagerie.html': 'M4 5h16v11H8l-4 4z',
    '/assistant.html': 'M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z',
    '/entrainement.html': 'M4 19V9l8-5 8 5v10M9 19v-6h6v6',
    '/preparation.html': 'M9 4h6l1 2h3v14H5V6h3zM9 11h6M9 15h4',
    '/auditeur.html': 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm10 17l-5-5M8 11l2 2 4-4',
    '/pilotage.html': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    '/mise-en-service.html': 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l3 3m6 6l3 3M18 6l-3 3M9 15l-3 3',
    '/parametres.html': 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6l1.4 1.4m0-11.4l-1.4 1.4m-8.6 8.6l-1.4 1.4'
  };
  function decorateShell() {
    var nav = document.querySelector('.nav');
    if (!nav || nav.dataset.decorated) return;
    nav.dataset.decorated = '1';
    // Setup and settings live in the settings wheel at the bottom of the menu.
    nav.querySelectorAll('a[href="/parametres.html"], a[href="/mise-en-service.html"]').forEach(function (a) { if (a.getAttribute('aria-current') !== 'page') a.remove(); else a.classList.add('in-wheel'); });
    // Pages added on 2026-10-08, placed in every page's menu from here (one place to maintain).
    // The tender watch (2026-10-11), placed just before « Opportunités » on every page.
    var opp = nav.querySelector('a[href="/opportunites.html"]');
    if (opp && !nav.querySelector('a[href="/veille.html"]')) { var w = document.createElement('a'); w.href = '/veille.html'; w.textContent = 'Veille des appels d’offres'; if (location.pathname === '/veille.html') w.setAttribute('aria-current', 'page'); opp.parentNode.insertBefore(w, opp); }
    var after = nav.querySelector('a[href="/assistant.html"]');
    [['/preparation.html', 'Préparer une mission'], ['/auditeur.html', 'Enhanced Auditor'], ['/pilotage.html', 'Tableau des associés', true]].forEach(function (x) {
      if (nav.querySelector('a[href="' + x[0] + '"]') || !after) return;
      var link = document.createElement('a'); link.href = x[0]; link.textContent = x[1];
      if (location.pathname === x[0]) link.setAttribute('aria-current', 'page');
      if (x[2]) link.setAttribute('data-partners-only', '');
      after.parentNode.insertBefore(link, after.nextSibling); after = link;
    });
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
    if (!main || main.dataset.tabs || main.hasAttribute('data-no-tabs')) return;
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
    var current = 0;
    function select(i) {
      current = i;
      best.forEach(function (sec, j) { sec.style.display = j === i ? '' : 'none'; buttons[j].setAttribute('aria-selected', String(j === i)); });
    }
    // Sections the page itself hides (not ready yet, owner only…) lose their tab too; if the
    // open tab disappears, the first visible one opens.
    function sync() {
      // Written only when it changes: the observer below watches « hidden ».
      buttons.forEach(function (b, j) { if (b.hidden !== best[j].hidden) b.hidden = best[j].hidden; });
      var visible = best.filter(function (sec) { return !sec.hidden; });
      if (bar.hidden !== (visible.length < 2)) bar.hidden = visible.length < 2;
      if (best[current].hidden && visible.length) select(best.indexOf(visible[0]));
    }
    new MutationObserver(sync).observe(main, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    best[0].parentElement.insertBefore(bar, best[0]);
    // A link to a section (/parametres.html#h-google, the settings wheel) opens its tab.
    function fromHash() {
      var id = decodeURIComponent(location.hash.slice(1)); if (!id) return false;
      for (var i = 0; i < best.length; i++) {
        if (best[i].id === id || best[i].querySelector('[id="' + id.replace(/"/g, '') + '"]')) { select(i); window.scrollTo(0, 0); return true; }
      }
      return false;
    }
    window.addEventListener('hashchange', fromHash);
    sync(); if (!fromHash()) select(Math.min(saved, best.length - 1));
  }


  // Agents' names chosen by the firm (2026-10-08: « Firm Manager au lieu d'Office Manager,
  // Orpailleur clandestin… et la possibilité de les renommer »). The page keeps its texts; the
  // names are replaced on screen, everywhere, from the firm's choice (Paramètres → Noms des agents).
  var NAMES_KEY = 'om_agent_names';
  var DEFAULT_LABELS = [
    ['grand-controleur', ['Grand Contrôleur / Office Manager AI', 'Office Manager AI', 'Office Manager', 'Grand Contrôleur', 'Grand Controleur', 'Firm Manager']],
    ['orpailleur', ['Orpailleur']],
    ['sika', ['Sika']],
    ['mission-controller', ['Mission Controller']],
    ['enhanced-auditor', ['Enhanced Auditor']]
  ];
  var renameRe = null, renameMap = {};
  function escRe(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function buildRename(names) {
    var alts = [];
    renameMap = {};
    DEFAULT_LABELS.forEach(function (d) {
      var to = names && names[d[0]]; if (!to) return;
      d[1].forEach(function (from) {
        if (from === to) return;
        renameMap[from.toLowerCase()] = to;
        // « Orpailleur » → « Orpailleur clandestin »: never twice.
        var tail = to.indexOf(from) === 0 ? to.slice(from.length) : '';
        alts.push(escRe(from) + (tail ? '(?!' + escRe(tail) + ')' : ''));
      });
    });
    alts.sort(function (a, b) { return b.length - a.length; });
    renameRe = alts.length ? new RegExp('(^|[^\\p{L}])(' + alts.join('|') + ')(?![\\p{L}])', 'gu') : null;
  }
  function renameText(t) {
    if (!renameRe || !t) return t;
    return t.replace(renameRe, function (m, pre, word) { return pre + (renameMap[word.toLowerCase()] || word); });
  }
  function renameIn(root) {
    if (!renameRe || !root) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      var p = n.parentElement; if (!p) return NodeFilter.FILTER_REJECT;
      if (/^(SCRIPT|STYLE|TEXTAREA|INPUT|CODE|PRE)$/.test(p.tagName) || p.closest('[data-no-rename],[contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT; } });
    var n, list = [];
    while ((n = w.nextNode())) list.push(n);
    list.forEach(function (x) { var v = renameText(x.nodeValue); if (v !== x.nodeValue) x.nodeValue = v; });
    if (root.querySelectorAll) Array.prototype.forEach.call(root.querySelectorAll('[title],[placeholder],[aria-label]'), function (el) {
      if (el.closest('[data-no-rename]')) return;
      ['title', 'placeholder', 'aria-label'].forEach(function (a) { var v = el.getAttribute(a); if (v) { var r = renameText(v); if (r !== v) el.setAttribute(a, r); } });
    });
    var t = renameText(document.title); if (t !== document.title) document.title = t;
  }
  OM.agentNames = function () { try { return JSON.parse(window.localStorage.getItem(NAMES_KEY) || 'null'); } catch (e) { return null; } };
  OM.setAgentNames = function (names) { try { window.localStorage.setItem(NAMES_KEY, JSON.stringify(names || {})); } catch (e) { /* private mode */ } buildRename(names); renameIn(document.body); };
  OM.agentName = function (key) { var n = OM.agentNames(); return (n && n[key]) || ({ 'grand-controleur': 'Firm Manager', orpailleur: 'Orpailleur clandestin', sika: 'Silkoundêfouê', 'mission-controller': 'Mission Controller', 'enhanced-auditor': 'Enhanced Auditor', shadow: 'Shadow' })[key] || key; };
  function startRename() {
    var cached = OM.agentNames() || { 'grand-controleur': 'Firm Manager', orpailleur: 'Orpailleur clandestin', sika: 'Silkoundêfouê' };
    buildRename(cached); renameIn(document.body);
    var pendingR = false;
    new MutationObserver(function () { if (pendingR) return; pendingR = true; setTimeout(function () { pendingR = false; renameIn(document.body); }, 50); })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
    if (!onLoginPage() && readSession()) OM.api('/api/app?route=agent-names').then(function (s) { if (s && s.names) OM.setAgentNames(s.names); }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startRename); else startRename();
  var i18nReady = function () { startI18n(); if (onLoginPage()) loginLangSwitch(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', i18nReady); else i18nReady();
  function loginLangSwitch() {
    var host = document.querySelector('.login-card') || document.querySelector('.main') || document.body;
    var p = node('p', null, 'lang-switch'); p.setAttribute('data-keep', '');
    var other = OM.getLang() === 'en' ? ['fr', 'Français'] : ['en', 'English'];
    var b = node('button', other[1], 'link-lang'); b.type = 'button'; b.addEventListener('click', function () { OM.setLang(other[0]); });
    p.appendChild(b); host.appendChild(p);
  }
  if (!onLoginPage() && !inExcel()) {
    if (!readSession()) { OM.forget(true); return; }
    if (readSession().needs_cabinet) { location.replace(CABINETS_PAGE); return; }
    var ready = function () { decorateShell(); autoTabs(); addLogout(); OM.paintUser(); OM.checkSession(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
  }
  function startIndependenceReview() { if (onLoginPage() || inExcel() || !OM.hasPersonalSession()) return; var script = document.createElement('script'); script.src = '/assets/independence-review.js'; document.head.appendChild(script); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startIndependenceReview); else startIndependenceReview();
  // SIKA extends the existing mission, accounting workspace and settings; no separate page.
  function startSikaExpenses() { if (onLoginPage() || inExcel() || !OM.hasPersonalSession()) return; var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/assets/sika-expenses.css'; document.head.appendChild(css); var script = document.createElement('script'); script.src = '/assets/sika-expenses.js'; document.head.appendChild(script); }
  startSikaExpenses();
  function startWorkExperience() { if (onLoginPage() || inExcel() || !OM.hasPersonalSession()) return; var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/assets/work-experience.css'; document.head.appendChild(css); var script = document.createElement('script'); script.src = '/assets/work-experience.js'; document.head.appendChild(script); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWorkExperience); else startWorkExperience();
  function startCollaboration() { if (onLoginPage() || inExcel() || !OM.hasPersonalSession()) return; var script = document.createElement('script'); script.src = '/assets/live-collaboration.js'; document.head.appendChild(script); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startCollaboration); else startCollaboration();
  // Additive dossier navigation: existing screens and their controls remain available.
  function addDossierNavigation() {
    if (onLoginPage() || inExcel() || !readSession()) return;
    var nav = document.querySelector('.nav');
    if (nav && !nav.querySelector('a[href="/dossiers.html"]') && OM.getRole() !== 'it_admin') {
      var a = node('a', 'Mes dossiers'); a.href = '/dossiers.html';
      var brand = nav.querySelector('.brand');
      nav.insertBefore(a, brand ? brand.nextSibling : nav.firstChild);
    }
    var main = document.querySelector('.main'), p = new URLSearchParams(location.search);
    var mission = location.pathname === '/mission.html' ? p.get('id') : p.get('mission_id');
    var opportunity = location.pathname === '/opportunites.html' ? p.get('id') : p.get('opportunity_id');
    if (main && location.pathname !== '/dossiers.html' && (mission || opportunity)) {
      var q = new URLSearchParams(); if (mission) q.set('mission_id', mission); if (opportunity) q.set('opportunity_id', opportunity);
      var link = node('a', 'Voir le dossier, les travaux et les relais →', 'btn ghost'); link.href = '/dossiers.html?' + q;
      main.insertBefore(link, main.firstChild);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addDossierNavigation); else addDossierNavigation();
})();
