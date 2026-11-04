// Office Manager on the firm's own server (VPS, 2026-11-04 — Paul: « je ne veux plus utiliser supabase et vercel »).
// One Node process: the pages, the api/*.js handlers UNCHANGED (same req/res helpers Vercel gave them), the rules of vercel.json
// (rewrites, redirects, security headers), the e-mail confirmation link of the firm's own accounts, and the scheduler that Supabase's
// pg_cron used to call every 5 minutes. HTTPS is done in front of it by Caddy (docker-compose.yml).
// Start: node server/index.mjs   (PORT, default 3000; environment in .env, see .env.example)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VERCEL = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const MAX_BODY = Number(process.env.OFFICE_MANAGER_MAX_BODY_BYTES || 12 * 1024 * 1024);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.pdf': 'application/pdf' };

// ---- vercel.json rules ------------------------------------------------------------------------------------------------------------
// Vercel patterns: "/(a|b)/(.*)" are regular expressions anchored on the whole path.
const pattern = source => new RegExp('^' + source + '$');
const REDIRECTS = (VERCEL.redirects || []).map(r => ({ re: pattern(r.source), to: r.destination, code: r.permanent ? 308 : 307 }));
const REWRITES = (VERCEL.rewrites || []).map(r => ({ re: pattern(r.source), to: r.destination }));
const HEADERS = (VERCEL.headers || []).map(h => ({ re: pattern(h.source), headers: h.headers }));

// Only what the browser needs is served: the pages at the root, assets/, excel/ and the published simulation results.
// Code, SQL, documents, secrets and anything else is never a file of the site.
const PUBLIC = [/^\/[A-Za-z0-9_-]+\.html$/, /^\/assets\/[A-Za-z0-9_./-]+$/, /^\/excel\/[A-Za-z0-9_./-]+$/, /^\/docs\/FIRM_SIMULATION_DISK\.md$/, /^\/docs\/firm-simulation-results\/[A-Za-z0-9_./-]+$/];

function securityHeaders(path, res) {
  for (const h of HEADERS) if (h.re.test(path)) for (const { key, value } of h.headers) res.setHeader(key, value);
}

// ---- the req / res helpers the api/*.js handlers use on Vercel ------------------------------------------------------------------------
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY) throw Object.assign(new Error('REQUEST_TOO_LARGE'), { statusCode: 413 }); chunks.push(c); }
  const raw = Buffer.concat(chunks);
  if (!raw.length) return undefined;
  const type = String(req.headers['content-type'] || '');
  if (/application\/json/i.test(type)) { try { return JSON.parse(raw.toString('utf8')); } catch { throw Object.assign(new Error('INVALID_JSON'), { statusCode: 400 }); } }
  if (/application\/x-www-form-urlencoded/i.test(type)) return Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
  if (/^text\//i.test(type)) return raw.toString('utf8');
  return raw;
}
function decorate(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); return res; };
  res.send = value => {
    if (value == null) { res.end(); return res; }
    if (Buffer.isBuffer(value)) { res.end(value); return res; }
    if (typeof value === 'object') return res.json(value);
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(String(value)); return res;
  };
  res.redirect = (a, b) => { const [code, to] = typeof a === 'number' ? [a, b] : [307, a]; res.statusCode = code; res.setHeader('Location', to); res.end(); return res; };
  return res;
}

const handlers = new Map();
async function apiHandler(name) {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  if (handlers.has(name)) return handlers.get(name);
  const file = join(ROOT, 'api', name + '.js');
  if (!existsSync(file)) return null;
  const mod = await import(pathToFileURL(file).href);
  handlers.set(name, mod.default);
  return mod.default;
}

