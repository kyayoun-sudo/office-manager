// PERMISSIONS — who may see which screen and do which action (Paul, 2026-10-11: « cherche les postes
// possibles dans un cabinet ; c'est eux qu'on mettra dans Paramètres et qui définiront l'accès des
// personnes aux différentes interfaces ; en fonction des positions il y a des rôles ; chacun a accès à
// un certain niveau dans les différentes actions »). For EVERY firm, not one firm: each firm adjusts
// the defaults below in Paramètres → Droits.
//
// Specification §5, §55, §58; ISQM 1 (roles of the firm), ISQM 2 (engagement quality reviewer),
// ISA 220 (engagement partner). The design is written in the doc « Postes, rôles et droits d'accès ».
//
// One scale of levels (each includes the previous ones, except ADMIN which opens no client file):
//   none · view · prepare · review · approve · sign · admin
// Three layers give a person's right: their ROLE (lib/roles.js), their ROLES IN THE FIRM (ISQM 1
// responsibilities, cumulative) and their FUNCTION ON A MISSION (assignment). The automatic rules
// below then REMOVE a right even when a layer gives it. AI agents never go above « prepare ».
//
// What this module decides today: the menu (screens) and the actions that call can() — the tender
// watch, the people rights in Paramètres. The older routes keep their role families (lib/roles.js),
// which match the defaults below; moving each of them onto can() is done route by route.

import { ROLES, ROLE_LABELS, FIRM_LEAD } from './roles.js';
import { rest } from './supabase.js';

const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const q = encodeURIComponent;

export const LEVELS = Object.freeze(['none', 'view', 'prepare', 'review', 'approve', 'sign', 'admin']);
export const LEVEL_LABELS = Object.freeze({ none: 'Aucun', view: 'Voir', prepare: 'Préparer', review: 'Revoir', approve: 'Approuver / décider', sign: 'Signer / émettre', admin: 'Administrer' });
const rank = l => ({ none: 0, view: 1, prepare: 2, review: 3, approve: 4, sign: 5 })[l] ?? 0;
// The AI's ceiling: an agent prepares and proposes; a person reviews, decides, signs.
export const AI_CEILING = 'prepare';

// ---- The positions of an audit / accounting firm (default catalogue, renamed by each firm) ----
// level = place in the hierarchy (0 = top); role = the application role it gives by default.
export const DEFAULT_POSITIONS = Object.freeze([
  { key: 'owner', label: 'Propriétaire du compte', family: 'Gouvernance', level: 0, role: 'owner' },
  { key: 'managing_partner', label: 'Associé gérant', family: 'Production / gouvernance', level: 1, role: 'partner' },
  { key: 'partner', label: 'Associé', family: 'Production', level: 1, role: 'partner' },
  { key: 'director', label: 'Directeur / senior manager', family: 'Production', level: 2, role: 'manager' },
  { key: 'bdm', label: 'Business Development Manager', family: 'Commercial et production', level: 3, role: 'bdm' },
  { key: 'manager', label: 'Manager', family: 'Production', level: 3, role: 'manager' },
  { key: 'supervisor', label: 'Superviseur', family: 'Production', level: 4, role: 'supervisor' },
  { key: 'senior', label: 'Senior / chef de mission', family: 'Production', level: 5, role: 'senior' },
  { key: 'assistant_confirmed', label: 'Assistant confirmé', family: 'Production', level: 6, role: 'auditor' },
  { key: 'assistant', label: 'Assistant / auditeur junior', family: 'Production', level: 7, role: 'auditor' },
  { key: 'intern', label: 'Stagiaire (dont expert-comptable stagiaire)', family: 'Production', level: 8, role: 'auditor' },
  { key: 'specialist', label: 'Spécialiste (fiscalité, informatique, évaluation)', family: 'Production transverse', level: null, role: 'auditor' },
  { key: 'secretary', label: 'Secrétariat / assistante de direction', family: 'Support', level: null, role: 'secretary' },
  { key: 'billing', label: 'Administration et facturation', family: 'Support', level: null, role: 'secretary' },
  { key: 'hr', label: 'Ressources humaines', family: 'Support', level: null, role: 'secretary' },
  { key: 'it', label: 'Responsable informatique', family: 'Support', level: null, role: 'it_admin' },
  { key: 'external_eqr', label: 'Revue qualité externe (EQR externe)', family: 'Externe', level: null, role: 'quality_reviewer' }
]);

