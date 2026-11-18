import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('Entraînement offers a Simulation tab and loads the simulation script', () => {
  const h = read('entrainement.html');
  assert.match(h, /data-training-view="simulation"/);
  assert.match(h, /id="training-simulation"/);
  assert.match(h, /src="\/assets\/simulation\.js"/);
  assert.match(read('assets/training-navigation.js'), /'simulation'\]/);
});

test('the banner and the way out exist and say the simulation is not real', () => {
  const b = read('assets/brand-theme.js');
  assert.match(b, /om-simulation-banner/);
  assert.match(b, /Mode Simulation/);
  assert.match(b, /om-simulation-leave/);
});

test('the simulation script never builds HTML from server text (textContent only)', () => {
  const s = read('assets/simulation.js');
  assert.doesNotMatch(s, /innerHTML\s*=/);
  assert.match(s, /route=simulation/);
  assert.match(s, /switchCabinet/);
});
