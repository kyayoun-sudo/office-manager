import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { handle } from '../server/index.mjs';

const page = readFileSync(new URL('../mobile.html', import.meta.url), 'utf8');
const mobileJs = readFileSync(new URL('../assets/mobile.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../mobile-sw.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../assets/mobile-manifest.json', import.meta.url), 'utf8'));

async function withServer(run) {
  const server = http.createServer(handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('installable mobile app manifest has correct route, identity and icons', () => {
  assert.equal(manifest.start_url, '/mobile.html');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');
  assert.ok(page.includes('rel="manifest" href="/assets/mobile-manifest.json"'));
  assert.ok(page.includes('rel="apple-touch-icon"'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
  assert.ok(page.includes('id="mobile-install"'));
  assert.ok(mobileJs.includes("navigator.serviceWorker.register('/mobile-sw.js', { scope: '/' })"));
});

test('mobile install flow uses existing login return and does not create a second auth scheme', () => {
  assert.ok(mobileJs.includes("encodeURIComponent('/mobile.html')"));
  assert.ok(mobileJs.includes('OM.checkSession()'));
  assert.ok(mobileJs.includes('OM.hasPersonalSession()'));
  assert.ok(!mobileJs.includes('localStorage.'));
  assert.ok(!mobileJs.includes('sessionStorage.'));
});

test('service worker never intercepts mission data, chats, API, HTML or documents', () => {
  assert.ok(worker.includes("req.method !== 'GET'"));
  assert.ok(worker.includes('STATIC_PATHS.has(url.pathname)'));
  assert.ok(worker.includes("url.origin !== self.location.origin"));
  assert.ok(!worker.includes("'/api/"));
  assert.ok(!worker.includes("'/mobile.html'"));
  assert.ok(!worker.includes("'/messagerie.html'"));
});

test('VPS serves mobile PWA files and keeps private code hidden', async () => {
  await withServer(async origin => {
    for (const url of ['/mobile.html', '/mobile-sw.js', '/assets/mobile.js',
      '/assets/mobile.css', '/assets/mobile-chat.js', '/assets/mobile-ai.js', '/assets/mobile-capture.js', '/assets/mobile-manifest.json',
      '/assets/firm-mobile-180.png', '/assets/firm-mobile-192.png',
      '/assets/firm-mobile-512.png']) {
      const r = await fetch(origin + url, { redirect: 'manual' });
      assert.equal(r.status, 200, url + ': ' + r.status);
      assert.ok(Number(r.headers.get('content-length')) > 0, url);
      if (url.endsWith('.png')) assert.match(r.headers.get('content-type'), /^image\/png/);
      if (url === '/mobile-sw.js') assert.match(r.headers.get('cache-control'), /no-cache/);
    }
    const hidden = await fetch(origin + '/lib/user-auth.js', { redirect: 'manual' });
    assert.equal(hidden.status, 307);
  });
});
