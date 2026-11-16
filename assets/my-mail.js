// « Mes e-mails » on the home page (2026-11-16, lib/personal-mail.js): every person links THEIR OWN mailbox, sees the
// messages that need an action, lets the AI draft a reply, corrects it and sends it from their own address.
// Nobody else sees this card's content: the server only ever returns the signed-in person's mailbox.
(function () {
  var OM = window.OfficeManager, UI = window.OMScreens;
  if (!OM || !UI) return;
  var $ = function (id) { return document.getElementById(id); };
  var section = $('mes-mails');
  if (!section) return;
  var api = function (body) { return OM.api('/api/app?route=my-mail', body ? { method: 'POST', body: JSON.stringify(body) } : undefined); };
  var ERR = {
    MAILBOX_NOT_YOURS: 'Le compte Google choisi n’est pas votre adresse de connexion à Office Manager : choisissez votre propre boîte.',
    MAILBOX_RIGHTS_MISSING: 'Google n’a pas donné la lecture et l’envoi : recommencez et cochez les deux autorisations.',
    MAILBOX_ACCESS_REVOKED: 'Google a retiré l’accès à votre boîte (mot de passe changé ou accès supprimé) : reliez-la de nouveau.',
    MAILBOX_NOT_LINKED: 'Votre boîte n’est pas reliée.',
    GOOGLE_NO_REFRESH_TOKEN: 'Google n’a pas donné d’accès durable : recommencez « Relier ma boîte e-mail ».',
    NOT_IN_THIS_CABINET: 'Votre adresse n’est pas un compte de ce cabinet.',
    OAUTH_STATE_EXPIRED: 'La demande a expiré : recommencez « Relier ma boîte e-mail ».',
    OAUTH_STATE_INVALID: 'La demande n’a pas été reconnue : recommencez depuis cette page.',
    GOOGLE_REFUSED: 'Vous avez refusé chez Google : rien n’a été relié.',
    AI_UNAVAILABLE: 'L’IA ne répond pas (crédit ou panne) : vos e-mails seront lus dès qu’elle répondra.',
    EMPTY_REPLY: 'Le message est vide.',
    SENDER_ADDRESS_UNKNOWN: 'L’adresse de l’expéditeur est illisible : répondez depuis Gmail.'
  };
  function say(e) { var c = (e && (e.code || e.message)) || String(e || ''); return ERR[String(c).split(/[: ]/)[0]] || c; }
  function btn(text, cls) { var b = UI.el('button', text, cls || 'btn'); b.type = 'button'; return b; }

  // Back from Google (?mailbox=ok|CODE): said once, at the top of the card.
  var back = new URLSearchParams(location.search).get("mailbox"), note = "";
  if (back) {
    note = back === "ok" ? "Votre boîte est reliée. " : say({ code: back }) + " ";
    try { history.replaceState(null, "", location.pathname + "#mes-mails"); } catch (e) { /* shown anyway */ }
  }

  function load() {
    section.hidden = false;
    var list = $('my-mails-list'), tools = $('my-mails-tools'), status = $('my-mails-status');
    api().then(function (d) {
      list.textContent = ''; tools.textContent = '';
      if (!d.linked) {
        $('my-mails-at').textContent = '';
        status.textContent = note + (d.last_error ? say({ code: d.last_error }) + ' ' : '') +
          'Reliez votre propre boîte Gmail : vous verrez ici vos e-mails qui demandent une action, et vous pourrez y répondre depuis votre adresse. Personne d’autre ne les voit.';
        var link = btn('Relier ma boîte e-mail');
        link.addEventListener('click', function () {
          link.disabled = true; status.textContent = 'Ouverture de Google…';
          api({ action: 'connect' }).then(function (r) { location.href = r.url; }).catch(function (e) { link.disabled = false; status.textContent = say(e); });
        });
        tools.appendChild(link);
        return;
      }
      $('my-mails-at').textContent = d.google_email || '';
      status.textContent = note + (d.last_error ? say({ code: d.last_error }) + ' ' : '') + (d.last_triage_at ? 'Boîte lue le ' + UI.dateTime(d.last_triage_at) + ' · ' + d.items.length + ' e-mail(s) à traiter.' : 'Votre boîte n’a pas encore été lue.');
      var read = btn('Relire ma boîte', 'btn ghost'), unlink = btn('Délier ma boîte', 'btn ghost');
      read.addEventListener('click', function () { refresh(read); });
      unlink.addEventListener('click', function () {
        if (!confirm('Délier votre boîte e-mail ? Office Manager n’y aura plus accès, et ce qu’il en avait compris est effacé. Vos e-mails restent dans Gmail.')) return;
        unlink.disabled = true;
        api({ action: 'unlink' }).then(load).catch(function (e) { unlink.disabled = false; status.textContent = say(e); });
      });
      tools.appendChild(read); tools.appendChild(unlink);
      (d.items || []).forEach(function (m) { list.appendChild(card(m)); });
      if (d.last_triage_at && !(d.items || []).length) list.appendChild(UI.el('p', 'Aucun e-mail en attente d’action.', 'empty'));
      // Read by itself when last read more than 15 minutes ago.
      if (!d.last_triage_at || Date.now() - Date.parse(d.last_triage_at) > 15 * 60000) refresh(read, true);
    }).catch(function (e) { UI.fail(list, e); });
  }

  function refresh(b, quiet) {
    note = "";
    var status = $('my-mails-status');
    b.disabled = true; if (!quiet) status.textContent = 'Lecture de votre boîte…';
    api({ action: 'refresh' }).then(function (r) { if (r.new || !quiet) load(); })
      .catch(function (e) { status.textContent = say(e); }).then(function () { b.disabled = false; });
  }

  function card(m) {
    var c = UI.el('article', null, 'item mail-item imp-' + (m.importance || 'basse'));
    var t = UI.el('div', null, 't');
    t.appendChild(UI.el('span', m.subject || '(sans objet)'));
    t.appendChild(UI.el('span', [m.from_text, UI.dateTime(m.received_at), m.importance === 'haute' ? 'importance haute' : null, m.deadline ? 'échéance ' + m.deadline : null].filter(Boolean).join(' · '), 'meta'));
    t.appendChild(UI.el('p', m.summary || '', 'mail-sum'));
    if (m.suggested_action) t.appendChild(UI.el('p', 'Action suggérée : ' + m.suggested_action, 'mail-act'));
    if (m.mission_id) { var a = UI.el('a', 'Voir la mission'); a.href = '/mission.html?id=' + encodeURIComponent(m.mission_id); t.appendChild(a); }
    c.appendChild(t);
    var tools = UI.el('div', null, 'mail-tools'), reply = btn('Répondre'), done = btn('Traité', 'btn ghost');
    tools.appendChild(reply); tools.appendChild(done); c.appendChild(tools);
    var zone = UI.el('div', null, 'mail-reply'); zone.hidden = true; c.appendChild(zone);
    done.addEventListener('click', function () {
      done.disabled = true;
      api({ action: 'done', id: m.id }).then(function () { c.remove(); }).catch(function (e) { done.disabled = false; zone.hidden = false; zone.appendChild(UI.el('p', say(e), 'status error')); });
    });
    reply.addEventListener('click', function () { zone.hidden = !zone.hidden; if (!zone.firstChild) replyZone(zone, m, c); });
    return c;
  }

  function replyZone(zone, m, c) {
    var id = 'my-ri-' + m.id.replace(/[^A-Za-z0-9_-]/g, '');
    var lab = UI.el('label', 'Ce que vous voulez répondre (quelques mots suffisent)'); lab.htmlFor = id;
    var ins = document.createElement('textarea'); ins.id = id; ins.rows = 3; ins.maxLength = 2000;
    var draft = btn('Rédiger la réponse'), st = UI.el('p', '', 'status'); st.setAttribute('role', 'status');
    var subj = document.createElement('input'); subj.type = 'text'; subj.maxLength = 200; subj.hidden = true; subj.setAttribute('aria-label', 'Objet');
    var body = document.createElement('textarea'); body.rows = 9; body.hidden = true; body.setAttribute('aria-label', 'Message');
    var send = btn('Envoyer depuis ma boîte'); send.hidden = true;
    [lab, ins, draft, st, subj, body, send].forEach(function (x) { zone.appendChild(x); });
    draft.addEventListener('click', function () {
      if (ins.value.trim().length < 2) { st.textContent = 'Dites en quelques mots ce que vous voulez répondre.'; return; }
      draft.disabled = true; st.textContent = 'Rédaction…';
      api({ action: 'draft', id: m.id, instruction: ins.value }).then(function (d) {
        subj.value = d.subject; body.value = d.body; subj.hidden = body.hidden = send.hidden = false;
        st.textContent = 'Relisez et modifiez si besoin. À : ' + d.to + '. Rien ne part avant votre clic sur « Envoyer depuis ma boîte ».';
      }).catch(function (e) { st.textContent = 'Rédaction impossible : ' + say(e); }).then(function () { draft.disabled = false; });
    });
    send.addEventListener('click', function () {
      send.disabled = true; st.textContent = 'Envoi…';
      api({ action: 'send', id: m.id, subject: subj.value, body: body.value }).then(function () {
        st.textContent = 'Réponse envoyée depuis votre boîte (elle est dans « Messages envoyés » de Gmail).';
        setTimeout(function () { c.remove(); }, 1800);
      }).catch(function (e) { send.disabled = false; st.textContent = 'Envoi impossible : ' + say(e); });
    });
  }

  load();
})();
