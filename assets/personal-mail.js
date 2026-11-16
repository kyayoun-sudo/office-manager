/* Personal mailbox widget: never renders HTML from messages, providers or the AI. */
(function () {
  'use strict';
  var OM = window.OfficeManager, UI = window.OMScreens;
  var root = document.getElementById('personal-mail-card');
  if (!OM || !UI || !root) return;
  var state = { accounts: [], box: null, tab: 'inbox', items: [], draft: null, busy: false, lastPoll: 0 };
  function el(tag, txt, cls) {
    var x = document.createElement(tag);
    if (txt != null) x.textContent = txt;
    if (cls) x.className = cls;
    return x;
  }
  function qs(name) { return new URLSearchParams(location.search).get(name); }
  function api(action, args, get) {
    var path = '/api/app?route=personal-mail';
    if (get) {
      var qp = new URLSearchParams({ action: action });
      Object.keys(args || {}).forEach(function (k) { if (args[k] != null) qp.set(k, String(args[k])); });
      return OM.api(path + '&' + qp.toString());
    }
    return OM.api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, args || {})) });
  }
  function setStatus(msg, danger) {
    var box = document.getElementById('personal-mail-status');
    if (!box) return;
    box.textContent = msg || '';
    box.className = danger ? 'status error' : 'status';
  }
  function button(text, cb, secondary) {
    var b = el('button', text, secondary ? 'btn ghost' : 'btn');
    b.type = 'button';
    b.addEventListener('click', function () {
      if (b.disabled) return;
      var p;
      try { p = cb(); } catch (e) { setStatus(e.message, true); return; }
      if (!p || !p.then) return;
      b.disabled = true;
      p.catch(function (e) { setStatus(e.message || 'Opération impossible', true); })
        .finally(function () { b.disabled = false; });
    });
    return b;
  }
  function field(label, value, longText) {
    var wrap = el('label', label, 'pm-field');
    var input = document.createElement(longText ? 'textarea' : 'input');
    if (!longText) input.type = 'text';
    input.value = value || '';
    if (longText) input.rows = 7;
    wrap.appendChild(input);
    return { wrap: wrap, input: input };
  }
  function choose(box) {
    state.box = box || null;
    state.items = [];
    state.draft = null;
    state.lastPoll = 0;
    state.tab = 'inbox';
    paint();
    if (box) return loadMessages(true);
  }
  function loadAccounts() {
    return api('accounts', {}, true).then(function (res) {
      state.accounts = res.accounts || [];
      var chosen = state.accounts.find(function (x) { return state.box && x.id === state.box.id; });
      state.box = chosen || state.accounts[0] || null;
      paint();
      if (state.box) return loadMessages(true);
    }).catch(function (e) {
      setStatus('Messagerie personnelle indisponible : ' + e.message + '. Vérifiez que la migration SQL a été appliquée.', true);
    });
  }
  function connect(provider) {
    setStatus('Ouverture du consentement ' + (provider === 'google' ? 'Google' : 'Microsoft') + '…');
    return api('connect', { provider: provider }).then(function (res) { window.location.assign(res.url); });
  }
  function disconnect() {
    if (!state.box || !window.confirm('Déconnecter cette boîte ? Ses résumés et brouillons stockés dans Firm Manager seront supprimés.')) return;
    return api('disconnect', { mailbox_id: state.box.id }).then(function () { state.box = null; setStatus('Boîte déconnectée.'); return loadAccounts(); });
  }
  function renderHeader() {
    root.textContent = '';
    var head = el('div', null, 'card-head');
    head.appendChild(el('h2', 'Ma messagerie'));
    var tools = el('div', null, 'pm-toolbar');
    tools.appendChild(button('Connecter Gmail', function () { return connect('google'); }, true));
    tools.appendChild(button('Connecter Outlook', function () { return connect('microsoft'); }, true));
    head.appendChild(tools); root.appendChild(head);
    root.appendChild(el('p', 'Vos propres e-mails, indépendants de ceux du propriétaire et du cabinet.', 'meta'));
    var panel = el('div', null, 'pm-toolbar');
    if (state.accounts.length) {
      var lbl = el('label', 'Boîte : ', 'pm-select');
      var sel = document.createElement('select');
      sel.setAttribute('aria-label', 'Sélection de ma boîte personnelle');
      state.accounts.forEach(function (x) {
        var option = el('option', x.email + ' (' + (x.provider === 'google' ? 'Gmail' : 'Outlook') + ')');
        option.value = x.id;
        option.selected = Boolean(state.box && state.box.id === x.id);
        sel.appendChild(option);
      });
      sel.addEventListener('change', function () { var x = state.accounts.find(function (a) { return a.id === sel.value; }); choose(x); });
      lbl.appendChild(sel); panel.appendChild(lbl);
      if (state.box) {
        panel.appendChild(button('Synchroniser', function () { return synchronize(); }, true));
        panel.appendChild(button('Déconnecter', disconnect, true));
      }
    }
    root.appendChild(panel);
    var status = el('p', '', 'status'); status.id = 'personal-mail-status'; status.setAttribute('role', 'status');
    root.appendChild(status);
  }
  function renderConsent() {
    var card = el('div', null, 'pm-consent');
    var lbl = el('label', null, 'pm-switch');
    var input = document.createElement('input'); input.type = 'checkbox'; input.checked = state.box.ai_enabled === true;
    var title = el('span', 'Autoriser les propositions de mon IA (résumés et brouillons)');
    lbl.appendChild(input); lbl.appendChild(title); card.appendChild(lbl);
    card.appendChild(el('p', 'Avec votre accord, des extraits de vos e-mails sont transmis au fournisseur IA configuré. ' +
      'Ils ne sont pas ajoutés à la mémoire collective du cabinet. Désactivez à tout moment cette analyse.', 'meta'));
    input.addEventListener('change', function () {
      input.disabled = true;
      api('ai-consent', { mailbox_id: state.box.id, enabled: input.checked }).then(function (r) {
        state.box.ai_enabled = r.ai_enabled;
        setStatus(r.ai_enabled ? 'Analyse IA autorisée pour cette boîte.' : 'Analyse IA désactivée pour cette boîte.');
        return r.ai_enabled ? synchronize() : Promise.resolve();
      }).catch(function (e) { input.checked = !input.checked; setStatus(e.message, true); })
        .finally(function () { input.disabled = false; });
    });
    root.appendChild(card);
  }
  function paint() {
    renderHeader();
    if (!state.box) {
      root.appendChild(el('p', 'Connectez votre messagerie pour recevoir vos e-mails et les propositions de votre assistant IA.', 'empty'));
      return;
    }
    if (state.box.status === 'reconnect_required') {
      root.appendChild(el('p', 'Connexion expirée. Reconnectez votre boîte avec Gmail ou Outlook pour rétablir l’accès.', 'status error'));
      return;
    }
    renderConsent();
    var tabs = el('div', null, 'pm-toolbar');
    [['inbox','Réception'],['suggestions','À traiter'],['sent','Envoyés'],['drafts','Brouillons'],['compose','Nouveau message']].forEach(function (it) {
      var b = button(it[1], function () {
        state.tab = it[0]; state.draft = null; paint();
        if (it[0] === 'drafts') return showDrafts();
        if (it[0] !== 'compose') return loadMessages(false);
      }, it[0] !== state.tab);
      tabs.appendChild(b);
    });
    root.appendChild(tabs);
    var list = el('div', null, 'pm-list'); list.id = 'personal-mail-list'; root.appendChild(list);
    if (state.tab === 'compose') showComposer();
    else if (state.tab === 'drafts') showDrafts();
    else renderList();
  }
  function loadMessages(syncFirst) {
    if (!state.box || state.tab === 'compose' || state.tab === 'drafts') return Promise.resolve();
    var boxId = state.box.id;
    var refresh = syncFirst && Date.now() - state.lastPoll > 120000;
    var start = refresh ? synchronize(false) : Promise.resolve();
    return start.catch(function (e) { setStatus('Synchronisation : ' + e.message, true); })
      .then(function () { return api('list', { mailbox_id: boxId, folder: state.tab }, true); })
      .then(function (res) {
        if (!state.box || state.box.id !== boxId) return;
        state.items = res.items || [];
        renderList();
      }).catch(function (e) { setStatus('Lecture : ' + e.message, true); });
  }
  function synchronize(reload) {
    if (!state.box) return Promise.resolve();
    var boxId = state.box.id;
    state.lastPoll = Date.now();
    setStatus('Synchronisation en cours…');
    return api('sync', { mailbox_id: boxId }).then(function (r) {
      setStatus(r.ai_error ? 'Messages reçus. Propositions IA temporairement indisponibles.' :
        'Synchronisation terminée : ' + r.added + ' nouveau(x) message(s).', Boolean(r.ai_error));
      if (reload !== false && state.box && state.box.id === boxId) return loadMessages(false);
    });
  }
  function renderList() {
    var list = document.getElementById('personal-mail-list'); if (!list) return;
    list.textContent = '';
    var tools = el('div', null, 'pm-toolbar');
    var search = document.createElement('input'); search.type = 'search';
    search.placeholder = 'Rechercher un expéditeur ou un objet';
    search.setAttribute('aria-label', 'Rechercher dans les messages synchronisés');
    search.style.minWidth = '210px';
    tools.appendChild(search);
    var unreadLabel = el('label', 'Non lus uniquement', 'pm-switch');
    var unread = document.createElement('input'); unread.type = 'checkbox';
    unreadLabel.insertBefore(unread, unreadLabel.firstChild);
    tools.appendChild(unreadLabel);
    list.appendChild(tools);
    var results = el('div', null, 'pm-list'); list.appendChild(results);
    function fill() {
      results.textContent = '';
      var needle = search.value.trim().toLowerCase();
      var messages = state.items.filter(function (m) {
        if (unread.checked && !m.unread) return false;
        return !needle || [m.subject, m.sender, m.recipient, m.snippet, m.summary].join(' ').toLowerCase().includes(needle);
      });
      if (!messages.length) { results.appendChild(el('p', 'Aucun message correspondant parmi les messages synchronisés.', 'empty')); return; }
      messages.forEach(function (m) {
        var item = el('div', null, 'item pm-item');
        var info = el('div', null, 't');
        info.appendChild(el('strong', m.subject || '(sans objet)'));
        info.appendChild(el('span', [m.sender, UI.dateTime(m.received_at), m.unread ? 'Non lu' : ''].filter(Boolean).join(' · '), 'meta'));
        info.appendChild(el('p', m.summary || m.snippet || '', 'pm-snippet'));
        if (m.suggested_action) info.appendChild(el('p', 'Proposition IA : ' + m.suggested_action, 'meta'));
        item.appendChild(info);
        var row = el('div', null, 'pm-toolbar');
        row.appendChild(button('Ouvrir', function () { return openMessage(m); }, true));
        if (state.tab === 'suggestions') row.appendChild(button('Traité', function () {
          return api('done', { mailbox_id: state.box.id, message_id: m.id }).then(function () { return loadMessages(false); });
        }, true));
        item.appendChild(row); results.appendChild(item);
      });
    }
    search.addEventListener('input', fill);
    unread.addEventListener('change', fill);
    fill();
  }
  function downloadAttachment(messageId, att) {
    return api('attachment', { mailbox_id: state.box.id, id: messageId, attachment_id: att.id }, true).then(function (r) {
      var bin = atob(r.base64), buf = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
      var a = document.createElement('a'); a.href = url; a.download = (r.name || 'piece-jointe').replace(/[/\\]/g, '_');
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    });
  }
  function openMessage(m) {
    var boxId = state.box.id;
    setStatus('Lecture du message…');
    return api('message', { mailbox_id: boxId, id: m.id }, true).then(function (res) {
      if (!state.box || state.box.id !== boxId) return;
      var list = document.getElementById('personal-mail-list');
      list.textContent = '';
      var back = button('Retour aux messages', function () { return loadMessages(false); }, true); list.appendChild(back);
      list.appendChild(el('h3', res.item.subject || '(sans objet)'));
      list.appendChild(el('p', [res.item.sender, UI.dateTime(res.item.received_at)].filter(Boolean).join(' · '), 'meta'));
      var body = el('pre', res.body || '(aucun texte lisible)', 'pm-body'); list.appendChild(body);
      (res.attachments || []).forEach(function (a) {
        list.appendChild(button('Pièce jointe : ' + a.name, function () { return downloadAttachment(m.id, a); }, true));
      });
      if (res.item.suggested_action) list.appendChild(el('p', 'Suggestion : ' + res.item.suggested_action, 'meta'));
      list.appendChild(button('Répondre', function () {
        state.tab = 'compose'; paint();
        showComposer({ recipient: res.item.sender_email, subject: 'Re: ' + (res.item.subject || ''), body: '', reply_to_id: m.id });
      }));
      if (state.box.ai_enabled && m.folder !== 'sent') list.appendChild(button('Faire rédiger une réponse par l’IA', function () {
        setStatus('Préparation du brouillon IA…');
        return api('ai-draft', { mailbox_id: boxId, message_id: m.id, instruction: '' }).then(function (draft) {
          state.tab = 'compose'; paint(); showComposer(draft); setStatus('Brouillon préparé : relisez et validez avant tout envoi.');
        });
      }, true));
    });
  }
  function showComposer(existing) {
    var box = document.getElementById('personal-mail-list');
    if (!box || state.tab !== 'compose' || !state.box) return;
    box.textContent = '';
    var data = existing || state.draft || {};
    box.appendChild(el('h3', data.id ? 'Modifier mon brouillon' : 'Préparer un message'));
    var to = field('Destinataire', data.recipient), subject = field('Objet', data.subject), body = field('Message', data.body, true);
    [to, subject, body].forEach(function (f) { box.appendChild(f.wrap); });
    box.appendChild(el('p', 'Aucun message n’est envoyé sans confirmation. Les communications officielles de mission restent soumises aux validations du cabinet.', 'meta'));
    var row = el('div', null, 'pm-toolbar'); box.appendChild(row);
    function save() {
      return api('draft', { mailbox_id: state.box.id, id: data.id || null, recipient: to.input.value,
        subject: subject.input.value, body: body.input.value, reply_to_id: data.reply_to_id || null }).then(function (r) {
        data.id = r.id; data.recipient = to.input.value; data.subject = subject.input.value; data.body = body.input.value;
        state.draft = data; setStatus('Brouillon enregistré dans votre espace personnel.');
        return r;
      });
    }
    row.appendChild(button('Enregistrer le brouillon', save));
    row.appendChild(button('Confirmer et envoyer', function () {
      if (!window.confirm('Envoyer ce message depuis ' + state.box.email + ' vers ' + to.input.value + ' ?')) return;
      return save().then(function (r) {
        return api('send', { mailbox_id: state.box.id, draft_id: r.id, confirm: true });
      }).then(function () { setStatus('Envoi accepté par votre fournisseur de messagerie.'); state.draft = null; state.tab = 'sent'; return loadMessages(true); });
    }));
  }
  function showDrafts() {
    if (!state.box || state.tab !== 'drafts') return Promise.resolve();
    var boxId = state.box.id;
    return api('drafts', { mailbox_id: boxId }, true).then(function (r) {
      if (!state.box || state.box.id !== boxId || state.tab !== 'drafts') return;
      var box = document.getElementById('personal-mail-list'); box.textContent = '';
      if (!(r.drafts || []).length) box.appendChild(el('p', 'Aucun brouillon.', 'empty'));
      (r.drafts || []).forEach(function (d) {
        var card = el('div', null, 'item');
        card.appendChild(el('strong', d.subject));
        card.appendChild(el('p', d.recipient + ' · ' + d.status, 'meta'));
        if (d.status === 'draft') card.appendChild(button('Modifier', function () { state.draft = d; state.tab = 'compose'; paint(); }, true));
        if (d.status === 'sending') card.appendChild(el('p', 'Envoi incertain : vérifier la boîte du fournisseur avant toute nouvelle tentative.', 'status error'));
        box.appendChild(card);
      });
    }).catch(function (e) { setStatus('Brouillons : ' + e.message, true); });
  }
  function init() {
    root.hidden = false;
    paint();
    if (qs('personal_mail') === 'connected') setStatus('Messagerie connectée. Votre compte est distinct de celui du cabinet.');
    if (qs('personal_mail') === 'error') setStatus('Connexion impossible : ' + (qs('code') || 'autorisation refusée'), true);
    loadAccounts();
    setInterval(function () {
      if (!document.hidden && state.box && Date.now() - state.lastPoll > 10 * 60 * 1000) {
        if (['inbox','suggestions','sent'].includes(state.tab)) loadMessages(true);
      }
    }, 60 * 1000);
  }
  UI.requireLogin(init);
})();
