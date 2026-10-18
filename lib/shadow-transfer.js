import crypto from 'node:crypto';
import { loadLab, changeLab, AGENT_KEYS, touchesProtected } from './shadow.js';
import { audit as auditLog } from './audit-log.js';

// SHADOW — export / import of what it has learnt (Paul, 2026-10-18: « pour ne pas avoir à tout refaire » when a firm
// is erased with « Repartir de zéro »). The export is a plain JSON file the partner keeps; the import puts the lessons
// and tests back. Only what is worth keeping travels: lessons, golden tests, the agents' version / score history,
// good practices. NOT the raw problems, the people's questionnaire answers, the sources or the usage counters (they may
// name clients or people).
// Safety: partners only; every lesson goes through the same protected-zone guard as a new lesson; a lesson already
// present (same id) is never overwritten; an imported lesson keeps its status (a lesson waiting for a human stays waiting);
// the import is traced in the audit log.
const STATUSES = ['active', 'under_review', 'superseded', 'deprecated', 'rejected'];
const TYPES = ['professional_rule', 'firm_rule', 'experience_lesson', 'hypothesis'];
export const EXPORT_SCHEMA = 'office-manager.shadow-export/1';
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const cut = (s, n) => String(s ?? '').slice(0, n);
const sha = o => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const MAX_BYTES = 4 * 1024 * 1024;

export async function exportLab(by, d = {}) {
  const lab = await (d.loadLab || loadLab)(d);
  const content = {
    lessons: (lab.lessons || []).slice(-400),
    tests: (lab.tests || []).slice(-300).map(t => ({ ...t, results: (t.results || []).slice(-5) })),
    agents: Object.fromEntries(Object.entries(lab.agents || {}).map(([k, a]) => [k, { version: a.version, score_history: (a.score_history || []).slice(-60), weaknesses: a.weaknesses || [], versions: (a.versions || []).slice(-30) }])),
    practices: lab.practices || {}, self: lab.self || {}
  };
  return { schema: EXPORT_SCHEMA, exported_at: new Date().toISOString(), exported_by: cut(by, 120) || null,
    counts: { lessons: content.lessons.length, active: content.lessons.filter(l => l.status === 'active').length, tests: content.tests.length }, checksum: sha(content), content };
}

export async function importLab(orgId, payload, by, d = {}) {
  if (!payload || payload.schema !== EXPORT_SCHEMA || typeof payload.content !== 'object' || !payload.content) throw fail('NOT_A_SHADOW_EXPORT');
  if (JSON.stringify(payload).length > MAX_BYTES) throw fail('EXPORT_TOO_LARGE', 413);
  if (payload.checksum !== sha(payload.content)) throw fail('EXPORT_ALTERED_OR_CORRUPT');   // detects corruption / hand edits, not a forgery
  const c = payload.content; const now = new Date().toISOString();
  const out = { lessons_added: 0, lessons_skipped: 0, lessons_refused: 0, tests_added: 0 };
  await changeLab(lab => {
    const haveL = new Set(lab.lessons.map(l => l.id)), haveT = new Set(lab.tests.map(t => t.id));
    for (const l of Array.isArray(c.lessons) ? c.lessons.slice(0, 400) : []) {
      if (!l || !AGENT_KEYS.includes(l.agent) || !String(l.lesson || l.rule || '').trim() || !STATUSES.includes(l.status)) { out.lessons_refused++; continue; }
      if (haveL.has(l.id)) { out.lessons_skipped++; continue; }
      if (touchesProtected((l.lesson || '') + ' ' + (l.rule || ''))) { out.lessons_refused++; continue; }
      lab.lessons.push({ id: cut(l.id, 40) || 'L-' + sha(l).slice(0, 8), agent: l.agent, category: cut(l.category || 'général', 60), situation: cut(l.situation, 300), error: cut(l.error, 300), cause: cut(l.cause, 300),
        lesson: cut(l.lesson, 400), rule: cut(l.rule, 300), type: TYPES.includes(l.type) ? l.type : 'hypothesis', source: cut(l.source, 200) || null, status: l.status, needs_owner: l.status === 'under_review',
        auto: l.auto === true, confidence: ['haute', 'moyenne', 'basse'].includes(l.confidence) ? l.confidence : 'basse', occurrences: Math.max(1, Number(l.occurrences) || 1),
        evidence: (Array.isArray(l.evidence) ? l.evidence : []).slice(0, 10).map(e => cut(e, 200)), first_at: l.first_at || now, last_at: l.last_at || now,
        history: [...(Array.isArray(l.history) ? l.history : []).slice(-8), { at: now, status: l.status, why: 'importée par ' + (cut(by, 80) || 'un associé') + ' depuis une sauvegarde de Shadow' }] });
      haveL.add(l.id); out.lessons_added++;
    }
    for (const t of Array.isArray(c.tests) ? c.tests.slice(0, 300) : []) {
      if (!t || !AGENT_KEYS.includes(t.agent) || !t.scenario || !t.id || haveT.has(t.id)) continue;
      lab.tests.push({ id: cut(t.id, 60), agent: t.agent, kind: cut(t.kind || 'golden', 20), name: cut(t.name, 120), scenario: cut(t.scenario, 2000), expected: cut(t.expected, 1000), lesson_id: t.lesson_id || null, created_at: t.created_at || now, results: [] });
      haveT.add(t.id); out.tests_added++;
    }
    // Practices and history only fill what is empty here; an existing score history or practice is never replaced.
    for (const [k, a] of Object.entries(c.agents || {})) if (lab.agents[k] && !(lab.agents[k].score_history || []).length && Array.isArray(a.score_history)) lab.agents[k].score_history = a.score_history.slice(-60);
    for (const [k, v] of Object.entries(c.practices || {})) if (!(k in (lab.practices ||= {}))) lab.practices[k] = v;
  }, d);
  await (d.audit || auditLog)(orgId, [{ agent: 'shadow', action_type: 'SHADOW_LAB_IMPORTED', decision: JSON.stringify(out), reviewer: cut(by, 120) || null }]).catch(() => null);
  return out;
}