// ---- Roles in the firm (ISQM 1 and internal), cumulative with the role ----
export const FIRM_ROLES = Object.freeze({
  quality_ultimate: { label: 'Responsable ultime de la qualité', origin: 'ISQM 1', grants: { quality: 'approve', audit_log: 'view' } },
  quality_operational: { label: 'Responsable opérationnel qualité', origin: 'ISQM 1', grants: { quality: 'approve' } },
  ethics_independence: { label: 'Responsable éthique et indépendance', origin: 'ISQM 1', grants: { acceptance: 'approve' } },
  monitoring: { label: 'Responsable du suivi et de la remédiation', origin: 'ISQM 1', grants: { quality: 'review', audit_log: 'view' } },
  billing: { label: 'Responsable facturation', origin: 'interne', grants: { billing: 'approve' } },
  hr: { label: 'Responsable RH', origin: 'interne', grants: { team: 'approve' } },
  it_admin: { label: 'Administrateur informatique', origin: 'interne', grants: { settings: 'admin' } }
});

// ---- Functions on a mission (given in the mission's staffing) ----
export const MISSION_FUNCTIONS = Object.freeze({
  signing_partner: { label: 'Associé signataire', grants: { mission: 'approve', workpapers: 'sign', engagement_letter: 'sign' } },
  eqr: { label: 'Revue qualité de mission (EQR)', grants: { mission: 'view', workpapers: 'review', quality: 'sign' } },
  mission_manager: { label: 'Manager de mission', grants: { mission: 'approve', workpapers: 'review', pbc: 'approve' } },
  team_lead: { label: 'Chef de mission', grants: { mission: 'review', workpapers: 'review', pbc: 'review' } },
  member: { label: 'Membre d’équipe', grants: { mission: 'view', workpapers: 'prepare', pbc: 'prepare' } },
  specialist: { label: 'Spécialiste', grants: { mission: 'view', workpapers: 'prepare' } },
  reader: { label: 'Lecteur', grants: { mission: 'view' } }
});

// ---- Screens (each one a page of the application) ----
export const SCREENS = Object.freeze({
  home: { label: 'Accueil', page: '/accueil.html' },
  tenders: { label: 'Veille des appels d’offres', page: '/veille.html' },
  opportunities: { label: 'Opportunités (TDR, AMI)', page: '/opportunites.html' },
  acceptance: { label: 'Acceptation, KYC, indépendance', page: null },
  mission: { label: 'Fiche mission, planning', page: '/mission.html' },
  engagement_letter: { label: 'Lettre de mission', page: null },
  pbc: { label: 'Demandes au client (PBC)', page: null },
  workpapers: { label: 'Dossier de travail et revue', page: '/auditeur.html' },
  documents: { label: 'Documents (Orpailleur)', page: '/rangement.html' },
  quality: { label: 'Revue qualité, consultations', page: '/pilotage.html' },
  billing: { label: 'Honoraires et facturation', page: null },
  team: { label: 'Équipe, capacité, staffing', page: '/equipe.html' },
  validations: { label: 'À faire / À valider', page: '/validations.html' },
  audit_log: { label: 'Journal d’audit', page: null },
  shadow: { label: 'Entraînement (Shadow)', page: '/entrainement.html' },
  settings: { label: 'Paramètres', page: '/parametres.html' }
});

