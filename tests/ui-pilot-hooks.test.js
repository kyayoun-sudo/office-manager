import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Fingerprints from the pre-pilot HTML, including markup inside inline scripts.
const baseline = {
  'accueil.html': '47511c0902d7b0243d2fc5085053dd8423bd7615eb4df0e076fcdb382fe253ad',
  'mission.html': '546dced6bd4cf2d54ae2cb6c4a6cdec6442eb4d67494f0f0a71b1f467b327933',
  'procedure.html': '0eb664662ec5904b3afec4efcc37dbc2333b45a9e3ae9583f084068ccd9255df',
  'dossiers.html': 'fc697d435a08db369be1ac73fdc43ead24a64b6836f941c8d6e2c3a2efe81b5f',
  'pilotage.html': 'ea16697c7a6239c5c078afcf9556b28a7632b8d49b1ae62e5766dcf7de4350f9',
  'programme.html': 'a9e2f3beeb61530be58355fce57f3a31b7099db9677656fa237bd104a6003378',
  'workflow.html': '7eede4c1b0c03c6ca19e295d6ae06830b6929aac9860bc161a73ce6b950483ed',
  'revue-analytique.html': '3b7f098cf0d145841a1d58d3476ff09bc8ac27697ff0ea5bb7d37fa4c142f118',
  'methodologie.html': 'a5fc261e980e86d17b32c4919e583c61d40e367db51c4de7b7c70e918250cfb1',
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
