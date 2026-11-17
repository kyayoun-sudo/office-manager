import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('@tailwindcss/cli/package.json');
const { bin } = require(packagePath);

test('assets/ui.css matches the minified Tailwind build', () => {
  const actual = execFileSync(process.execPath, [
    resolve(dirname(packagePath), bin.tailwindcss),
    '-i', 'assets/ui.src.css', '--minify',
  ], { cwd: new URL('../', import.meta.url), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const expected = readFileSync(new URL('../assets/ui.css', import.meta.url), 'utf8');
  // Windows checkouts may add a CR (core.autocrlf): line endings are not a difference in the CSS.
  const norm = s => s.replace(/\r/g, '').trimEnd();
  assert.ok(norm(actual) === norm(expected), 'Run npm run build:css and commit assets/ui.css');
});
