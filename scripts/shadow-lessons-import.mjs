#!/usr/bin/env node
// Turns proposed lessons (a JSON file kept by the firm, never in this repository) into a file the partners import in
// Entraînement → « Garder ce que Shadow a appris » → Importer (lib/shadow-transfer.js, action lab-import).
// Every lesson arrives « under_review »: it waits for a partner's decision and reaches no agent before (2026-11-03).
// The lesson text must be GENERIC (no client name): it is added to the AI's instructions in every mission. Client-specific
// examples go in « evidence », which is never sent to the AI.
// Usage: node scripts/shadow-lessons-import.mjs <proposals.json> <out.json> [--by "Nom"]
import fs from 'node:fs';
import crypto from 'node:crypto';
import { EXPORT_SCHEMA } from '../lib/shadow-transfer.js';
import { AGENT_KEYS, touchesProtected } from '../lib/shadow.js';

const TYPES = ['professional_rule', 'firm_rule', 'experience_lesson', 'hypothesis'];
const cut = (s, n) => String(s ?? '').slice(0, n);
const sha = o => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');

export function buildImport(proposals, { by = null, now = new Date().toISOString(), clientNames = [] } = {}) {
  const lessons = [], refused = [];
  const names = clientNames.map(n => String(n).trim()).filter(n => n.length >= 3);
  for (const p of proposals.lessons || []) {
    const text = String(p.lesson || '').trim(), rule = String(p.rule || '').trim();
    const why = !AGENT_KEYS.includes(p.agent) ? 'agent inconnu : ' + p.agent
      : !text ? 'texte vide'
      : touchesProtected(text + ' ' + rule) ? 'zone protégée (droits, validation humaine, secrets…)'
      : names.find(n => new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text + ' ' + rule)) ? 'nom de client dans le texte : le mettre dans evidence'
      : null;
    if (why) { refused.push({ id: p.id, why }); continue; }
    lessons.push({ id: cut(p.id, 40), agent: p.agent, category: cut(p.category || 'missions terminées', 60), situation: cut(p.situation, 300), error: cut(p.error, 300), cause: cut(p.cause, 300),
      lesson: cut(text, 400), rule: cut(rule, 300), type: TYPES.includes(p.type) ? p.type : 'experience_lesson', source: cut(p.source || 'Étude des missions terminées', 200),
      status: 'under_review', needs_owner: true, auto: false, confidence: ['haute', 'moyenne', 'basse'].includes(p.confidence) ? p.confidence : 'moyenne', occurrences: Math.max(1, Number(p.occurrences) || 1),
      evidence: (p.evidence || []).slice(0, 10).map(e => cut(e, 200)), first_at: now, last_at: now,
      history: [{ at: now, status: 'under_review', why: 'proposée par l’étude des missions terminées' + (by ? ' (' + cut(by, 80) + ')' : '') + ' — en attente de la décision d’un associé' }] });
  }
  const content = { lessons, tests: [], agents: {}, practices: {}, self: {} };
  return { file: { schema: EXPORT_SCHEMA, exported_at: now, exported_by: by, counts: { lessons: lessons.length, active: 0, tests: 0 }, checksum: sha(content), content }, refused };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) { console.error('Usage: node scripts/shadow-lessons-import.mjs <proposals.json> <out.json> [--by "Nom"]'); process.exit(2); }
  const byIdx = process.argv.indexOf('--by'), by = byIdx > 0 ? process.argv[byIdx + 1] : null;
  const proposals = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^﻿/, ''));
  const { file, refused } = buildImport(proposals, { by, clientNames: proposals.client_names || [] });
  fs.writeFileSync(output, JSON.stringify(file, null, 1));
  console.log(`${file.counts.lessons} leçon(s) prêtes à importer (toutes « à revoir »), ${refused.length} refusée(s).`);
  for (const r of refused) console.log('  refusée', r.id, '—', r.why);
}
