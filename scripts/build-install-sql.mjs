// Builds db/INSTALL_TOUT.sql: every table of the application in one file, in order,
// to paste once in Supabase → SQL Editor. Safe to re-run (each part is idempotent).
// Usage: node scripts/build-install-sql.mjs   (tests/verify-install-sql.mjs checks it is up to date)
import { readFileSync, writeFileSync } from 'node:fs';

export const INSTALL_PARTS = ['org-branding.sql', 'action-decisions.sql', 'agent-persona.sql', 'app-users.sql',
  'tidy.sql', 'agent-schedule.sql', 'access-log.sql', 'training.sql', 'agent-messages.sql'];

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