// Default level of each role on each screen (the doc's matrix). '*' after a level = « my missions only ».
const L = (s) => { const mine = s.endsWith('*'); return { level: mine ? s.slice(0, -1) : s, mine }; };
const ROW = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, L(v)]));
export const DEFAULT_MATRIX = Object.freeze({
  owner: ROW({ home: 'approve', tenders: 'approve', opportunities: 'approve', acceptance: 'approve', mission: 'approve', engagement_letter: 'sign', pbc: 'view', workpapers: 'sign', documents: 'view', quality: 'approve', billing: 'approve', team: 'approve', validations: 'approve', audit_log: 'view', shadow: 'approve', settings: 'admin' }),
  partner: ROW({ home: 'view', tenders: 'approve', opportunities: 'approve', acceptance: 'approve', mission: 'approve', engagement_letter: 'sign', pbc: 'view', workpapers: 'sign*', documents: 'view', quality: 'approve', billing: 'approve', team: 'approve', validations: 'approve', audit_log: 'view', shadow: 'approve', settings: 'admin' }),
  quality_reviewer: ROW({ home: 'view*', tenders: 'none', opportunities: 'none', acceptance: 'view*', mission: 'view*', engagement_letter: 'none', pbc: 'view*', workpapers: 'review*', documents: 'view*', quality: 'sign*', billing: 'none', team: 'none', validations: 'review', audit_log: 'view*', shadow: 'none', settings: 'none' }),
  bdm: ROW({ home: 'view', tenders: 'prepare', opportunities: 'prepare', acceptance: 'prepare*', mission: 'view*', engagement_letter: 'prepare', pbc: 'view*', workpapers: 'prepare*', documents: 'prepare', quality: 'none', billing: 'view', team: 'view', validations: 'prepare', audit_log: 'none', shadow: 'none', settings: 'none' }),
  manager: ROW({ home: 'view', tenders: 'none', opportunities: 'prepare', acceptance: 'review', mission: 'approve*', engagement_letter: 'prepare', pbc: 'approve*', workpapers: 'review*', documents: 'approve*', quality: 'view*', billing: 'view*', team: 'approve*', validations: 'approve', audit_log: 'view*', shadow: 'none', settings: 'none' }),
  supervisor: ROW({ home: 'view*', tenders: 'none', opportunities: 'view', acceptance: 'prepare*', mission: 'review*', engagement_letter: 'view*', pbc: 'review*', workpapers: 'review*', documents: 'review*', quality: 'none', billing: 'none', team: 'view*', validations: 'review', audit_log: 'none', shadow: 'none', settings: 'none' }),
  senior: ROW({ home: 'view*', tenders: 'none', opportunities: 'view', acceptance: 'prepare*', mission: 'prepare*', engagement_letter: 'view*', pbc: 'prepare*', workpapers: 'review*', documents: 'prepare*', quality: 'none', billing: 'none', team: 'view*', validations: 'prepare', audit_log: 'none', shadow: 'none', settings: 'none' }),
  auditor: ROW({ home: 'view*', tenders: 'none', opportunities: 'none', acceptance: 'prepare*', mission: 'view*', engagement_letter: 'none', pbc: 'prepare*', workpapers: 'prepare*', documents: 'prepare*', quality: 'none', billing: 'none', team: 'view*', validations: 'prepare', audit_log: 'none', shadow: 'none', settings: 'none' }),
  secretary: ROW({ home: 'view', tenders: 'none', opportunities: 'prepare', acceptance: 'none', mission: 'view', engagement_letter: 'prepare', pbc: 'prepare', workpapers: 'none', documents: 'prepare', quality: 'none', billing: 'prepare', team: 'view', validations: 'prepare', audit_log: 'none', shadow: 'none', settings: 'none' }),
  it_admin: ROW({ home: 'view', tenders: 'none', opportunities: 'none', acceptance: 'none', mission: 'none', engagement_letter: 'none', pbc: 'none', workpapers: 'none', documents: 'none', quality: 'none', billing: 'none', team: 'view', validations: 'none', audit_log: 'view', shadow: 'view', settings: 'admin' }),
  collaborator: ROW({ home: 'view*', tenders: 'none', opportunities: 'view', acceptance: 'prepare*', mission: 'view*', engagement_letter: 'none', pbc: 'prepare*', workpapers: 'prepare*', documents: 'prepare*', quality: 'none', billing: 'none', team: 'view*', validations: 'prepare', audit_log: 'none', shadow: 'none', settings: 'none' })
});

