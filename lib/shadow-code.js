// SHADOW REWRITES CODE — AS A PROPOSAL (Paul, 2026-10-10: « Shadow doit pouvoir réécrire le code pour
// améliorer le comportement de tous les agents et de lui-même ; ils doivent pouvoir s'améliorer eux-mêmes »).
//
// From what Shadow has learned about an agent (its problems, lessons, failed golden tests, the team's
// corrections) or from a goal the owner writes, Shadow reads that agent's source files and proposes a
// small, targeted code change: precise edits, a test to add, the risks, how to go back.
//   - It never merges and never deploys: the change is pushed to its OWN branch with a draft pull
//     request on GitHub (Vercel builds a preview of it); a person reviews, runs the tests and merges.
//   - It can never touch the guard rails (lib/shadow-guard.js): who may do what, the human approval,
//     the audit log, secrets, routes, database, deployment, dependencies, existing tests, nor this
//     pipeline itself. Edits that would hand out power or reach secrets are refused in any file.
//   - Each edit must match the current code exactly once, and every changed file must still parse.
//   - Without a GitHub connection the proposal (with its full diff) waits in Shadow's lab, saying so.
// Shadow improves itself the same way (lib/shadow.js), under the same rules.

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { parseJsonLoose } from './ai-plus.js';
import { loadLab, changeLab, shadowAI, AGENT_KEYS } from './shadow.js';
import { isGuardedFile, dangerousCode, touchesProtected } from './shadow-guard.js';

const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const cut = (s, n) => String(s ?? '').slice(0, n);

// The code that makes each agent behave (where its judgement lives).
export const AGENT_FILES = Object.freeze({
  orpailleur: ['lib/tidy-plan.js', 'lib/orpailleur-ask.js'],
  'mission-controller': ['lib/mission-events.js', 'lib/engagement-prep.js', 'lib/opportunities.js'],
  'grand-controleur': ['lib/opportunities.js', 'lib/capabilities.js', 'lib/people-cards.js'],
  'enhanced-auditor': ['lib/enhanced-auditor.js', 'lib/auditor-plus.js'],
  sika: ['lib/agent-passes.js'],
  shadow: ['lib/shadow.js']
});
export const CODE_AGENTS = Object.keys(AGENT_FILES);
const MAX_SOURCE = 160000;

export function githubConfig(env = process.env) {
  const repo = env.SHADOW_GITHUB_REPO || (env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG ? env.VERCEL_GIT_REPO_OWNER + '/' + env.VERCEL_GIT_REPO_SLUG : null);
  const base = env.SHADOW_GITHUB_BASE || env.VERCEL_GIT_COMMIT_REF || 'feature/white-label-desktop';
  return { connected: Boolean(env.SHADOW_GITHUB_TOKEN && repo), repo, base, token: env.SHADOW_GITHUB_TOKEN || null };
}

