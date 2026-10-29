import test from 'node:test';
import assert from 'node:assert/strict';
import { TIDY_INSTRUCTIONS } from '../lib/tidy-plan.js';

test('le classement privilégie la fonction documentée et la mission existante sur l’apparence ou les mots-clés', () => {
  assert.match(TIDY_INSTRUCTIONS, /fais primer la fonction établie par le contenu et le rattachement à une mission existante sur l’apparence de modèle ou de classeur/);
  assert.match(TIDY_INSTRUCTIONS, /un working file de due diligence reste un document de cette mission/);
});
