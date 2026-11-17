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

const login = () => read('login.html');

test('the inline script of login.html is unchanged', () => {
  const blocks = [...login().matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1);
  const hash = createHash('sha256').update(blocks[0][1]).digest('hex');
  assert.equal(hash, 'decdefabca83247f026fd1f08104abdf49e8df4a966a6747e06e4c7db1f9f7aa');
});

test('login.html uses the auth layout and no inline styles', () => {
  const html = login();
  assert.ok(html.includes('class="om-auth"'));
  assert.ok(html.includes('<main class="om-auth-main">'));
  assert.ok(html.includes('<aside class="om-auth-aside">'));
  assert.ok(html.includes('href="/assets/ui.css"'));
  assert.ok(!/<style[\s>]/.test(html), 'the page <style> block must move to assets/ui/auth.css');
  assert.ok(!/\sstyle="/.test(html), 'no style="" attributes: use the om-auth-* classes');
});

test('the form comes before the brand panel in the DOM (focus order) and there is one h1', () => {
  const html = login();
  assert.ok(html.indexOf('<main') < html.indexOf('<aside'));
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
});

test('every text and password input has a visible label bound by for/id', () => {
  const html = login();
  const inputs = [...html.matchAll(/<input[^>]*\sid="([^"]+)"[^>]*>/g)].filter(m => !/type="checkbox"/.test(m[0]));
  assert.ok(inputs.length >= 8);
  for (const [, id] of inputs) {
    assert.ok(new RegExp('<label[^>]*for="' + id + '"').test(html), 'no <label for="' + id + '">');
  }
});

test('the password sign-in stays inside the collapsible #pw-box, and the hidden widgets keep the hidden attribute', () => {
  const html = login();
  const box = html.slice(html.indexOf('id="pw-box"'), html.indexOf('</details>', html.indexOf('id="pw-box"')));
  assert.ok(box.includes('id="login-form"'));
  for (const id of ['start-new', 'restart-box', 'claim-form', 'signup-form', 'code-form', 'diag-form']) {
    const tag = html.match(new RegExp('<[a-z]+[^>]*\\sid="' + id + '"[^>]*>'));
    assert.ok(tag, id + ' is missing');
    assert.ok(/\shidden(\s|>|=)/.test(tag[0]), id + ' must stay hidden by default');
  }
});

test('decorative icons are hidden from assistive technology and no firm name is hard-coded', () => {
  const html = login();
  const aside = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
  assert.ok((aside.match(/<svg[^>]*aria-hidden="true"/g) || []).length >= 3);
  assert.ok(!/<svg(?![^>]*aria-hidden)/.test(aside), 'every svg in the panel is decorative');
  assert.ok(!/(?:TATY|EYNOWA)/i.test(html.replace(/<script>[\s\S]*?<\/script>/, '')), 'no firm name in the markup: the firm name comes from data-firm-name');
});

test('the card keeps the login-card class where brand-theme.js mounts the language switch', () => {
  const theme = read('assets/brand-theme.js');
  assert.ok(theme.includes("document.querySelector('.login-card')"), 'brand-theme.js no longer looks for .login-card: update this test and the markup together');
  assert.ok(/class="[^"]*\blogin-card\b[^"]*"/.test(login()), 'the card must keep the login-card class');
});

function luminance(hex) {
  const c = hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test('error messages keep AA contrast (4.5:1) on the dark card too', () => {
  const css = read('assets/ui/auth.css');
  const light = css.match(/\.om-auth \.status\.error\s*{[^}]*color:\s*var\(--danger,\s*(#[0-9a-f]{6})\)/i);
  const dark = css.match(/\.dark \.om-auth \.status\.error\s*{[^}]*color:\s*(#[0-9a-f]{6})/i);
  assert.ok(dark, 'a lighter error colour is needed under .dark');
  assert.ok(ratio(dark[1], '#0a0a0a') >= 4.5, 'dark error colour contrast ' + ratio(dark[1], '#0a0a0a').toFixed(2));
  assert.ok(light && ratio(light[1], '#ffffff') >= 4.5, 'light fallback error colour contrast');
});

test('the French question mark never wraps alone on the sign-up line', () => {
  assert.ok(login().includes('Pas encore de compte&nbsp;?'));
});
