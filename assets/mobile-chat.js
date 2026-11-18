/* Firm Manager Mobile E3: internal chat, same account, same protected API.
   No browser-side chat database, no direct third-party access, no external email. */
(function () {
  'use strict';

  var om = null;
  var state = {
    key: 'cabinet', to: null, archive: false, open: false, sending: false,
    request: 0, loaded: false, timer: null, conversations: [], users: [],
    missions: [], groups: [], myEmail: ''
  };
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, label, cls) {
    var n = document.createElement(tag);
    if (label != null) n.textContent = String(label);
    if (cls) n.className = cls;
    return n;
  }
  function note(message) { $('mobile-chat-status').textContent = message || ''; }
  function showList() {
    state.open = false;
    $('mobile-chat-list-view').hidden = false;
    $('mobile-chat-thread-view').hidden = true;
    note('');
  }
  function showThread() {
    state.open = true;
    $('mobile-chat-list-view').hidden = true;
    $('mobile-chat-thread-view').hidden = false;
    $('mobile-chat-archive').disabled = Boolean(state.to);
    $('mobile-chat-archive').textContent = state.archive ? 'Messages récents' : 'Archives';
    $('mobile-chat-text').focus();
  }
  function noContent(box, message, problem) {
    box.replaceChildren(el('p', message, problem ? 'mobile-error' : 'mobile-muted'));
  }
  function api(path, options) { return om.api(path, options); }
  function titleFor(key) {
    if (state.to) {
      var u = state.users.find(function (x) { return x.email === state.to; });
      return 'À ' + (u ? u.name : state.to);
    }
    var found = state.conversations.find(function (x) { return x.key === key; });
    if (found) return found.label;
    var mission = state.missions.find(function (x) { return x.key === key; });
    if (mission) return mission.name;
    return key === 'cabinet' ? 'Tout le cabinet' : 'Conversation';
  }
  function renderPicker() {
    var picker = $('mobile-new-chat');
    var prior = picker.value;
    picker.replaceChildren(el('option', 'Choisir une personne ou une mission…'));
    picker.firstChild.value = '';
    function group(title, entries, valueKey, labelKey, prefix) {
      if (!entries.length) return;
      var opt = el('optgroup');
      opt.label = title;
      entries.forEach(function (entry) {
        var option = el('option', entry[labelKey] || entry[valueKey]);
        option.value = prefix + entry[valueKey];
        opt.appendChild(option);
      });
      picker.appendChild(opt);
    }
    group('Collègues', state.users, 'email', 'name', 'to:');
    group('Missions autorisées', state.missions, 'key', 'name', '');
    group('Groupes', state.groups, 'key', 'name', '');
    picker.value = prior;
  }
  function renderList() {
    var box = $('mobile-chats');
    box.replaceChildren();
    var conversations = state.conversations.slice();
    if (!conversations.some(function (c) { return c.key === 'cabinet'; })) {
      conversations.unshift({ key: 'cabinet', label: 'Tout le cabinet', last: null });
    }
    conversations.slice(0, 30).forEach(function (c) {
      var button = el('button', null, 'mobile-chat-conversation');
      button.type = 'button';
      var avatar = el('span', '☏', 'mobile-chat-avatar');
      avatar.setAttribute('aria-hidden', 'true');
      var body = el('span', null, 'mobile-chat-conversation-main');
      body.appendChild(el('strong', c.label || 'Conversation'));
      var last = c.last ? [c.last.from, c.last.body].filter(Boolean).join(' : ') : 'Écrire un message';
      body.appendChild(el('small', last));
      var arrow = el('span', '›', 'mobile-chat-chevron');
      arrow.setAttribute('aria-hidden', 'true');
      button.append(avatar, body, arrow);
      button.addEventListener('click', function () { open(c.key); });
      box.appendChild(button);
    });
    if (!conversations.length) noContent(box, 'Aucune conversation pour le moment.', false);
  }
  function renderThread(data) {
    $('mobile-chat-title').textContent = titleFor(state.key);
    var box = $('mobile-chat-messages');
    box.replaceChildren();
    var messages = Array.isArray(data.messages) ? data.messages : [];
    if (!messages.length) {
      noContent(box, state.archive ? 'Aucun message dans les archives.' : 'Aucun message récent. Écrivez le premier.', false);
      return;
    }
    messages.forEach(function (m) {
      var mine = m.sender_email === state.myEmail;
      var item = el('div', null, 'mobile-chat-bubble' + (mine ? ' mine' : ''));
      if (!mine) item.appendChild(el('span', m.sender_name || m.sender_email || 'Collègue', 'mobile-chat-from'));
      item.appendChild(el('p', m.body || ''));
      var when = m.created_at ? new Date(m.created_at) : null;
      var stamp = when && !isNaN(when) ? when.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      if (stamp) item.appendChild(el('small', stamp));
      box.appendChild(item);
    });
    box.scrollTop = box.scrollHeight;
  }
  function displayError(e) {
    if (!navigator.onLine || e && e.code === 'NETWORK_REQUEST_FAILED') return 'Connexion indisponible : réessayez lorsque le réseau revient.';
    return 'Messagerie indisponible : ' + (e && e.message || 'erreur du serveur');
  }
  function refresh(force) {
    if (!om) return Promise.resolve();
    if (document.hidden || !navigator.onLine) return Promise.resolve();
    if (!force && state.loaded && !state.open) return Promise.resolve();
    if (state.to) {
      // A new private conversation has no saved conversation key yet.
      return Promise.resolve();
    }
    var req = ++state.request;
    var key = state.key;
    var url = '/api/app?route=chat&conversation=' + encodeURIComponent(key) + (state.archive ? '&archive=1' : '');
    return api(url).then(function (data) {
      if (req !== state.request || key !== state.key) return;
      if (data.available === false) {
        noContent($('mobile-chats'), 'Messagerie non configurée pour ce cabinet.', true);
        note('La base des messages doit être vérifiée par l’administrateur.');
        return;
      }
      state.conversations = Array.isArray(data.conversations) ? data.conversations : [];
      state.users = Array.isArray(data.users) ? data.users : [];
      state.missions = Array.isArray(data.missions) ? data.missions : [];
      state.groups = Array.isArray(data.groups) ? data.groups : [];
      state.myEmail = data.me || '';
      state.loaded = true;
      renderList();
      renderPicker();
      if (state.open) renderThread(data);
      note('');
    }).catch(function (error) {
      if (req !== state.request) return;
      note(displayError(error));
      if (!state.loaded) noContent($('mobile-chats'), 'Impossible de charger les conversations.', true);
    });
  }
  function open(key, to) {
    state.key = key || 'cabinet';
    state.to = to || null;
    state.archive = false;
    state.request++;
    $('mobile-chat-title').textContent = titleFor(state.key);
    showThread();
    noContent($('mobile-chat-messages'), state.to ? 'Écrivez votre premier message privé.' : 'Chargement de la conversation…', false);
    if (!state.to) refresh(true);
  }
  function send(event) {
    event.preventDefault();
    if (state.sending) return;
    var textarea = $('mobile-chat-text');
    var text = textarea.value.trim();
    if (!text) { note('Écrivez un message avant d’envoyer.'); return; }
    if (text.length > 4000) { note('Le message ne doit pas dépasser 4 000 caractères.'); return; }
    if (!navigator.onLine) { note('Pas de connexion : votre message n’a pas été envoyé.'); return; }
    var body = state.to ? { to: state.to, body: text } : { conversation: state.key, body: text };
    state.sending = true;
    $('mobile-chat-send').disabled = true;
    note('Envoi…');
    api('/api/app?route=chat', { method: 'POST', body: JSON.stringify(body) })
      .then(function (result) {
        if (!result || !result.conversation) throw new Error('Envoi non confirmé. Vérifiez la conversation avant de réessayer.');
        textarea.value = '';
        state.key = result.conversation;
        state.to = null;
        state.archive = false;
        state.loaded = false;
        note('Message envoyé.');
        return refresh(true);
      }).catch(function (error) {
        note('Envoi non confirmé : ' + (error.message || 'erreur') + '. Vérifiez avant de renvoyer pour éviter les doublons.');
      }).finally(function () {
        state.sending = false;
        $('mobile-chat-send').disabled = false;
      });
  }
  function init(officeManager) {
    if (om) return;
    om = officeManager;
    $('mobile-chat-back').addEventListener('click', showList);
    $('mobile-chat-form').addEventListener('submit', send);
    $('mobile-chat-archive').addEventListener('click', function () {
      if (state.to) return;
      state.archive = !state.archive;
      this.textContent = state.archive ? 'Messages récents' : 'Archives';
      refresh(true);
    });
    $('mobile-new-chat').addEventListener('change', function () {
      var option = this.value;
      this.value = '';
      if (!option) return;
      if (option.startsWith('to:')) open('cabinet', option.slice(3));
      else open(option);
    });
    // Refresh only while the Messages tab is displayed and the user is online.
    // Avoid 4-second network loops, background battery costs and excessive polling.
    state.timer = window.setInterval(function () {
      if (!document.hidden && navigator.onLine && !state.sending && !state.archive &&
          !$('panel-messages').hidden) refresh(true);
    }, 12000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !$('panel-messages').hidden) refresh(true);
    });
    window.addEventListener('online', function () {
      if (!$('panel-messages').hidden) refresh(true);
    });
  }
  window.FirmMobileChat = { init: init, refresh: refresh };
})();
