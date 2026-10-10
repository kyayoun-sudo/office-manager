import { rest } from './supabase.js';

// Coordination and team indicators, computed on the fly from WORK FACTS only:
// mission assignments (load), assigned actions (done, late, on time, cycle time,
// verified). Never from questionnaires, HR profiles or AI judgement of people.
// Indicators open a conversation; they never trigger an HR decision on their own.

export const PERIOD_DAYS = 30;
const DONE_STATES = new Set(['done', 'completed', 'executed', 'verified', 'closed']);
const DROPPED = new Set(['cancelled', 'canceled', 'rejected']);
const INACTIVE_ASSIGNMENT = new Set(['cancelled', 'canceled', 'rejected', 'completed']);
const CLOSED_MISSION = new Set(['closed', 'completed', 'cancelled', 'canceled', 'archived']);
const DAY = 24 * 3600 * 1000;
const q = v => encodeURIComponent(v);
const t = v => (v ? Date.parse(v) : NaN);

export function doneAt(a) {
  const ts = [t(a.verified_at), t(a.executed_at)].filter(Number.isFinite);
  if (ts.length) return Math.min(...ts);
  return DONE_STATES.has(String(a.work_state || a.status || '').toLowerCase()) ? NaN : null;
}
const isDone = a => doneAt(a) !== null;
const isDropped = a => DROPPED.has(String(a.status || '').toLowerCase());

function activeToday(a, now) {
  if (INACTIVE_ASSIGNMENT.has(String(a.status || '').toLowerCase())) return false;
  const s = t(a.planned_start), e = t(a.planned_end);
  return (!Number.isFinite(s) || s <= now) && (!Number.isFinite(e) || e + DAY > now);
}

// Done by the agents themselves once validated: never a person's task.
export const AGENT_HANDLED = new Set(['REVIEW_FILE', 'FILE_MOVE', 'PBC_MAIL_RECEIVED', 'MISSION_UPDATE', 'MISSION_FOLDER_LINK', 'WORKFILE_SAVE_CLOSE', 'PEOPLE_INTELLIGENCE_RECOMMENDATION']);
export function needsPerson(a) {
  const st = String(a.status || '').toLowerCase();
  if (st === 'proposed' || st === 'awaiting_approval') return false;
  if (String(a.work_state || '').toLowerCase() === 'blocked') return true;
  return !AGENT_HANDLED.has(a.action_type);
}

const round = (x, d = 0) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

export function personKpis(person, assignments, actions, now = Date.now(), periodDays = PERIOD_DAYS) {
  const since = now - periodDays * DAY;
  const mine = assignments.filter(a => a.staff_profile_id === person.id && activeToday(a, now));
  const load = mine.reduce((s, a) => s + (Number(a.allocation_pct) || 0), 0);
  const acts = actions.filter(a => a.assigned_staff_profile_id === person.id && !isDropped(a));
  const open = acts.filter(a => !isDone(a));
  const overdue = open.filter(a => Number.isFinite(t(a.due_at)) && t(a.due_at) < now);
  const donePeriod = acts.filter(a => { const d = doneAt(a); return Number.isFinite(d) && d >= since; });
  const withDue = donePeriod.filter(a => Number.isFinite(t(a.due_at)));
  const onTime = withDue.filter(a => doneAt(a) <= t(a.due_at) + DAY / 2);
  const cycles = donePeriod.map(a => (doneAt(a) - t(a.requested_at || a.created_at)) / DAY).filter(x => Number.isFinite(x) && x >= 0);
  const verified = donePeriod.filter(a => Number.isFinite(t(a.verified_at)));

  const signals = [];
  if (load > 100) signals.push({ level: 'warn', text: 'Surcharge : ' + round(load) + ' % de charge planifiée.' });
  if (overdue.length) signals.push({ level: 'warn', text: overdue.length + ' action' + (overdue.length > 1 ? 's' : '') + ' en retard.' });
  if (load < 30 && !open.length) signals.push({ level: 'info', text: 'Disponible pour une nouvelle mission.' });
  const coverage = [];
  if (!acts.length) coverage.push('Aucune action assignée : les indicateurs d’exécution ne sont pas mesurables.');
  const noDue = open.filter(a => !Number.isFinite(t(a.due_at))).length;
  if (noDue) coverage.push(noDue + ' action' + (noDue > 1 ? 's' : '') + ' en cours sans échéance (non comptée' + (noDue > 1 ? 's' : '') + ' dans les retards).');
  if (!person.weekly_capacity_hours) coverage.push('Capacité hebdomadaire non renseignée : charge exprimée en % d’affectation.');

  return {
    id: person.id, name: person.full_name, email: person.email || null, role_title: person.role_title || null, department: person.department || null,
    load_pct: round(load), missions_active: new Set(mine.map(a => a.office_mission_id)).size,
    actions_open: open.length, actions_overdue: overdue.length, actions_done: donePeriod.length,
    on_time_rate: withDue.length ? round(100 * onTime.length / withDue.length) : null,
    avg_cycle_days: cycles.length ? round(cycles.reduce((s, x) => s + x, 0) / cycles.length, 1) : null,
    verified_rate: donePeriod.length ? round(100 * verified.length / donePeriod.length) : null,
    signals, coverage
  };
}

