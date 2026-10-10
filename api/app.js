import { requirePilotAccess } from '../lib/auth.js';
import { requireFirmOwner } from '../lib/owner-auth.js';
import { getBranding, saveBranding } from '../lib/branding.js';
import { globalSearch } from '../lib/global-search.js';
import { smartSearch } from '../lib/smart-search.js';
import { listPendingActions, recordDecision } from '../lib/action-decisions.js';
import { getMissionView, getMissionContacts } from '../lib/mission-view.js';
import { getPersona, savePersona, draftInternalMessage } from '../lib/agent-persona.js';
import { login, refreshSession, logout, bootstrapOwner, listAccounts, manageAccount, signUp, claimOwner, oauthLogin, authStartUrl, setupState, closeOwnAccount } from '../lib/accounts.js';
import { translateTexts } from '../lib/translate-ui.js';
import { providersStatus } from '../lib/ai-plus.js';
import { startCapabilityRefresh, capabilityStep, capabilityInsights, capabilityReport, capabilityContext } from '../lib/capabilities.js';
import { engagementMissions, tdrCandidates, engagementState, startEngagementPrep, engagementStep } from '../lib/engagement-prep.js';
import { submissionState, startSubmissionReview, submissionStep } from '../lib/submissions.js';
import { auditorState, auditorReviews, startAuditorReview, auditorStep } from '../lib/enhanced-auditor.js';
import { startDepositAnalysis, depositStep, depositState, listDeposits, attachDeposit } from '../lib/deposit-analysis.js';
import { diagnose } from '../lib/diagnostic.js';
import { createRequest, listRequests, getRequest, step, decide, undo, stop } from '../lib/tidy.js';
import { getSchedule, saveSchedule } from '../lib/schedule.js';
import { tick, runNow, listPasses } from '../lib/agent-passes.js';
import { requireRole, logAccess } from '../lib/user-auth.js';
import { teamKpis, coordination, myKpis } from '../lib/kpi.js';
import { checkReadiness, launchMappingPass } from '../lib/readiness.js';
import { listMessages, proposeMessage, decideMessage, messageThread } from '../lib/agent-mail.js';
import { getTraining, startCampaign, stopCampaign, cleanupCampaign, confirmCase, step as trainingStep } from '../lib/training.js';
import { getTestRun, startCopy, copyTick, seed as seedTestRun } from '../lib/test-run.js';
import { googleStatus, startConnect, finishConnect, disconnectGoogle, loadGoogleConnection, setFirmDrive } from '../lib/google-connection.js';
import { assertIsolatedOrg } from '../lib/test-mode.js';
import { signinUrl, completeGoogleReturn } from '../lib/google-signin.js';
import { googleClientConfigured } from '../lib/google-connection.js';
import { agentPermissions, grantAgentPermissions } from '../lib/agent-permissions.js';
import { startScan, scanStep, scanStatus } from '../lib/mapping-scan.js';
import { learnFirm, firmKnowledge } from '../lib/firm-learning.js';
import { startTidyPlan, tidyPlanStep, tidyStatus, answerQuestion } from '../lib/tidy-plan.js';
import { loadPeoplePolicy, savePeoplePolicy } from '../lib/people-policy.js';
import { dropFile } from '../lib/drop-box.js';
import { peopleBrief } from '../lib/people-brief.js';
import { dedupeMissions } from '../lib/mission-dedupe.js';
import { fireInternal } from '../lib/agent-passes.js';
import { AGENT_FILES, loadAgentMemory, rebuildAgentMemory } from '../lib/agent-memory.js';
import { readMissionMemory, refreshMissionMemories, listLearnings, confirmLearning, proposeStatusChange } from '../lib/mission-memory.js';
import { listAuditEvents } from '../lib/audit-log.js';
import { rest } from '../lib/supabase.js';
import { cockpit } from '../lib/cockpit.js';
import { notifications } from '../lib/notifications.js';
import { getMissionFull } from '../lib/mission-full.js';
import { assignAction } from '../lib/action-executor.js';
import { chatState, sendChat, createGroup } from '../lib/chat.js';
import { integratePlan } from '../lib/plan-integration.js';
import { searchSpecialists, draftOutreach } from '../lib/external-specialists.js';
import { workState, eveningPoint, eveningStep, startWpReview, wpStep, updateReviewPoint, retrospective, signoffEvents, signoffStatus, signoffAction, partnerView } from '../lib/auditor-plus.js';
import { managementCard, refreshCard, addObservation, recommendTeam, lastRecommendation, retainPerson } from '../lib/people-cards.js';
import { addContacts, decideContact, addFact } from '../lib/mission-data.js';
import { suggest as writeSuggest, draft as writeDraft, submit as writeSubmit } from '../lib/mission-write.js';
import { triageInbox, importantMails, draftReply, sendReply, markMailDone } from '../lib/mail-triage.js';

// Single endpoint for the new screens, to stay within Vercel's function limit.
//   GET  /api/app?route=branding                   firm name, colour, logo (everyone)
//   POST /api/app?route=branding                   save them — OWNER ONLY
//   GET  /api/app?route=search&q=…&scope=…         read-only global search
//   GET  /api/app?route=actions                    proposals waiting for a decision
//   POST /api/app?route=actions                    record a decision (executes nothing)
//   GET  /api/app?route=mission-view&mission_id=…  mission dossier + team names
//   GET  /api/app?route=agent-persona              agent mail identity and tone — OWNER ONLY
//   POST /api/app?route=agent-persona              save them — OWNER ONLY
//   POST /api/app?route=agent-message              draft an internal message (never sent)
//   POST /api/app?route=login                      e-mail + password -> session (public)
//   POST /api/app?route=session                    re-check a session with its refresh token (public)
//   POST /api/app?route=logout                     end the session (public)
//   POST /api/app?route=bootstrap-owner            first owner account (owner code, only if no account)
//   POST /api/app?route=diagnostic                 which code was typed, what is missing (public, no secret shown)
//   GET  /api/app?route=tidy[&id=…]                Orpailleur tidy-up requests / one request with its plan
//   POST /api/app?route=tidy {action}              create | step | decide | undo | stop (background chained)
//   GET  /api/app?route=agent-schedule             agent pass times — OWNER ONLY (POST: save)
//   GET  /api/app?route=passes                     latest agent passes
//   POST /api/app?route=scheduler-tick             called by the scheduler (x-scheduler-secret), runs due passes
//   POST /api/app?route=scheduler-run {agent}      run a pass now — OWNER ONLY
//   GET  /api/app?route=coordination               missions at risk, late and unassigned actions — MANAGERS (personal session)
//   GET  /api/app?route=team-kpi                   team indicators — MANAGERS (personal session, access logged)
//   GET  /api/app?route=my-kpi                     my own indicators — any account (personal session)
//   GET  /api/app?route=users                      firm accounts — OWNER ONLY
//   POST /api/app?route=users                      create / deactivate / role / password — OWNER ONLY
//   GET  /api/app?route=training                   agent training: campaign, missions, grades, report (personal session)
//   POST /api/app?route=training {action}          start | stop | cleanup (remove the training missions) — OWNER ONLY
//   POST /api/app?route=training-confirm           the team confirms / corrects the agent on a real mission (personal session)
//   POST /api/app?route=training-step              next unit of training work (background chain)
//   GET  /api/app?route=messages                   agent's messages to colleagues — MANAGERS (personal session)
//   POST /api/app?route=messages {action}          propose (any account) | decide approve/reject (owner, partner, manager)
//   GET  /api/app?route=readiness                  "Mise en service": every link of the chain checked — OWNER ONLY
//   POST /api/app?route=readiness {action}         mapping-pass (full Drive mapping by the Orpailleur) — OWNER ONLY
// Every route needs the pilot token, except the public login routes. Owner routes
// also need the owner token (x-office-manager-owner-token), as in api/owner.js.

