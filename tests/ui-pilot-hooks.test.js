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
  'login.html': 'cbe22dfb73df6bee49f435c362e9163e4c2d57db00d08810a8641b221acbec61',
  'bienvenue.html': '6ca2bdb186d28d2add5da590dd1d5189cefaa72b751a44979064efc1e6dd7c67',
  'demarrer.html': '573f93df0b6e96301b5e772719541ceb4ad98fcc6cb05a5ceb267b04fa677019',
  'mise-en-service.html': 'cf2e657eb373ebe0b02cfff6850effa1000575990de8dfecc11498e66e8bc876',
  'parametres.html': '1f8d3ec68fbaedc0aa9e5ccbc6da4053ce51a3311a7a874fabcd459e074ec4d4',
  'cabinets.html': '8a5c378333fe273fd27afb5a92415264958c7969ae2a5cc446d2d2889f075c67',
  'equipe.html': '68a66efb94cd09574ffb4e4c19a34d51ed4ec39be40a06903b5d5b082975d65a',
  'specialists.html': '734aeb79ba2a8423cb3f3f553e14cca7c34df8c229aa858dad36ef171ec7665c',
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
