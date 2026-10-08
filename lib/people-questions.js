import crypto from 'node:crypto';
import { rest } from './supabase.js';
import { loadFacts } from './kpi.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, updateJsonFile } from './mapping-scan.js';
import { addObservation } from './people-cards.js';

// ONE QUESTION ABOUT SOMETHING THAT HAPPENED (Paul, 2026-10-08: « pour la Management Card, l'agent
// central peut envoyer des notifications où il faudra répondre à une question concernant un truc qui
// s'est passé, une situation connue ; la réponse devra être utilisée pour la Management Card »).
// The Firm Manager picks a REAL situation from the facts of the work (an action delivered late or
// early, a mission that has just ended), asks the managers ONE short question about the person, and
// the answer becomes a documented observation (validated: it is a manager's) used by the card.
// Kept in the agents' memory (Atelier mémoire), never more than one open question per person and
// three new questions a day. Facts of the work, never a questionnaire alone (R011).

const FILE = 'OFFICE_MANAGER_PEOPLE_QUESTIONS.json';
const DAY = 86400000;
const id = (...p) => crypto.createHash('sha1').update(p.join('|')).digest('hex').slice(0, 12);
const cut = (s, n) => String(s ?? '').slice(0, n);
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });

// Pure: the situations worth one question, most telling first.
export function situations(facts, now = Date.now()) {
  const staff = new Map((facts.staff || []).map(s => [s.id, s]));
  const missions = new Map((facts.missions || []).map(m => [m.id, m]));
  const out = [];
  for (const a of facts.actions || []) {
    const s = staff.get(a.assigned_staff_profile_id); if (!s || !a.due_at || !a.executed_at) continue;
    if (now - Date.parse(a.executed_at) > 21 * DAY) continue;
    const late = days(a.executed_at, a.due_at);
    const m = missions.get(a.office_mission_id);
    if (late >= 3) out.push({ key: id('late', a.id), staff_id: s.id, staff_name: s.full_name, mission_id: a.office_mission_id || null, kind: 'developpement', weight: late,
      situation: '« ' + cut(a.summary, 140) + ' »' + (m ? ' (' + m.name + ')' : '') + ' a été terminée ' + late + ' jours après l’échéance.',
      question: 'Qu’est-ce qui explique ce retard pour ' + s.full_name + ' : charge, information reçue tard, difficulté technique, organisation, autre ?' });
    else if (late <= -2) out.push({ key: id('early', a.id), staff_id: s.id, staff_name: s.full_name, mission_id: a.office_mission_id || null, kind: 'force', weight: -late / 2,
      situation: '« ' + cut(a.summary, 140) + ' »' + (m ? ' (' + m.name + ')' : '') + ' a été terminée ' + (-late) + ' jours avant l’échéance.',
      question: 'Qu’est-ce qui a bien marché chez ' + s.full_name + ' sur ce point (méthode, autonomie, anticipation…) ?' });
  }
  for (const as of facts.assignments || []) {
    const s = staff.get(as.staff_profile_id), m = missions.get(as.office_mission_id);
    if (!s || !m || !as.planned_end) continue;
    const ago = (now - Date.parse(as.planned_end)) / DAY;
    if (ago < 0 || ago > 14 || ['rejected', 'cancelled'].includes(as.status)) continue;
    out.push({ key: id('end', as.office_mission_id, s.id), staff_id: s.id, staff_name: s.full_name, mission_id: m.id, kind: 'comportement', weight: 2,
      situation: 'La mission « ' + m.name + ' » vient de se terminer (fin prévue le ' + as.planned_end + ').',
      question: 'Sur cette mission, comment ' + s.full_name + ' a-t-il ou elle travaillé : autonomie, communication avec l’équipe et le client, qualité, besoin d’encadrement ?' });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

async function load(d) { return (await loadJsonFile(FILE, d.drive || driveAdapter, d.folder || memoryFolderId())).state || { questions: {} }; }

// Each tick: new questions from new situations (one open per person, three a day at most).
export async function askQuestions(orgId, d = {}) {
  const facts = await (d.loadFacts || loadFacts)(orgId, d.fetchRows || rest);
  const now = d.now ? d.now() : Date.now();
  const cands = situations(facts, now);
  let created = 0;
  await (d.updateJsonFile || updateJsonFile)(FILE, st => {
    const s = st || { questions: {} };
    const qs = Object.values(s.questions);
    const today = qs.filter(x => now - Date.parse(x.at) < DAY).length;
    const openFor = new Set(qs.filter(x => x.status === 'open').map(x => x.staff_id));
    for (const c of cands) {
      if (today + created >= 3) break;
      if (s.questions[c.key] || openFor.has(c.staff_id)) continue;
      s.questions[c.key] = { ...c, status: 'open', at: new Date(now).toISOString() };
      openFor.add(c.staff_id); created++;
    }
    // Kept small: answered or skipped questions older than 90 days leave the active list.
    for (const [k, x] of Object.entries(s.questions)) if (x.status !== 'open' && now - Date.parse(x.at) > 90 * DAY) delete s.questions[k];
    return created ? s : null;
  }, { drive: d.drive || driveAdapter, folder: d.folder || memoryFolderId() });
  return { created };
}

export async function openQuestions(d = {}) {
  return Object.entries((await load(d)).questions || {}).filter(([, x]) => x.status === 'open').map(([key, x]) => ({ key, ...x }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

// A manager answers (or skips). The answer becomes a VALIDATED observation of the person.
export async function answerQuestion(orgId, input = {}, by, d = {}) {
  const key = String(input.key || '');
  const answer = String(input.answer || '').trim();
  if (!input.skip && answer.length < 3) throw fail('ANSWER_REQUIRED');
  let q = null;
  await (d.updateJsonFile || updateJsonFile)(FILE, st => {
    q = null;
    const cur = st?.questions?.[key];
    if (!cur || cur.status !== 'open') return null;
    q = cur;
    Object.assign(q, { status: input.skip ? 'skipped' : 'answered', answer: input.skip ? null : cut(answer, 1500), answered_by: cut(by, 120), answered_at: new Date().toISOString() });
    return st;
  }, { drive: d.drive || driveAdapter, folder: d.folder || memoryFolderId() });
  if (!q) throw fail('QUESTION_NOT_OPEN', 409);
  if (input.skip) return { skipped: true };
  const obs = await (d.addObservation || addObservation)(orgId, { staff_profile_id: q.staff_id, mission_id: q.mission_id, kind: q.kind,
    observation: q.situation + ' — ' + answer, source: 'Réponse de ' + (by || 'un manager') + ' à la question du Firm Manager' }, by, true, d.fetchRows || rest)
    .catch(e => ({ error: String(e.message || e) }));
  return { answered: true, observation: obs, notice: obs?.error ? 'Réponse gardée dans la mémoire des agents ; exécuter db/memory.sql pour l’ajouter à la Management Card.' : null };
}
