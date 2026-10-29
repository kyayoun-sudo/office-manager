// Syntax check of every JavaScript file of the repository (audit 2026-10-29: `npm run check` covered 13 files out of ~400).
import { execFileSync, spawnSync } from 'node:child_process';

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.js', '*.mjs'], { encoding: 'utf8' })
  .split('\n').filter(f => f && !/^(node_modules|desktop\/node_modules)\//.test(f));
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; console.error(`✖ ${f}\n${r.stderr}`); }
}
console.log(`${files.length - failed}/${files.length} files parse`);
process.exit(failed ? 1 : 0);
