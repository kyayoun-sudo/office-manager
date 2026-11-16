#!/usr/bin/env node
// Read-only preflight for a Shadow export. No upload, no import, no agent activation.
// Usage: node scripts/shadow-export-audit.mjs <shadow-export.json> [--json]
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AGENT_KEYS, touchesProtected } from '../lib/shadow.js';
import { EXPORT_SCHEMA } from '../lib/shadow-transfer.js';

const STATUSES = new Set(['active', 'under_review', 'superseded', 'deprecated', 'rejected']);
const MAX_BYTES = 4 * 1024 * 1024; // Same ceiling as lib/shadow-transfer.js
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const increment = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };

export function auditShadowExport(payload) {
  if (!payload || payload.schema !== EXPORT_SCHEMA || !payload.content || typeof payload.content !== 'object') {
    throw new Error('NOT_A_SHADOW_EXPORT: utiliser un fichier exporté depuis Shadow, pas une liste de propositions');
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_BYTES) throw new Error('EXPORT_TOO_LARGE');
  if (payload.checksum !== hash(payload.content)) throw new Error('EXPORT_ALTERED_OR_CORRUPT');

  const { lessons, tests } = payload.content;
  if (!Array.isArray(lessons) || !Array.isArray(tests)) throw new Error('INVALID_EXPORT_COLLECTIONS');

  const statuses = {}, types = {}, agents = {}, problems = [];
  const lessonIds = new Set(), testIds = new Set();
  let importableLessons = 0, importableTests = 0, unrunTests = 0, activeHypotheses = 0;
  const refusedLessonIds = [], refusedTestIds = [];

  for (const lesson of lessons) {
    increment(statuses, lesson?.status || 'missing');
    increment(types, lesson?.type || 'missing');
    increment(agents, lesson?.agent || 'missing');
    if (lesson?.status === 'active' && lesson?.type === 'hypothesis') activeHypotheses++;
    const invalid = !lesson || !AGENT_KEYS.includes(lesson.agent) ||
      !String(lesson.lesson || lesson.rule || '').trim() || !STATUSES.has(lesson.status) ||
      !lesson.id || lessonIds.has(lesson.id) ||
      touchesProtected(String(lesson.lesson || '') + ' ' + String(lesson.rule || ''));
    if (invalid) refusedLessonIds.push(String(lesson?.id || '(sans ID)').slice(0, 60));
    else { lessonIds.add(lesson.id); importableLessons++; }
  }
  for (const t of tests) {
    if (!Array.isArray(t?.results) || t.results.length === 0) unrunTests++;
    const invalid = !t || !t.id || !AGENT_KEYS.includes(t.agent) || !t.scenario || testIds.has(t.id);
    if (invalid) refusedTestIds.push(String(t?.id || '(sans ID)').slice(0, 60));
    else { testIds.add(t.id); importableTests++; }
  }

  if (payload.counts?.lessons !== lessons.length || payload.counts?.tests !== tests.length ||
      payload.counts?.active !== (statuses.active || 0)) {
    problems.push('Les compteurs annoncés ne correspondent pas au contenu signé par le checksum.');
  }
  if (lessons.length > 400) problems.push('L’importateur ne traite que les 400 premières leçons.');
  if (tests.length > 300) problems.push('L’importateur ne traite que les 300 premiers tests.');
  if (refusedLessonIds.length) problems.push(`${refusedLessonIds.length} leçon(s) exclue(s) par le précontrôle ; consulter leurs identifiants.`);
  if (refusedTestIds.length) problems.push(`${refusedTestIds.length} test(s) invalide(s) ou dupliqué(s).`);

  return {
    valid_checksum: true,
    exported_at: payload.exported_at || null,
    totals: { lessons: lessons.length, active: statuses.active || 0, tests: tests.length,
      unrun_tests: unrunTests, active_hypotheses: activeHypotheses },
    by_agent: agents, by_status: statuses, by_type: types,
    possible_import: { lessons: Math.min(importableLessons, 400), tests: Math.min(importableTests, 300),
      excluded_lesson_ids: refusedLessonIds, excluded_test_ids: refusedTestIds },
    warnings: problems,
    note: 'Contrôle du fichier uniquement. Aucune leçon n’a été importée, aucun test exécuté et aucun comportement d’agent modifié.'
  };
}

const calledAsScript = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (calledAsScript) {
  try {
    const filename = process.argv[2];
    if (!filename || filename.startsWith('--')) throw new Error('Usage: node scripts/shadow-export-audit.mjs <shadow-export.json> [--json]');
    const report = auditShadowExport(JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')));
    if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Shadow export valide (${report.exported_at || 'date non fournie'})`);
      console.log(`Leçons : ${report.totals.lessons} (${report.totals.active} actives, ${report.totals.active_hypotheses} hypothèses actives)`);
      console.log(`Tests : ${report.totals.tests} (${report.totals.unrun_tests} sans résultat enregistré)`);
      console.log(`Agents : ${JSON.stringify(report.by_agent)}`);
      console.log(`Précontrôle import : ${report.possible_import.lessons} leçons, ${report.possible_import.tests} tests`);
      for (const warning of report.warnings) console.warn(`ATTENTION : ${warning}`);
      console.log(report.note);
    }
  } catch (error) {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  }
}
