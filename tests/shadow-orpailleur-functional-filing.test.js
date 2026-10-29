import test from 'node:test';
import assert from 'node:assert/strict';
import { TIDY_INSTRUCTIONS } from '../lib/tidy-plan.js';

const flat = TIDY_INSTRUCTIONS.replace(/\s+/g, ' ');

test('le classement privilégie la fonction établie par le contenu sur l’apparence ou les mots-clés', () => {
  assert.match(flat, /fais primer la fonction établie par le contenu sur l’apparence de classeur/);
});

test('le rattachement à une mission exige une preuve, et un modèle vierge ne va jamais dans une mission (audit 2026-10-29)', () => {
  // Une mission n’est retenue que si le contenu ou le contexte l’établit.
  assert.match(flat, /n’est retenu que si le contenu ou le contexte fourni l’établit/);
  // Un working file rempli reste à sa mission ; un modèle vierge / manuel / SOP / référentiel jamais.
  assert.match(flat, /working file REMPLI pour une mission/);
  assert.match(flat, /Un modèle VIERGE du cabinet, un manuel, une SOP ou un référentiel n’est jamais rangé dans une mission/);
  // Le doute se résout par une question, pas par un choix.
  assert.match(flat, /en cas de doute entre les deux, demande/);
  // La règle générale plus bas (méthodes / modèles) est toujours là : les deux consignes ne se contredisent plus.
  assert.match(flat, /un modèle du cabinet n'est JAMAIS une pièce PBC d'un client/);
  // Aucun exemple propre à un type de mission dans une consigne commune à tous les cabinets.
  assert.doesNotMatch(flat, /due diligence/i);
});
