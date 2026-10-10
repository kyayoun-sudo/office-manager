// SHADOW'S GUARD RAILS — what no lesson, rule or code proposal may change (2026-10-10).
// Paul: « Shadow doit pouvoir réécrire le code pour améliorer le comportement de tous les agents et de
// lui-même ». It may — as a PROPOSAL a person reviews and merges, never deployed by itself — but no
// agent can give itself more power (architecture §55-60, principle 10). This file is the boundary:
// Shadow can never propose a change to it, nor to any file listed here.

// Rules in words: a lesson or a proposal that would weaken one of these is refused.
const PROTECTED = /(permission|droit|r[ôo]le|rls|secret|cl[ée]s? api|api key|mot de passe|password|limite de d[ée]pense|budget ia|journal d.audit|audit log|approbation|validation (humaine|du propri[ée]taire|owner)|rollback|retour arri[èe]re|confidentialit|ind[ée]pendance|signature|sign-?off|envoi externe|authentification|garde-fou)/i;
const WEAKEN = /(d[ée]sactiv|supprim|contourn|ignor|outrepass|sans (validation|approbation|contr[ôo]le)|augment\w* (ses|leurs|les) (droits|permissions|pouvoirs)|s.accorde|bypass|skip|disable|remove)/i;
export const touchesProtected = text => PROTECTED.test(String(text || '')) && WEAKEN.test(String(text || ''));

// Files Shadow may never rewrite: who may do what (auth, roles, permissions), the human approval
// (« À valider » and its executor), the audit log, secrets and connections, the database, the
// routes, the deployment, the dependencies, existing tests, and these guard rails themselves.
export const GUARDED_FILES = [
  /^lib\/shadow-(guard|code)\.js$/, // the boundary and the pipeline that enforces it
  /^lib\/(auth|user-auth|owner-auth|accounts|agent-permissions|action-decisions|action-executor|audit-log|supabase|google-connection|google-signin|test-mode|branding)\.js$/,
  /^api\//, /^db\//, /^supabase\//, /^\.github\//, /^vercel\.json$/, /^package(-lock)?\.json$/, /^pnpm-lock\.yaml$/, /^CLAUDE\.md$/, /^docs\//,
  /^tests\/shadow-code\.test\.js$/,
  /^tests\/(?!shadow-)/ // existing tests are never weakened; Shadow may ADD tests named tests/shadow-*.test.js
];
export const isGuardedFile = path => GUARDED_FILES.some(re => re.test(String(path || '').replace(/^\/+/, '')));

// Code that would hand out power or reach secrets is refused even in an allowed file.
const DANGEROUS_CODE = /(process\.env\.[A-Z_]*(SECRET|TOKEN|KEY|PASSWORD)|child_process|\beval\s*\(|new Function\s*\(|role\s*[:=]\s*['"](owner|partner)['"]|ownerOnly\s*:\s*false|requireRole|requireFirmOwner|requirePilotAccess|office_app_users|office_action_queue|status\s*:\s*['"](approved|executed)['"])/;
export const dangerousCode = text => DANGEROUS_CODE.test(String(text || ''));