export function teamKpisFrom({ staff, assignments, actions }, now = Date.now(), periodDays = PERIOD_DAYS) {
  // Alphabetical on purpose: no leaderboard, no single score.
  const people = staff.map(p => personKpis(p, assignments, actions, now, periodDays))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
  const sum = k => people.reduce((s, p) => s + (p[k] || 0), 0);
  return {
    period_days: periodDays,
    people,
    team: {
      people: people.length, overloaded: people.filter(p => p.load_pct > 100).length,
      available: people.filter(p => p.load_pct < 30 && !p.actions_open).length,
      actions_open: sum('actions_open'), actions_overdue: sum('actions_overdue'), actions_done: sum('actions_done')
    },
    method: 'Indicateurs calculés uniquement à partir des affectations aux missions et des actions assignées (dates de demande, échéance, exécution, vérification) sur les ' + periodDays + ' derniers jours. Ni questionnaire, ni profil RH, ni jugement de l’IA. Ce sont des repères pour un échange avec la personne, jamais une décision automatique.'
  };
}

export function coordinationFrom({ missions, staff, assignments, actions }, now = Date.now()) {
  const nameOf = Object.fromEntries(staff.map(s => [s.id, s.full_name]));
  const missionOf = Object.fromEntries(missions.map(m => [m.id, m.name || m.mission_code || 'Mission']));
  const open = actions.filter(a => !isDone(a) && !isDropped(a));
  const overdue = open.filter(a => Number.isFinite(t(a.due_at)) && t(a.due_at) < now)
    .map(a => ({ id: a.id, summary: a.summary, mission: missionOf[a.office_mission_id] || null, mission_id: a.office_mission_id || null,
      assignee: nameOf[a.assigned_staff_profile_id] || null, days_late: Math.floor((now - t(a.due_at)) / DAY), due_at: a.due_at }))
    .sort((a, b) => b.days_late - a.days_late);
  // « Sans responsable » = work for a PERSON, already decided, with nobody on it (2026-10-08 fix):
  // proposals still waiting for a decision are in « À valider », work done by the agents
  // themselves (filing, deposits, mission updates) needs no person, and an assigned item leaves.
  const unassigned = open.filter(a => needsPerson(a) && !a.assigned_staff_profile_id)
    .map(a => ({ id: a.id, summary: a.summary, mission: missionOf[a.office_mission_id] || null, mission_id: a.office_mission_id || null, due_at: a.due_at || null, action_type: a.action_type || null }));
  const live = missions.filter(m => !CLOSED_MISSION.has(String(m.status || '').toLowerCase()));
  const missionRows = live.map(m => {
    const mo = open.filter(a => a.office_mission_id === m.id);
    const team = new Set(assignments.filter(a => a.office_mission_id === m.id && activeToday(a, now)).map(a => a.staff_profile_id));
    const end = t(m.planned_end);
    const daysLeft = Number.isFinite(end) ? Math.ceil((end - now) / DAY) : null;
    const late = mo.filter(a => Number.isFinite(t(a.due_at)) && t(a.due_at) < now).length;
    const risk = (daysLeft != null && daysLeft < 0) || late >= 3 || (daysLeft != null && daysLeft <= 14 && mo.length > 5) ? 'high'
      : late || (daysLeft != null && daysLeft <= 14) || !team.size ? 'medium' : 'low';
    return { id: m.id, name: m.name || m.mission_code, status: m.status, planned_end: m.planned_end || null, days_left: daysLeft,
      open_actions: mo.length, overdue_actions: late, team_size: team.size, risk };
  }).sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.risk] - ({ high: 0, medium: 1, low: 2 })[b.risk] || (a.days_left ?? 9999) - (b.days_left ?? 9999));
  return {
    missions: missionRows,
    overdue: overdue.slice(0, 50),
    unassigned: unassigned.slice(0, 50),
    totals: { missions_live: live.length, missions_at_risk: missionRows.filter(m => m.risk === 'high').length,
      overdue: overdue.length, unassigned: unassigned.length }
  };
}

