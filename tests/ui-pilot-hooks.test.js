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
  'opportunites.html': 'ee406d61d7d4f410ee15a92a5a9e61a32f681137537e29b1006a4a553959e7fd',
  'veille.html': '71b4987c47752f37d7d36908d8ace2dacedb68e60e15b7c3f6d5f3f5d249d9e8',
  'secretariat.html': '0fa0aa1341c6a42f882fa967ea353abfe9bf5393f32353b5574126e077169b6e',
  'validations.html': 'e791d88de28eae36a2457abe1da20bd9e19568fb4c9e4d6d879983e6040e6e30',
  'messagerie.html': '3a7a031f53a3e098216a677f754c7086d2206b00b6aa6dd4d27f857bbd1c8d07',
  'recherche.html': '8204a7e5a390e20dc2cceaccb437ec125b2c6afc34bea62b2d8551ca3558797e',
  'rangement.html': 'a804fbab64dbedc2498f28ddf1427986460ca583ade8b286e3124f60f2dc64dd',
  'apprentissage.html': '50c5fa6149cf72d8ce8f609bb62c478ba2defe53a58cb0c623bc243a6a4d2898',
  'assistant.html': '81568bdf56f981b699fcea87e1af11801ae3b9168d823f73f691e4189f8a45be',
  'auditeur.html': 'f35c16f1edebaf4ed884f90f2299de8ceab772aced92ad54badc6f33e9e6a53f',
  'carte.html': '517264de7878e11fa9e4c0ddbd52b1537bed1ee0a8614f286bbbda3d6255bf45',
  'entrainement.html': '498594eedf82d79934500483f4e6674008f10ec26b7e77557a8bdb6ebd04a735',
  'fichiers.html': '3754d85d85743a8676c7722fbdf334e8cbc11df0eab262f27246585d9d634b3d',
  'missions-terminees.html': '3bc3550b6db8965b93c70910029a0bed4807dbd406f6ae3abf5696c1ef43dd80',
  'mon-ia.html': '37df909cadf681eeea0794dad10714686e93046bfdb8d051017013181d542281',
  'preparation.html': '94fd07a732baee5ad99109ec897ef3c645c353a6197552be3ea1fc6d2b2e45dd',
  'presentation.html': 'd0fc3521e64512260a4f1cffe9b7d714ccdff92b376221b5bbf6e6ffb4454ef5',
  'questionnaire.html': '68904f87d60289c6dd6851f70bd65228c06c7b61da90c44b6f1df33bf72bb9ea',
  'index.html': '510b342a031c4b5be4c462898baadcd536f4abfa2a099df51e727f95fcc1d1b0',
  'opportunites-corrige.html': 'f8de45c22f7fb89ae4c32db5af88f72bcdbe7ece219217eaeeaa178fa086f3a3',
  'diagnostic-ia.html': '0aaf7974879afc9d9bcb53df400350d905e59b5bddc37f40ed1a229ed1e26332',
  'test-cabinet.html': '68745167bb28e12a7f3b54c4dfceeba4bcc7d037f6061612fced4d8245f91b11',
  'cabinet-simulation-resultats.html': '8e9d2714e40cc4cded695737f6ff83e5bce7d2e21ee13592b441e14800fe3bdf',
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
