import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../mobile.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/mobile.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../assets/mobile.js', import.meta.url), 'utf8');

test('mobile uses existing Firm Manager session and five tabs', () => {
  assert.ok(html.includes('/assets/brand-theme.js'));
  assert.ok(html.includes('id="mobile-app" hidden'));
  for (const tab of ['accueil', 'messages', 'ia', 'missions', 'travail']) {
    assert.ok(html.includes('data-tab="' + tab + '"'));
    assert.ok(html.includes('id="panel-' + tab + '"'));
  }
});

test('mobile Javascript parses and does not introduce authentication storage', () => {
  assert.doesNotThrow(() => new vm.Script(js));
  assert.ok(js.includes('OM.hasPersonalSession()'));
  assert.ok(js.includes('OM.checkSession()'));
  assert.ok(js.includes("OM.api('/api/missions')"));
  assert.ok(js.includes("OM.api('/api/app?route=notifications')"));
  assert.ok(js.includes("OM.api('/api/app?route=chat&conversation=cabinet')"));
  assert.ok(!js.includes('innerHTML'));
  assert.ok(!js.includes('localStorage.'));
});

test('mobile layout supports safe areas and small screens', () => {
  assert.ok(css.includes('safe-area-inset-bottom'));
  assert.ok(css.includes('max-width:350px'));
  assert.ok(css.includes('prefers-reduced-motion'));
});
