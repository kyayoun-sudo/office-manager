// Starts the REAL gateway process (no Office Manager) against a SIMULATED Ollama and an in-test Chroma double.
// Proves the HTTP contract and key scoping end to end; it does not prove model quality (see tests/helpers/fake-ollama.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeOllama } from './helpers/fake-ollama.mjs';

function fakeChroma() {
  const cols = new Map();
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c; const b = raw ? JSON.parse(raw) : {};
    const send = d => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (req.url.endsWith('/heartbeat')) return send({});
    if (req.url.endsWith('/collections')) { if (!cols.has(b.name)) cols.set(b.name, { id: crypto.randomUUID(), rows: [] }); const c = cols.get(b.name); return send({ id: c.id, name: b.name }); }
    const col = [...cols.values()].find(c => req.url.includes(c.id));
    if (req.url.endsWith('/upsert')) { b.ids.forEach((id, i) => { col.rows = col.rows.filter(r => r.id !== id); col.rows.push({ id, doc: b.documents?.[i], meta: b.metadatas?.[i] || {} }); }); return send(true); }
    if (req.url.endsWith('/query')) {
      const rows = col.rows.filter(r => !b.where?.tenant || r.meta.tenant === b.where.tenant).slice(0, b.n_results);
      return send({ ids: [rows.map(r => r.id)], documents: [rows.map(r => r.doc)], metadatas: [rows.map(r => r.meta)], distances: [rows.map(() => 0.2)] });
    }
    res.writeHead(404); res.end('{}');
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

test('real gateway process: scoped keys, task with verified citations, no Office Manager', async t => {
  const ollama = await startFakeOllama(); const chroma = await fakeChroma();
  const dir = mkdtempSync(join(tmpdir(), 'lab-')); const key = 'k-' + crypto.randomBytes(24).toString('hex');
  const h = x => crypto.createHash('sha256').update(x).digest('hex');
  writeFileSync(join(dir, 'clients.json'), JSON.stringify([{ id: 'accounting-ai', key_sha256: h(key), tenants: ['t1'], knowledge: ['syscohada'], can_remember: true }]));
  writeFileSync(join(dir, 'knowledge.json'), JSON.stringify([{ id: 'syscohada', kind: 'chroma', name: 'kb', authority: 'normative', version: 'test' }]));
  const port = 18000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['lab-gateway-server.js'], { env: { PATH: process.env.PATH, PORT: String(port), EYNOWA_LAB_API_KEY: 'legacy-' + 'z'.repeat(40),
    EYNOWA_TOOL_GATEWAY_ENABLED: 'true', OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.port}`, CHROMA_BASE_URL: `http://127.0.0.1:${chroma.port}`,
    EYNOWA_LAB_CLIENTS_FILE: join(dir, 'clients.json'), EYNOWA_LAB_KNOWLEDGE_FILE: join(dir, 'knowledge.json'), EYNOWA_LAB_MODEL: 'fake-simulated:0' } });
  t.after(() => { child.kill(); ollama.server.close(); chroma.server.close(); });
  await new Promise((ok, ko) => { child.stdout.on('data', d => String(d).includes('ready') && ok()); child.on('exit', c => ko(new Error('exit ' + c))); });
  const call = (path, body, k = key) => fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  assert.equal((await fetch(`http://127.0.0.1:${port}/livez`)).status, 200);
  assert.equal((await call('/v1/capabilities', null, 'wrong')).status, 401);
  await call('/memory/semantic-store', { collection: 'kb', text: 'Passage de test sur les immobilisations.' }, 'legacy-' + 'z'.repeat(40));
  const caps = await (await call('/v1/capabilities')).json();
  assert.deepEqual(caps.models, ['fake-simulated:0', 'nomic-embed-text-v2-moe']);
  const r = await (await call('/v1/task', { task: 'Traiter', scope: { tenant: 't1' }, knowledge: { query: 'immobilisations' } })).json();
  assert.equal(r.citations.length, 1); assert.deepEqual(r.rejected_citations, ['P-0000000000000000']);
  assert.equal((await call('/v1/memory/search', { query: 'x', scope: { tenant: 'other' } })).status, 403);
  assert.equal((await call('/v1/memory/remember', { text: 'x', scope: { tenant: 't1' } })).status, 400);
});
