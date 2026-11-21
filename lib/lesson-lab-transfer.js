import { labRemember, labV1Configured } from './eynowa-lab-v1.js';
import { genericProblem } from './simulation-lessons.js';

// A lesson that came from a simulation and that a partner ACTIVATED goes to the firm's own memory in EYNOWA Lab (2026-11-21, step 5).
// Memory is per firm (tenant = the firm that validated); nothing is shared between firms. The activation is the human validation the Lab
// requires. The result is written on the lesson and is honest: `stored` only with the Lab's confirmation; a failure never blocks the
// activation and can be retried (same idempotency key = same memory id, no duplicate).
const cut = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const now = d => new Date((d.now || Date.now)()).toISOString();

export const isSimulationLesson = l => String(l?.source || '').startsWith('simulation:');

export function lessonLabText(l) {
  return cut('Leçon validée (agent : ' + l.agent + (l.category ? ', catégorie : ' + l.category : '') + '). ' + (l.lesson || '') +
    (l.rule ? ' Règle : ' + l.rule : '') + (l.situation ? ' Situation : ' + l.situation : ''), 8000);
}

export async function transferLesson(orgId, lessonId, by, d = {}) {
  const { loadLab, changeLab, touchesProtected } = await import('./shadow.js');
  const lab = await (d.loadLab || loadLab)(d);
  const l = lab.lessons.find(x => x.id === lessonId);
  if (!l) throw Object.assign(new Error('LESSON_NOT_FOUND'), { statusCode: 404 });
  if (!isSimulationLesson(l)) throw Object.assign(new Error('NOT_A_SIMULATION_LESSON'), { statusCode: 400 });
  if (l.status !== 'active') throw Object.assign(new Error('LESSON_NOT_ACTIVE'), { statusCode: 409 });
  if (l.lab_transfer?.status === 'stored') return l.lab_transfer; // already in the Lab: nothing is sent twice
  const at = now(d), who = cut(by, 120);
  const text = lessonLabText(l);
  let rec;
  if (!who) rec = { status: 'refused', why: 'HUMAN_VALIDATION_REQUIRED', at };
  else if (genericProblem(text) || touchesProtected(text)) rec = { status: 'refused', why: 'NOT_GENERIC_OR_PROTECTED', at };
  else if (!d.remember && !labV1Configured(d.env)) rec = { status: 'not_configured', at };
  else {
    const validatedAt = [...(l.history || [])].reverse().find(h => h.status === 'active')?.at || at;
    try {
      const r = await (d.remember || labRemember)({ tenant: orgId, text, validatedBy: who, validatedAt, idempotencyKey: 'om-lesson-' + l.id, kind: 'validated_lesson',
        metadata: { agent: l.agent, category: cut(l.category, 60), lesson_id: l.id, origin: 'simulation' } }, d);
      rec = { status: 'stored', memory_id: r.memory_id, tenant: orgId, at };
    } catch (e) { rec = { status: 'failed', error: cut(e?.message || e, 80), at, attempts: (l.lab_transfer?.attempts || 0) + 1 }; }
  }
  await changeLab(x => { const y = x.lessons.find(z => z.id === lessonId); if (y) { y.lab_transfer = rec; (y.history ||= []).push({ at, status: y.status, why: 'EYNOWA Lab : ' + rec.status + (rec.error ? ' (' + rec.error + ')' : rec.why ? ' (' + rec.why + ')' : '') }); } }, d);
  return rec;
}
