(function () {
  'use strict';
  const root = document.documentElement;
  const page = document.body;
  const darkPreference = window.matchMedia('(prefers-color-scheme: dark)');
  const storageKey = 'om:design-theme';
  let preference;
  try { preference = localStorage.getItem(storageKey); } catch (_) {}
  const themeButton = document.createElement('button');
  const english = root.lang === 'en';
  themeButton.type = 'button';
  themeButton.className = 'om-toolbar-btn om-theme-toggle';
  themeButton.textContent = english ? 'Dark theme' : 'Thème sombre';

  function luminance(hex) {
    const channels = hex.slice(1).match(/../g).map(function (channel) {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  }

  function paintTheme() {
    const dark = preference ? preference === 'dark' : darkPreference.matches;
    page.classList.toggle('dark', dark);
    themeButton.setAttribute('aria-pressed', String(dark));
    const brand = getComputedStyle(root).getPropertyValue('--brand').trim();
    if (!/^#[0-9a-f]{6}$/i.test(brand)) return;
    const lightness = luminance(brand);
    page.style.setProperty('--om-brand-text', lightness > 0.179 ? '#000' : '#fff');
    const surface = dark ? luminance('#262626') : luminance('#fafafa');
    const contrast = (Math.max(surface, lightness) + 0.05) / (Math.min(surface, lightness) + 0.05);
    page.style.setProperty('--om-brand-link', contrast >= 4.5 ? brand : dark ? '#fafafa' : '#171717');
  }

  themeButton.addEventListener('click', function () {
    preference = page.classList.contains('dark') ? 'light' : 'dark';
    try { localStorage.setItem(storageKey, preference); } catch (_) {}
    paintTheme();
  });
  darkPreference.addEventListener('change', paintTheme);
  new MutationObserver(paintTheme).observe(root, { attributes: true, attributeFilter: ['style'] });
  paintTheme();

  const mobile = window.matchMedia('(max-width: 860px)');
  document.addEventListener('keydown', function (event) {
    if (!mobile.matches || event.defaultPrevented) return;
    const menu = page.querySelector('.nav.open');
    if (!menu) return;
    const toggle = menu.querySelector('.nav-toggle');
    if (event.key === 'Escape' && toggle && !menu.querySelector('.gear[aria-expanded="true"]')) {
      event.preventDefault();
      toggle.click();
      toggle.focus();
    }
    if (event.key === 'Tab') {
      const visible = [...menu.querySelectorAll('a[href], button:not(:disabled), select:not(:disabled)')]
        .filter(element => element.getClientRects().length && getComputedStyle(element).visibility === 'visible');
      const edge = event.shiftKey ? visible[0] : visible.at(-1);
      if (edge && (document.activeElement === edge || !menu.contains(document.activeElement))) {
        event.preventDefault();
        (event.shiftKey ? visible.at(-1) : visible[0]).focus();
      }
    }
  });

  function groupNavigation() {
    const nav = page.querySelector('.nav');
    const account = nav && nav.querySelector('.who');
    if (!account) return;
    const links = [...nav.querySelectorAll(':scope > a[href]')];
    const groups = [
      [english ? 'Dashboard' : 'Tableau de bord', ['accueil', 'recherche', 'mon-travail', 'pilotage']],
      ['Missions', ['opportunites', 'veille', 'mission', 'missions', 'missions-terminees', 'dossiers']],
      ['Audit', ['programme', 'procedure', 'methodologie', 'validations', 'rangement']],
      [english ? 'Firm' : 'Cabinet', []],
    ];
    const assigned = new Set();
    for (const [label, pages] of groups) {
      const entries = links.filter(link => pages.length
        ? pages.includes(link.pathname.split('/').pop().replace(/\.html$/, ''))
        : !assigned.has(link));
      if (!entries.length) continue;
      const heading = document.createElement('div');
      heading.className = 'om-nav-heading';
      heading.textContent = label;
      nav.insertBefore(heading, account);
      for (const link of entries) {
        assigned.add(link);
        nav.insertBefore(link, account);
      }
      const update = () => {
        heading.hidden = entries.every(link => link.hidden || link.classList.contains('in-wheel'));
      };
      const observer = new MutationObserver(update);
      for (const link of entries) observer.observe(link, { attributes: true, attributeFilter: ['hidden', 'class'] });
      update();
    }
  }

  function attachThemeButton() {
    const toolbar = document.getElementById('om-workspace-toolbar');
    if (!toolbar) return false;
    const breadcrumb = toolbar.querySelector('.om-workspace-crumb');
    if (breadcrumb) {
      const oldLabel = breadcrumb.textContent;
      breadcrumb.textContent = 'Application' + (oldLabel.includes(' / ') ? ' › ' + oldLabel.split(' / ').slice(1).join(' / ') : '');
    }
    toolbar.appendChild(themeButton);
    groupNavigation();
    const menu = document.querySelector('.shell > .nav');
    const main = toolbar.closest('main');
    if (main && menu) {
      const syncDrawer = () => { main.inert = mobile.matches && menu.classList.contains('open'); };
      new MutationObserver(syncDrawer).observe(menu, { attributes: true, attributeFilter: ['class'] });
      mobile.addEventListener('change', syncDrawer);
      syncDrawer();
    }
    const accountMenu = page.querySelector('.gear-menu');
    if (accountMenu) {
      const accountTheme = document.createElement('button');
      accountTheme.type = 'button';
      accountTheme.className = 'gm-link';
      accountTheme.textContent = themeButton.textContent;
      accountTheme.addEventListener('click', () => themeButton.click());
      const observeTheme = () => accountTheme.setAttribute('aria-pressed', themeButton.getAttribute('aria-pressed'));
      new MutationObserver(observeTheme).observe(themeButton, { attributes: true, attributeFilter: ['aria-pressed'] });
      observeTheme();
      function addAccountTheme() {
        if (!accountMenu.hidden && accountTheme.parentNode !== accountMenu) accountMenu.prepend(accountTheme);
      }
      new MutationObserver(addAccountTheme).observe(accountMenu, { childList: true, attributes: true, attributeFilter: ['hidden'] });
    }
    return true;
  }
  if (!attachThemeButton()) {
    const observer = new MutationObserver(function () {
      if (attachThemeButton()) observer.disconnect();
    });
    observer.observe(page, { childList: true, subtree: true });
  }
})();
