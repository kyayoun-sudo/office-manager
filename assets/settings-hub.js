/* Structured settings hub: group existing controls without cloning, rewriting or
 * detaching any forms. Their event handlers and backend storage remain unchanged. */
(function () {
  'use strict';
  var OM = window.OfficeManager;
  var main = document.querySelector('main.main');
  var area = document.getElementById('owner-area');
  if (!main || !area || !OM || document.getElementById('om-settings-hub')) return;
  var role = OM.getRole();
  if (!['owner', 'partner', 'it_admin'].includes(role)) return;
  var technician = role === 'it_admin';
  var definitions = [
    { key: 'personal', name: 'Mon compte', hint: 'Vos préférences et services personnels.', words: 'profil langue mon ia email personnel' },
    { key: 'identity', name: 'Identité du cabinet', hint: 'Nom, logo et apparence du cabinet.', words: 'nom logo couleur branding' },
    { key: 'team', name: 'Équipe et accès', hint: 'Comptes, rôles, positions, droits et règles de gestion des personnes.', words: 'utilisateur droits équipe personnes rh manager permission' },
    { key: 'connections', name: 'Connexions et données', hint: 'Accès Google, Drive et messagerie partagée des agents.', words: 'gmail email google drive données oauth' },
    { key: 'agents', name: 'Agents et automatisations', hint: 'Noms, ton, mémoire, horaires et tests des agents IA.', words: 'shadow entrainement automatisation horaires mémoire agents ia' },
    { key: 'methods', name: 'Méthodes et workflows', hint: 'Références, documents et décisions métier.', words: 'workflow procédure modèles documents opportunités' },
    { key: 'advanced', name: 'Administration avancée', hint: 'Diagnostics, mise en service et opérations sensibles.', words: 'diagnostic effacement supprimer reset journal sauvegarde' }
  ].filter(function (d) { return !technician || ['personal', 'team', 'agents', 'advanced'].includes(d.key); });
  var active = '';
  var hub = document.createElement('section'); hub.id = 'om-settings-hub'; hub.className = 'om-settings-hub';
  var heading = document.createElement('h2'); heading.textContent = 'Centre de paramètres'; hub.appendChild(heading);
  var search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Rechercher un paramètre (Drive, droits, horaires…)';
  search.setAttribute('aria-label', 'Rechercher dans les paramètres'); hub.appendChild(search);
  var nav = document.createElement('nav'); nav.className = 'om-settings-groups'; nav.setAttribute('aria-label', 'Rubriques des paramètres'); hub.appendChild(nav);
  var current = document.createElement('p'); current.className = 'om-settings-intro'; current.setAttribute('aria-live', 'polite'); hub.appendChild(current);
  var personal = document.createElement('section'); personal.className = 'card'; personal.id = 'om-settings-personal'; hub.appendChild(personal);
  var advanced = document.createElement('section'); advanced.className = 'card'; advanced.id = 'om-settings-technical'; hub.appendChild(advanced);
  var results = document.createElement('div'); results.className = 'om-settings-results'; results.hidden = true; hub.appendChild(results);
  // The existing unlock gate is intentionally outside the category groups.
  var login = document.getElementById('login');
  main.insertBefore(hub, login || area);
  var categoryLinks = [];
  function link(target, label) {
    var a = document.createElement('a'); a.href = target; a.textContent = label; a.className = 'btn ghost'; return a;
  }
  function staticContent() {
    personal.textContent = '';
    var p = document.createElement('p');
    p.textContent = 'Les réglages de ce compte ne changent pas les droits des autres collaborateurs.';
    personal.appendChild(p);
    personal.appendChild(link('/mon-ia.html', 'Configurer Mon IA'));
    personal.appendChild(link('/accueil.html', 'Mon travail et mes e-mails personnels'));
    personal.appendChild(link('/apprentissage.html', 'Mon apprentissage'));
    advanced.textContent = '';
    var intro = document.createElement('p');
    intro.textContent = technician
      ? 'Le pilotage intégral du laboratoire est disponible dans Entraînement. Les dossiers clients et les fonctions métier restent protégés.'
      : 'Les fonctions sensibles sont séparées des réglages ordinaires. Toute opération destructive exige une confirmation.';
    advanced.appendChild(intro);
    advanced.appendChild(link('/mise-en-service.html', 'État des connexions et diagnostic'));
    advanced.appendChild(link('/entrainement.html', 'Ouvrir le laboratoire IA'));
    var registry = document.querySelector('main.main > header a[href="/specialists.html"]');
    if (registry) { registry.textContent = 'Registre des spécialistes IA'; advanced.appendChild(registry); }
  }
  staticContent();
  var topSections = {
    'accounts-area': 'team', 'rights-area': 'team', 'memory-area': 'agents', 'reset-area': 'advanced'
  };
  var innerSections = {
    'h-id': 'identity', 'h-logo': 'identity', 'h-col': 'identity',
    'h-people': 'team', 'h-google': 'connections', 'h-mail': 'connections',
    'h-names': 'agents', 'h-tone': 'agents', 'h-sched': 'agents',
    'h-try': 'agents', 'h-workflow-reference': 'methods', 'h-bp': 'methods'
  };
  var sections = Object.keys(topSections).map(function (id) {
    return { el: document.getElementById(id), group: topSections[id] };
  });
  var grow = area.querySelector('.grow');
  var nested = grow ? Array.from(grow.children).filter(function (node) { return node.matches('section.card'); }) : [];
  var nestedGroups = nested.map(function (node) {
    var heading = node.querySelector('h2[id]');
    // Unknown legacy setting remains accessible under Advanced rather than disappearing.
    return { el: node, group: innerSections[heading && heading.id] || 'advanced' };
  });
  var documents = Array.from(main.children).find(function (n) {
    return n.matches && n.matches('section.card') && n.querySelector('h2') && /Documents et modèles partagés/i.test(n.querySelector('h2').textContent);
  });
  if (documents) sections.push({ el: documents, group: 'methods' });
  var preview = area.querySelector(':scope > .side');
  var saveRow = document.getElementById('save') && document.getElementById('save').parentElement;
  var storage = 'om:settings-group:' + role;
  function hashGroup() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (h.startsWith('settings-')) return h.slice(9);
    if (h === 'h-users' || h === 'h-rights' || h === 'h-people') return 'team';
    if (h === 'h-google' || h === 'h-mail') return 'connections';
    if (h === 'h-id' || h === 'h-logo' || h === 'h-col') return 'identity';
    if (h === 'h-names' || h === 'h-tone' || h === 'h-sched' || h === 'h-try' || h === 'h-memory') return 'agents';
    if (h === 'h-workflow-reference' || h === 'h-bp') return 'methods';
    if (h === 'h-reset') return 'advanced';
    return null;
  }
  function show(group, save) {
    if (!definitions.some(function (d) { return d.key === group; })) group = definitions[0].key;
    active = group;
    categoryLinks.forEach(function (x) { x.button.setAttribute('aria-current', x.key === group ? 'true' : 'false'); });
    var def = definitions.find(function (d) { return d.key === group; });
    current.textContent = def.name + ' — ' + def.hint;
    sections.forEach(function (x) { if (x.el) x.el.classList.toggle('om-settings-out', x.group !== group); });
    nestedGroups.forEach(function (x) { x.el.classList.toggle('om-settings-out', x.group !== group); });
    area.classList.toggle('om-settings-out', !nestedGroups.some(function (x) { return x.group === group; }));
    if (preview) preview.classList.toggle('om-settings-out', group !== 'identity');
    if (saveRow) saveRow.classList.toggle('om-settings-out', !['identity', 'connections', 'agents'].includes(group));
    personal.hidden = group !== 'personal';
    advanced.hidden = group !== 'advanced';
    if (save) {
      try { window.localStorage.setItem(storage, group); } catch (_) {}
      window.history.replaceState(window.history.state, '', location.pathname + location.search + '#settings-' + group);
    }
  }
  definitions.forEach(function (d) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'om-settings-group'; b.textContent = d.name;
    b.dataset.search = (d.name + ' ' + d.hint + ' ' + d.words).toLocaleLowerCase('fr');
    b.addEventListener('click', function () { show(d.key, true); });
    nav.appendChild(b);
    categoryLinks.push({ key: d.key, button: b });
  });
  function renderSearch() {
    var q = search.value.trim().toLocaleLowerCase('fr');
    var visible = 0;
    categoryLinks.forEach(function (l) {
      var matched = !q || l.button.dataset.search.indexOf(q) >= 0;
      l.button.hidden = !matched;
      if (matched) visible++;
    });
    results.hidden = Boolean(visible || !q);
    results.textContent = visible ? '' : 'Aucune rubrique trouvée. Essayez un mot plus court.';
  }
  search.addEventListener('input', renderSearch);
  window.addEventListener('hashchange', function () { var g = hashGroup(); if (g) show(g, false); });
  var initial = hashGroup();
  if (!initial) { try { initial = window.localStorage.getItem(storage); } catch (_) {} }
  show(initial || (technician ? 'team' : 'identity'), false);
})();