async function gh(cfg, method, url, body, d) {
  const r = await (d.fetchImpl || fetch)('https://api.github.com/repos/' + cfg.repo + url, {
    method, headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', 'User-Agent': 'office-manager-shadow' },
    body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw fail('GITHUB_' + r.status + '_' + cut(j.message, 80), 502);
  return j;
}

// The current code: from GitHub (the branch the change will start from) or from the deployment.
export async function readSource(file, d = {}) {
  const cfg = d.github || githubConfig(d.env);
  if (d.readSource) return d.readSource(file);
  if (cfg.connected) {
    const j = await gh(cfg, 'GET', '/contents/' + file.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(cfg.base), null, d);
    return Buffer.from(j.content || '', 'base64').toString('utf8');
  }
  return fs.readFile(path.join(process.cwd(), file), 'utf8');
}

// Applies search / replace edits; each must match exactly once (line endings of the file kept).
export function applyEdits(sources, edits) {
  const out = { ...sources };
  const problems = [];
  for (const e of edits) {
    const file = String(e.file || '').replace(/^\/+/, '');
    if (isGuardedFile(file)) { problems.push(file + ' : fichier protégé (garde-fous)'); continue; }
    if (!(file in out)) { problems.push(file + ' : hors des fichiers de cet agent'); continue; }
    const crlf = out[file].includes('\r\n');
    const fix = s => crlf ? String(s).replace(/\r?\n/g, '\r\n') : String(s).replace(/\r\n/g, '\n');
    const find = fix(e.find || ''), replace = fix(e.replace ?? '');
    if (!find) { problems.push(file + ' : extrait à remplacer vide'); continue; }
    const n = out[file].split(find).length - 1;
    if (n !== 1) { problems.push(file + ' : l’extrait à remplacer apparaît ' + n + ' fois (il faut exactement 1)'); continue; }
    if (dangerousCode(replace) && !dangerousCode(find)) { problems.push(file + ' : la modification ajoute du code qui touche aux droits, aux secrets ou aux validations'); continue; }
    if (touchesProtected((e.why || '') + ' ' + replace)) { problems.push(file + ' : la modification affaiblirait un garde-fou'); continue; }
    out[file] = out[file].replace(find, () => replace);
  }
  return { sources: out, problems };
}

// Every changed JavaScript file must still parse (node --check).
export async function checkSyntax(files, d = {}) {
  if (d.checkSyntax) return d.checkSyntax(files);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-'));
  const errors = [];
  try {
    for (const [file, text] of Object.entries(files)) {
      if (!/\.(m?js)$/.test(file)) continue;
      const p = path.join(dir, path.basename(file).replace(/\.js$/, '.mjs'));
      await fs.writeFile(p, text);
      await new Promise(res => execFile(process.execPath, ['--check', p], { timeout: 20000 }, (err, so, se) => { if (err) errors.push(file + ' : ' + cut(se || err.message, 300)); res(); }));
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => null); }
  return errors;
}

export function unifiedDiff(before, after, file) {
  const a = String(before).split(/\r?\n/), b = String(after).split(/\r?\n/);
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let ja = a.length - 1, jb = b.length - 1; while (ja >= i && jb >= i && a[ja] === b[jb]) { ja--; jb--; }
  const from = Math.max(0, i - 3);
  return ['--- a/' + file, '+++ b/' + file, '@@ ligne ' + (from + 1) + ' @@', ...a.slice(from, i).map(l => ' ' + l), ...a.slice(i, ja + 1).map(l => '-' + l), ...b.slice(i, jb + 1).map(l => '+' + l), ...a.slice(ja + 1, ja + 4).map(l => ' ' + l)].join('\n');
}

const CODE_PROMPT = `Tu es Shadow, le laboratoire d'apprentissage d'Office Manager (logiciel d'un cabinet d'audit). Tu proposes une modification PRÉCISE du code d'un agent pour corriger un comportement observé.
Règles :
- Petit changement ciblé qui corrige la cause du problème (pas de réécriture, pas de nouveau fichier de production, pas de nouvelle dépendance). « EXTEND, DO NOT REBUILD ».
- Garde le style du fichier (commentaires en anglais ou en français comme autour, ESM, pas de point-virgule superflu changé).
- Chaque modification = un extrait EXACT du code actuel (find, recopié caractère pour caractère, assez long pour être unique) et son remplacement (replace).
- Interdit : toucher aux droits, rôles, permissions, validations humaines (« À valider »), journal d'audit, secrets, envois externes, signatures, indépendance ; augmenter les pouvoirs d'un agent ; supprimer un contrôle ou une vérification. L'IA propose, l'humain décide.
- Ajoute si possible UN test (fichier tests/shadow-<agent>-<sujet>.test.js, node:test, sans réseau) qui échoue avant et réussit après.
- Si la cause n'est pas dans ces fichiers ou si tu n'es pas sûr, ne propose rien et explique.
JSON STRICT : {"summary":"","problem":"","cause":"","edits":[{"file":"","find":"","replace":"","why":""}],"new_tests":[{"file":"","content":""}],"tests_to_run":[""],"risks":[""],"rollback":"","not_possible":""}`;

// The owner asks (or Shadow decides, within its budget): a proposal is recorded, the work runs in the
// background (one AI call, then the branch and the pull request).
export async function requestCodeChange(orgId, req, input = {}, by = null, d = {}) {
  const agent = String(input.agent || '');
  if (!CODE_AGENTS.includes(agent)) throw fail('UNKNOWN_AGENT');
  const lab = await loadLab(d);
  const open = (lab.code_proposals || []).find(p => p.agent === agent && ['drafting', 'pr_open', 'ready_without_github'].includes(p.status));
  if (open && !input.force) throw fail('CODE_PROPOSAL_ALREADY_OPEN', 409);
  const id = 'CODE-' + new Date().toISOString().slice(0, 10) + '-' + randomUUID().slice(0, 6);
  await changeLab(l => { (l.code_proposals ||= []).push({ id, agent, goal: cut(input.goal, 2000), requested_by: by || 'Shadow', at: new Date().toISOString(), status: 'drafting' }); l.code_proposals = l.code_proposals.slice(-60); }, d);
  await (d.fire || (await import('./agent-passes.js')).fireInternal)(req, '/api/app?route=shadow-code-step', { proposal_id: id });
  return { id, status: 'drafting' };
}

export async function codeStep(orgId, req, body = {}, d = {}) {
  const lab = await loadLab(d);
  const p = (lab.code_proposals || []).find(x => x.id === body.proposal_id);
  if (!p || p.status !== 'drafting') return p || { status: 'none' };
  const set = async patch => changeLab(l => { const x = (l.code_proposals || []).find(y => y.id === p.id); if (x) Object.assign(x, patch, { updated_at: new Date().toISOString() }); l.usage = { ...l.usage, ...lab.usage }; l.calls = lab.calls; }, d);
  try {
    const files = AGENT_FILES[p.agent];
    const sources = {};
    for (const f of files) sources[f] = await readSource(f, d);
    // What Shadow knows about this agent: problems, lessons, failed golden tests.
    const known = {
      problems: (lab.problems || []).filter(x => x.agent === p.agent).slice(-15),
      lessons: (lab.lessons || []).filter(x => x.agent === p.agent && !['deprecated', 'rejected'].includes(x.status)).slice(-20).map(x => ({ lesson: x.lesson, rule: x.rule, cause: x.cause, occurrences: x.occurrences })),
      failing_tests: (lab.tests || []).filter(t => t.agent === p.agent && (t.results || []).slice(-1)[0]?.pass === false).slice(-10).map(t => ({ name: t.name, expected: t.expected })),
      self: p.agent === 'shadow' ? lab.self : undefined
    };
    let total = 0; const shown = Object.entries(sources).map(([f, t]) => { const part = t.slice(0, Math.max(0, MAX_SOURCE - total)); total += part.length; return '### FICHIER ' + f + (part.length < t.length ? ' (tronqué)' : '') + '\n' + part; }).join('\n\n');
    const r = await shadowAI(lab, { instructions: CODE_PROMPT, input: 'AGENT : ' + p.agent + '\nOBJECTIF : ' + (p.goal || 'corriger les faiblesses observées ci-dessous') + '\n\nCE QUE SHADOW A OBSERVÉ : ' + JSON.stringify(known).slice(0, 20000) + '\n\nCODE ACTUEL :\n' + shown, maxTokens: 12000 }, { kind: 'code', agent: p.agent, ref: p.id }, d);
    const x = parseJsonLoose(r.text) || {};
    if (!(x.edits || []).length) { await set({ status: 'nothing_proposed', summary: cut(x.not_possible || x.summary || 'Aucune modification sûre trouvée.', 800), by: r.provider }); return { status: 'nothing_proposed' }; }
    const { sources: after, problems } = applyEdits(sources, x.edits.slice(0, 12));
    // New test files only (never an existing one rewritten), named tests/shadow-*.test.js.
    const tests = [];
    for (const t of (x.new_tests || []).slice(0, 2)) {
      if (!/^tests\/shadow-[\w-]+\.test\.js$/.test(t.file || '') || isGuardedFile(t.file) || dangerousCode(t.content)) continue;
      const exists = await readSource(t.file, d).then(() => true, () => false);
      if (!exists) tests.push(t);
    }
    for (const t of tests) after[t.file] = String(t.content || '');
    const changed = Object.fromEntries(Object.entries(after).filter(([f, t]) => t !== sources[f]));
    const syntax = problems.length ? [] : await checkSyntax(changed, d);
    const diff = Object.keys(changed).map(f => unifiedDiff(sources[f] || '', changed[f], f)).join('\n\n');
    const record = { summary: cut(x.summary, 800), problem: cut(x.problem, 800), cause: cut(x.cause, 800), files: Object.keys(changed), diff: cut(diff, 60000), tests_to_run: (x.tests_to_run || []).slice(0, 8).map(s => cut(s, 200)),
      risks: (x.risks || []).slice(0, 8).map(s => cut(s, 300)), rollback: cut(x.rollback || 'Fermer la pull request (rien n’est fusionné) ; après fusion : revert du commit.', 400), by: r.provider };
    if (problems.length || syntax.length || !Object.keys(changed).length) { await set({ ...record, status: 'refused', refused: [...problems, ...syntax].slice(0, 12) }); return { status: 'refused' }; }
    const cfg = d.github || githubConfig(d.env);
    if (!cfg.connected) { await set({ ...record, status: 'ready_without_github', note: 'Connexion GitHub absente (SHADOW_GITHUB_TOKEN) : la modification attend ici, rien n’est appliqué.' }); return { status: 'ready_without_github' }; }
    // Its own branch, one commit, a DRAFT pull request — never merged, never deployed by Shadow.
    const baseRef = await gh(cfg, 'GET', '/git/ref/heads/' + encodeURIComponent(cfg.base), null, d);
    const baseCommit = await gh(cfg, 'GET', '/git/commits/' + baseRef.object.sha, null, d);
    const tree = await gh(cfg, 'POST', '/git/trees', { base_tree: baseCommit.tree.sha, tree: Object.entries(changed).map(([f, content]) => ({ path: f, mode: '100644', type: 'blob', content })) }, d);
    const commit = await gh(cfg, 'POST', '/git/commits', { message: 'Shadow : ' + cut(x.summary || p.agent, 70) + '\n\n' + cut(x.problem, 600) + '\n\nProposition ' + p.id + ' (Shadow, ' + r.provider + '). À relire, tester et fusionner par une personne.', tree: tree.sha, parents: [baseRef.object.sha] }, d);
    const branch = 'shadow/' + p.agent + '-' + p.id.toLowerCase();
    await gh(cfg, 'POST', '/git/refs', { ref: 'refs/heads/' + branch, sha: commit.sha }, d);
    const pr = await gh(cfg, 'POST', '/pulls', { title: '[Shadow] ' + p.agent + ' — ' + cut(x.summary, 80), head: branch, base: cfg.base, draft: true,
      body: ['Proposition **' + p.id + '** de Shadow pour **' + p.agent + '**' + (p.goal ? ' — objectif : ' + p.goal : '') + '.', '', '**Problème :** ' + (x.problem || ''), '**Cause :** ' + (x.cause || ''), '**Modification :** ' + (x.summary || ''), '',
        '**Tests à lancer :** `npm test`' + (record.tests_to_run.length ? ' ; ' + record.tests_to_run.join(' ; ') : ''), '**Risques :** ' + (record.risks.join(' ; ') || '—'), '**Retour arrière :** ' + record.rollback, '',
        'Shadow ne fusionne jamais et ne déploie jamais : une personne relit, teste et décide. Les garde-fous (lib/shadow-guard.js) n’ont pas pu être modifiés.'].join('\n') }, d);
    await set({ ...record, status: 'pr_open', branch, pr_number: pr.number, pr_url: pr.html_url, commit: commit.sha });
    return { status: 'pr_open', pr_url: pr.html_url };
  } catch (e) {
    await set({ status: 'failed', error: cut(e.message || e, 300) });
    return { status: 'failed', error: cut(e.message || e, 300) };
  }
}

// The owner closes a proposal (refused): the pull request is closed, nothing is merged.
export async function closeCodeProposal(orgId, input = {}, by = null, d = {}) {
  const lab = await loadLab(d);
  const p = (lab.code_proposals || []).find(x => x.id === input.id);
  if (!p) throw fail('PROPOSAL_NOT_FOUND', 404);
  const cfg = d.github || githubConfig(d.env);
  if (p.pr_number && cfg.connected) await gh(cfg, 'PATCH', '/pulls/' + p.pr_number, { state: 'closed' }, d).catch(() => null);
  await changeLab(l => { const x = (l.code_proposals || []).find(y => y.id === p.id); if (x) { x.status = 'closed'; x.closed_by = by; x.closed_at = new Date().toISOString(); x.reason = cut(input.reason, 400); } l.self.code_closed = (l.self.code_closed || 0) + 1; }, d);
  return { closed: true };
}

// At its daily pass, Shadow proposes at most one code change: for the agent with the most active
// problems that has no open proposal (and for itself when its own proposals keep being refused).
export async function autoCodeProposal(orgId, req, d = {}) {
  if (String((d.env || process.env).SHADOW_CODE_AUTO || 'true').toLowerCase() === 'false') return { skipped: 'SHADOW_CODE_AUTO=false' };
  const lab = await loadLab(d);
  const today = new Date().toISOString().slice(0, 10);
  if ((lab.code_proposals || []).some(p => String(p.at).startsWith(today))) return { skipped: 'ALREADY_TODAY' };
  const open = new Set((lab.code_proposals || []).filter(p => ['drafting', 'pr_open', 'ready_without_github'].includes(p.status)).map(p => p.agent));
  const since = Date.now() - 14 * 86400000;
  const counts = AGENT_KEYS.map(a => [a, (lab.problems || []).filter(p => p.agent === a && Date.parse(p.at) > since).length]);
  const selfTrouble = (lab.self?.rejected || 0) + (lab.self?.regressions_after || 0) + (lab.self?.code_closed || 0);
  if (selfTrouble >= 3) counts.push(['shadow', selfTrouble]);
  const pick = counts.filter(([a, n]) => n >= 3 && !open.has(a)).sort((x, y) => y[1] - x[1])[0];
  if (!pick) return { skipped: 'NOTHING_RECURRENT' };
  return requestCodeChange(orgId, req, { agent: pick[0], goal: 'Problèmes récurrents observés (' + pick[1] + ' en 14 jours) : corriger leur cause dans le code.' }, 'Shadow (passage quotidien)', d);
}

export function codeView(lab, env = process.env) {
  const cfg = githubConfig(env);
  return { github: { connected: cfg.connected, repo: cfg.repo, base: cfg.base }, agents: CODE_AGENTS, proposals: (lab.code_proposals || []).slice(-30).reverse() };
}