// ---- Sensitive actions: who prepares, who reviews, who decides, and what is never allowed ----
// decide = the roles that may take the decision; prepare = roles that may prepare it;
// ai = what an agent may do; rules = the automatic rules checked by can().
export const ACTIONS = Object.freeze({
  tender_follow_decision: { label: 'Décider de suivre ou non un avis d’appel d’offres', prepare: ['bdm'], decide: ['owner', 'partner'], ai: 'résume, vérifie la date limite, score Bid / No Bid', rules: ['no_self_approval'] },
  tender_obtain_tdr: { label: 'Obtenir le TDR et créer l’opportunité', prepare: ['bdm', 'owner', 'partner'], decide: ['bdm', 'owner', 'partner'], ai: 'range le TDR (Orpailleur)', rules: ['followed_first'] },
  tender_record_result: { label: 'Enregistrer le dépôt et le résultat d’une offre', prepare: ['bdm', 'owner', 'partner'], decide: ['bdm', 'owner', 'partner'], ai: '—', rules: [] },
  tender_settings: { label: 'Régler la veille (zones, missions, sources, qui décide)', prepare: ['owner', 'partner'], decide: ['owner', 'partner'], ai: '—', rules: [] },
  shadow_lesson_validate: { label: 'Valider une leçon de Shadow (offres perdues comprises)', prepare: [], decide: ['owner', 'partner'], ai: 'propose les raisons et les améliorations', rules: [] },
  shadow_lesson_share_bdm: { label: 'Transmettre au BDM une recommandation validée', prepare: [], decide: ['owner', 'partner'], ai: '—', rules: [] },
  phase0_decision: { label: 'Poursuivre ou non une opportunité (Phase 0)', prepare: ['bdm', 'manager'], decide: ['owner', 'partner'], ai: 'résume, signale les risques', rules: ['no_self_approval'] },
  acceptance_decision: { label: 'Décision d’acceptation du client', prepare: ['manager'], decide: ['owner', 'partner'], ai: '—', rules: ['no_self_approval', 'beneficial_owners_verified'] },
  independence_declaration: { label: 'Déclaration individuelle d’indépendance', prepare: ['*self'], decide: ['*self'], ai: 'rappelle, préremplit les liens connus', rules: ['only_self'] },
  eqr_appointment: { label: 'Désigner l’EQR d’une mission', prepare: [], decide: ['owner', 'partner'], ai: 'propose des noms éligibles', rules: ['eqr_outside_team', 'eqr_cooling_off'] },
  engagement_letter_send: { label: 'Envoyer la lettre de mission', prepare: ['bdm', 'manager', 'secretary'], decide: ['owner', 'partner'], ai: 'brouillon depuis le modèle', rules: ['kyc_independence_first'] },
  staffing: { label: 'Valider l’équipe d’une mission', prepare: ['manager'], decide: ['owner', 'partner', 'manager'], ai: 'propose selon capacité et indépendance', rules: ['independent_of_client'] },
  materiality: { label: 'Seuil de signification', prepare: ['senior', 'manager'], decide: ['owner', 'partner'], ai: 'calcule une proposition', rules: [] },
  workpaper_review: { label: 'Revue d’une feuille de travail', prepare: ['auditor', 'senior', 'collaborator'], decide: ['senior', 'supervisor', 'manager', 'owner', 'partner'], ai: 'relève des écarts', rules: ['no_self_review'] },
  report_issue: { label: 'Émettre le rapport', prepare: ['manager'], decide: ['owner', 'partner'], ai: '—', rules: ['eqr_done', 'can_sign'] },
  invoice_issue: { label: 'Émettre une facture', prepare: ['secretary'], decide: ['owner', 'partner'], ai: 'prépare depuis la lettre de mission', rules: [] },
  payment_verified: { label: 'Marquer un encaissement « vérifié »', prepare: ['secretary'], decide: ['secretary', 'owner', 'partner'], ai: 'rapproche avec le relevé', rules: ['no_self_approval'] },
  archive_lock: { label: 'Archiver et verrouiller un dossier', prepare: ['manager'], decide: ['owner', 'partner'], ai: 'prépare le manifeste', rules: [] },
  see_performance: { label: 'Voir la performance d’une personne', prepare: [], decide: ['owner', 'partner', 'manager', 'supervisor'], ai: 'calcule les indicateurs', rules: ['direct_reports_only'] },
  manage_accounts: { label: 'Créer un compte, changer un rôle', prepare: ['it_admin'], decide: ['owner', 'partner', 'it_admin'], ai: 'propose depuis le tableau de l’équipe', rules: ['no_self_elevation'] },
  permissions_edit: { label: 'Modifier les droits par défaut', prepare: [], decide: ['owner', 'partner'], ai: '—', rules: ['no_self_elevation'] }
});

export const RULE_LABELS = Object.freeze({
  no_self_approval: 'Préparateur ≠ approbateur : la personne qui a préparé ne décide pas.',
  no_self_review: 'Personne ne revoit son propre travail.',
  only_self: 'Seule la personne concernée répond pour elle-même.',
  followed_first: 'Un associé doit d’abord avoir décidé de suivre l’avis.',
  beneficial_owners_verified: 'Pas d’acceptation tant que les bénéficiaires effectifs ne sont pas vérifiés.',
  eqr_outside_team: 'L’EQR n’est pas membre de l’équipe et ne rend pas compte à l’associé signataire.',
  eqr_cooling_off: 'Un ancien associé signataire attend deux ans avant d’être EQR de la même mission (ISQM 2).',
  kyc_independence_first: 'Pas de lettre de mission avant KYC et indépendance validés.',
  independent_of_client: 'Pas de staffing sans déclaration d’indépendance ou avec un conflit déclaré.',
  eqr_done: 'Pas de date de rapport avant la fin de la revue qualité (ISQM 2).',
  can_sign: 'Seule une personne qualifiée pour signer émet le rapport.',
  direct_reports_only: 'Un manager ne voit que ses rapports directs, si le cabinet l’autorise.',
  no_self_elevation: 'Personne ne se donne à soi-même un droit plus élevé.'
});

