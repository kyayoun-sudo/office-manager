import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { updateJsonFile, loadJsonFile } from './mapping-scan.js';
import { fireInternal } from './agent-passes.js';
import { executeDecision } from './action-executor.js';
import { loadAgentMemory, writeAgentMemory, endPass, isStale } from './agent-memory.js';
import { audit } from './audit-log.js';

// CRASH RECOVERY (2026-10-08, extension « mémoire »), run at each scheduler tick. ADDED:
// nothing stays « running » forever, nothing is done twice, a failure never moves a checkpoint.
//  1. Agent runs still « running » after 10 min (function killed by its time limit) → failed.
//  2. Passes still « started » after 30 min → failed, then retried (2 times at most).
//  3. Validated actions whose execution was interrupted (safe types only) → executed again
//     (3 times at most), then « blocked » for a person to look at.
//  4. Background jobs in Drive (preparation, Enhanced Auditor, deposits, submissions, CV,
//     Orpailleur pass) silent for 10 min → their step is started again (3 times at most), then failed.
//  5. Each agent's memory: a pass is marked successful only when its work REALLY finished
//     (Orpailleur: TIDY_STATE done; Grand Contrôleur / Sika: their run verified).

const q = encodeURIComponent;
const MIN = 60000;
const RUN_STALE = 10 * MIN, PASS_STALE = 30 * MIN, JOB_STALE = 10 * MIN;
const MAX_PASS_RETRIES = 2, MAX_ACTION_RETRIES = 3, MAX_JOB_RETRIES = 3;
export const SAFE_REEXECUTE = ['MISSION_UPDATE', 'MISSION_FOLDER_LINK', 'FILE_MOVE'];
const ago = (now, ms) => new Date(now.getTime() - ms).toISOString();
const cut = (s, n = 200) => String(s ?? '').slice(0, n);

// The Drive jobs: file, where the jobs are inside, which status means « working », step route.
export const JOBS = [
  { file: 'OFFICE_MANAGER_ENGAGEMENTS.json', map: 'engagements', running: 'running', route: 'engagement-step', body: id => ({ mission_id: id }) },
  { file: 'OFFICE_MANAGER_ENHANCED_AUDITOR.json', map: 'reviews', running: 'running', route: 'auditor-step', body: id => ({ mission_id: id }) },
  { file: 'OFFICE_MANAGER_DEPOSITS.json', map: 'deposits', running: 'running', route: 'deposit-step', body: id => ({ id }) },
  { file: 'OFFICE_MANAGER_SUBMISSIONS.json', map: null, running: 'running', route: 'submissions-step', body: () => ({}) },
  { file: 'OFFICE_MANAGER_CAPABILITIES.json', map: null, running: 'reading', route: 'capabilities-step', body: () => ({}) },
  { file: 'OFFICE_MANAGER_TIDY_STATE.json', map: null, running: 'planning', route: 'tidy-plan-step', body: () => ({}) }
];

const lastActivity = st => {
  const log = Array.isArray(st.log) && st.log.length ? st.log[st.log.length - 1].at : null;
  return [st.updated_at, log, st.started_at].filter(Boolean).sort().pop() || null;
};

export async function recoverRuns(orgId, now, d) {
  const fetchRows = d.fetchRows || rest;
  const stale = await fetchRows('office_agent_runs?org_id=eq.' + q(orgId) + '&status=eq.running&started_at=lt.' + q(ago(now, RUN_STALE)) + '&select=id,agent_key,started_at&limit=50').catch(() => []) || [];
  for (const r of stale) {
    await fetchRows('office_agent_runs?org_id=eq.' + q(orgId) + '&id=eq.' + q(r.id) + '&status=eq.running', { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'failed', finished_at: now.toISOString(), summary: 'Interrompu : délai dépassé sans réponse (récupération automatique).' }) }).catch(() => null);
  }
  return stale.length;
}

