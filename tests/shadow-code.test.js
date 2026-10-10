import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, codeStep, requestCodeChange, closeCodeProposal, autoCodeProposal, AGENT_FILES, unifiedDiff } from '../lib/shadow-code.js';
import { isGuardedFile, dangerousCode } from '../lib/shadow-guard.js';
import { emptyLab } from '../lib/shadow.js';

function store() {
  let file = null;
  return { get: () => file, updateJsonFile: async (n, f) => { const r = await f(file ? structuredClone(file) : null); if (r) file = r; return {}; },
    drive: { findFilesByExactName: async () => file ? [{ id: 'lab' }] : [], downloadBuffer: async () => Buffer.from(JSON.stringify(file)) } };
}
const SRC = {
  'lib/tidy-plan.js': "// the brain\nexport function score(x) {\n  return x > 0.9 ? 'file' : 'ask';\n}\n",
  'lib/orpailleur-ask.js': 'export const ask = () => 1;\r\nexport const two = () => 2;\r\n'
};

test('Shadow code: guard rails — protected files, power, secrets, ambiguous edits are refused', () => {
  for (const f of ['lib/shadow-guard.js', 'lib/shadow-code.js', 'lib/action-decisions.js', 'lib/user-auth.js', 'api/app.js', 'db/memory.sql', 'package.json', 'tests/opportunities.test.js', 'vercel.json']) assert.equal(isGuardedFile(f), true, f);
  for (const f of ['lib/tidy-plan.js', 'lib/shadow.js', 'tests/shadow-orpailleur-x.test.js']) assert.equal(isGuardedFile(f), false, f);
  const r = applyEdits(SRC, [
    { file: 'lib/action-decisions.js', find: 'a', replace: 'b' },
    { file: 'lib/tidy-plan.js', find: "x > 0.9", replace: "x > 0.9 && process.env.GOOGLE_TOKEN" },
    { file: 'lib/tidy-plan.js', find: 'x', replace: 'y' },
    { file: 'lib/mission-events.js', find: 'a', replace: 'b' }
  ]);
  assert.equal(r.problems.length, 4);
  assert.match(r.problems.join('|'), /protégé/); assert.match(r.problems.join('|'), /droits, aux secrets/); assert.match(r.problems.join('|'), /apparaît \d+ fois/); assert.match(r.problems.join('|'), /hors des fichiers/);
  assert.equal(r.sources['lib/tidy-plan.js'], SRC['lib/tidy-plan.js'], 'nothing applied from refused edits');
  assert.equal(dangerousCode("status: 'approved'"), true);
  // A good edit, and line endings of a CRLF file are kept.
  const ok = applyEdits(SRC, [{ file: 'lib/tidy-plan.js', find: "x > 0.9 ? 'file'", replace: "x >= 0.95 ? 'file'" }, { file: 'lib/orpailleur-ask.js', find: 'export const two = () => 2;\n', replace: 'export const two = () => 2; // checked\n' }]);
  assert.deepEqual(ok.problems, []);
  assert.match(ok.sources['lib/tidy-plan.js'], /x >= 0\.95/);
  assert.equal(ok.sources['lib/orpailleur-ask.js'], 'export const ask = () => 1;\r\nexport const two = () => 2; // checked\r\n');
  assert.match(unifiedDiff(SRC['lib/tidy-plan.js'], ok.sources['lib/tidy-plan.js'], 'lib/tidy-plan.js'), /^-  return x > 0\.9.*\n\+  return x >= 0\.95/m);
});

