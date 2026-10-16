(function () {
  'use strict';
  var OM = window.OfficeManager;
  if (!OM || !OM.hasPersonalSession() || OM.getRole() === 'it_admin') return;
  var session = OM.getSession(), user = session.user || {};
  var key = 'om-chat-sound:' + (user.org_id || '') + ':' + (user.email || user.auth_user_id || '');
  var previous = null, busy = false, audio, lastBeat = 0;
  var button = document.createElement('button'); button.type = 'button';
  var enabled = localStorage.getItem(key) !== 'off';
  function label() { button.textContent = enabled ? '🔔 Son des messages activé' : '🔕 Son des messages désactivé'; button.setAttribute('aria-pressed', String(enabled)); }
  label();
  function unlock() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume().catch(function () {}); } catch (_) {} }
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  button.onclick = function () { enabled = !enabled; localStorage.setItem(key, enabled ? 'on' : 'off'); unlock(); label(); };
  var host = document.querySelector('.nav') || document.querySelector('main');
  if (host) host.appendChild(button);
  var panel;
  if (OM.isManager() && host) {
    panel = document.createElement('details'); var summary = document.createElement('summary'); summary.textContent = 'En ligne'; panel.appendChild(summary);
    var list = document.createElement('div'); list.setAttribute('role', 'status'); panel.appendChild(list); host.appendChild(panel);
  }
  function ring(ids) {
    if (!enabled || !audio || audio.state !== 'running') return;
    // Shared browser claim prevents the same message ringing in every open tab.
    var claim = key + ':last-alert', token = ids.slice().sort().join(',');
    if (localStorage.getItem(claim) === token) return;
    localStorage.setItem(claim, token);
    var oscillator = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime;
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.frequency.setValueAtTime(660, t); oscillator.frequency.setValueAtTime(880, t + .14);
    gain.gain.setValueAtTime(.0001, t); gain.gain.exponentialRampToValueAtTime(.12, t + .02); gain.gain.exponentialRampToValueAtTime(.0001, t + .4);
    oscillator.start(t); oscillator.stop(t + .42);
  }
  window.addEventListener('om-chat-arrived', function (event) { if (event.detail.length) ring(event.detail); });
  function render(d) {
    if (!d.available) throw new Error('Installation de db/live-collaboration.sql nécessaire.');
    document.querySelectorAll('a[href="/messagerie.html"]').forEach(function (a) {
      var badge = a.querySelector('[data-chat-count]');
      if (!badge) { badge = document.createElement('span'); badge.setAttribute('data-chat-count', ''); badge.style.cssText = 'margin-left:6px;background:#b45309;color:white;border-radius:12px;padding:2px 7px;font-size:12px'; a.appendChild(badge); }
      badge.textContent = String(d.unread); badge.hidden = !d.unread;
      a.setAttribute('aria-label', 'Messages, ' + d.unread + ' non lus');
    });
    if (panel) { panel.firstChild.textContent = '● En ligne (' + d.people.length + ')'; list.textContent = ''; d.people.forEach(function (p) { var a = document.createElement('a'); a.href = '/messagerie.html?to=' + encodeURIComponent(p.email); a.textContent = '● ' + p.name; a.style.cssText = 'display:block;padding:6px;color:inherit'; list.appendChild(a); }); if (!d.people.length) list.textContent = 'Aucune présence récente dans votre périmètre.'; panel.title = 'Onglets visibles récemment · actualisation 5 s · expiration 45 s'; }
    var fresh = d.unread_ids.filter(function (id) { return previous && previous.indexOf(id) < 0; });
    if (fresh.length) ring(fresh);
    previous = d.unread_ids;
    window.dispatchEvent(new CustomEvent('om-chat-counts', { detail: d.conversations }));
  }
  function poll() {
    if (busy || !OM.hasPersonalSession()) return;
    busy = true;
    var beat = !document.hidden && Date.now() - lastBeat > 14000;
    if (beat) lastBeat = Date.now();
    OM.api('/api/app?route=chat' + (beat ? '' : '&live=1'), beat ? { method: 'POST', body: JSON.stringify({ action: 'heartbeat' }) } : undefined)
      .then(render).catch(function () { if (panel) { panel.firstChild.textContent = 'Présence indisponible'; list.textContent = 'Connexion ou configuration à vérifier.'; } }).finally(function () { busy = false; });
  }
  window.addEventListener('om-chat-read', poll);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  poll(); setInterval(poll, 5000);
})();