export async function recoverPasses(orgId, req, now, d) {
  const fetchRows = d.fetchRows || rest;
  const stale = await fetchRows('office_agent_passes?org_id=eq.' + q(orgId) + '&status=eq.started&started_at=lt.' + q(ago(now, PASS_STALE)) + '&select=id,agent_key,slot,started_at&limit=20').catch(() => []) || [];
  const out = [];
  for (const p of stale) {
    await fetchRows('office_agent_passes?org_id=eq.' + q(orgId) + '&id=eq.' + q(p.id) + '&status=eq.started', { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'failed', summary: 'Interrompu (aucune fin après 30 min) : récupération automatique.', finished_at: now.toISOString() }) }).catch(() => null);
    const base = String(p.slot).replace(/^reprise\s+/, '').replace(/\s+#\d+$/, '');
    const n = /^reprise .* #(\d+)$/.exec(p.slot) ? Number(/#(\d+)$/.exec(p.slot)[1]) + 1 : 1;
    if (n > MAX_PASS_RETRIES) { out.push({ pass: p.id, retried: false }); continue; }
    const slot = ('reprise ' + base).slice(0, 36) + ' #' + n;
    const start = d.startPass || (await import('./agent-passes.js')).startPass;
    const r = await start(orgId, p.agent_key, slot, req, d.passDeps || {}).catch(e => ({ failed: cut(e.message || e) }));
    out.push({ pass: p.id, retried: true, slot, result: r.failed ? 'échec' : 'relancé' });
  }
  return out;
}

export async function recoverActions(orgId, now, d) {
  const fetchRows = d.fetchRows || rest;
  const rows = await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&status=eq.approved&work_state=eq.requested&executed_at=is.null&approved_at=lt.' + q(ago(now, 10 * MIN)) +
    '&action_type=in.(' + SAFE_REEXECUTE.join(',') + ')&select=id,agent_key,office_mission_id,action_type,summary,payload,status,approved_at&limit=20').catch(() => []) || [];
  if (!rows.length) return [];
  // Retries are counted in the Office Manager's (Grand Contrôleur's) own memory.
  const mem = d.agentMemory || { loadAgentMemory, writeAgentMemory };
  const counts = (await mem.loadAgentMemory('grand-controleur', d.memoryDeps || {}).catch(() => null))?.memory?.checkpoint?.action_retries || {};
  const out = [];
  for (const a of rows) {
    const n = (counts[a.id] || 0) + 1;
    if (n > MAX_ACTION_RETRIES) {
      await fetchRows('office_action_queue?org_id=eq.' + q(orgId) + '&id=eq.' + q(a.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ work_state: 'blocked' }) }).catch(() => null);
      out.push({ id: a.id, blocked: true });
      continue;
    }
    counts[a.id] = n;
    const r = await (d.execute || executeDecision)(orgId, a, 'approve', 'récupération automatique', { fetchRows, reexecute: true }).catch(e => ({ executed: false, effect: cut(e.message || e) }));
    if (r.executed) delete counts[a.id];
    out.push({ id: a.id, retry: n, executed: Boolean(r.executed), effect: r.effect || null });
  }
  await mem.writeAgentMemory('grand-controleur', m => { m.checkpoint = { ...(m.checkpoint || {}), action_retries: counts }; return m; }, d.memoryDeps || {}).catch(() => null);
  return out;
}

export async function recoverJobs(orgId, req, now, d) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const fire = d.fire || fireInternal;
  const limit = ago(now, JOB_STALE);
  const out = [];
  for (const job of JOBS) {
    const relaunch = [];
    try {
      await (d.updateJsonFile || updateJsonFile)(job.file, state => {
        if (!state) return null;
        let changed = false;
        const entries = job.map ? Object.entries(state[job.map] || {}) : [[null, state]];
        for (const [id, st] of entries) {
          if (!st || st.status !== job.running) continue;
          const last = lastActivity(st);
          if (last && last > limit) continue;
          // A job that moved forward since the last relaunch has not « failed »: its counter starts again.
          const mark = st.done ?? st.picture_done ?? null;
          if (mark != null && mark !== st.recovery_mark) { st.recovery_retries = 0; st.recovery_mark = mark; }
          st.recovery_retries = (st.recovery_retries || 0) + 1;
          st.updated_at = now.toISOString();
          if (st.recovery_retries > MAX_JOB_RETRIES) {
            st.status = 'failed'; st.error = 'INTERROMPU : relancé ' + MAX_JOB_RETRIES + ' fois sans aboutir (récupération automatique).';
            if (Array.isArray(st.log)) st.log.push({ at: now.toISOString(), m: 'Arrêt après ' + MAX_JOB_RETRIES + ' reprises.' });
            out.push({ file: job.file, id, failed: true });
          } else {
            if (Array.isArray(st.log)) st.log.push({ at: now.toISOString(), m: 'Reprise automatique (' + st.recovery_retries + '/' + MAX_JOB_RETRIES + ') après une interruption.' });
            relaunch.push(id);
          }
          changed = true;
        }
        return changed ? state : null;
      }, { drive, folder });
    } catch (e) { out.push({ file: job.file, error: cut(e.message || e, 120) }); continue; }
    for (const id of relaunch) { await fire(req, '/api/app?route=' + job.route, job.body(id)); out.push({ file: job.file, id, relaunched: true }); }
  }
  return out;
}