test('Shadow code: proposal → its own branch and a DRAFT pull request (never merged); without GitHub it waits with its diff', async () => {
  const st = store();
  const calls = [];
  const fetchImpl = async (url, o) => {
    calls.push({ url: url.replace('https://api.github.com/repos/o/r', ''), method: o.method, body: o.body ? JSON.parse(o.body) : null });
    const u = url.replace('https://api.github.com/repos/o/r', '');
    const j = u.startsWith('/git/ref/') ? { object: { sha: 'base' } } : u.startsWith('/git/commits/') ? { tree: { sha: 't0' } } : u === '/git/trees' ? { sha: 't1' } : u === '/git/commits' ? { sha: 'c1' } : u === '/git/refs' ? { ref: 'x' } : u === '/pulls' ? { number: 7, html_url: 'https://github.com/o/r/pull/7' } : {};
    return { ok: true, json: async () => j };
  };
  const ai = async () => ({ provider: 'anthropic', text: JSON.stringify({ summary: 'Seuil de rangement relevé', problem: 'rangements faux', cause: 'seuil trop bas',
    edits: [{ file: 'lib/tidy-plan.js', find: "x > 0.9 ? 'file'", replace: "x >= 0.95 ? 'file'", why: 'moins de rangements faux' }],
    new_tests: [{ file: 'tests/shadow-orpailleur-seuil.test.js', content: "import test from 'node:test';\ntest('x', () => {});\n" }, { file: 'tests/tidy-plan.test.js', content: 'x' }], tests_to_run: ['npm test'], risks: ['plus de questions'], rollback: 'fermer la PR' }) });
  const fired = [];
  const d = { updateJsonFile: st.updateJsonFile, drive: st.drive, folder: 'om', env: { ANTHROPIC_API_KEY: 'k' }, ai, readSource: async f => { if (!(f in SRC)) throw new Error('404'); return SRC[f]; }, checkSyntax: async () => [],
    fire: async (req, path, body) => { fired.push(body); }, fetchImpl, github: { connected: true, repo: 'o/r', base: 'feature/white-label-desktop', token: 't' } };
  const r = await requestCodeChange('org', {}, { agent: 'orpailleur', goal: 'moins de rangements faux' }, 'Paul', d);
  await assert.rejects(requestCodeChange('org', {}, { agent: 'orpailleur' }, 'Paul', d), /CODE_PROPOSAL_ALREADY_OPEN/);
  await assert.rejects(requestCodeChange('org', {}, { agent: 'root' }, 'Paul', d), /UNKNOWN_AGENT/);
  assert.equal(fired[0].proposal_id, r.id);
  const out = await codeStep('org', {}, { proposal_id: r.id }, d);
  assert.equal(out.status, 'pr_open');
  const pr = calls.find(c => c.url === '/pulls');
  assert.equal(pr.body.draft, true);
  assert.equal(pr.body.base, 'feature/white-label-desktop');
  assert.match(pr.body.head, /^shadow\/orpailleur-code-/);
  const tree = calls.find(c => c.url === '/git/trees').body.tree.map(t => t.path).sort();
  assert.deepEqual(tree, ['lib/tidy-plan.js', 'tests/shadow-orpailleur-seuil.test.js'], 'an existing test is never rewritten');
  assert.equal(calls.some(c => /merge/.test(c.url)), false, 'Shadow never merges');
  const p = st.get().code_proposals[0];
  assert.equal(p.pr_url, 'https://github.com/o/r/pull/7');
  assert.match(p.diff, /\+  return x >= 0\.95/);
  await closeCodeProposal('org', { id: r.id, reason: 'pas maintenant' }, 'Paul', d);
  assert.equal(st.get().code_proposals[0].status, 'closed');
  assert.deepEqual(calls.at(-1), { url: '/pulls/7', method: 'PATCH', body: { state: 'closed' } });

  // Without GitHub: nothing is applied anywhere, the proposal and its diff wait in the lab.
  const st2 = store();
  const d2 = { ...d, updateJsonFile: st2.updateJsonFile, drive: st2.drive, github: { connected: false } };
  const r2 = await requestCodeChange('org', {}, { agent: 'shadow' }, 'Paul', { ...d2, readSource: async () => "export const lab = 1;\nconst x = 0.9 ? 'file' : 2;\n" });
  const ai2 = async () => ({ provider: 'anthropic', text: JSON.stringify({ summary: 's', edits: [{ file: 'lib/shadow.js', find: "x = 0.9 ? 'file'", replace: "x = 0.95 ? 'file'" }] }) });
  const o2 = await codeStep('org', {}, { proposal_id: r2.id }, { ...d2, ai: ai2, readSource: async () => "export const lab = 1;\nconst x = 0.9 ? 'file' : 2;\n" });
  assert.equal(o2.status, 'ready_without_github');
  assert.deepEqual(AGENT_FILES.shadow, ['lib/shadow.js'], 'Shadow improves itself, never its guard rails');
});

test('Shadow code: an edit that breaks the code is refused (syntax), recurrent problems trigger one proposal a day', async () => {
  const st = store();
  const d = { updateJsonFile: st.updateJsonFile, drive: st.drive, folder: 'om', env: { ANTHROPIC_API_KEY: 'k' }, readSource: async f => SRC[f], fire: async () => null, github: { connected: false },
    ai: async () => ({ provider: 'anthropic', text: JSON.stringify({ summary: 's', edits: [{ file: 'lib/tidy-plan.js', find: "return x > 0.9 ? 'file' : 'ask';", replace: 'return x > (;' }] }) }) };
  const r = await requestCodeChange('org', {}, { agent: 'orpailleur' }, 'Paul', d);
  const out = await codeStep('org', {}, { proposal_id: r.id }, d);
  assert.equal(out.status, 'refused');
  assert.match(st.get().code_proposals[0].refused.join(' '), /tidy-plan\.js/);
  // Auto: 3 problems of the same agent in 14 days and no open proposal → one proposal, once a day.
  const st3 = store();
  const now = new Date().toISOString();
  await st3.updateJsonFile('x', () => ({ ...emptyLab(), problems: [1, 2, 3].map(() => ({ agent: 'sika', at: now })) }));
  const d3 = { ...d, updateJsonFile: st3.updateJsonFile, drive: st3.drive };
  const a = await autoCodeProposal('org', { headers: { host: 'x' } }, d3);
  assert.match(a.id, /^CODE-/);
  assert.equal(st3.get().code_proposals[0].agent, 'sika');
  assert.deepEqual(await autoCodeProposal('org', {}, d3), { skipped: 'ALREADY_TODAY' });
  assert.deepEqual(await autoCodeProposal('org', {}, { ...d3, env: { SHADOW_CODE_AUTO: 'false' } }), { skipped: 'SHADOW_CODE_AUTO=false' });
});