// ---- The firm's overrides (Paramètres → Droits), kept in office_firm_settings.settings.permissions ----
// { matrix: { role: { screen: 'level' | 'level*' } } } — only what differs from the defaults.
export function effectiveMatrix(overrides = {}) {
  const out = {};
  for (const role of ROLES) {
    out[role] = {};
    for (const screen of Object.keys(SCREENS)) {
      const base = DEFAULT_MATRIX[role]?.[screen] || { level: 'none', mine: false };
      const o = overrides?.matrix?.[role]?.[screen];
      out[role][screen] = typeof o === 'string' && validCell(o) ? L(o) : { ...base };
    }
  }
  // Locks that no override may remove: the IT administrator never opens client files; Paramètres
  // stays administered by the firm's lead (nobody locks themselves out of the settings).
  for (const s of ['acceptance', 'mission', 'engagement_letter', 'pbc', 'workpapers', 'documents', 'quality', 'billing', 'tenders', 'opportunities']) out.it_admin[s] = { level: 'none', mine: false };
  out.owner.settings = { level: 'admin', mine: false };
  return out;
}
export function validCell(v) { const s = String(v || ''); const lvl = s.endsWith('*') ? s.slice(0, -1) : s; return LEVELS.includes(lvl); }

export async function loadOverrides(orgId, fetchRows = rest) {
  const rows = await fetchRows('office_firm_settings?org_id=eq.' + q(orgId) + '&select=settings&limit=1').catch(() => null);
  return (Array.isArray(rows) && rows[0]?.settings?.permissions) || {};
}

// What the person sees: their screens and levels, and the menu pages to hide.
export function myScreens(account, matrix) {
  const row = matrix[account?.role] || {};
  const screens = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v]));
  const hidden = Object.entries(SCREENS).filter(([k, s]) => s.page && (row[k]?.level || 'none') === 'none').map(([, s]) => s.page);
  return { role: account?.role || null, screens, hidden_pages: [...new Set(hidden)].filter(p => p !== '/accueil.html') };
}

export async function permissionsView(orgId, account, d = {}) {
  const overrides = await (d.loadOverrides || loadOverrides)(orgId, d.fetchRows || rest);
  const matrix = effectiveMatrix(overrides);
  const mine = myScreens(account, matrix);
  if (!FIRM_LEAD.includes(account?.role) && account?.role !== 'it_admin') return { mine };
  return { mine, matrix, overrides: overrides.matrix || {}, levels: LEVELS, level_labels: LEVEL_LABELS, screens: SCREENS, roles: ROLES, role_labels: ROLE_LABELS,
    positions: DEFAULT_POSITIONS, firm_roles: FIRM_ROLES, mission_functions: MISSION_FUNCTIONS, actions: ACTIONS, rules: RULE_LABELS };
}