const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });
const owner = run => Object.assign(run, { ownerOnly: true });
const open = run => Object.assign(run, { public: true });
// Needs a personal session (Supabase access token) with one of these roles.
const MANAGERS = ['owner', 'partner', 'manager'];
const users = (roles, run) => Object.assign(run, { userRoles: roles });
const lastAiDedupe = new Map();
const ALL_ROLES = ['owner', 'partner', 'manager', 'collaborator'];
const PARTNERS = ['owner', 'partner'];
const who = req => req.account?.display_name || req.account?.email || null;
// Results kept in Drive JSON without the heavy working data (raw mail, read files).
const light = st => { if (!st) return st; const { threads, extracted, workings, auditor_risks, gc_risks, ...rest } = st; return rest; };

export const ROUTES = Object.freeze({
  branding: {
    GET: (orgId) => getBranding(orgId),
    POST: owner((orgId, req) => saveBranding(orgId, req.body || {}, req.body?.updated_by)),
    unavailable: 'BRANDING_UNAVAILABLE'
  },
  search: {
    // Smart search (2026-10-08): optional status and mission, keywords, what the agents read.
    GET: (orgId, req) => smartSearch(orgId, { q: req.query?.q, scope: req.query?.scope, status: req.query?.status, mission_id: req.query?.mission_id || null }),
    unavailable: 'SEARCH_UNAVAILABLE'
  },
  actions: {
    GET: (orgId) => listPendingActions(orgId),
    // Validators only, and the journal records who they really are (never a typed name).
    POST: users(MANAGERS, (orgId, req) => recordDecision(orgId, { ...(req.body || {}), decided_by: req.account?.display_name || req.account?.email || null })),
    unavailable: 'ACTIONS_UNAVAILABLE'
  },
  'mission-view': {
    GET: (orgId, req) => getMissionView(orgId, req.query?.mission_id),
    unavailable: 'MISSION_VIEW_UNAVAILABLE'
  },
  // Agents' names chosen by the firm (everyone reads them; the owner changes them) and the
  // « rangement automatique » switch.
  // One question about a real situation, for the Management Cards (managers answer).
  // Shadow, the learning lab (owner only), and its short questionnaire (everyone).
  shadow: {
    GET: owner(async () => (await import('../lib/shadow.js')).labView()),
    POST: owner(async (orgId, req) => {
      const s = await import('../lib/shadow.js'); const b = req.body || {};
      if (b.action === 'run') return s.shadowPass(orgId, { force: true, req });
      // Code proposals (2026-10-10): a branch + draft pull request; Shadow never merges nor deploys.
      if (b.action === 'code') return (await import('../lib/shadow-code.js')).requestCodeChange(orgId, req, { agent: b.agent, goal: b.goal }, who(req) || 'propriétaire');
      if (b.action === 'code-close') return (await import('../lib/shadow-code.js')).closeCodeProposal(orgId, { id: b.id, reason: b.reason }, who(req) || 'propriétaire');
      if (b.action === 'decide') return s.decide(orgId, b, who(req));
      if (b.action === 'rollback') return s.rollback(orgId, String(b.agent || ''), who(req));
      if (b.action === 'lesson') return s.setLessonStatus(orgId, b, who(req));
      if (b.action === 'tests') return s.generateTests(orgId, String(b.agent || ''));
      if (b.action === 'experiment') return s.runExperiment(orgId, String(b.agent || ''));
      if (b.action === 'source') { const m = String(b.link || '').match(/[-\w]{25,}/); return s.addSource(orgId, { file_id: m ? m[0] : b.link }, who(req)); }
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'SHADOW_UNAVAILABLE'
  },
  'shadow-code-step': { POST: async (orgId, req) => (await import('../lib/shadow-code.js')).codeStep(orgId, req, req.body || {}), unavailable: 'SHADOW_UNAVAILABLE' },
  'shadow-survey': {
    GET: users(ALL_ROLES, async (orgId, req) => (await import('../lib/shadow.js')).currentSurvey(req.account)),
    POST: users(ALL_ROLES, async (orgId, req) => (await import('../lib/shadow.js')).answerSurvey(req.body || {}, req.account)),
    unavailable: 'SHADOW_UNAVAILABLE'
  },
  'people-questions': {
    GET: users(MANAGERS, async () => ({ questions: await (await import('../lib/people-questions.js')).openQuestions() })),
    POST: users(MANAGERS, async (orgId, req) => (await import('../lib/people-questions.js')).answerQuestion(orgId, req.body || {}, who(req))),
    unavailable: 'PEOPLE_UNAVAILABLE'
  },
  'agent-names': {
    GET: users(ALL_ROLES, async orgId => (await import('../lib/agent-persona.js')).agentSettings(orgId)),
    POST: owner(async (orgId, req) => (await import('../lib/agent-persona.js')).saveAgentSettings(orgId, req.body || {}, who(req))),
    unavailable: 'PERSONA_UNAVAILABLE'
  },
  'agent-persona': {
    GET: owner((orgId) => getPersona(orgId)),
    POST: owner((orgId, req) => savePersona(orgId, req.body || {}, req.body?.updated_by)),
    unavailable: 'AGENT_PERSONA_UNAVAILABLE'
  },
  'agent-message': {
    POST: (orgId, req) => draftInternalMessage(orgId, req.body || {}),
    unavailable: 'AGENT_MESSAGE_UNAVAILABLE'
  },
  login: { POST: open((orgId, req) => login(orgId, req.body || {})), unavailable: 'LOGIN_UNAVAILABLE' },
  session: { POST: open((orgId, req) => refreshSession(orgId, req.body || {})), unavailable: 'SESSION_UNAVAILABLE' },
  logout: { POST: open((orgId, req) => logout(req.body || {})), unavailable: 'LOGOUT_UNAVAILABLE' },
  'bootstrap-owner': { POST: open((orgId, req) => bootstrapOwner(orgId, req)), unavailable: 'BOOTSTRAP_UNAVAILABLE' },
  // Sign-up for everyone (account inactive until the owner gives a role) and owner claim (owner code).
  signup: { POST: open((orgId, req) => signUp(orgId, req.body || {})), unavailable: 'SIGNUP_UNAVAILABLE' },
  'setup-state': { GET: open(async (orgId) => {
    const st = await setupState(orgId);
    // The app's own Google sign-in (no Supabase provider needed) once its Google client is set.
    return { ...st, google_login: Boolean(st.google_login || googleClientConfigured()) };
  }), unavailable: 'SIGNUP_UNAVAILABLE' },
  'claim-owner': { POST: open((orgId, req) => claimOwner(orgId, req)), unavailable: 'CLAIM_UNAVAILABLE' },
  // "Continuer avec Google": start address (public) and session check after Google (public).
  'oauth-start': { GET: open((orgId, req) => {
    if (String(req.query?.provider || 'google') === 'google' && googleClientConfigured()) return signinUrl(orgId, req);
    const host = req.headers?.['x-forwarded-host'] || req.headers?.host;
    const proto = String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0];
    return { url: authStartUrl(String(req.query?.provider || 'google'), proto + '://' + host + '/login.html') };
  }), unavailable: 'LOGIN_UNAVAILABLE' },
  'oauth-login': { POST: open((orgId, req) => oauthLogin(orgId, req.body || {})), unavailable: 'LOGIN_UNAVAILABLE' },
  tidy: {
    GET: (orgId, req) => req.query?.id ? getRequest(orgId, req.query.id) : listRequests(orgId),
    POST: (orgId, req) => tidyAction(orgId, req),
    unavailable: 'TIDY_UNAVAILABLE'
  },
  diagnostic: { POST: open((orgId, req) => diagnose(req.body || {})), unavailable: 'DIAGNOSTIC_UNAVAILABLE' },
  'agent-schedule': {
    GET: owner((orgId) => getSchedule(orgId)),
    POST: owner((orgId, req) => saveSchedule(orgId, req.body || {}, req.body?.updated_by)),
    unavailable: 'SCHEDULE_UNAVAILABLE'
  },
  passes: { GET: (orgId) => listPasses(orgId), unavailable: 'PASSES_UNAVAILABLE' },
  // Public route: the scheduler secret is checked inside tick().
  'scheduler-tick': { POST: open((orgId, req) => tick(orgId, req)), unavailable: 'SCHEDULER_UNAVAILABLE' },
  'scheduler-run': { POST: owner((orgId, req) => runNow(orgId, req)), unavailable: 'SCHEDULER_UNAVAILABLE' },
  coordination: {
    GET: users(MANAGERS, async (orgId, req) => {
      await logAccess(orgId, req.account, 'view_coordination');
      // One mission, one row: obvious duplicates merged before showing, the AI pass now and then.
      await dedupeMissions(orgId).catch(() => null);
      if (Date.now() - (lastAiDedupe.get(orgId) || 0) > 30 * 60 * 1000) { lastAiDedupe.set(orgId, Date.now()); fireInternal(req, '/api/app?route=mission-dedupe', {}).catch(() => null); }
      return coordination(orgId);
    }),
    unavailable: 'COORDINATION_UNAVAILABLE'
  },
  'team-kpi': {
    GET: users(MANAGERS, async (orgId, req) => { await logAccess(orgId, req.account, 'view_team_kpi'); await (await import('../lib/people-sync.js')).syncStaffFromUsers(orgId).catch(() => null); return teamKpis(orgId); }),
    unavailable: 'KPI_UNAVAILABLE'
  },
  'my-kpi': {
    GET: users(['owner', 'partner', 'manager', 'collaborator'], (orgId, req) => myKpis(orgId, req.account)),
    unavailable: 'KPI_UNAVAILABLE'
  },
  training: {
    GET: users(ALL_ROLES, (orgId, req) => getTraining(orgId, req)),
    POST: owner((orgId, req) => trainingAction(orgId, req)),
    unavailable: 'TRAINING_UNAVAILABLE'
  },
  'training-confirm': { POST: users(ALL_ROLES, (orgId, req) => confirmCase(orgId, req)), unavailable: 'TRAINING_UNAVAILABLE' },
  'training-step': { POST: (orgId, req) => trainingStep(orgId, req), unavailable: 'TRAINING_UNAVAILABLE' },
  messages: {
    GET: users(MANAGERS, (orgId) => listMessages(orgId)),
    POST: users(ALL_ROLES, (orgId, req) => {
      const body = req.body || {};
      if (body.action === 'propose') return proposeMessage(orgId, body, req.account);
      if (body.action === 'decide') return decideMessage(orgId, body, req.account);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'MESSAGES_UNAVAILABLE'
  },
  readiness: {
    GET: owner((orgId) => checkReadiness(orgId)),
    POST: owner((orgId, req) => {
      // Whole-Drive mapping in short resumable steps (a single agent call hit the 300 s limit).
      if (req.body?.action === 'mapping-pass') return startScan(orgId, req).then(r => ({ ...r, message: r.already_running ? 'Cartographie déjà en cours : elle continue.' : 'Cartographie lancée : l’Orpailleur parcourt votre Drive. Suivez l’avancement ici.' }));
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'READINESS_UNAVAILABLE'
  },
  users: {
    GET: owner((orgId) => listAccounts(orgId)),
    POST: owner((orgId, req) => manageAccount(orgId, req.body || {})),
    unavailable: 'USERS_UNAVAILABLE'
  },
  // Test of the whole app on a copy of the firm — works only in a preview on a test firm.
  //   GET  /api/app?route=test-run                 environment check, copy progress, missions — OWNER ONLY
  //   POST /api/app?route=test-run {action}        copy (the Drive) | seed (team + 5 missions) — OWNER ONLY
  //   POST /api/app?route=test-run-step            next chunk of the copy (background chain)
  'test-run': {
    GET: owner((orgId) => getTestRun(orgId)),
    POST: owner((orgId, req) => {
      if (req.body?.action === 'copy') return startCopy(orgId, req);
      if (req.body?.action === 'seed') return seedTestRun(orgId, req);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'TEST_RUN_UNAVAILABLE'
  },
  'test-run-step': { POST: (orgId, req) => copyTick(orgId, req), unavailable: 'TEST_RUN_UNAVAILABLE' },
  // "Connecter Google" (Drive + Gmail of the firm), from Paramètres.
  //   GET  /api/app?route=google                   connected account, rights, shared drives seen — OWNER ONLY
  //   POST /api/app?route=google {action}          connect (returns Google's consent address) | disconnect — OWNER ONLY
  //   GET  /oauth/google/callback (rewrite)        Google sends the owner back here (signed state checked)
  google: {
    GET: owner((orgId, req) => googleStatus(orgId, { req })),
    POST: owner((orgId, req) => {
      if (req.body?.action === 'connect') return startConnect(orgId, req);
      if (req.body?.action === 'disconnect') return disconnectGoogle(orgId);
      if (req.body?.action === 'set-drive') return setFirmDrive(orgId, req).then(async (r) => {
        // The agents start on the Drive right away: first the mapping (cartographie) by the Orpailleur.
        const m = await startScan(orgId, req).catch(() => ({ started: false }));
        return { ...r, mapping_started: Boolean(m.started) };
      });
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'GOOGLE_UNAVAILABLE'
  },
  // "Autoriser les agents": Drive listing, reading of chosen documents, AI — granted by the owner
  //   GET  /api/app?route=agent-permissions        granted or not (any account)
  //   POST /api/app?route=agent-permissions        grant (owner / partner, personal session)
  // Drive mapping progress (owner) and its background step (pilot token, chained by itself).
  'mapping-scan': { GET: owner(() => scanStatus()), unavailable: 'MAPPING_UNAVAILABLE' },
  'mapping-step': { POST: (orgId, req) => scanStep(orgId, req), unavailable: 'MAPPING_UNAVAILABLE' },
  // « Ce que l'Orpailleur a compris du cabinet »: team, clients, missions read in the Drive.
  //   GET  firm-knowledge                       the proposal (owner)
  //   POST firm-knowledge {action:learn}         read the firm again (background, owner)
  //   POST firm-learn                           background work (pilot token)
  'firm-knowledge': {
    GET: owner(async () => ({ ...(await firmKnowledge()), tidy: await tidyStatus().catch(() => null) })),
    POST: owner(async (orgId, req) => {
      if (req.body?.action === 'learn') { await fireInternal(req, '/api/app?route=firm-learn', { skip_tidy: req.body?.skip_tidy === true }); return { started: true }; }
      if (req.body?.action === 'answer') return answerQuestion({ ...req.body, by: req.body?.by || null });
      if (req.body?.action === 'tidy') return startTidyPlan(orgId, req, req.body.browser_batches === true ? { resume: true, fire: async () => true } : {});
      if (req.body?.action === 'tidy-batch') return tidyPlanStep(orgId, req, { noLoop: true });
      if (req.body?.action === 'dedupe') return dedupeMissions(orgId, { ai: true, loadKnowledge: firmKnowledge });
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'KNOWLEDGE_UNAVAILABLE'
  },
  // Understanding the firm, then (same first scan) where every file goes.
  'firm-learn': { POST: async (orgId, req) => { const k = await learnFirm(orgId); if (req.body?.skip_tidy !== true) await startTidyPlan(orgId, req).catch(() => null); return k; }, unavailable: 'KNOWLEDGE_UNAVAILABLE' },
  // The settings wheel: close one's own account (typed e-mail), the interface in English.
  'close-account': { POST: users(['owner', 'partner', 'manager', 'collaborator'], (orgId, req) => closeOwnAccount(orgId, req.account, req.body || {})), unavailable: 'ACCOUNTS_UNAVAILABLE' },
  translate: { POST: users(['owner', 'partner', 'manager', 'collaborator'], (orgId, req) => translateTexts(req.body || {})), unavailable: 'TRANSLATION_UNAVAILABLE' },
  // ---- 2026-10-08: capabilities, engagement preparation, submissions, Enhanced Auditor ----
  // Which AI providers are configured (keys in Vercel; nothing secret returned).
  'ai-providers': { GET: users(ALL_ROLES, () => providersStatus()), unavailable: 'AI_UNAVAILABLE' },
  // The firm's capability database (Grand Contrôleur): read from the HR / CV folders.
  capabilities: {
    GET: users(MANAGERS, async (orgId, req) => req.query?.people ? capabilityContext(orgId) : capabilityInsights(orgId)),
    POST: users(PARTNERS, (orgId, req) => {
      const a = req.body?.action;
      if (a === 'refresh') return startCapabilityRefresh(orgId, req);
      if (a === 'insights') return capabilityInsights(orgId, { refresh: true });
      if (a === 'report') return capabilityReport(orgId);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'CAPABILITIES_UNAVAILABLE'
  },
  'capabilities-step': { POST: (orgId, req) => capabilityStep(orgId, req), unavailable: 'CAPABILITIES_UNAVAILABLE' },
  // Engagement preparation (Mission Controller): active and not-yet-started missions only.
  engagement: {
    GET: users(MANAGERS, async (orgId, req) => {
      const id = req.query?.mission_id || null;
      if (!id) return { missions: await engagementMissions(orgId) };
      if (req.query?.candidates) return { candidates: await tdrCandidates(orgId, id) };
      return light(await engagementState(id));
    }),
    POST: users(MANAGERS, (orgId, req) => startEngagementPrep(orgId, req, { ...(req.body || {}), requested_by: who(req) })),
    unavailable: 'ENGAGEMENT_UNAVAILABLE'
  },
  'engagement-step': { POST: (orgId, req) => engagementStep(orgId, req, req.body || {}), unavailable: 'ENGAGEMENT_UNAVAILABLE' },
  // Opportunities (2026-10-10): a TDR / AMI deposited → Firm Manager reads, files, fills the firm's
  // acceptance workbook and prepares Phase 0; the client's confirmation → Mission Controller (KYC,
  // independence) in the same workbook. People answer; only the Associé decides.
  opportunities: {
    GET: users(ALL_ROLES, async (orgId, req) => {
      const o = await import('../lib/opportunities.js');
      return req.query?.id ? o.opportunityView(orgId, String(req.query.id), req.account) : o.listOpportunities(orgId);
    }),
    POST: users(ALL_ROLES, async (orgId, req) => {
      const o = await import('../lib/opportunities.js'); const b = req.body || {}; const a = b.action;
      if (a === 'create') return o.createOpportunity(orgId, req, b, req.account);
      if (a === 'upload-start') return o.startTdrUpload(orgId, b, req);
      if (a === 'answer') return o.answerRow(orgId, b, req.account, { req });
      if (a === 'review-section') return o.reviewSection(orgId, b, req.account);
      if (a === 'prepare-again') return o.prepareAgain(orgId, req, b, req.account);
      if (a === 'propose-team') { if (!MANAGERS.includes(req.account?.role)) throw fail('MANAGERS_ONLY', 403); return o.proposeTeam(orgId, req, b); }
      if (a === 'validate-team') return o.validateTeam(orgId, b, req.account);
      if (a === 'declare') return o.declareIndependence(orgId, b, req.account);
      if (a === 'won') { if (!PARTNERS.concat('manager').includes(req.account?.role)) throw fail('MANAGERS_ONLY', 403); return o.markWon(orgId, req, b, req.account); }
      if (a === 'kyc-prepare') return o.prepareKyc(orgId, req, b, req.account);
      if (a === 'dismiss-signal') return o.dismissSignal(orgId, b);
      if (a === 'template') { if (!PARTNERS.includes(req.account?.role)) throw fail('PARTNERS_ONLY', 403); return o.setTemplate(orgId, b, req.account); }
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'OPPORTUNITIES_UNAVAILABLE'
  },
  // « Mon IA »: each person may connect their own AI after accepting the warning; partners see who
  // did and may switch it off for the whole firm.
  'my-ai': {
    GET: users([...ALL_ROLES], async (orgId, req) => (await import('../lib/personal-ai.js')).myAIView(orgId, req.account)),
    POST: users([...ALL_ROLES], async (orgId, req) => {
      const p = await import('../lib/personal-ai.js'); const b = req.body || {};
      if (b.action === 'connect') return p.connectMyAI(orgId, req.account, b);
      if (b.action === 'disconnect') return p.disconnectMyAI(orgId, req.account, b);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'MY_AI_UNAVAILABLE'
  },
  'personal-ai': {
    GET: users(PARTNERS, async (orgId) => (await import('../lib/personal-ai.js')).personalAIOverview(orgId)),
    POST: users(PARTNERS, async (orgId, req) => (await import('../lib/personal-ai.js')).setPersonalAIAllowed(orgId, Boolean(req.body?.allowed), who(req))),
    unavailable: 'MY_AI_UNAVAILABLE'
  },
  'opportunity-step': { POST: async (orgId, req) => (await import('../lib/opportunities.js')).opportunityStep(orgId, req, req.body || {}), unavailable: 'OPPORTUNITIES_UNAVAILABLE' },
  'opportunity-team-step': { POST: async (orgId, req) => (await import('../lib/opportunities.js')).teamStep(orgId, req, req.body || {}), unavailable: 'OPPORTUNITIES_UNAVAILABLE' },
  'opportunity-kyc-step': { POST: async (orgId, req) => (await import('../lib/opportunities.js')).kycStep(orgId, req, req.body || {}), unavailable: 'OPPORTUNITIES_UNAVAILABLE' },
  // Submission performance (Grand Contrôleur): tenders and proposals read in Gmail.
  submissions: {
    GET: users(MANAGERS, async () => light(await submissionState())),
    POST: users(PARTNERS, (orgId, req) => startSubmissionReview(orgId, req, req.body || {})),
    unavailable: 'SUBMISSIONS_UNAVAILABLE'
  },
  'submissions-step': { POST: (orgId, req) => submissionStep(orgId, req), unavailable: 'SUBMISSIONS_UNAVAILABLE' },
  // Enhanced Auditor reviews.
  auditor: {
    GET: users(MANAGERS, async (orgId, req) => req.query?.mission_id ? light(await auditorState(req.query.mission_id)) : { reviews: await auditorReviews() }),
    POST: users(MANAGERS, (orgId, req) => startAuditorReview(orgId, req, { ...(req.body || {}), requested_by: who(req) })),
    unavailable: 'AUDITOR_UNAVAILABLE'
  },
  'auditor-step': { POST: (orgId, req) => auditorStep(orgId, req, req.body || {}), unavailable: 'AUDITOR_UNAVAILABLE' },
  // Documents and folders dropped on Rangement: understood by the agents, then analysed by the
  // agent chosen (Grand Contrôleur, Mission Controller, Enhanced Auditor). Filing stays as before.
  deposit: {
    GET: users(ALL_ROLES, async (orgId, req) => req.query?.id ? depositState(req.query.id) : { deposits: (await listDeposits()).slice(0, 30) }),
    POST: users(ALL_ROLES, (orgId, req) => {
      if (req.body?.action === 'attach') return attachDeposit(orgId, { ...req.body, by: who(req) });
      const p = req.body?.purpose;
      if ((p === 'mission' || p === 'auditor') && !MANAGERS.includes(req.account?.role)) throw fail('ROLE_NOT_ALLOWED', 403);
      return startDepositAnalysis(orgId, req, { ...(req.body || {}), by: who(req) });
    }),
    unavailable: 'DEPOSIT_UNAVAILABLE'
  },
  'deposit-step': { POST: (orgId, req) => depositStep(orgId, req, req.body || {}), unavailable: 'DEPOSIT_UNAVAILABLE' },
  // Partner Dashboard: firm improvement in one place (owner / partners).
  'partner-dashboard': {
    GET: users(PARTNERS, async (orgId, req) => {
      await logAccess(orgId, req.account, 'view_partner_dashboard');
      const [cap, sub, rev] = await Promise.all([capabilityInsights(orgId).catch(e => ({ error: e.message })), submissionState().catch(e => ({ error: e.message })), auditorReviews().catch(() => [])]);
      return { capabilities: cap, submissions: light(sub), reviews: rev, providers: providersStatus() };
    }),
    unavailable: 'DASHBOARD_UNAVAILABLE'
  },
  // The global bell: notifications computed from what is recorded, one per event.
  notifications: { GET: users(ALL_ROLES, (orgId, req) => notifications(orgId, req.account)), unavailable: 'NOTIFICATIONS_UNAVAILABLE' },
  // Home cockpit (2026-10-08): the system's KPI, each with what / how / sources / elements.
  cockpit: {
    GET: users(ALL_ROLES, async (orgId, req) => {
      const c = await cockpit(orgId);
      // Collaborators: the firm's work, not the people indicators nor the firm's mailbox.
      if (!MANAGERS.includes(req.account?.role)) c.kpis = c.kpis.filter(k => !['capacity', 'conflicts', 'quality', 'mails', 'ethics', 'training'].includes(k.key));
      return c;
    }),
    unavailable: 'COCKPIT_UNAVAILABLE'
  },
  // Management Card (owner, partners, managers): opened from a person; each opening is journaled.
  'management-card': {
    GET: users(MANAGERS, async (orgId, req) => { await logAccess(orgId, req.account, 'view_management_card', String(req.query?.staff_id || '')).catch(() => null); return managementCard(orgId, String(req.query?.staff_id || '')); }),
    POST: users(MANAGERS, (orgId, req) => {
      const b = req.body || {};
      if (b.action === 'refresh') return refreshCard(orgId, String(b.staff_id || ''), who(req));
      if (b.action === 'observe') return addObservation(orgId, { ...b, staff_profile_id: b.staff_id }, who(req), true);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'PEOPLE_UNAVAILABLE'
  },
  // Team recommendation: two independent AI judgements; a manager retains people.
  'team-recommendation': {
    GET: users(MANAGERS, (orgId, req) => lastRecommendation(String(req.query?.mission_id || ''))),
    POST: users(MANAGERS, (orgId, req) => {
      const b = req.body || {};
      if (b.action === 'retain') return retainPerson(orgId, String(b.mission_id || ''), b, who(req));
      return recommendTeam(orgId, String(b.mission_id || ''), who(req));
    }),
    unavailable: 'PEOPLE_UNAVAILABLE'
  },
  // A saved plan feeds the mission's structured data (Assistant « Enregistrer »).
  'plan-integrate': { POST: users(ALL_ROLES, (orgId, req) => integratePlan(orgId, String(req.body?.mission_id || ''), req.body || {}, who(req))), unavailable: 'MISSION_UNAVAILABLE' },
  // External specialists for a missing capability: proposed, chosen by a person, message prepared (never sent by the app).
  'external-specialists': {
    POST: users(MANAGERS, (orgId, req) => req.body?.action === 'draft' ? draftOutreach(orgId, req.body || {}, req.account) : searchSpecialists(orgId, req.body || {})),
    unavailable: 'SPECIALISTS_UNAVAILABLE'
  },
  // Enhanced Auditor, its own section: evening points, former missions, working-paper review, partner view.
  'auditor-work': {
    GET: users(MANAGERS, async (orgId, req) => {
      const st = await workState();
      const mid = req.query?.mission_id || null;
      const evening = Object.fromEntries(Object.entries(st.evening || {}).filter(([k]) => !mid || k === mid).map(([k, v]) => [k, mid ? v : v.slice(0, 1)]));
      const wp = Object.values(st.wp_reviews || {}).filter(r => !mid || r.mission_id === mid).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 60);
      return { evening, evening_run: st.evening_run || null, retrospectives: Object.values(st.retrospectives || {}).filter(r => !mid || r.mission?.id === mid), wp_reviews: wp, wp_jobs: Object.values(st.wp_jobs || {}).slice(-10).map(j => ({ id: j.id, status: j.status, left: (j.queue || []).length, done: (j.done || []).length, started_at: j.started_at })) };
    }),
    POST: users(MANAGERS, (orgId, req) => {
      const b = req.body || {};
      if (b.action === 'evening') return eveningPoint(orgId, String(b.mission_id || ''));
      if (b.action === 'retro') return retrospective(orgId, b, who(req));
      if (b.action === 'wp_review') return startWpReview(orgId, req, b, who(req));
      if (b.action === 'point') return updateReviewPoint(String(b.file_id || ''), String(b.point_id || ''), String(b.status || ''), who(req));
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'AUDITOR_UNAVAILABLE'
  },
  'auditor-evening-step': { POST: (orgId, req) => eveningStep(orgId, req), unavailable: 'AUDITOR_UNAVAILABLE' },
  'auditor-wp-step': { POST: (orgId, req) => wpStep(orgId, req, req.body || {}), unavailable: 'AUDITOR_UNAVAILABLE' },
  // Sign-off linked to the real working file and its version (the reviewer opens it before signing).
  signoff: {
    GET: users(ALL_ROLES, async (orgId, req) => { const r = await signoffEvents(orgId, { file_id: req.query?.file_id || null, mission_id: req.query?.mission_id || null }); return { ...r, files: signoffStatus(r.events) }; }),
    POST: users(ALL_ROLES, (orgId, req) => signoffAction(orgId, req.body || {}, req.account)),
    unavailable: 'SIGNOFF_UNAVAILABLE'
  },
  // Partner view: only what a partner must see.
  'partner-view': { GET: users(PARTNERS, () => partnerView()), unavailable: 'AUDITOR_UNAVAILABLE' },
  // Instant internal messaging: no validation, 24 h then archived (formal e-mails stay in « messages »).
  chat: {
    GET: users(ALL_ROLES, (orgId, req) => chatState(orgId, req.account, { conversation: req.query?.conversation || 'cabinet', archive: req.query?.archive === '1' })),
    POST: users(ALL_ROLES, (orgId, req) => req.body?.action === 'group' ? createGroup(orgId, req.account, req.body) : sendChat(orgId, req.account, req.body || {})),
    unavailable: 'CHAT_UNAVAILABLE'
  },
  // Give an action to a person (« Sans responsable », or right after validating it).
  'assign-action': { POST: users(MANAGERS, (orgId, req) => assignAction(orgId, String(req.body?.id || ''), String(req.body?.staff_profile_id || ''), who(req))), unavailable: 'ACTIONS_UNAVAILABLE' },
  // The mission file (2026-10-08): everything the agents and the team know about one mission.
  'mission-file': { GET: users(ALL_ROLES, (orgId, req) => getMissionFull(orgId, String(req.query?.mission_id || ''))), unavailable: 'MISSION_UNAVAILABLE' },
  // Client contacts of a mission: found by the agents (proposed), validated by a manager.
  'mission-client-contacts': {
    POST: users(MANAGERS, (orgId, req) => {
      const b = req.body || {}, mid = String(b.mission_id || '');
      if (b.action === 'add') return addContacts(orgId, mid, [b.contact || {}], who(req), { validated: true });
      if (b.action === 'validate') return decideContact(orgId, mid, String(b.id || ''), b.role ? { role: b.role } : 'validate', who(req));
      if (b.action === 'remove') return decideContact(orgId, mid, String(b.id || ''), 'remove', who(req));
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'MISSION_UNAVAILABLE'
  },
  // Information added to a mission by a person (agents use their tool).
  'mission-fact': { POST: users(ALL_ROLES, (orgId, req) => addFact(String(req.body?.mission_id || ''), { ...(req.body || {}), agent: who(req) })), unavailable: 'MISSION_UNAVAILABLE' },
  // Writing to the client from a mission: purpose, suggested recipients, AI draft, validation.
  'mission-write': {
    POST: users(ALL_ROLES, (orgId, req) => {
      const b = req.body || {}, mid = String(b.mission_id || '');
      if (b.action === 'suggest') return writeSuggest(orgId, mid, b);
      if (b.action === 'draft') return writeDraft(orgId, mid, b, req.account);
      if (b.action === 'submit') return writeSubmit(orgId, mid, b, req.account);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'MISSION_UNAVAILABLE'
  },
  // Important e-mails of the firm's authorised mailbox: list, refresh, AI reply, send / propose.
  'mail-triage': {
    GET: users(MANAGERS, () => importantMails()),
    POST: users(MANAGERS, (orgId, req) => {
      const b = req.body || {};
      if (b.action === 'refresh') return triageInbox(orgId);
      if (b.action === 'draft') return draftReply(orgId, String(b.id || ''), String(b.instruction || ''), req.account);
      if (b.action === 'send') return sendReply(orgId, { id: b.id, subject: b.subject, body: b.body, mission_id: b.mission_id || null, send: b.send !== false }, req.account);
      if (b.action === 'done') return markMailDone(String(b.id || ''), req.account, b.how || 'traité');
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'MAIL_UNAVAILABLE'
  },
  // Memories (2026-10-08): agents' memories, missions' memories, learnings, audit log.
  memory: {
    GET: users(MANAGERS, async (orgId, req) => {
      if (req.query?.mission_id) return readMissionMemory(orgId, String(req.query.mission_id));
      if (req.query?.agent) return (await loadAgentMemory(String(req.query.agent))).memory;
      const agents = {};
      for (const a of Object.keys(AGENT_FILES)) {
        try { const m = (await loadAgentMemory(a)).memory; agents[a] = { status: m.status, last_successful_at: m.last_successful_at, last_attempted_at: m.last_attempted_at, last_error: m.last_error, retry_count: m.retry_count, pending: (m.pending || []).length, recovered_at: m.recovered_at || null }; }
        catch (e) { agents[a] = { error: String(e.message || e).slice(0, 120) }; }
      }
      return { agents };
    }),
    POST: users(MANAGERS, async (orgId, req) => {
      const b = req.body || {};
      if (b.action === 'propose_status') {
        const m = (await rest('office_missions?org_id=eq.' + encodeURIComponent(orgId) + '&id=eq.' + encodeURIComponent(String(b.mission_id || '')) + '&select=id,name,status&limit=1'))?.[0];
        if (!m) throw fail('MISSION_NOT_FOUND', 404);
        return proposeStatusChange(orgId, m, String(b.status || ''), String(b.why || '').slice(0, 300) + ' (demandé par ' + who(req) + ')');
      }
      if (req.account?.role !== 'owner') throw fail('ROLE_NOT_ALLOWED', 403);
      if (b.action === 'home') return (await import('../lib/memory-home.js')).ensureMemoryHome(orgId, { force: true });
      if (b.action === 'rebuild') return rebuildAgentMemory(orgId, String(b.agent || ''), who(req), { fetchRows: rest });
      if (b.action === 'refresh_missions') return refreshMissionMemories(orgId, { limit: Math.min(10, Number(b.limit) || 5) });
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'MEMORY_UNAVAILABLE'
  },
  learnings: {
    GET: users(MANAGERS, (orgId, req) => listLearnings(orgId, { category: req.query?.category || null, status: req.query?.status || null })),
    POST: users(PARTNERS, (orgId, req) => confirmLearning(orgId, req.body?.id, who(req), req.body?.decision || 'confirmed')),
    unavailable: 'MEMORY_UNAVAILABLE'
  },
  'audit-log': { GET: users(PARTNERS, (orgId, req) => listAuditEvents(orgId, { missionId: req.query?.mission_id || null, agent: req.query?.agent || null, limit: req.query?.limit })), unavailable: 'MEMORY_UNAVAILABLE' },
  'mission-dedupe': { POST: orgId => dedupeMissions(orgId, { ai: true, loadKnowledge: firmKnowledge }), unavailable: 'KNOWLEDGE_UNAVAILABLE' },
  'tidy-plan-step': { POST: (orgId, req) => tidyPlanStep(orgId, req), unavailable: 'KNOWLEDGE_UNAVAILABLE' },
  // People a message about a mission goes to: the mission team first, then the whole firm.
  'mission-contacts': { GET: users(['owner', 'partner', 'manager', 'collaborator'], (orgId, req) => getMissionContacts(orgId, req.query?.mission_id || null)), unavailable: 'CONTACTS_UNAVAILABLE' },
  // The firm's people-management policy, kept in the agents' Drive memory (owner).
  // Documents dropped on the Rangement page (40 max, one per request): named, placed, sent — after validation.
  // Small files through the app; large ones straight from the browser to Google (start / finish).
  drop: { POST: users(['owner', 'partner', 'manager', 'collaborator'], async (orgId, req) => {
    const a = req.body?.action;
    if (a === 'start_upload') return (await import('../lib/drop-box.js')).startLargeUpload(orgId, req.body || {}, req.account, req);
    if (a === 'finish_upload') return (await import('../lib/drop-box.js')).finishLargeUpload(orgId, req.body || {}, req.account);
    return dropFile(orgId, req.body || {}, req.account);
  }), unavailable: 'DROP_UNAVAILABLE' },
  // « Équipe et briefing » with the firm's people-management policy (AI) — managers.
  'people-brief': { POST: users(MANAGERS, (orgId, req) => peopleBrief(orgId, req.body?.mission_id)), unavailable: 'PEOPLE_BRIEF_UNAVAILABLE' },
  // Messagerie: the Gmail conversation of a sent message (replies of the colleagues) — managers.
  'mail-thread': { GET: users(MANAGERS, (orgId, req) => messageThread(orgId, req.query?.id)), unavailable: 'MAIL_THREAD_UNAVAILABLE' },
  // Saved → read at once by the agents (team, preferences, questionnaire answers → Équipe and Management Cards).
  'people-policy': { GET: owner(() => loadPeoplePolicy()), POST: owner(async (orgId, req) => { const r = await savePeoplePolicy(req.body || {}); const read = await (await import('../lib/capabilities.js')).startCapabilityRefresh(orgId, req).catch(e => ({ error: String(e.message || e) })); return { ...r, reading: read }; }), unavailable: 'POLICY_UNAVAILABLE' },
  'agent-permissions': {
    GET: users(['owner', 'partner', 'manager', 'collaborator'], (orgId) => agentPermissions(orgId)),
    POST: users(['owner', 'partner'], (orgId, req) => grantAgentPermissions(orgId, req)),
    unavailable: 'PERMISSIONS_UNAVAILABLE'
  },
  'google-callback': {
    GET: open(async (orgId, req) => {
      try {
        const out = await completeGoogleReturn(orgId, req);
        console.log('[google-callback] ok');
        return out;
      } catch (e) {
        console.error('[google-callback] failed:', String(e.message || e).slice(0, 120));
        let signin = false;
        try { signin = JSON.parse(Buffer.from(String(req.query?.state || '').split('.')[0], 'base64url').toString('utf8')).m === 'signin'; } catch { signin = false; }
        if (signin) return { __redirect: '/login.html#error=' + encodeURIComponent(String(e.message || e).slice(0, 80)) };
        return { __redirect: '/parametres.html?google=error&code=' + encodeURIComponent(String(e.message || e).slice(0, 80)) + '#google' };
      }
    }),
    unavailable: 'GOOGLE_UNAVAILABLE'
  }
});

// Starts the next background step without waiting for it (separate invocation).
export function continueInBackground(req, requestId, fetchImpl = fetch) {
  const host = req.headers?.host;
  if (!host || !requestId) return Promise.resolve(false);
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const headers = { 'Content-Type': 'application/json', 'x-office-manager-token': process.env.OFFICE_MANAGER_ACCESS_TOKEN || '' };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  // Protected preview (Vercel Authentication): the owner's own preview cookie lets the background call through.
  const jwt = String(req?.headers?.cookie || '').match(/(?:^|;\s*)(_vercel_jwt=[^;]+)/);
  if (jwt) headers.Cookie = jwt[1];
  const sent = fetchImpl(proto + '://' + host + '/api/app?route=tidy', {
    method: 'POST', headers, body: JSON.stringify({ action: 'step', request_id: requestId })
  }).then(() => true, () => false);
  return Promise.race([sent, new Promise(r => setTimeout(() => r(true), 1500))]);
}

async function tidyAction(orgId, req) {
  const body = req.body || {};
  const action = String(body.action || '');
  let result, chainId = null;
  if (action === 'create') { result = await createRequest(orgId, body); chainId = result.id; }
  else if (action === 'step') { result = await step(orgId, body.request_id); if (result.more) chainId = body.request_id; }
  else if (action === 'decide') { result = await decide(orgId, body); if (body.decision !== 'reject') chainId = body.request_id; }
  else if (action === 'undo') result = await undo(orgId, body);
  else if (action === 'stop') result = await stop(orgId, body);
  else throw fail('UNKNOWN_ACTION', 400);
  if (chainId) await continueInBackground(req, chainId);
  return result;
}

async function trainingAction(orgId, req) {
  const action = String(req.body?.action || '');
  if (action === 'start') return startCampaign(orgId, req);
  if (action === 'stop') return stopCampaign(orgId);
  if (action === 'cleanup') return cleanupCampaign(orgId, req);
  throw fail('UNKNOWN_ACTION', 400);
}

export async function handleApp(req) {
  const route = ROUTES[String(req.query?.route || '')];
  if (!route) { requirePilotAccess(req); throw fail('UNKNOWN_ROUTE', 404); }
  const run = route[req.method];
  if (typeof run !== 'function') { requirePilotAccess(req); throw fail('METHOD_NOT_ALLOWED', 405); }
  if (!run.public) requirePilotAccess(req);
  if (run.ownerOnly) requireFirmOwner(req);
  const orgId = process.env.DEFAULT_ORG_ID;
  if (!orgId && route !== ROUTES.diagnostic) throw new Error('DEFAULT_ORG_ID_MISSING');
  // Test mode (preview): never on the real firm's organisation (test run TATY TEST).
  if (route !== ROUTES.diagnostic) assertIsolatedOrg(orgId);
  if (run.userRoles) req.account = await requireRole(req, run.userRoles);
  // The firm's Google connection (Paramètres → Connecter Google), used by Drive and Gmail.
  if (orgId) await loadGoogleConnection(orgId).catch(() => null);
  // « Mon IA »: a person's own requests may use the AI they connected (warning accepted); else the firm's.
  if (req.account?.auth_user_id) return (await import('../lib/personal-ai.js')).runAs(orgId, req.account, () => run(orgId, req));
  return run(orgId, req);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // A JSON body sent without « Content-Type: application/json » arrives as text: read it anyway
  // (2026-10-08: the chat said « INVALID_BODY », several buttons did nothing).
  if (typeof req.body === 'string' && req.body.trim().startsWith('{')) { try { req.body = JSON.parse(req.body); } catch { /* left as is */ } }
  if (Buffer.isBuffer(req.body)) { try { req.body = JSON.parse(req.body.toString('utf8')); } catch { /* left as is */ } }
  try {
    const out = await handleApp(req);
    // Only the Google callback redirects, and only to a page of this app.
    if (out && typeof out.__redirect === 'string' && out.__redirect.startsWith('/')) {
      res.statusCode = 302; res.setHeader('Location', out.__redirect); return res.end();
    }
    return res.status(200).json(out);
  } catch (error) {
    const status = error.statusCode || 500;
    const route = ROUTES[String(req.query?.route || '')];
    const shown = [400, 401, 403, 404, 405, 409, 429, 503].includes(status) ? error.message : (route?.unavailable || 'APP_UNAVAILABLE');
    const body = { error: shown };
    if (status >= 500) {
      // The real cause, short and without secrets, so the screen (and the logs) say what broke.
      const detail = String(error.message || error).replace(/(Bearer|token|secret|key)[^\s,;]*/gi, '$1…').slice(0, 160);
      body.detail = detail;
      console.error('[app] ' + String(req.query?.route || '') + ' failed:', detail);
    }
    if (Array.isArray(error.outside)) body.outside = error.outside;
    return res.status(status).json(body);
  }
}
