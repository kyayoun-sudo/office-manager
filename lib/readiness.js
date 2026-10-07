import { rest } from './supabase.js';
import { googleConnectionConfigured, directGoogleAccess } from './google-drive.js';
import { driveAdapter } from './drive-adapter.js';
import { loadMemory, ownerSecret } from './memory-runtime.js';
import { buildMappingReport, getState } from './orpailleur-memory.js';
import { fireInternal } from './agent-passes.js';
import { getPersona } from './agent-persona.js';
import { mailConfigured } from './agent-mail.js';

// "Mise en service": checks that every link of the chain is in place so that the
// pieces work TOGETHER, and says exactly what to do for each missing one.
//
//   1. Réglages (Vercel)      secrets and keys present (never their values)
//   2. Base de données        the tables of the app exist (db/INSTALL_TOUT.sql)
//   3. Comptes                a first owner account exists
//   4. Drive                  connection; direct access for moves / trash
//   5. Cartographie           complete Orpailleur mapping, reviewed by the owner
//                             (without it, Rangement and Drive writes stay blocked)
//   6. Passages automatiques  schedule enabled and scheduler really ticking
//
// Read-only, except two owner actions: launch a full mapping pass (through the
// Orpailleur agent) and nothing else; the owner review itself goes through the
// existing signed endpoint /api/owner.

const q = v => encodeURIComponent(v);
const HOUR = 3600 * 1000;

export const TABLES = [
  ['office_org_branding', 'nom, couleur et logo du cabinet'],
  ['office_action_decisions', 'décisions « À valider »'],
  ['office_agent_persona', 'e-mail et ton de l’agent'],
  ['office_app_users', 'comptes e-mail + mot de passe'],
  ['office_tidy_requests', 'Rangement (demandes)'],
  ['office_tidy_items', 'Rangement (fichiers)'],
  ['office_tidy_preferences', 'Rangement (apprentissage)'],
  ['office_agent_schedule', 'horaires des agents'],
  ['office_agent_passes', 'journal des passages'],
  ['office_access_log', 'journal de sécurité'],
  ['office_training_campaigns', 'entraînement (campagnes)'],
  ['office_training_cases', 'entraînement (missions)'],
  ['office_training_items', 'entraînement (registre Drive)'],
  ['office_agent_messages', 'messages de l’agent aux collègues']
];

const ENV = [
  ['SUPABASE_URL', 'adresse de la base Supabase', true],
  ['SUPABASE_SERVICE_ROLE_KEY', 'clé serveur Supabase', true],
  ['DEFAULT_ORG_ID', 'identifiant du cabinet', true],
  ['OPENAI_API_KEY', 'IA des agents (OpenAI)', true],
  ['ANTHROPIC_API_KEY', 'Claude (relecture, examinateur de l’entraînement)', false],
  ['ANTHROPIC_MODEL', 'modèle Claude utilisé', false],
  ['OFFICE_MANAGER_ACCESS_TOKEN', 'code d’accès du cabinet', true],
  ['OFFICE_MANAGER_OWNER_TOKEN', 'code propriétaire (paramètres, validations)', true],
  ['OWNER_APPROVAL_SECRET', 'signature des validations du propriétaire (cartographie)', true],
  ['ORPAILLEUR_JOB_SECRET', 'scanneur du Drive (Orpailleur)', true],
  ['OFFICE_MANAGER_SCHEDULER_SECRET', 'planificateur des passages (sinon ORPAILLEUR_JOB_SECRET)', false]
];

const check = (id, step, label, ok, fix, extra = {}) => ({ id, step, label, status: ok === true ? 'ok' : ok === 'warn' ? 'warn' : 'todo', fix: ok === true ? null : fix, ...extra });

async function tableExists(table, fetchRows) {
  try { await fetchRows(table + '?select=*&limit=1'); return true; } catch { return false; }
}