// Only the firm's lead changes the rights; nobody gives their own role more than it had.
export async function savePermissions(orgId, body = {}, account = null, d = {}) {
  const fetchRows = d.fetchRows || rest;
  if (!FIRM_LEAD.includes(account?.role)) throw fail('PARTNERS_ONLY', 403);
  const rows = await fetchRows('office_firm_settings?org_id=eq.' + q(orgId) + '&select=settings&limit=1').catch(() => null);
  const settings = (Array.isArray(rows) && rows[0]?.settings) || {};
  const current = settings.permissions?.matrix || {};
  const next = { ...current };
  if (body.reset) { for (const r of Object.keys(next)) delete next[r]; }
  for (const ch of Array.isArray(body.changes) ? body.changes.slice(0, 200) : []) {
    const role = String(ch.role || ''), screen = String(ch.screen || ''), value = ch.value == null ? null : String(ch.value);
    if (!ROLES.includes(role) || !SCREENS[screen]) throw fail('UNKNOWN_ROLE_OR_SCREEN');
    if (value !== null && !validCell(value)) throw fail('UNKNOWN_LEVEL');
    // Rule « no self-elevation »: a person never raises the level of their own role.
    if (role === account.role && value !== null) {
      const before = (effectiveMatrix(settings.permissions || {})[role][screen] || {}).level;
      const after = L(value).level;
      if (rank(after) > rank(before) || (after === 'admin' && before !== 'admin')) throw fail('NO_SELF_ELEVATION', 403);
    }
    next[role] = { ...(next[role] || {}) };
    if (value === null || value === serialise(DEFAULT_MATRIX[role]?.[screen])) delete next[role][screen]; else next[role][screen] = value;
    if (!Object.keys(next[role]).length) delete next[role];
  }
  const newSettings = { ...settings, permissions: { matrix: next, updated_by: account.display_name || account.email || null, updated_at: new Date().toISOString() } };
  try {
    await fetchRows('office_firm_settings?on_conflict=org_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ org_id: orgId, settings: newSettings, updated_by: account.display_name || account.email || null, updated_at: new Date().toISOString() }]) });
  } catch (e) { throw fail(/office_firm_settings|PGRST205|42P01/i.test(String(e?.message || e)) ? 'ROLES_SQL_NOT_INSTALLED' : String(e.message || e), 409); }
  await (d.audit || (async (...a) => (await import('./audit-log.js')).audit(...a)))(orgId, { agent: 'firm-manager', action_type: 'PERMISSIONS_CHANGED', source_ref: 'permissions', decision: 'Droits modifiés par ' + (account.display_name || account.email), status: 'done' }).catch(() => null);
  return { saved: true, matrix: effectiveMatrix({ matrix: next }) };
}
const serialise = c => c ? c.level + (c.mine ? '*' : '') : 'none';

// ---- can(): one check for an action, with the automatic rules and their reason ----
// ctx: { preparedBy, followed, isSelf, ... } — the facts the rules need. Returns { ok, reason }.
export function can(account, action, ctx = {}) {
  const a = ACTIONS[action];
  if (!a) return { ok: false, reason: 'UNKNOWN_ACTION' };
  if (ctx.agent) return { ok: false, reason: 'AI_CANNOT_DECIDE' };
  const role = account?.role;
  const me = String(account?.email || '').toLowerCase();
  const allowed = a.decide.includes('*self') ? Boolean(ctx.isSelf) : (a.decide.includes(role) || (ctx.extraDeciders || []).some(e => String(e).toLowerCase() === me));
  if (!allowed) return { ok: false, reason: 'ROLE_NOT_ALLOWED' };
  // Firm setting: only named people decide (e.g. the tender deciders) when the firm says so.
  if (Array.isArray(ctx.onlyThese) && ctx.onlyThese.length && !ctx.onlyThese.map(x => String(x).toLowerCase()).includes(me)) return { ok: false, reason: 'NOT_THE_NAMED_DECIDER' };
  for (const rule of a.rules) {
    if ((rule === 'no_self_approval' || rule === 'no_self_review') && ctx.preparedBy && me && String(ctx.preparedBy).toLowerCase() === me) return { ok: false, reason: rule.toUpperCase() };
    if (rule === 'only_self' && !ctx.isSelf) return { ok: false, reason: 'ONLY_SELF' };
    if (rule === 'followed_first' && !ctx.followed) return { ok: false, reason: 'FOLLOW_DECISION_FIRST' };
    if (rule === 'kyc_independence_first' && ctx.kycDone === false) return { ok: false, reason: 'KYC_INDEPENDENCE_FIRST' };
    if (rule === 'eqr_done' && ctx.eqrDone === false) return { ok: false, reason: 'EQR_NOT_DONE' };
    if (rule === 'can_sign' && ctx.canSign === false) return { ok: false, reason: 'NOT_QUALIFIED_TO_SIGN' };
    if (rule === 'eqr_outside_team' && ctx.inTeam) return { ok: false, reason: 'EQR_IN_TEAM' };
    if (rule === 'eqr_cooling_off' && ctx.signedWithinTwoYears) return { ok: false, reason: 'EQR_COOLING_OFF' };
    if (rule === 'independent_of_client' && ctx.independent === false) return { ok: false, reason: 'NOT_INDEPENDENT' };
    if (rule === 'beneficial_owners_verified' && ctx.beneficialOwnersVerified === false) return { ok: false, reason: 'BENEFICIAL_OWNERS_NOT_VERIFIED' };
  }
  return { ok: true, reason: null };
}

// Throws the reason (403) when the check fails; returns nothing otherwise.
export function requireCan(account, action, ctx = {}) {
  const r = can(account, action, ctx);
  if (!r.ok) throw fail(r.reason, 403);
}