// ---- Loaders (read-only) ----

export async function loadFacts(orgId, fetchRows = rest, now = Date.now(), periodDays = PERIOD_DAYS) {
  const org = 'org_id=eq.' + q(orgId);
  const since = new Date(now - periodDays * DAY).toISOString();
  const [staff, assignments, actions, missions] = await Promise.all([
    fetchRows('office_staff_profiles?' + org + '&active=eq.true&select=id,full_name,email,role_title,department,weekly_capacity_hours&order=full_name.asc&limit=500'),
    fetchRows('office_mission_assignments?' + org + '&select=staff_profile_id,office_mission_id,allocation_pct,planned_start,planned_end,status&limit=5000'),
    fetchRows('office_action_queue?' + org + '&action_type=neq.PEOPLE_INTELLIGENCE_RECOMMENDATION' +
      '&or=(created_at.gte.' + q(since) + ',executed_at.gte.' + q(since) + ',verified_at.gte.' + q(since) + ',and(executed_at.is.null,verified_at.is.null))' +
      '&select=id,office_mission_id,assigned_staff_profile_id,action_type,summary,status,work_state,due_at,requested_at,executed_at,verified_at,created_at&limit=5000'),
    fetchRows('office_missions?' + org + '&select=id,name,mission_code,status,planned_start,planned_end&limit=500')
  ]);
  return { staff: staff || [], assignments: assignments || [], actions: actions || [], missions: missions || [] };
}

export async function teamKpis(orgId, fetchRows = rest) {
  return teamKpisFrom(await loadFacts(orgId, fetchRows));
}

export async function coordination(orgId, fetchRows = rest) {
  return coordinationFrom(await loadFacts(orgId, fetchRows));
}

// A person's own indicators: linked to the directory by the same e-mail address.
export async function myKpis(orgId, account, fetchRows = rest) {
  const facts = await loadFacts(orgId, fetchRows);
  const me = facts.staff.find(s => String(s.email || '').toLowerCase() === String(account.email || '').toLowerCase());
  if (!me) return { linked: false, message: 'Votre compte n’est relié à aucune fiche de l’annuaire (même adresse e-mail). Demandez au manager de vérifier votre fiche.' };
  return { linked: true, ...personKpis(me, facts.assignments, facts.actions), period_days: PERIOD_DAYS };
}
