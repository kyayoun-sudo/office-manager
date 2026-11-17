import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8').replace(/\r/g, '');

test('auth.css defines the login layout classes and is compiled into ui.css', () => {
  const source = read('assets/ui/auth.css');
  const compiled = read('assets/ui.css');
  for (const cls of ['om-auth', 'om-auth-main', 'om-auth-card', 'om-auth-brand', 'om-auth-google',
    'om-auth-alert', 'om-auth-form', 'om-auth-more', 'om-auth-aside', 'om-auth-pitch', 'om-auth-points']) {
    assert.ok(source.includes('.' + cls), cls + ' missing from assets/ui/auth.css');
    assert.ok(compiled.includes('.' + cls), cls + ' missing from assets/ui.css: run npm run build:css');
  }
});

test('the brand panel takes its colours from the firm tokens only', () => {
  const source = read('assets/ui/auth.css');
  const aside = source.slice(source.indexOf('.om-auth-aside'), source.indexOf('/* end aside */'));
  assert.ok(aside.includes('var(--primary)'), 'panel background must use --primary');
  assert.ok(aside.includes('var(--primary-foreground)'), 'panel text must use --primary-foreground');
  assert.ok(!/(^|[^-\w])color:\s*#[0-9a-f]{3,8}/i.test(aside), 'no hard-coded hex text colour on the panel');
});

test('the form never overrides the hidden attribute', () => {
  const source = read('assets/ui/auth.css');
  assert.ok(!/\[hidden\]\s*{[^}]*display\s*:\s*(?!\s|none)/.test(source));
  assert.ok(source.includes('.om-auth [hidden]'), 'auth.css must keep [hidden] effective inside .om-auth');
});
