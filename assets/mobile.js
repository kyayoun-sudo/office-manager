/* Firm Manager Mobile E1: read-only overview and links to existing working screens.
   Uses the exact same OfficeManager session and APIs as the desktop interface.
   No sensitive caching, no independent auth, no simulated agent execution. */
(function () {
  'use strict';

  var OM = window.OfficeManager;
  var tabs = ['accueil', 'messages', 'ia', 'missions', 'travail'];
  var active = 'accueil';
  var loaded = Object.create(null);
  var serial = Object.create(null);

  function $(id) { return document.getElementById(id); }
  function node(tag, value, cls) {
    var el = document.createElement(tag);
    if (value != null) el.textContent = String(value);
    if (cls) el.className = cls;
    return el;
  }
  function safePath(href, fallback) {
    if (typeof href !== 'string' || href.startsWith('//')) return fallback;
    try {
      var u = new URL(href, location.origin);
      return u.origin === location.origin && /^\/[a-z0-9-]+\.html$/i.test(u.pathname)
        ? u.pathname + u.search + u.hash : fallback;
    } catch (_) { return fallback; }
  }
  function detail(text) { $('mobile-status').textContent = text || ''; }
  function errorText(e) {
    if (!navigator.onLine || e && e.code === 'NETWORK_REQUEST_FAILED') return 'Réseau indisponible. Réessayez une fois reconnecté.';
    return 'Chargement impossible : ' + (e && e.message || 'erreur du serveur');
  }
  function updateNetwork() {
    $('mobile-network').hidden = navigator.onLine;
  }
  function placeholder(target, message, isError) {
    var box = $(target);
    box.replaceChildren(node('p', message, isError ? 'mobile-error' : 'mobile-muted'));
  }
  function listItem(title, subtitle, href, symbol) {
    var a = node('a', null, 'mobile-list-item');
    a.href = href;
    var ico = node('span', symbol || '•', 'mobile-list-icon');
    ico.setAttribute('aria-hidden', 'true');
    var wrap = node('span');
    wrap.appendChild(node('strong', title));
    if (subtitle) wrap.appendChild(node('small', subtitle));
    var more = node('span', '›');
    more.setAttribute('aria-hidden', 'true');
    a.append(ico, wrap, more);
    return a;
  }
  function setTab(which, changeHistory) {
    if (tabs.indexOf(which) < 0) which = 'accueil';
    active = which;
    document.querySelectorAll('[data-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== which;
    });
    document.querySelectorAll('[data-tab]').forEach(function (button) {
      if (button.dataset.tab === which) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    if (changeHistory && location.hash !== '#' + which) history.pushState(null, '', '#' + which);
    window.scrollTo(0, 0);
    refresh(false);
  }
  function syncUrl() { setTab(location.hash.slice(1) || 'accueil', false); }

  function renderNotifications(items) {
    var actionable = items.filter(function (n) { return n && n.action_required; });
    function fill(target, list, max) {
      var box = $(target);
      box.replaceChildren();
      if (!list.length) {
        box.appendChild(node('p', 'Rien à traiter pour le moment.', 'mobile-muted'));
        return;
      }
      list.slice(0, max).forEach(function (n) {
        box.appendChild(listItem(n.title || n.label || 'Notification', n.meta || n.label || '',
          safePath(n.href, '/validations.html'), n.action_required ? '✓' : '•'));
      });
    }
    fill('mobile-home-tasks', actionable, 4);
    fill('mobile-tasks', items, 25);
    if (!items.length) placeholder('mobile-tasks', 'Aucune notification disponible.', false);
  }
  function notifications(force) {
    if (loaded.notifications && !force) return Promise.resolve();
    placeholder('mobile-home-tasks', 'Chargement…', false);
    placeholder('mobile-tasks', 'Chargement…', false);
    var thisRun = serial.notifications = (serial.notifications || 0) + 1;
    return OM.api('/api/app?route=notifications').then(function (d) {
      if (serial.notifications !== thisRun) return;
      loaded.notifications = true;
      renderNotifications(Array.isArray(d.notifications) ? d.notifications : []);
    }).catch(function (e) {
      if (serial.notifications !== thisRun) return;
      placeholder('mobile-home-tasks', errorText(e), true);
      placeholder('mobile-tasks', errorText(e), true);
    });
  }
  function missions(force) {
    if (loaded.missions && !force) return Promise.resolve();
    placeholder('mobile-missions', 'Chargement des missions…', false);
    var thisRun = serial.missions = (serial.missions || 0) + 1;
    return OM.api('/api/missions').then(function (d) {
      if (serial.missions !== thisRun) return;
      var box = $('mobile-missions');
      box.replaceChildren();
      var list = Array.isArray(d.missions) ? d.missions : [];
      if (!list.length) box.appendChild(node('p', 'Aucune mission accessible.', 'mobile-muted'));
      list.slice(0, 30).forEach(function (m) {
        if (!m || !m.id) return;
        box.appendChild(listItem(m.name || m.mission_code || 'Mission',
          [m.mission_code, m.status].filter(Boolean).join(' · '),
          '/mission.html?id=' + encodeURIComponent(m.id), '▣'));
      });
      loaded.missions = true;
      if (window.FirmMobileCapture) window.FirmMobileCapture.setMissions(list);
    }).catch(function (e) {
      if (serial.missions !== thisRun) return;
      placeholder('mobile-missions', errorText(e), true);
    });
  }
  function messages(force) {
    if (window.FirmMobileChat) return window.FirmMobileChat.refresh(force);
    if (loaded.messages && !force) return Promise.resolve();
    placeholder('mobile-chats', 'Chargement des conversations…', false);
    var thisRun = serial.messages = (serial.messages || 0) + 1;
    return OM.api('/api/app?route=chat&conversation=cabinet').then(function (d) {
      if (serial.messages !== thisRun) return;
      if (d.available === false) {
        placeholder('mobile-chats', 'Messagerie indisponible : configuration du cabinet à vérifier.', true);
        return;
      }
      var box = $('mobile-chats'), list = Array.isArray(d.conversations) ? d.conversations : [];
      box.replaceChildren();
      if (!list.length) box.appendChild(node('p', 'Aucune conversation.', 'mobile-muted'));
      list.slice(0, 20).forEach(function (c) {
        var excerpt = c.last ? [c.last.from, c.last.body].filter(Boolean).join(' : ') : 'Aucun message récent';
        box.appendChild(listItem(c.label || 'Conversation', excerpt, '/messagerie.html', '☏'));
      });
      loaded.messages = true;
    }).catch(function (e) {
      if (serial.messages !== thisRun) return;
      placeholder('mobile-chats', errorText(e), true);
    });
  }
  function refresh(force) {
    detail('');
    if (active === 'accueil') return notifications(force);
    if (active === 'travail') return Promise.all([
      notifications(force),
      window.FirmMobileTasks ? window.FirmMobileTasks.refresh(force) : Promise.resolve(),
      window.FirmMobileMail ? window.FirmMobileMail.refresh(force) : Promise.resolve()
    ]);
    if (active === 'missions') return missions(force);
    if (active === 'messages') return messages(force);
    return Promise.resolve();
  }
  function connectNav() {
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.tab, true); });
    });
    document.querySelectorAll('[data-open-tab]').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.openTab, true); });
    });
    $('mobile-refresh').addEventListener('click', function () { refresh(true); });
    window.addEventListener('popstate', syncUrl);
    window.addEventListener('hashchange', syncUrl);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    window.addEventListener('pageshow', function (event) { if (event.persisted) refresh(true); });
  }
  // Install only a browser-backed mobile shell. No second account or device-side AI.
  var deferredInstall = null;
  var dismissedInstall = false;
  function installedMode() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }
  function installationBanner() {
    var banner = $('mobile-install');
    if (!banner) return;
    var mobileAgent = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (installedMode() || dismissedInstall || (!mobileAgent && !deferredInstall)) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    var ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    $('mobile-install-cta').hidden = !deferredInstall;
    $('mobile-install-hint').textContent = deferredInstall
      ? 'Installez Firm Manager comme une application depuis votre navigateur.'
      : ios
        ? 'Dans Safari : Partager → Ajouter à l’écran d’accueil → Ouvrir comme app.'
        : 'Dans le menu du navigateur : Installer l’application ou Ajouter à l’écran d’accueil.';
  }
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredInstall = event;
    if (!$('mobile-app').hidden) installationBanner();
  });
  window.addEventListener('appinstalled', function () {
    deferredInstall = null;
    dismissedInstall = true;
    installationBanner();
  });
  $('mobile-install-close').addEventListener('click', function () {
    dismissedInstall = true;
    installationBanner();
  });
  $('mobile-install-cta').addEventListener('click', function () {
    if (!deferredInstall) return;
    var event = deferredInstall;
    deferredInstall = null;
    var result = event.prompt();
    Promise.resolve(result).then(function () {
      return event.userChoice;
    }).then(function (choice) {
      if (choice && choice.outcome === 'accepted') dismissedInstall = true;
    }).catch(function () {
      detail('Installation non disponible : utilisez le menu de votre navigateur.');
    }).finally(installationBanner);
  });

  function login() {
    // login.html deliberately validates "next" without a # fragment.
    location.replace('/login.html?next=' + encodeURIComponent('/mobile.html'));
  }
  function showRetry() {
    var lock = $('mobile-lock');
    lock.replaceChildren(node('p', 'Impossible de vérifier votre session. Vérifiez votre connexion puis réessayez.'));
    var button = node('button', 'Réessayer', 'mobile-secondary');
    button.type = 'button';
    button.addEventListener('click', boot);
    lock.appendChild(button);
  }
  function boot() {
    if (!OM || !OM.hasPersonalSession()) { login(); return; }
    var s = OM.getSession();
    if (!s || !s.org_id || s.needs_cabinet) {
      location.replace('/cabinets.html');
      return;
    }
    $('mobile-lock').textContent = 'Vérification de votre connexion…';
    OM.checkSession().then(function (confirmed) {
      if (!confirmed) { showRetry(); return; }
      $('mobile-lock').hidden = true;
      $('mobile-app').hidden = false;
      OM.paintUser();
      $('mobile-role').textContent = OM.roleLabel() || 'Mon espace';
      OM.loadBranding().catch(function () { /* The user still has a valid session. */ });
      updateNetwork();
      if ('serviceWorker' in navigator && window.isSecureContext) {
        navigator.serviceWorker.register('/mobile-sw.js', { scope: '/' }).catch(function () {
          // A browser without service-worker support still loads the regular online app.
        });
      }
      installationBanner();
      if (window.FirmMobileChat) window.FirmMobileChat.init(OM);
      if (window.FirmMobileAI) window.FirmMobileAI.init(OM);
      if (window.FirmMobileCapture) window.FirmMobileCapture.init(OM);
      if (window.FirmMobileTasks) window.FirmMobileTasks.init(OM);
      if (window.FirmMobileMail) window.FirmMobileMail.init(OM);
      if (!boot.navReady) { connectNav(); boot.navReady = true; }
      syncUrl();
    }).catch(showRetry);
  }
  boot();
})();
