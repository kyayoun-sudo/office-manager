import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Fingerprints from the pre-pilot HTML, including markup inside inline scripts.
const baseline = {
  'accueil.html': '47511c0902d7b0243d2fc5085053dd8423bd7615eb4df0e076fcdb382fe253ad',
  'mission.html': '546dced6bd4cf2d54ae2cb6c4a6cdec6442eb4d67494f0f0a71b1f467b327933',
  'procedure.html': '0eb664662ec5904b3afec4efcc37dbc2333b45a9e3ae9583f084068ccd9255df',
};

function hooks(html) {
  return [...html.matchAll(/\s((?:id|name|data-[\w-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)(?=\s|\/?>)/gi)]
    .map(match => match[1]).sort().join('\n');
}

for (const [page, expected] of Object.entries(baseline)) {
  test(page + ' preserves id, name and data attributes', () => {
    const html = readFileSync(new URL('../' + page, import.meta.url), 'utf8');
    const actual = createHash('sha256').update(hooks(html)).digest('hex');
    assert.equal(actual, expected);
  });
}
