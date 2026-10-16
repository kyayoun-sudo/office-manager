// Builds db/INSTALL_TOUT.sql: every table of the application in one file, in order,
// to paste once in Supabase → SQL Editor. Safe to re-run (each part is idempotent).
// Usage: node scripts/build-install-sql.mjs   (tests/verify-install-sql.mjs checks it is up to date)
import { readFileSync, writeFileSync } from 'node:fs';

// base.sql first (the firm, missions, people, « À valider », inventory: 2026-10-11, any firm can start from an empty
// Supabase); then the parts that extend it. purge.sql last (it lists every table of the firm).
export const INSTALL_PARTS = ['base.sql', 'org-branding.sql', 'action-decisions.sql', 'agent-persona.sql', 'app-users.sql',
  'tidy.sql', 'agent-schedule.sql', 'access-log.sql', 'training.sql', 'agent-messages.sql', 'agent-messages-client.sql', 'test-run.sql', 'google-connection.sql', 'roles.sql', 'personal-ai.sql',
  'memory.sql', 'live-collaboration.sql', 'inspection-reader-leases.sql', 'mission-plans.sql', 'workfiles.sql', 'people-intelligence.sql', 'work-programme.sql', 'procedure-work.sql', 'purge.sql'];

export function buildInstallSql() {
  const head = '-- OFFICE MANAGER — INSTALLATION DE TOUTES LES TABLES DE L’APPLICATION\n' +
    '-- Fichier généré par scripts/build-install-sql.mjs : ne pas modifier à la main.\n' +
    '-- À coller UNE fois dans Supabase → SQL Editor → Run. Sans danger si on le relance.\n' +
    '-- Ensuite seulement : db/scheduler-cron.sql (après y avoir mis l’adresse et le secret).\n';
  return head + INSTALL_PARTS.map(f => '\n-- ===== ' + f + ' =====\n' + readFileSync(new URL('../db/' + f, import.meta.url), 'utf8').trim() + '\n').join('');
}

if (import.meta.url === 'file://' + process.argv[1]) {
  writeFileSync(new URL('../db/INSTALL_TOUT.sql', import.meta.url), buildInstallSql());
  console.log('db/INSTALL_TOUT.sql written (' + INSTALL_PARTS.length + ' parts).');
}
