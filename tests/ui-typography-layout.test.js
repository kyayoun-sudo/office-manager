import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../parametres.html', import.meta.url), 'utf8');

test('shared typography has a stable baseline for reading and form controls', () => {
  assert.match(css, /body\s*\{[^}]*font-family:[^}]*line-height:1\.5/s);
  assert.match(css, /button,input,select,textarea\s*\{\s*font-family:inherit;/);
  assert.match(css, /\.nav\s*>\s*a\[href\]\s*\{[^}]*line-height:1\.35;/);
  assert.match(css, /textarea\s*\{\s*line-height:1\.5;/);
});

test('the workflow-reference form is a single column without horizontal overflow', () => {
  assert.match(settings, /<form id="workflow-reference-form">/);
  assert.match(css, /#workflow-reference-form\s*\{[^}]*display:grid;[^}]*grid-template-columns:minmax\(0,1fr\);/s);
  assert.match(css, /#workflow-reference-form :is\(input,select\)\s*\{[^}]*width:100%;[^}]*min-width:0;[^}]*max-width:100%;/s);
  assert.match(css, /\.main,\.main > \*,\.main \.card,\.main \.card > \*/);
});

test('no global layout override forces all buttons into flex containers', () => {
  const typographySection = css.split('/* UI consistency (Windows / Edge / Chrome):')[1];
  assert.ok(typographySection, 'UI consistency patch is installed');
  assert.doesNotMatch(typographySection, /(?:^|\n)button\s*\{[^}]*display:/);
});