// ---- static files -------------------------------------------------------------------------------------------------------------------
async function serveStatic(path, req, res) {
  if (!PUBLIC.some(re => re.test(path))) return false;
  const file = normalize(join(ROOT, decodeURIComponent(path)));
  if (!file.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return false;
  let info;
  try { info = await stat(file); } catch { return false; }
  if (!info.isFile()) return false;
  res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Cache-Control', /\.html$/.test(file) ? 'no-cache' : 'public, max-age=300');
  res.setHeader('Content-Length', info.size);
  if (req.method === 'HEAD') { res.end(); return true; }
  res.end(await readFile(file));
  return true;
}

// ---- one request --------------------------------------------------------------------------------------------------------------------
export async function handle(req, res) {
  decorate(res);
  const url = new URL(req.url, 'http://local');
  let path = url.pathname;
  try {
    securityHeaders(path, res);
    for (const r of REDIRECTS) if (r.re.test(path)) return res.redirect(r.code, r.to);
    // The link of the e-mail that confirms an address (the firm's own accounts, lib/local-auth.js).
    if (path === '/auth/v1/verify' && req.method === 'GET') {
      const { verifyLinkRedirect } = await import('../lib/local-auth.js');
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(303, await verifyLinkRedirect(Object.fromEntries(url.searchParams)));
    }
    for (const r of REWRITES) if (r.re.test(path)) {
      const to = new URL(r.to, 'http://local');
      for (const [k, v] of url.searchParams) if (!to.searchParams.has(k)) to.searchParams.set(k, v);
      path = to.pathname; url.search = to.search;
      break;
    }
    const api = path.match(/^\/api\/([a-z0-9-]+)\/?$/);
    if (api) {
      const handler = await apiHandler(api[1]);
      if (!handler) return res.status(404).json({ error: 'NOT_FOUND' });
      req.query = Object.fromEntries(url.searchParams);
      req.body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
      return await handler(req, res);
    }
    if (['GET', 'HEAD'].includes(req.method) && await serveStatic(path, req, res)) return;
    return res.redirect(307, '/accueil.html');
  } catch (e) {
    if (!res.headersSent) res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : 'SERVER_ERROR' });
    if (!e.statusCode) console.error('[server]', req.method, path, e?.stack || e);
  }
}

// ---- the scheduler (was Supabase pg_cron → bridge → /api/app?route=scheduler-tick, every 5 minutes) ---------------------------------
export function startScheduler(port, env = process.env) {
  const secret = env.OFFICE_MANAGER_SCHEDULER_SECRET || env.ORPAILLEUR_JOB_SECRET;
  if (!secret || env.OFFICE_MANAGER_SCHEDULER === 'off') { console.warn('[scheduler] off (OFFICE_MANAGER_SCHEDULER_SECRET missing or OFFICE_MANAGER_SCHEDULER=off)'); return null; }
  const every = Math.max(60, Number(env.OFFICE_MANAGER_SCHEDULER_SECONDS || 300)) * 1000;
  let running = false;
  const tick = async () => {
    if (running) return;          // never two passes at once
    running = true;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/app?route=scheduler-tick`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-scheduler-secret': secret }, body: '{}' });
      if (!r.ok) console.warn('[scheduler] tick HTTP', r.status);
    } catch (e) { console.warn('[scheduler] tick failed:', e.message); }
    finally { running = false; }
  };
  const timer = setInterval(tick, every);
  timer.unref?.();
  return timer;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  // The code's production guards read VERCEL_ENV (owner list required, no test mode, no sandbox mail). The firm's server IS its
  // production unless said otherwise (OFFICE_MANAGER_ENV=test for a trial server).
  if (!process.env.VERCEL_ENV) process.env.VERCEL_ENV = process.env.OFFICE_MANAGER_ENV === 'test' ? 'preview' : 'production';
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer((req, res) => { handle(req, res); });
  // Long agent passes and large reads: no Vercel time limit here, but a hung client is not kept forever.
  server.requestTimeout = Number(process.env.OFFICE_MANAGER_REQUEST_TIMEOUT_MS || 15 * 60 * 1000);
  server.headersTimeout = 65_000;
  server.listen(port, () => console.log(`[server] Office Manager on port ${port}`));
  startScheduler(port);
  const stop = async () => { server.close(); try { (await import('../lib/pg-db.js')).closeDatabase(); } catch { /* ignore */ } process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
