#!/usr/bin/env node
// Prepares the installation of ONE firm (one Vercel project + one Supabase project, same code):
//   node scripts/new-firm.mjs --name "Cabinet Exemple" --url https://cabinet-exemple.vercel.app --owner associe@cabinet.com
// Prints: the Vercel variables (with NEW random secrets made for this firm only), the scheduler SQL already filled in,
// and the steps. Nothing is sent anywhere, nothing is read from another firm; shared keys (AI, Google client) stay
// as placeholders for the person to paste. See docs/INSTALLER_UN_CABINET.md.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function newFirmKit({ name, url, owners = [], orgId = randomUUID(), secret = () => randomBytes(32).toString('base64url') } = {}) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(base)) throw new Error('URL_REQUIRED: --url https://<adresse-de-production>');
  const emails = owners.map(e => String(e).trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  if (!emails.length) throw new Error('OWNER_REQUIRED: --owner <e-mail de l’associé qui ouvrira le compte propriétaire>');
  const scheduler = secret();
  const env = [
    ['DEFAULT_ORG_ID', orgId, 'identifiant du cabinet (nouveau)'],
    ['FIRST_OWNER_EMAILS', emails.join(','), 'seules ces adresses peuvent devenir propriétaire'],
    ['OFFICE_MANAGER_PUBLIC_URL', base, 'adresse de production'],
    ['SUPABASE_URL', '<Supabase du cabinet → Project Settings → API → Project URL>', ''],
    ['SUPABASE_SERVICE_ROLE_KEY', '<Supabase du cabinet → API → service_role>', 'serveur seulement'],
    ['SUPABASE_ANON_KEY', '<Supabase du cabinet → API → anon public>', ''],
    ['OPENAI_API_KEY', '<clé IA>', ''],
    ['ANTHROPIC_API_KEY', '<clé Claude, facultatif>', ''],
    ['GOOGLE_CLIENT_ID', '<client OAuth Google>', 'peut être le même pour tous les cabinets'],
    ['GOOGLE_CLIENT_SECRET', '<secret du client OAuth Google>', ''],
    ['OFFICE_MANAGER_ACCESS_TOKEN', secret(), 'nouveau, propre à ce cabinet'],
    ['OFFICE_MANAGER_OWNER_TOKEN', secret(), 'nouveau'],
    ['OWNER_APPROVAL_SECRET', secret(), 'nouveau'],
    ['OAUTH_STATE_SECRET', secret(), 'nouveau'],
    ['GOOGLE_TOKEN_ENCRYPTION_KEY', secret(), 'nouveau — ne jamais le changer ensuite (jetons Google chiffrés)'],
    ['ORPAILLEUR_JOB_SECRET', secret(), 'nouveau'],
    ['OFFICE_MANAGER_SCHEDULER_SECRET', scheduler, 'nouveau, aussi dans le SQL du planificateur']
  ];
  const cron = readFileSync(new URL('../db/scheduler-cron.sql', import.meta.url), 'utf8')
    .replaceAll('https://VOTRE-APPLICATION.vercel.app', base).replaceAll('VOTRE_SECRET_PLANIFICATEUR', scheduler);
  return { name: name || 'Cabinet', orgId, env, cron };
}

export function renderKit(kit) {
  const pad = Math.max(...kit.env.map(([k]) => k.length));
  return [
    '# Installation — ' + kit.name,
    '',
    '## 1. Supabase (projet neuf, propre au cabinet) → SQL Editor → coller et exécuter db/INSTALL_TOUT.sql',
    '',
    '## 2. Vercel (projet neuf, même dépôt, même branche) → Settings → Environment Variables (Production)',
    ...kit.env.map(([k, v, note]) => k.padEnd(pad) + ' = ' + v + (note ? '    # ' + note : '')),
    '',
    '## 3. Google Cloud → client OAuth → URI de redirection autorisée à ajouter :',
    '   ' + (kit.env.find(([k]) => k === 'OFFICE_MANAGER_PUBLIC_URL')[1]) + '/oauth/google/callback',
    '',
    '## 4. Supabase → SQL Editor → planificateur des agents (déjà rempli pour ce cabinet) :',
    '',
    kit.cron.trim(),
    '',
    '## 5. Ouvrir l’adresse, créer le compte avec l’adresse propriétaire, puis « Démarrer » : connecter Google, choisir le Drive,',
    '##    autoriser les agents. Paramètres → Mise en service doit être entièrement verte.',
    ''
  ].join('\n');
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const arg = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
  const owners = process.argv.flatMap((a, i) => a === '--owner' ? [process.argv[i + 1]] : []);
  try { process.stdout.write(renderKit(newFirmKit({ name: arg('name'), url: arg('url'), owners }))); }
  catch (e) { console.error(e.message); process.exit(1); }
}
