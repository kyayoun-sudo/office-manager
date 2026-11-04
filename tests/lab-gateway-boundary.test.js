// The Lab gateway must start without Office Manager: it may import only Node builtins and its own two modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const OWN = new Set(['./lib/tool-gateway.js', './lib/lab-v1.js', './tool-gateway.js']);
function imports(file) { return [...readFileSync(file, 'utf8').matchAll(/^\s*import[\s\S]*?from\s+["']([^"']+)["']/gm)].map(m => m[1]); }

test('gateway files import nothing from Office Manager', () => {
  for (const file of ['lab-gateway-server.js', 'lib/lab-v1.js', 'lib/tool-gateway.js']) {
    for (const spec of imports(file)) assert.ok(spec.startsWith('node:') || OWN.has(spec), `${file} imports ${spec}`);
  }
  const docker = readFileSync('Dockerfile.lab-gateway', 'utf8');
  assert.ok(!/COPY lib \.\/lib/.test(docker) && !/npm (ci|install)/.test(docker), 'image copies only the gateway files');
});
