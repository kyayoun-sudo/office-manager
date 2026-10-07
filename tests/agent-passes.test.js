import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSchedule, dueSlots, localNow, nextPasses, ORPAILLEUR_TIMES } from '../lib/schedule.js';
import { tick, runPass, extractNeeds, requireSchedulerSecret, runNow } from '../lib/agent-passes.js';
import { isPoorName, ruleName, decideMode, parseAiDecisions } from '../lib/tidy-planner.js';
import { ROUTES } from '../api/app.js';

const sched = { enabled: true, timezone: 'Africa/Abidjan', controller_times: ['09:00', '16:00'], sika_weekday: 5, sika_time: '09:00' };
const at = iso => new Date(iso); // Abidjan = UTC

test('schedule: Orpailleur is fixed at 08:00, 12:00, 20:00; owner sets the rest', () => {
  const s = validateSchedule({ enabled: true, timezone: 'Africa/Abidjan', controller_times: '16:00, 09:00', sika_weekday: 5, sika_time: '10:30', orpailleur_times: ['03:00'] });
  assert.deepEqual(s.controller_times, ['09:00', '16:00']);
  assert.deepEqual(s.orpailleur_times, ['08:00', '12:00', '20:00'], 'the Orpailleur times cannot be changed');
  assert.throws(() => validateSchedule({ controller_times: '25:00' }), /INVALID_CONTROLLER_TIMES/);
  assert.throws(() => validateSchedule({ controller_times: '09:00', timezone: 'Mars/Olympus' }), /INVALID_TIMEZONE/);
  assert.throws(() => validateSchedule({ controller_times: '09:00', sika_weekday: 8 }), /INVALID_SIKA_DAY/);
  assert.deepEqual([...ORPAILLEUR_TIMES], ['08:00', '12:00', '20:00']);
});

test('schedule: due slots, Orpailleur first; Sika only on its weekday; nothing when disabled', () => {
  // Friday 2026-10-09 09:10 in Abidjan.
  const due = dueSlots(sched, at('2026-10-09T09:10:00Z'));
  assert.deepEqual(due.map(d => d.agent + ' ' + d.time), ['orpailleur 08:00', 'grand-controleur 09:00', 'sika 09:00']);
  assert.equal(due[0].slot, '2026-10-09 08:00');
  assert.deepEqual(dueSlots(sched, at('2026-10-08T09:10:00Z')).map(d => d.agent), ['orpailleur', 'grand-controleur'], 'no Sika on Thursday');
  assert.deepEqual(dueSlots(sched, at('2026-10-09T20:05:00Z')).map(d => d.time), ['20:00']);
  assert.deepEqual(dueSlots({ ...sched, enabled: false }, at('2026-10-09T09:10:00Z')), []);
  assert.equal(localNow(at('2026-10-09T09:10:00Z'), 'Europe/Paris').minutes, 11 * 60 + 10);
  const n = nextPasses(sched, at('2026-10-09T13:00:00Z'));
  assert.deepEqual(n.orpailleur, { in_days: 0, time: '20:00' });
  assert.deepEqual(n.sika, { in_days: 7, time: '09:00' });
});

function db() {
  const passes = [], calls = [];
  const fetchRows = async (path, o = {}) => {
    const method = o.method || 'GET';
    calls.push({ path, method, body: o.body });
    if (path.startsWith('office_agent_passes?on_conflict')) {
      const row = JSON.parse(o.body)[0];
      if (passes.some(p => p.agent_key === row.agent_key && p.slot === row.slot)) return [];
      const p = { id: 'p' + passes.length, ...row, started_at: new Date(Date.now() - 1000 * (10 - passes.length)).toISOString() };
      passes.push(p); return [p];
    }
    if (path.startsWith('office_agent_passes?') && method === 'PATCH') {
      const id = path.match(/&id=eq\.([^&]+)/)[1]; Object.assign(passes.find(p => p.id === id), JSON.parse(o.body)); return [];
    }
    if (path.startsWith('office_agent_passes?')) {
      const agent = path.match(/agent_key=eq\.([^&]+)/)?.[1];
      return passes.filter(p => !agent || p.agent_key === decodeURIComponent(agent)).slice().reverse();
    }
    if (path.startsWith('office_agent_runs?')) return [{ summary: 'Revue faite. BESOINS POUR L’ORPAILLEUR : relevés bancaires Nova de septembre.' }];
    if (path.startsWith('office_tidy_requests?')) return [{ status: 'ready', counts: { total: 12, moved: 7, to_review: 3 } }];
    return [];
  };
  return { fetchRows, passes, calls };
}
const secretReq = { headers: { 'x-scheduler-secret': 'S', host: 'app.example' } };