export async function checkReadiness(orgId, deps = {}) {
  const env = deps.env || process.env;
  const fetchRows = deps.fetchRows || rest;
  const memoryLoader = deps.loadMemory || (() => loadMemory(driveAdapter));
  const google = deps.google || { connected: googleConnectionConfigured(), direct: directGoogleAccess() };
  const now = deps.now || new Date();
  const checks = [];

  // 1. Réglages
  for (const [key, what, required] of ENV) {
    const present = Boolean(env[key]) || (key === 'OFFICE_MANAGER_SCHEDULER_SECRET' && Boolean(env.ORPAILLEUR_JOB_SECRET));
    checks.push(check('env:' + key, 'Réglages', what + ' (' + key + ')', present ? true : required ? false : 'warn',
      'Vercel → Settings → Environment Variables : ajouter ' + key + ' (Production et Preview), puis redéployer.'));
  }
  const dbConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

  // 2. Base de données
  const missing = [];
  if (dbConfigured) {
    const results = await Promise.all(TABLES.map(async ([t, what]) => [t, what, await tableExists(t, fetchRows)]));
    for (const [t, what, ok] of results) if (!ok) missing.push(t + ' (' + what + ')');
  }
  checks.push(check('db:tables', 'Base de données', 'Tables de l’application (' + (TABLES.length - missing.length) + ' / ' + TABLES.length + ')',
    dbConfigured && !missing.length, (dbConfigured ? 'Manquantes : ' + missing.join(', ') + '. ' : '') +
    'Supabase → SQL Editor : coller et exécuter le fichier db/INSTALL_TOUT.sql (sans danger si on le relance).', { missing }));

  // 3. Comptes
  let owners = 0;
  if (dbConfigured && !missing.some(m => m.startsWith('office_app_users'))) {
    try { owners = (await fetchRows('office_app_users?org_id=eq.' + q(orgId) + '&role=in.(owner,partner)&active=eq.true&select=id&limit=5') || []).length; } catch { owners = 0; }
  }
  checks.push(check('accounts:owner', 'Comptes', 'Compte propriétaire avec e-mail et mot de passe', owners > 0,
    'Page de connexion → « Premier compte propriétaire » (avec le code propriétaire), puis créer les comptes de l’équipe dans Paramètres.'));

  // 4. Drive
  checks.push(check('drive:connected', 'Drive', 'Connexion au Drive du cabinet', google.connected,
    'Configurer le pont Google (Supabase) ou GOOGLE_SERVICE_ACCOUNT_JSON dans Vercel.'));
  checks.push(check('drive:direct', 'Drive', 'Accès Google direct (déplacer, renommer, mettre à la corbeille)', google.direct ? true : 'warn',
    'Ajouter GOOGLE_SERVICE_ACCOUNT_JSON (ou l’accès OAuth) dans Vercel. Sans lui : lecture et propositions seulement.'));

  // 5. Cartographie (Orpailleur) — the gate of every Drive write
  let mapping = null;
  if (google.connected) {
    try {
      const memory = await memoryLoader();
      if (memory?.exists) {
        const secret = deps.ownerSecret !== undefined ? deps.ownerSecret : ownerSecret();
        const report = buildMappingReport(memory, secret || '');
        mapping = { ...report, warning: getState(memory, 'last_pass_warning') || null };
      } else mapping = { mapping_state: 'NO_MAP' };
    } catch (e) { mapping = { mapping_state: 'UNREADABLE', error: String(e.message || e).slice(0, 200) }; }
  }
  const state = mapping?.mapping_state || 'NO_DRIVE';
  checks.push(check('mapping:complete', 'Cartographie', 'Cartographie complète du Drive par l’Orpailleur',
    ['MAPPING_PENDING_REVIEW', 'MAPPING_REVIEWED'].includes(state),
    state === 'NO_MAP' ? 'Lancer le premier passage de cartographie (bouton ci-dessous).'
      : 'Le dernier passage n’a pas couvert tout le Drive' + (mapping?.warning ? ' (' + mapping.warning + ')' : '') + ' : relancer un passage complet (bouton ci-dessous).',
    { action: 'mapping-pass' }));
  checks.push(check('mapping:reviewed', 'Cartographie', 'Cartographie validée par le propriétaire', state === 'MAPPING_REVIEWED',
    state === 'MAPPING_PENDING_REVIEW' ? 'Vérifier la cartographie ci-dessous, répondre aux questions, puis « Valider la cartographie ».'
      : 'Possible une fois la cartographie complète.', { action: state === 'MAPPING_PENDING_REVIEW' ? 'mapping-review' : null }));

  // 6. Passages automatiques
  let enabled = false, lastPass = null;
  if (dbConfigured && !missing.some(m => m.startsWith('office_agent_'))) {
    try { enabled = Boolean((await fetchRows('office_agent_schedule?org_id=eq.' + q(orgId) + '&select=enabled&limit=1'))?.[0]?.enabled); } catch { /* table check above */ }
    try { lastPass = (await fetchRows('office_agent_passes?org_id=eq.' + q(orgId) + '&slot=not.like.manuel*&select=started_at&order=started_at.desc&limit=1'))?.[0]?.started_at || null; } catch { /* idem */ }
  }
  checks.push(check('schedule:enabled', 'Passages automatiques', 'Horaires des agents activés', enabled,
    'Paramètres → Horaires des agents → cocher « Activer les passages automatiques ».'));
  const ticking = lastPass && now - Date.parse(lastPass) < 26 * HOUR;
  checks.push(check('schedule:ticking', 'Passages automatiques', 'Planificateur qui déclenche les passages', ticking ? true : enabled ? false : 'warn',
    'Supabase → SQL Editor : db/scheduler-cron.sql (remplacer l’adresse de l’application et le secret du planificateur).',
    { last_pass_at: lastPass }));

  // 7. E-mails de l'agent (collègues seulement, après validation)
  let persona = null;
  if (dbConfigured && !missing.some(m => m.startsWith('office_agent_persona'))) {
    try { persona = await (deps.getPersona || getPersona)(orgId); } catch { persona = null; }
  }
  checks.push(check('mail:sender', 'E-mails de l’agent', 'Adresse d’envoi de l’agent et domaines du cabinet', Boolean(persona?.sender_email && persona?.internal_domains?.length) ? true : 'warn',
    'Paramètres → E-mail de l’agent : adresse d’envoi (ex. assistant@taty.info) et domaines du cabinet (taty.info).'));
  checks.push(check('mail:delegation', 'E-mails de l’agent', 'Envoi Gmail au nom de l’agent (après validation)', mailConfigured(env) ? true : 'warn',
    'Ajouter GOOGLE_SERVICE_ACCOUNT_JSON dans Vercel ; le super administrateur Google Workspace autorise ce compte de service (délégation, droit gmail.send) pour l’adresse de l’agent. Sans cela, les messages validés restent non envoyés.'));

  const todo = checks.filter(c => c.status === 'todo');
  return {
    ready: !todo.length,
    remaining: todo.length,
    checks,
    mapping,
    next: todo[0] || null,
    checked_at: now.toISOString()
  };
}

// Owner action: full mapping pass by the Orpailleur (runs in /api/agent, up to 300 s).
export async function launchMappingPass(req, fire = fireInternal) {
  const message = 'Passage de cartographie COMPLET demandé par le propriétaire depuis la Mise en service. ' +
    'Appelle run_mapping_pass avec listing_source DRIVE_WALK (tout le Drive autorisé) et max_reads 30 (les autres fichiers seront lus aux passages suivants). Lecture seule sur les fichiers métier. ' +
    'Ensuite, appelle get_mapping_report et résume : état de la cartographie, nombre d’objets, dossiers de mission trouvés, ' +
    'questions qui attendent le propriétaire. N’approuve rien toi-même.';
  const sent = await fire(req, '/api/agent', { message, agent: 'orpailleur', provider: 'auto', risk: 'normal' });
  return { started: Boolean(sent), message: 'Passage de cartographie lancé. Résultat dans quelques minutes ; revenez sur cette page.' };
}
