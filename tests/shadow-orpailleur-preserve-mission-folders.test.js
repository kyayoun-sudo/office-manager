import test from 'node:test';
import assert from 'node:assert/strict';
import { TIDY_INSTRUCTIONS } from '../lib/tidy-plan.js';

test('le prompt distingue les branches de mission proches et protège un dossier spécifique', () => {
  assert.match(TIDY_INSTRUCTIONS, /Compare le chemin complet du dossier actuel et celui de la destination/);
  assert.match(TIDY_INSTRUCTIONS, /« Audit de projets » et « Audit »/);
  assert.match(TIDY_INSTRUCTIONS, /demande uniquement l'information manquante plutôt que de déplacer le fichier par ressemblance de noms/);
});
