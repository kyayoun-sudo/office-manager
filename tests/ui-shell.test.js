import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8').replace(/\r/g, '');

const MENU_PAGES = ['accueil', 'recherche', 'opportunites', 'veille', 'mission', 'dossiers', 'rangement', 'equipe', 'validations',
  'messagerie', 'assistant', 'preparation', 'auditeur', 'pilotage', 'entrainement', 'mise-en-service', 'parametres',
  'fichiers', 'missions-terminees', 'programme', 'secretariat', 'specialists', 'workflow', 'methodologie',
  'revue-analytique', 'mon-ia', 'apprentissage', 'carte', 'cabinets'];

test('every menu page has an icon, so no link falls back to a letter', () => {
  const theme = read('assets/brand-theme.js');
  const icons = theme.slice(theme.indexOf('var ICONS = {'), theme.indexOf('};', theme.indexOf('var ICONS = {')));
  for (const page of MENU_PAGES) assert.ok(icons.includes("'/" + page + ".html'"), page + ' has no icon in ICONS');
});

test('renaming a menu link keeps its icon (addNavIcon is called after textContent is rewritten)', () => {
  const theme = read('assets/brand-theme.js');
  assert.ok(theme.includes('function addNavIcon(a)'), 'addNavIcon missing');
  assert.ok(/a\.textContent = label;[^}]*addNavIcon\(a\)/.test(theme), 'the rename must restore the icon');
  assert.ok(theme.includes('OM.addNavIcon = addNavIcon'), 'workspace-navigation.js needs OM.addNavIcon');
  assert.ok(read('assets/workspace-navigation.js').includes('OM.addNavIcon'), 'the rail fallback must try a real icon first');
});

test('ui.src.css imports the unlayered shell and kit sheets, and auth.css is no longer layered', () => {
  const src = read('assets/ui.src.css');
  assert.ok(/@import "\.\/ui\/auth\.css";/.test(src), 'auth.css must be imported without layer()');
  assert.ok(/@import "\.\/ui\/shell\.css";/.test(src));
  assert.ok(/@import "\.\/ui\/kit\.css";/.test(src));
});
