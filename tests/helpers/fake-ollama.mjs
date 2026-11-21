// SIMULATED Ollama for contract tests ONLY. It is not a model: embeddings are hashed word counts and the
// "answer" cites the first retrieved passage. Any result obtained with it proves plumbing, never intelligence.
import http from 'node:http';
import crypto from 'node:crypto';

const DIM = 64;
export function embed(text) {
  const v = new Array(DIM).fill(0);
  for (const w of String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(x => x.length > 2)) {
    v[crypto.createHash('md5').update(w).digest()[0] % DIM] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map(x => x / n);
}

export function startFakeOllama(port = 0) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ url: req.url, body });
    const send = d => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (req.url === '/api/tags') return send({ models: [{ name: 'fake-simulated:0' }, { name: 'nomic-embed-text-v2-moe' }] });
    if (req.url === '/api/embed') return send({ embeddings: [embed(String(body.input).replace(/^search_(query|document): /, ''))] });
    if (req.url === '/api/generate') {
      const ids = [...String(body.prompt).matchAll(/\[(P-[a-f0-9]{16})\]/g)].map(m => m[1]);
      const mem = [...String(body.prompt).matchAll(/^\[(mem-[a-f0-9]+)\]/gm)].map(m => m[1]);
      return send({ model: body.model, done: true, response: JSON.stringify({ answer: 'SIMULATED', citations: ids.slice(0, 1).concat(['P-0000000000000000']), memory_used: mem.slice(0, 1), missing_information: [], confidence: 'low' }) });
    }
    res.writeHead(404); res.end('{}');
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, calls })));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  startFakeOllama(Number(process.env.PORT || 11999)).then(({ port }) => console.log('SIMULATED ollama on ' + port));
}
