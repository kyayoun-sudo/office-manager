import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// A merge once glued two versions of assets/firm-simulation.js together (« Unexpected end of input » in the browser,
// the virtual firm never appeared). Every browser script of the app must at least parse.
test('every script in assets/ and every inline script of the pages parses', () => {
  const bad = [];
  for (const f of fs.readdirSync('assets').filter(x => x.endsWith('.js'))) {
    try { new vm.Script(fs.readFileSync('assets/' + f, 'utf8'), { filename: f }); } catch (e) { bad.push(f + ': ' + e.message); }
  }
  for (const f of fs.readdirSync('.').filter(x => x.endsWith('.html'))) {
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/\bsrc=/.test(m[1])) { if (m[2].trim()) bad.push(f + ': a script with src also holds inline code (ignored by the browser)'); continue; }
      if (/type="(?!text\/javascript|module)/.test(m[1])) continue;
      try { new vm.Script(m[2], { filename: f }); } catch (e) { bad.push(f + ': ' + e.message); }
    }
  }
  assert.deepEqual(bad, []);
});
