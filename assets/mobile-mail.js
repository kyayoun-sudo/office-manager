/* Firm Manager Lite: very small personal e-mail client.
 * Reuses protected personal-mail API, ownedMailbox and draft/send confirmation.
 * NEVER reads the owner's mailbox as another user, or the cabinet's shared mailbox.
 * No automatic sending, no storing mail bodies in browser persistent storage. */
(function () {
  'use strict';
  var om = null, accounts = [], box = null, current = null, busy = false, loaded = false, seq = 0;
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function status(message, problem) {
    var node = $('mobile-mail-status');
    node.textContent = message || '';
    node.dataset.state = problem ? 'error' : 'neutral';
  }
  function api(action, body, get) {
    if (get) {
      var params = new URLSearchParams({ route: 'personal-mail', action: action });
      Object.entries(body || {}).forEach(function (pair) {
        if (pair[1] != null) params.set(pair[0], String(pair[1]));
      });
      return om.api('/api/app?' + params.toString());
    }
    return om.api('/api/app?route=personal-mail', {
      method: 'POST', body: JSON.stringify(Object.assign({ action: action }, body || {}))
    });
  }
  function hideEditor() {
    $('mobile-mail-composer').hidden = true;
    $('mobile-mail-message').hidden = true;
    $('mobile-mail-list').hidden = false;
  }
  function drawAccounts() {
    $('mobile-mail-no-account').hidden = accounts.length !== 0;
    $('mobile-mail-account-view').hidden = accounts.length === 0;
    if (!accounts.length) return;
    var picker = $('mobile-mail-account');
    picker.replaceChildren();
    accounts.forEach(function (account) {
      var option = el('option', account.email + ' · ' + account.provider);
      option.value = account.id;
      picker.appendChild(option);
    });
    picker.value = box.id;
  }
  function render(items) {
    hideEditor();
    var list = $('mobile-mail-list');
    list.replaceChildren();
    if (!items.length) {
      list.appendChild(el('p', 'Aucun message dans les e-mails synchronisés. Appuyez sur Actualiser pour rechercher les nouveaux messages.', 'mobile-muted'));
      return;
    }
    items.slice(0, 15).forEach(function (m) {
      var button = el('button', null, 'mobile-work-item');
      button.type = 'button';
      var main = el('span', null, 'mobile-work-item-main');
      main.appendChild(el('strong', m.subject || '(sans objet)'));
      main.appendChild(el('small', [m.sender, m.summary || m.snippet].filter(Boolean).join(' · ').slice(0, 220)));
      button.append(main, el('span', '›', 'mobile-chat-chevron'));
      button.addEventListener('click', function () { openMessage(m); });
      list.appendChild(button);
    });
  }
  function refresh(force) {
    if (!om || !navigator.onLine || document.hidden || busy) return Promise.resolve();
    if (loaded && !force) return Promise.resolve();
    var token = ++seq;
    status('Lecture de vos boîtes personnelles…');
    return api('accounts', {}, true).then(function (data) {
      if (token !== seq) return;
      accounts = Array.isArray(data.accounts) ? data.accounts : [];
      box = accounts.find(function (a) { return box && a.id === box.id; }) || accounts[0] || null;
      drawAccounts();
      if (!box) {
        loaded = true;
        status('Connectez votre boîte Gmail ou Outlook pour répondre ici.');
        return;
      }
      if (box.status === 'reconnect_required') {
        status('La connexion de cette boîte a expiré. Reconnectez-la depuis votre espace complet.', true);
        return;
      }
      var id = box.id;
      return (force ? api('sync', { mailbox_id: id }) : Promise.resolve()).then(function () {
        if (token !== seq || !box || box.id !== id) return;
        return api('list', { mailbox_id: id, folder: 'inbox' }, true);
      }).then(function (result) {
        if (token !== seq || !result) return;
        loaded = true;
        render(Array.isArray(result.items) ? result.items : []);
        status(force ? 'Boîte actualisée.' : 'E-mails synchronisés. Utilisez Actualiser pour chercher les nouveaux messages.');
      });
    }).catch(function (error) {
      if (token !== seq) return;
      status('Accès à votre messagerie indisponible : ' + (error.message || 'erreur du serveur'), true);
    });
  }
  function openMessage(item) {
    if (!box || busy) return;
    var id = box.id, token = ++seq;
    status('Ouverture du message…');
    api('message', { mailbox_id: id, id: item.id }, true).then(function (result) {
      if (token !== seq || !box || box.id !== id) return;
      current = result.item;
      $('mobile-mail-list').hidden = true;
      $('mobile-mail-message').hidden = false;
      $('mobile-mail-composer').hidden = true;
      $('mobile-mail-subject').textContent = result.item.subject || '(sans objet)';
      $('mobile-mail-from').textContent = [result.item.sender, result.item.received_at].filter(Boolean).join(' · ');
      $('mobile-mail-body').textContent = result.body || result.item.snippet || '(message sans texte)';
      $('mobile-mail-ai-reply').hidden = !box.ai_enabled;
      status('');
    }).catch(function (error) { status('Message inaccessible : ' + (error.message || 'erreur'), true); });
  }
  function compose(data) {
    if (!current) return;
    var draft = data || {};
    $('mobile-mail-message').hidden = true;
    $('mobile-mail-list').hidden = true;
    $('mobile-mail-composer').hidden = false;
    $('mobile-mail-to').value = current.sender_email || '';
    $('mobile-mail-reply-subject').value = draft.subject || (String(current.subject || '').match(/^re:/i)
      ? current.subject : 'Re: ' + (current.subject || ''));
    $('mobile-mail-reply-body').value = draft.body || '';
    status(draft.needs_confirmation ? 'Proposition IA : relisez avant de confirmer.' : 'Écrivez votre réponse.');
  }
  function aiReply() {
    if (!box || !current || !box.ai_enabled || busy) return;
    busy = true;
    $('mobile-mail-ai-reply').disabled = true;
    status('L’IA prépare une proposition. Aucun e-mail ne sera envoyé automatiquement.');
    api('ai-draft', { mailbox_id: box.id, message_id: current.id, instruction: '' })
      .then(function (result) { compose(result); })
      .catch(function (e) { status('Proposition impossible : ' + (e.message || 'erreur'), true); })
      .finally(function () { busy = false; $('mobile-mail-ai-reply').disabled = false; });
  }
  function send(event) {
    event.preventDefault();
    if (!box || !current || busy) return;
    if (!navigator.onLine) return status('Hors connexion : aucun envoi.', true);
    var body = $('mobile-mail-reply-body').value.trim();
    var subject = $('mobile-mail-reply-subject').value.trim();
    var recipient = $('mobile-mail-to').value.trim();
    if (!body || !subject || !recipient) return status('Votre réponse est incomplète.', true);
    if (!window.confirm('Envoyer cette réponse depuis ' + box.email + ' à ' + recipient + ' ?')) return;
    var original = current, mailbox = box;
    busy = true;
    $('mobile-mail-send').disabled = true;
    status('Enregistrement du brouillon et envoi après votre confirmation…');
    api('draft', { mailbox_id: mailbox.id, recipient: recipient, subject: subject,
      body: body, reply_to_id: original.id })
      .then(function (draft) {
        if (!draft || !draft.id) throw new Error('Brouillon non confirmé.');
        return api('send', { mailbox_id: mailbox.id, draft_id: draft.id, confirm: true });
      }).then(function () {
        if (box !== mailbox) return;
        current = null;
        hideEditor();
        loaded = false;
        status('Envoi accepté par votre fournisseur de messagerie.');
        return refresh(false);
      }).catch(function (error) {
        status('Envoi non confirmé (' + (error.message || 'réseau') + '). Vérifiez la boîte du fournisseur avant de renvoyer pour éviter un doublon.', true);
      }).finally(function () { busy = false; $('mobile-mail-send').disabled = false; });
  }
  function connect(provider) {
    if (busy) return;
    busy = true;
    api('connect', { provider: provider }).then(function (result) {
      var url = new URL(result.url);
      var approved = url.protocol === 'https:' && (url.hostname === 'accounts.google.com' ||
        url.hostname === 'login.microsoftonline.com');
      if (!approved) throw new Error('Adresse de consentement non autorisée.');
      location.assign(url.href);
    }).catch(function (error) {
      status('Connexion impossible : ' + (error.message || 'erreur'), true);
    }).finally(function () { busy = false; });
  }
  function init(officeManager) {
    if (om) return;
    om = officeManager;
    $('mobile-mail-refresh').addEventListener('click', function () { refresh(true); });
    $('mobile-mail-account').addEventListener('change', function () {
      box = accounts.find(function (a) { return a.id === this.value; }.bind(this)) || null;
      current = null; loaded = false; refresh(false);
    });
    $('mobile-mail-back').addEventListener('click', hideEditor);
    $('mobile-mail-reply').addEventListener('click', function () { compose(); });
    $('mobile-mail-ai-reply').addEventListener('click', aiReply);
    $('mobile-mail-composer').addEventListener('submit', send);
    $('mobile-mail-cancel').addEventListener('click', hideEditor);
    $('mobile-mail-connect-google').addEventListener('click', function () { connect('google'); });
    $('mobile-mail-connect-microsoft').addEventListener('click', function () { connect('microsoft'); });
  }
  window.FirmMobileMail = { init: init, refresh: refresh };
})();
