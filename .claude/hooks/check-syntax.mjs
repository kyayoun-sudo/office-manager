// PostToolUse hook: syntax-check a JS file right after Claude edits it.
// Exit code 2 sends the error back to Claude so it fixes it immediately.
import { spawnSync } from 'node:child_process';

let input = '';
for await (const chunk of process.stdin) input += chunk;

let file;
try {
  file = JSON.parse(input)?.tool_input?.file_path;
} catch {
  process.exit(0);
}
if (!file || !/\.(m?js|cjs)$/i.test(file) || /[\\/]node_modules[\\/]/.test(file)) process.exit(0);

const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
if (result.status !== 0) {
  process.stderr.write(`Erreur de syntaxe dans ${file} :\n${result.stderr}`);
  process.exit(2);
}
