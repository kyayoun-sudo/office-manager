import { rest } from './supabase.js';

// Agent schedule: when each agent passes. Pure time logic is exported for tests.
//   Grand Contrôleur : owner's times · Sika : once a week · Orpailleur : 08:00, 12:00, 20:00.

export const ORPAILLEUR_TIMES = Object.freeze(['08:00', '12:00', '20:00']);
export const DEFAULT_SCHEDULE = Object.freeze({
  enabled: false, timezone: 'Africa/Abidjan', controller_times: ['09:00', '16:00'],
  sika_weekday: 5, sika_time: '09:00', orpailleur_times: [...ORPAILLEUR_TIMES]
});
// A slot stays "due" for 2 hours, so an hourly (or 15-minute) tick never misses it.
export const DUE_WINDOW_MINUTES = 120;
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const bad = code => Object.assign(new Error(code), { statusCode: 400 });

export function validTimezone(tz) {
  try { new Intl.DateTimeFormat('fr-FR', { timeZone: tz }).format(0); return true; } catch { return false; }
}

const toMinutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function validateSchedule(input = {}) {
  const tz = String(input.timezone || DEFAULT_SCHEDULE.timezone).trim();
  if (!validTimezone(tz)) throw bad('INVALID_TIMEZONE');
  const raw = Array.isArray(input.controller_times) ? input.controller_times : String(input.controller_times || '').split(/[\s,;]+/);
  const times = [...new Set(raw.map(t => String(t).trim()).filter(Boolean))].sort();
  if (!times.length || times.length > 6 || times.some(t => !HHMM.test(t))) throw bad('INVALID_CONTROLLER_TIMES');
  const weekday = Number(input.sika_weekday ?? DEFAULT_SCHEDULE.sika_weekday);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw bad('INVALID_SIKA_DAY');
  const sikaTime = String(input.sika_time || DEFAULT_SCHEDULE.sika_time).trim();
  if (!HHMM.test(sikaTime)) throw bad('INVALID_SIKA_TIME');
  return {
    enabled: Boolean(input.enabled), timezone: tz, controller_times: times,
    sika_weekday: weekday, sika_time: sikaTime,
    orpailleur_times: [...ORPAILLEUR_TIMES] // fixed by the firm's rule
  };
}

// Local date, minutes since midnight and ISO weekday (1 = Monday) in the firm's time zone.
export function localNow(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
  }).formatToParts(date).map(p => [p.type, p.value]));
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1;
  return { date: parts.year + '-' + parts.month + '-' + parts.day, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday };
}

// Which agents have a slot that has come (and is still within the window).
export function dueSlots(schedule, date = new Date()) {
  const s = { ...DEFAULT_SCHEDULE, ...(schedule || {}) };
  if (!s.enabled) return [];
  const now = localNow(date, s.timezone);
  const out = [];
  const consider = (agent, time) => {
    const diff = now.minutes - toMinutes(time);
    if (diff >= 0 && diff < DUE_WINDOW_MINUTES) out.push({ agent, slot: now.date + ' ' + time, time });
  };
  ORPAILLEUR_TIMES.forEach(t => consider('orpailleur', t));
  (s.controller_times || []).forEach(t => consider('grand-controleur', t));
  if (now.weekday === s.sika_weekday) consider('sika', s.sika_time);
  // Orpailleur first: the Grand Contrôleur works from its latest results.
  const order = { orpailleur: 0, 'grand-controleur': 1, sika: 2 };
  return out.sort((a, b) => order[a.agent] - order[b.agent]);
}

// Next passes of each agent within 7 days, for display.
export function nextPasses(schedule, date = new Date()) {
  const s = { ...DEFAULT_SCHEDULE, ...(schedule || {}) };
  const now = localNow(date, s.timezone);
  const next = (times, weekdayOnly = null) => {
    for (let d = 0; d < 8; d++) {
      const wd = ((now.weekday - 1 + d) % 7) + 1;
      if (weekdayOnly && wd !== weekdayOnly) continue;
      const t = [...times].sort().find(x => d > 0 || toMinutes(x) > now.minutes);
      if (t) return { in_days: d, time: t };
    }
    return null;
  };
  return {
    orpailleur: next(ORPAILLEUR_TIMES),
    'grand-controleur': next(s.controller_times || []),
    sika: next([s.sika_time], s.sika_weekday)
  };
}

export async function getSchedule(orgId, fetchRows = rest) {
  const rows = await fetchRows('office_agent_schedule?org_id=eq.' + encodeURIComponent(orgId) +
    '&select=enabled,timezone,controller_times,sika_weekday,sika_time,orpailleur_times,updated_at&limit=1');
  const s = { ...DEFAULT_SCHEDULE, ...(rows?.[0] || {}), orpailleur_times: [...ORPAILLEUR_TIMES] };
  return { ...s, configured: Boolean(rows?.[0]), next: nextPasses(s) };
}

export async function saveSchedule(orgId, input, updatedBy = null, fetchRows = rest) {
  const clean = validateSchedule(input);
  const row = { org_id: orgId, ...clean, updated_by: updatedBy ? String(updatedBy).slice(0, 120) : null, updated_at: new Date().toISOString() };
  await fetchRows('office_agent_schedule?on_conflict=org_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([row])
  });
  return { ...clean, configured: true, next: nextPasses(clean) };
}
