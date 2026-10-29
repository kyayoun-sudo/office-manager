import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Audit 2026-10-29: Vercel publishes every file of the repository as a static file. On the deployed production,
// /lib/auth.js, /lib/supabase.js, /agents/index.js and /orchestrator.js were downloadable. Redirects run BEFORE the
// filesystem, so the source folders are redirected away. This test applies the rules of vercel.json to real paths.
const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const rules = config.redirects.filter(r => r.source !== '/').map(r => new RegExp('^' + r.source + '$'));
const blocked = p => rules.some(re => re.test(p));

test('source folders and project files are not served', () => {
  for (const p of ['/lib/auth.js', '/lib/agent-tools.js', '/agents/index.js', '/db/INSTALL_TOUT.sql', '/scripts/new-firm.mjs',
    '/supabase/functions/taty-google-bridge/index.ts', '/connectors/local-server/server.mjs', '/desktop/package.json', '/tests/accounts.test.js',
    '/claude/LOGIQUE_REMPLISSAGE_PROJETS.md', '/docs/SECURITE.md', '/docs/PASSATION_SESSION_2026-10-19.md', '/docs/architecture/01_SPECIFICATION_PRODUIT.md',
    '/lab-gateway-server.js', '/index.ts', '/CLAUDE.md', '/README.md', '/PROJECT_STATUS.md', '/package-lock.json', '/pnpm-lock.yaml', '/Dockerfile.lab-gateway', '/audit-dual-theme.patch']) {
    assert.ok(blocked(p), p + ' must not be served');
  }
});

test('what the pages and the app need stays reachable', () => {
  for (const p of ['/accueil.html', '/mission.html', '/index.html', '/assets/brand-theme.js', '/assets/app.css', '/excel/taskpane.html', '/dossiers.css',
    '/api/app', '/api/health', '/oauth/google/callback', '/docs/FIRM_SIMULATION_DISK.md', '/docs/firm-simulation-results/RESULTATS.md',
    '/docs/firm-simulation-results/cabinet-15-reference.json']) {
    assert.ok(!blocked(p), p + ' must stay reachable');
  }
});

test('every top-level folder is either blocked or deliberately public (a new folder must be decided)', () => {
  const dirs = [...new Set(execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(f => f.includes('/')).map(f => f.split('/')[0]))];
  const PUBLIC = new Set(['assets', 'excel', 'api', 'docs']);           // docs: only the two documents linked from the pages (see vercel.json)
  const HIDDEN_BY_GIT_OR_PLATFORM = new Set(['.claude']);                 // dot folders are not published
  for (const d of dirs) {
    if (PUBLIC.has(d) || HIDDEN_BY_GIT_OR_PLATFORM.has(d)) continue;
    assert.ok(blocked('/' + d + '/x.js'), 'folder ' + d + '/ is published: block it in vercel.json or list it as public here');
  }
});
