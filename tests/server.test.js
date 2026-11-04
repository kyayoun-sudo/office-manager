// The firm's own server (VPS, no Vercel): pages, api/*.js unchanged, the rules of vercel.json, nothing else served.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handle } from '../server/index.mjs';

async function withServer(run) {
  const server = http.createServer((req, res) => { handle(req, res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try { await run(base); } finally { await new Promise(r => server.close(r)); }
}
const get = (base, path, init = {}) => fetch(base + path, { redirect: 'manual', ...init });

test('pages are served with the security headers of vercel.json; the root goes to the home page', async () => {
  await withServer(async base => {
    const home = await get(base, '/');
    assert.equal(home.status, 307);
    assert.equal(home.headers.get('location'), '/accueil.html');
    const page = await get(base, '/accueil.html');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    const asset = await get(base, '/assets/brand-theme.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /javascript/);
  });
});

test('code, SQL, secrets and documents are never files of the site', async () => {
  await withServer(async base => {
    for (const path of ['/lib/supabase.js', '/db/INSTALL_TOUT.sql', '/package.json', '/vercel.json', '/CLAUDE.md', '/.env', '/server/index.mjs',
      '/tests/server.test.js', '/assets/../lib/supabase.js', '/assets/%2e%2e/lib/supabase.js', '/api/../lib/accounts.js', '/entrainement/x.xlsx', '/docs/AUDIT.md', '/Dockerfile', '/docker-compose.yml', '/Caddyfile', '/.env.example', '/backups/x.dump']) {
      const r = await get(base, path);
      assert.ok([307, 308].includes(r.status), path + ' → ' + r.status);
      assert.equal(r.headers.get('location'), '/accueil.html', path);
    }
  });
});

test('api/*.js run unchanged with the Vercel helpers (query, JSON body, status().json()); unknown api = 404', async () => {
  await withServer(async base => {
    const h = await get(base, '/api/health');
    assert.equal(h.status, 200);
    const body = await h.json();
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.providers.database, 'boolean');
    assert.equal((await get(base, '/api/health', { method: 'POST' })).status, 405);
    assert.equal((await get(base, '/api/nope')).status, 404);
    const bad = await get(base, '/api/app?route=signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'INVALID_JSON');
  });
});