test('tick: secret required; each slot runs once; agents work from each other', async () => {
  process.env.OFFICE_MANAGER_SCHEDULER_SECRET = 'S';
  await assert.rejects(tick('org-1', { headers: { 'x-scheduler-secret': 'nope' } }, { schedule: sched }), /SCHEDULER_UNAUTHORIZED/);
  const { fetchRows, passes } = db();
  const fired = [], created = [];
  const deps = {
    fetchRows, schedule: sched, now: at('2026-10-08T09:10:00Z'),
    fireInternal: async (req, path, body) => { fired.push({ path, body }); return true; },
    startDriveScan: async () => true,
    createRequest: async (org, body) => { created.push(body); return { id: 'T1' }; }
  };
  const r1 = await tick('org-1', secretReq, deps);
  assert.equal(r1.results.length, 2);
  // Orpailleur pass: files new since last pass, with the Grand Contrôleur's needs.
  assert.match(created[0].instructions, /relevés bancaires Nova/);
  assert.ok(created[0].since);
  assert.match(created[0].instructions, /renommer/);
  // Grand Contrôleur pass: starts from the Orpailleur's results and leaves needs for it.
  const ctrl = fired.find(f => f.path === '/api/agent');
  assert.match(ctrl.body.message, /Orpailleur/);
  assert.match(ctrl.body.message, /BESOINS POUR L.ORPAILLEUR/);
  assert.match(ctrl.body.message, /N’envoie rien hors du cabinet/);
  const again = await tick('org-1', secretReq, deps);
  assert.ok(again.results.every(x => x.skipped === 'already_done'), 'a slot never runs twice');
  assert.equal(passes.length, 2);
  assert.ok(passes.every(p => p.status === 'done'));
});

test('passes: manual run is owner-only and uses its own slot; tick route is public but secret-checked', async () => {
  assert.equal(ROUTES['scheduler-run'].POST.ownerOnly, true);
  assert.equal(ROUTES['agent-schedule'].POST.ownerOnly, true);
  assert.equal(ROUTES['scheduler-tick'].POST.public, true);
  const { fetchRows } = db();
  const r = await runNow('org-1', { body: { agent: 'sika' }, headers: {} }, { fetchRows, fireInternal: async () => true });
  assert.match(r.slot, /^manuel /);
  await assert.rejects(runNow('org-1', { body: { agent: 'x' } }, { fetchRows }), /UNKNOWN_AGENT/);
  delete process.env.OFFICE_MANAGER_SCHEDULER_SECRET; delete process.env.ORPAILLEUR_JOB_SECRET;
  assert.throws(() => requireSchedulerSecret({ headers: {} }), /SCHEDULER_SECRET_NOT_CONFIGURED/);
  assert.equal(extractNeeds('blabla BESOINS POUR L’ORPAILLEUR : pièce A'), 'pièce A');
  assert.equal(extractNeeds('rien'), '');
});

test('renaming: poor names only, from content; rename needs higher confidence to be automatic', () => {
  assert.equal(isPoorName('scan001.pdf'), true);
  assert.equal(isPoorName('Contrat de bail Nova.pdf'), false);
  const n = ruleName({ name: 'IMG_2045.jpg', client_name: 'Nova Services', document_type: 'Facture', document_period: '2025-09' });
  assert.equal(n.new_name, 'Nova Services - Facture - 2025-09.jpg');
  assert.equal(ruleName({ name: 'IMG_2045.jpg', client_name: 'Nova' }), null, 'no type known -> no rename');
  const f = { name: 'scan.pdf', parent_id: 'P' };
  assert.equal(decideMode(f, { dest_folder_id: 'P', new_name: 'Nova - X.pdf', confidence: 0.88 }, { gateAllowed: true }), 'proposal');
  assert.equal(decideMode(f, { dest_folder_id: 'P', new_name: 'Nova - X.pdf', confidence: 0.92 }, { gateAllowed: true }), 'auto');
  const d = parseAiDecisions('[{"file_id":"a","folder_id":null,"new_name":"Nova / Contrat","confidence":0.9}]',
    [{ file_id: 'P', name: 'P', folder_path: '' }], [{ file_id: 'a', name: 'scan.pdf', parent_id: 'P', folder_path: 'A trier' }]);
  assert.equal(d.a.new_name, 'Nova - Contrat.pdf');
  assert.equal(d.a.dest_folder_id, 'P', 'rename only keeps the file in its folder');
});

test('owner settings and home show the agent passes', () => {
  const p = readFileSync(new URL('../parametres.html', import.meta.url), 'utf8');
  assert.match(p, /Horaires des agents/);
  assert.match(p, /08:00/);
  assert.match(readFileSync(new URL('../accueil.html', import.meta.url), 'utf8'), /Passages des agents/);
  assert.match(readFileSync(new URL('../db/scheduler-cron.sql', import.meta.url), 'utf8'), /scheduler-tick/);
});