// A pass « running » in an agent's memory becomes a success only when its work really finished.
export async function settleAgentMemories(orgId, now, d) {
  const fetchRows = d.fetchRows || rest;
  const mem = d.agentMemory || { loadAgentMemory, endPass };
  const md = d.memoryDeps || {};
  const out = {};
  for (const agent of ['orpailleur', 'grand-controleur', 'sika']) {
    const cur = (await mem.loadAgentMemory(agent, md).catch(() => null))?.memory;
    if (!cur || cur.status !== 'running' || !cur.current?.started_at) continue;
    const since = cur.current.started_at;
    let verdict = null;
    if (agent === 'orpailleur') {
      const { state: t } = await (d.loadJsonFile || loadJsonFile)('OFFICE_MANAGER_TIDY_STATE.json', d.drive || driveAdapter, d.folder || memoryFolderId()).catch(() => ({ state: null }));
      if (t?.status === 'done' && String(t.finished_at || '') >= since) verdict = { ok: true, checkpoint: { last_pass_at: t.last_pass_at, source: 'OFFICE_MANAGER_TIDY_STATE.json' } };
      else if (t?.status === 'failed') verdict = { ok: false, error: t.error || 'passage en échec' };
      else if (!t || t.mode !== 'changes') {
        const p = (await fetchRows('office_agent_passes?org_id=eq.' + q(orgId) + '&agent_key=eq.orpailleur&started_at=gte.' + q(new Date(Date.parse(since) - MIN).toISOString()) + '&select=status,finished_at&order=started_at.desc&limit=1').catch(() => []))?.[0];
        if (p?.status === 'done') verdict = { ok: true, checkpoint: { last_pass_at: p.finished_at } };
      }
    } else {
      const run = (await fetchRows('office_agent_runs?org_id=eq.' + q(orgId) + '&agent_key=eq.' + q(agent) + '&started_at=gte.' + q(new Date(Date.parse(since) - MIN).toISOString()) + '&select=id,status,finished_at&order=started_at.desc&limit=1').catch(() => []))?.[0];
      if (run?.status === 'verified') verdict = { ok: true, checkpoint: { last_run_id: run.id, finished_at: run.finished_at }, ref: 'run:' + run.id };
      else if (run?.status === 'failed') verdict = { ok: false, error: 'réponse de l’agent en échec', ref: 'run:' + run.id };
    }
    if (!verdict && isStale(cur, 45, now)) verdict = { ok: false, error: 'interrompu : aucune fin constatée après 45 min' };
    if (verdict) {
      await mem.endPass(agent, verdict, md);
      await (d.audit || audit)(orgId, { agent, action_type: 'AGENT_PASS', status: verdict.ok ? 'succeeded' : 'failed', error: verdict.ok ? null : verdict.error, output_ref: verdict.ref || null }, { fetchRows, drive: d.auditDrive }).catch(() => null);
      out[agent] = verdict.ok ? 'réussi' : 'échec';
    }
  }
  return out;
}

export async function recover(orgId, req, d = {}) {
  const now = d.now ? d.now() : new Date();
  const step = async (name, fn) => { try { return await fn(); } catch (e) { return { error: cut(e.message || e, 160) }; } };
  return {
    runs: await step('runs', () => recoverRuns(orgId, now, d)),
    passes: await step('passes', () => recoverPasses(orgId, req, now, d)),
    actions: await step('actions', () => recoverActions(orgId, now, d)),
    jobs: await step('jobs', () => recoverJobs(orgId, req, now, d)),
    memories: await step('memories', () => settleAgentMemories(orgId, now, d))
  };
}
