/* Navigation shared by all authenticated workspaces.
 * Additive: never replaces page-specific mission/procedure controls. */
(function () {
  'use strict';
  var OM = window.OfficeManager;
  var shell = document.querySelector('.shell');
  var nav = shell && shell.querySelector('.nav');
  var main = shell && shell.querySelector('.main');
  if (!OM || !nav || !main || document.getElementById('om-workspace-toolbar')) return;
  var en = OM.getLang && OM.getLang() === 'en';
  function tr(fr, english) { return en ? english : fr; }
  var role = OM.getRole() || 'guest';
  var storageKey = 'om:rail-compact:' + role + ':' + (OM.getUserName && OM.getUserName() || 'user');
  var compact = false;
  try { compact = window.localStorage.getItem(storageKey) === '1'; } catch (_) {}
  var bar = document.createElement('div');
  bar.id = 'om-workspace-toolbar';
  bar.className = 'om-workspace-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', tr('Navigation de l’application', 'Application navigation'));
  function button(glyph, label, action) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'om-toolbar-btn';
    el.textContent = glyph;
    el.title = label;
    el.setAttribute('aria-label', label);
    el.addEventListener('click', action);
    bar.appendChild(el);
    return el;
  }
  var toggle = button('⋯', '', function () { setCompact(!compact); });
  var dirty = false;
  main.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t && t.matches && t.matches('textarea, input:not([type="search"]):not([type="hidden"]), select') && !t.readOnly && !t.disabled) dirty = true;
  });
  // A browser refresh/back/forward can discard unsaved form fields. Do not do it silently.
  function safeNavigate(fn) {
    if (dirty && !window.confirm(tr('Des champs ont été modifiés. Quitter sans enregistrer ?', 'Some fields have changed. Leave without saving?'))) return;
    fn();
  }
  button('←', tr('Précédent', 'Back'), function () { safeNavigate(function () { window.history.back(); }); });
  button('↻', tr('Actualiser la page', 'Refresh page'), function () { safeNavigate(function () { window.location.reload(); }); });
  button('→', tr('Suivant', 'Forward'), function () { safeNavigate(function () { window.history.forward(); }); });
  var crumb = document.createElement('span');
  crumb.className = 'om-workspace-crumb';
  var title = main.querySelector('h1');
  crumb.textContent = tr('Espace de travail', 'Workspace') + (title ? ' / ' + title.textContent.trim().slice(0, 90) : '');
  bar.appendChild(crumb);
  main.insertBefore(bar, main.firstChild);
  function setCompact(value) {
    compact = Boolean(value);
    shell.classList.toggle('om-nav-compact', compact);
    toggle.setAttribute('aria-pressed', String(compact));
    var label = compact ? tr('Agrandir le menu', 'Expand menu') : tr('Réduire le menu pour agrandir le travail', 'Collapse menu to expand workspace');
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
    try { window.localStorage.setItem(storageKey, compact ? '1' : '0'); } catch (_) {}
    nav.querySelectorAll(':scope > a[href]').forEach(function (a) {
      if (!a.title) a.title = a.getAttribute('aria-label') || a.textContent.trim();
      // Legacy/additive links (e.g. Mes dossiers) may have no SVG icon.
      // Give them a readable compact marker instead of hiding the link.
      if (!a.querySelector('svg') && OM.addNavIcon) OM.addNavIcon(a);
      if (!a.querySelector('svg, .om-rail-fallback')) {
        var marker = document.createElement('span');
        marker.className = 'om-rail-fallback';
        marker.textContent = (a.textContent.trim().charAt(0) || '•').toLocaleUpperCase();
        marker.setAttribute('aria-hidden', 'true');
        a.insertBefore(marker, a.firstChild);
      }
    });
  }
  setCompact(compact);
})();
