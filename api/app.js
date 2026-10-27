import { withOperationActor } from '../lib/operation-context.js';
import { resolveRequestOrg, runInFirm, pilotOrgId, multiCabinet } from '../lib/firm-context.js';
import { collaboration } from '../lib/live-collaboration.js';
import { requireScreenAccess } from '../lib/permissions.js';
import { accessibleMissionIds, requireMissionAccess } from '../lib/mission-access.js';
import { requirePilotAccess } from '../lib/auth.js';
import { requireFirmOwner } from '../lib/owner-auth.js';
import { getBranding, saveBranding } from '../lib/branding.js';
import { globalSearch } from '../lib/global-search.js';
import { smartSearch } from '../lib/smart-search.js';
import { listPendingActions, recordDecision } from '../lib/action-decisions.js';
import { getMissionView, getMissionContacts } from '../lib/mission-view.js';
import { getPersona, savePersona, draftInternalMessage } from '../lib/agent-persona.js';
import { login, refreshSession, logout, bootstrapOwner, listAccounts, manageAccount, signUp, claimOwner, oauthLogin, authStartUrl, setupState, closeOwnAccount, restartFirm, resetFirm } from '../lib/accounts.js';
import { translateTexts } from '../lib/translate-ui.js';
import { providersStatus } from '../lib/ai-plus.js';
import { startCapabilityRefresh, capabilityStep, capabilityInsights, capabilityReport, capabilityContext } from '../lib/capabilities.js';
import { engagementMissions, tdrCandidates, engagementState, startEngagementPrep, engagementStep } from '../lib/engagement-prep.js';
import { submissionState, startSubmissionReview, submissionStep } from '../lib/submissions.js';
import { auditorState, auditorReviews, startAuditorReview, auditorStep } from '../lib/enhanced-auditor.js';
import { startDepositAnalysis, depositStep, depositState, listDeposits, attachDeposit } from '../lib/deposit-analysis.js';
import { startSession, beat, endSession, reviewWorkbook, listRemarks, updateRemark, myWorkfileActions, decideWorkfileAction, workfileKpis } from '../lib/workfiles.js';
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
import { startScan, scanStep, scanStatus, excludeBlockedFolders, includeFolder } from '../lib/mapping-scan.js';
import { learnFirm, firmKnowledge } from '../lib/firm-learning.js';
import { startTidyPlan, tidyPlanStep, tidyStatus, answerQuestion, stopTidy } from '../lib/tidy-plan.js';
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
//   GET  /api/app?route=permissions                screens × roles, actions and rules (everyone: their own; partners: all)
//   POST /api/app?route=permissions {changes}      partners adjust the defaults (never their own role upwards)
//   GET  /api/app?route=tenders                    tender watch: tenders, indicators, workload (BDM, partners)
//   POST /api/app?route=tenders {action}           run | decide | tdr | submitted | result | review-decide | review-run | settings
//   GET  /api/app?route=readiness                  "Mise en service": every link of the chain checked — OWNER ONLY
//   POST /api/app?route=readiness {action}         mapping-pass (full Drive mapping by the Orpailleur) | mapping-exclude-blocked
//                                                  {folder_ids?} | mapping-include {folder_id} — OWNER ONLY
// Every route needs the pilot token, except the public login routes. Owner routes
// also need the owner token (x-office-manager-owner-token), as in api/owner.js.

const fail = (code, statusCode) => Object.assign(new Error(code), { statusCode });
const owner = run => Object.assign(run, { ownerOnly: true });
const open = run => Object.assign(run, { public: true });
// Needs a personal session (Supabase access token) with one of these roles.
// The role families come from lib/roles.js (2026-10-10: the firm's roles and positions).
import { MANAGERS as ROLE_MANAGERS, WORKERS, EVERYONE, FIRM_LEAD, ACCOUNT_ADMINS, BUSINESS_DEV, SHADOW_VIEWERS, ROLE_LABELS, visiblePeople, firmSettings, saveFirmSettings } from '../lib/roles.js';
const MANAGERS = [...ROLE_MANAGERS];
const users = (roles, run) => Object.assign(run, { userRoles: roles });
const lastAiDedupe = new Map();
const ALL_ROLES = [...WORKERS];
const PARTNERS = [...FIRM_LEAD];
const who = req => req.account?.display_name || req.account?.email || null;
// Results kept in Drive JSON without the heavy working data (raw mail, read files).
const light = st => { if (!st) return st; const { threads, extracted, workings, auditor_risks, gc_risks, ...rest } = st; return rest; };

export const ROUTES = Object.freeze({
  'specialist-registry': {
    GET: users(ACCOUNT_ADMINS, async (orgId, req) => (await import('../lib/specialists/admin.js')).specialistsAdmin(orgId, {}, req.account)),
    POST: users(ACCOUNT_ADMINS, async (orgId, req) => (await import('../lib/specialists/admin.js')).specialistsAdmin(orgId, req.body || {}, req.account)),
    unavailable: 'SPECIALIST_REGISTRY_UNAVAILABLE'
  },
  'sika-expenses': {
    GET: users(ALL_ROLES, async (orgId, req) => (await import('../lib/sika-expenses.js')).expenseView(orgId, req.query || {}, req.account)),
    POST: users(ALL_ROLES, async (orgId, req) => (await import('../lib/sika-expenses.js')).expenseAction(orgId, req.body || {}, req.account)),
    unavailable: 'SIKA_EXPENSES_UNAVAILABLE'
  },
  'personal-learning': {
    GET: users([...EVERYONE], async (orgId, req) => (await import('../lib/personal-learning.js')).learningView(orgId, req.account)),
    POST: users([...EVERYONE], async (orgId, req) => {
      const m = await import('../lib/personal-learning.js'), b = req.body || {};
      if (b.action === 'start') return m.startLearning(orgId, req.account, b);
      if (b.action === 'answer') return m.answerLearning(orgId, req.account, b);
      if (b.action === 'preference') return m.saveLearningPreference(orgId, req.account, b);
      throw fail('UNKNOWN_ACTION', 400);
    }), unavailable: 'PERSONAL_LEARNING_UNAVAILABLE'
  },
  'server-files': {
    GET: users(ALL_ROLES, async (orgId, req) => (await import('../lib/server-files.js')).serverFiles(orgId, req, req.account)),
    POST: users(ALL_ROLES, async (orgId, req) => (await import('../lib/server-files.js')).serverFiles(orgId, req, req.account)),
    unavailable: 'LOCAL_DOCUMENTS_UNAVAILABLE'
  },
  dossier: {
    GET: users(ALL_ROLES, async (orgId, req) => { const m = await import('../lib/dossier-service.js'); return req.query?.mission_id || req.query?.opportunity_id ? m.dossierView(orgId, req.query || {}, req.account) : m.dossierList(orgId, req.account); }),
    unavailable: 'DOSSIER_UNAVAILABLE'
  },
  'dossier-followup': {
    POST: users(MANAGERS, async (orgId, req) => {
      const b = req.body || {}, action = b.action;
      const screen = action === 'specialist' ? 'team' : action === 'quotation' ? 'billing' : null;
      if (!screen) throw fail('UNKNOWN_ACTION', 400);
      await requireScreenAccess(orgId, req.account, 'opportunities', 'prepare');
      await requireScreenAccess(orgId, req.account, screen, 'prepare');
      const m = await import('../lib/dossier-actions.js');
      return action === 'specialist' ? m.updateSpecialist(orgId, b, req.account) : m.recordQuotationChange(orgId, b, req.account);
    }), unavailable: 'DOSSIER_UNAVAILABLE'
  },
  branding: {
    GET: (orgId) => getBranding(orgId),
    POST: owner((orgId, req) => saveBranding(orgId, req.body || {}, req.body?.updated_by)),
    unavailable: 'BRANDING_UNAVAILABLE'
  },
  search: {
    // Smart search (2026-10-08): optional status and mission, keywords, what the agents read.
    GET: users(ALL_ROLES, async (orgId, req) => smartSearch(orgId, { q: req.query?.q, scope: req.query?.scope, status: req.query?.status, mission_id: req.query?.mission_id || null, allowedMissionIds: req.resourceAccess?.mine ? await accessibleMissionIds(orgId, req.account) : null })),
    unavailable: 'SEARCH_UNAVAILABLE'
  },
  actions: {
    GET: users(ALL_ROLES, (orgId) => listPendingActions(orgId)),
    // Validators only, and the journal records who they really are (never a typed name).
    POST: users(MANAGERS, (orgId, req) => recordDecision(orgId, { ...(req.body || {}), decided_by: req.account?.display_name || req.account?.email || null })),
    unavailable: 'ACTIONS_UNAVAILABLE'
  },
  'mission-view': {
    GET: users(ALL_ROLES, async (orgId, req) => { await requireMissionAccess(orgId, req.query?.mission_id, req.account); return getMissionView(orgId, req.query?.mission_id); }),
    unavailable: 'MISSION_VIEW_UNAVAILABLE'
  },
  // Agents' names chosen by the firm (everyone reads them; the owner changes them) and the
  // « rangement automatique » switch.
  // One question about a real situation, for the Management Cards (managers answer).
  // Shadow, the learning lab (owner only), and its short questionnaire (everyone).
  // Shadow is seen by the partners and the IT administrator (Paul, 2026-10-11); the partners decide on
  // lessons and experiments; code proposals may also be asked by the IT administrator.
  shadow: {
    GET: users([...SHADOW_VIEWERS], async (orgId, req) => req.query?.firm === '1' ? (await import('../lib/firm-simulation-service.js')).firmView(orgId, { mode: req.query?.mode }) : req.query?.sandbox === '1' ? (await import('../lib/audit-sandbox.js')).sandboxView(orgId) : (await import('../lib/shadow.js')).labView()),
    POST: users([...SHADOW_VIEWERS], async (orgId, req) => {
      const s = await import('../lib/shadow.js'); const b = req.body || {};
      if (!['code', 'code-close'].includes(b.action) && !PARTNERS.includes(req.account?.role)) throw fail('PARTNERS_ONLY', 403);
      if (String(b.action).startsWith('firm-')) return (await import('../lib/firm-simulation-service.js')).firmAction(orgId, req.account, b);
      if (String(b.action).startsWith('sandbox-')) return (await import('../lib/audit-sandbox.js')).sandboxAction(orgId, req.account, b);
      // Keep what Shadow learnt when the firm is erased (2026-10-18): partners export / import its lessons and tests.
      if (b.action === 'lab-export') return (await import('../lib/shadow-transfer.js')).exportLab(who(req) || 'associé');
      if (b.action === 'lab-import') return (await import('../lib/shadow-transfer.js')).importLab(orgId, b.file, who(req) || 'associé');
      if (b.action === 'run') return s.shadowPass(orgId, { force: true, req });
      // Code proposals (2026-10-10): a branch + draft pull request; Shadow never merges nor deploys.
      if (b.action === 'code') return (await import('../lib/shadow-code.js')).requestCodeChange(orgId, req, { agent: b.agent, goal: b.goal }, who(req) || 'propriétaire');
      if (b.action === 'code-close') return (await import('../lib/shadow-code.js')).closeCodeProposal(orgId, { id: b.id, reason: b.reason }, who(req) || 'propriétaire');
      // An investigation (with a question: « pourquoi l'Orpailleur ne fait pas X ? ») or the filing exam now.
      if (b.action === 'investigate') { const { AGENT_GOALS } = await import('../lib/agent-goals.js'); if (!AGENT_GOALS[b.agent]) throw fail('UNKNOWN_AGENT', 400); await (await import('../lib/agent-passes.js')).fireInternal(req, '/api/app?route=shadow-investigate-step', { agent: b.agent, question: String(b.question || '').slice(0, 600) }); return { started: true }; }
      if (b.action === 'exam') { await (await import('../lib/agent-passes.js')).fireInternal(req, '/api/app?route=shadow-investigate-step', { exam: true }); return { started: true }; }
      // The open-source watch (2026-10-19): projects and forums of agents doing the same work → ideas waiting for a person.
      if (b.action === 'code-watch') { const { AGENT_GOALS } = await import('../lib/agent-goals.js'); if (!AGENT_GOALS[b.agent]) throw fail('UNKNOWN_AGENT', 400); await (await import('../lib/agent-passes.js')).fireInternal(req, '/api/app?route=shadow-investigate-step', { code_watch: b.agent }); return { started: true }; }
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
  // Permissions (2026-10-11): screens × roles and sensitive actions; the firm's lead adjusts the defaults.
  permissions: {
    GET: users([...EVERYONE], async (orgId, req) => (await import('../lib/permissions.js')).permissionsView(orgId, req.account)),
    POST: users([...FIRM_LEAD], async (orgId, req) => (await import('../lib/permissions.js')).savePermissions(orgId, req.body || {}, req.account)),
    unavailable: 'PERMISSIONS_UNAVAILABLE'
  },
  // The firm's methodology library (2026-10-12): its SOP read procedure by procedure (code, no AI).
  methodology: {
    GET: users(ALL_ROLES, async (orgId, req) => {
      const m = await import('../lib/methodology.js'); const state = await m.methodologyState({}, orgId);
      const file = String(req.query?.sop || '');
      if (file) { const s = (state.sops || []).find(x => x.file_id === file); if (!s) throw fail('SOP_NOT_FOUND', 404); return s; }
      return m.librarySummary(state);
    }),
    POST: users(MANAGERS, async (orgId, req) => (await import('../lib/methodology.js')).loadMethodology(orgId, req.body || {}, req.account)),
    unavailable: 'METHODOLOGY_UNAVAILABLE'
  },
  // The mission's work programme (2026-10-12): cycles and procedures chosen by the Manager from the firm's SOP.
  'work-programme': {
    GET: users(ALL_ROLES, async (orgId, req) => (await import('../lib/work-programme.js')).programmeView(orgId, String(req.query?.mission_id || ''), req.account)),
    POST: users(MANAGERS, async (orgId, req) => {
      const w = await import('../lib/work-programme.js'); const b = req.body || {}; const id = String(b.mission_id || '');
      if (b.action === 'save') return w.saveProgramme(orgId, id, b, req.account);
      if (b.action === 'validate') return w.validateProgramme(orgId, id, req.account, Object.hasOwn(b,'expected_programme_id') ? {expected:{id:b.expected_programme_id,updated_at:b.expected_updated_at}} : {});
      if (b.action === 'analyse') return w.planProgramme(orgId, id, b, req.account);
      if (b.action === 'publish') return w.publishProgramme(orgId, id, req.account);
      if (b.action === 'import') return w.importProgramme(orgId, id, b, req.account);
      if (b.action === 'workpapers') { await w.mayPrepareWorkpapers(orgId, id, req.account); return (await import('../lib/cycle-workpapers.js')).prepareCycleWorkpapers(orgId, id, req.account); }
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'WORK_PROGRAMME_UNAVAILABLE'
  },
  // « Ma procédure » (2026-10-12): a procedure of the validated programme worked by its preparer with the Enhanced Auditor.
  procedure: {
    GET: users(ALL_ROLES, async (orgId, req) => {
      const w = await import('../lib/procedure-work.js');
      if (req.query?.mine) return w.myProcedures(orgId, req.account);
      if (req.query?.reviews) return (await import('../lib/procedure-review.js')).myReviews(orgId, req.account);
      if (req.query?.review) return (await import('../lib/procedure-review.js')).reviewView(orgId, String(req.query?.mission_id || ''), String(req.query?.code || ''), req.account);
      return (await import('../lib/procedure-reading-report.js')).publicView(await w.procedureView(orgId, String(req.query?.mission_id || ''), String(req.query?.code || ''), req.account));
    }),
    POST: users(ALL_ROLES, async (orgId, req) => {
      const w = await import('../lib/procedure-work.js'); const b = req.body || {}; const m = String(b.mission_id || ''), c = String(b.code || ''), a = req.account;
      if (b.action === 'table-import-options') return (await import('../lib/workfile-table-import.js')).tableImportOptions(orgId,m,c,b,a);
      if (b.action === 'preview-table-import') return (await import('../lib/workfile-table-import.js')).previewTableImport(orgId,m,c,b,a);
      if (b.action === 'run-table-import') return (await import('../lib/workfile-table-import.js')).runTableImport(orgId,m,c,b,a);
      if (b.action === 'template-options') return (await import('../lib/procedure-template.js')).templateOptions(orgId,m,c,a);
      if (b.action === 'inspect-template') return (await import('../lib/procedure-template.js')).inspectTemplate(orgId,m,c,b,a);
      if (b.action === 'adopt-template') return (await import('../lib/procedure-template.js')).adoptTemplate(orgId,m,c,b,a);
      if (b.action === 'review-workpaper') return (await import('../lib/workpaper-dialogue.js')).reviewWorkpaper(orgId,m,c,b,a);
      if (b.action === 'reading-report') return (await import('../lib/procedure-reading-report.js')).readingReport(orgId,m,c,b,a);
      if (b.action === 'workspace-brief') return (await import('../lib/procedure-workspace.js')).workspaceBrief(orgId,m,c,a);
      if (b.action === 'workbook-view') return (await import('../lib/procedure-workspace.js')).workbookView(orgId, m, c, b, a);
      if (b.action === 'ask-procedure') return (await import('../lib/procedure-workspace.js')).askProcedure(orgId, m, c, b, a);
      // What this test needs, the zones to deposit each document, and the e-mail for the missing ones (2026-10-19).
      // The living working file (2026-10-19): the steps of the test, « J'ai compris », run by code, result in a separate sheet.
      // The map of the working file (2026-10-24): roles of sheets and columns read by code, never guessed; read only.
      if (b.action === 'workfile-map') return (await import('../lib/workfile-map-view.js')).workfileMapView(orgId, m, c, a, { sheet: b.sheet ? String(b.sheet) : null, offset: b.offset });
      if (b.action === 'workfile-cells') return (await import('../lib/workfile-map-view.js')).writeWorkfileCells(orgId, m, c, a, b);
      // The agent that helps fill (2026-10-24): what the application knows (proposed, written on « Oui »), the received pieces (reviewed, renamed).
      if (b.action === 'workfile-assist') return (await import('../lib/workfile-assist.js')).workfileAssist(orgId, m, c, a);
      if (b.action === 'workfile-fill-known') return (await import('../lib/workfile-assist.js')).fillKnown(orgId, m, c, a, b);
      if (b.action === 'workfile-import-candidates') return (await import('../lib/workfile-import-assist.js')).importCandidates(orgId, m, c, b, a);
      if (b.action === 'workfile-import-inspect') return (await import('../lib/workfile-import-assist.js')).inspectImportFile(orgId, m, c, b, a);
      if (b.action === 'workfile-import-finish') return (await import('../lib/workfile-import-assist.js')).finishImport(orgId, m, c, b, a);
      // Paths too long for Excel on Windows (2026-10-25): listed with a shorter name proposed, renamed only on « Oui, raccourcis ».
      if (b.action === 'workfile-long-paths') return (await import('../lib/path-repair.js')).missionLongPaths(orgId, m, c, a);
      if (b.action === 'workfile-shorten-paths') return (await import('../lib/path-repair.js')).shortenMissionPaths(orgId, m, c, a, b);
      // The Enhanced Auditor learns by watching the auditor fill the working file in Excel (2026-10-25).
      if (b.action === 'workfile-learn-start') return (await import('../lib/workfile-learn.js')).startWatch(orgId, m, c, b, a);
      if (b.action === 'workfile-learn-cancel') return (await import('../lib/workfile-learn.js')).cancelWatch(orgId, m, c, b, a);
      if (b.action === 'workfile-learn') return (await import('../lib/workfile-learn.js')).learnFromPerson(orgId, m, c, b, a);
      if (b.action === 'workfile-learn-confirm') return (await import('../lib/workfile-learn.js')).confirmLesson(orgId, m, c, b, a);
      if (b.action === 'workfile-clear-sheet') return (await import('../lib/workfile-map-view.js')).clearSheetWork(orgId, m, c, a, b);
      // The pieces the working file needs and where they are in the mission's memory (2026-10-25).
      if (b.action === 'workfile-sheet-plan') return (await import('../lib/fill-orders.js')).fillOrdersPlan(orgId, m, c, b, a);   // l'IA donne les ordres, le code exécute (2026-10-26)
      if (b.action === 'workfile-sheet-plan-accept') return (await import('../lib/fill-orders.js')).acceptFillOrders(orgId, m, c, b, a);
      // (2026-10-26) A person says what a piece really is: kept on the piece and learned by the firm (lib/piece-profile.js).
      if (b.action === 'piece-profile-correct') { const v = await (await import('../lib/procedure-work.js')).procedureView(orgId, m, c, a); if (!v?.editable) throw Object.assign(new Error('PROCEDURE_NOT_EDITABLE'), { status: 403 }); return (await import('../lib/piece-profile.js')).correctProfile(orgId, m, b, a); }
      if (b.action === 'workfile-needs') return (await import('../lib/workfile-needs.js')).workfileNeeds(orgId, m, c, a);
      if (b.action === 'workfile-need-link') return (await import('../lib/workfile-needs.js')).linkNeed(orgId, m, c, b, a);
      // The person's choice of piece for a sheet, and a PDF turned into a verified table (2026-10-25).
      if (b.action === 'workfile-designate') return (await import('../lib/workfile-sources.js')).designateSource(orgId, m, c, b, a);
      if (b.action === 'workfile-pdf-extract') return (await import('../lib/workfile-sources.js')).extractPdfTable(orgId, m, c, b, a);
      if (b.action === 'workfile-import-undo') return (await import('../lib/workfile-undo.js')).undoImport(orgId, m, c, b, a);
      if (b.action === 'workfile-import-propose') return (await import('../lib/workfile-import-assist.js')).proposeImport(orgId, m, c, b, a);
      if (b.action === 'workfile-import-accept') return (await import('../lib/workfile-import-assist.js')).acceptImport(orgId, m, c, b, a);
      if (b.action === 'workfile-review-pieces') return (await import('../lib/workfile-assist.js')).reviewPieces(orgId, req, m, c, a);
      if (b.action === 'steps') return (await import('../lib/step-runner.js')).stepsView(orgId, m, c, a);
      if (b.action === 'step-plan') return (await import('../lib/step-runner.js')).planStep(orgId, m, c, b, a);
      if (b.action === 'step-run') return (await import('../lib/step-runner.js')).runStep(orgId, m, c, b, a);
      if (b.action === 'pipeline-plan') return (await import('../lib/audit-pipeline.js')).planPipeline(orgId, m, c, b, a);
      if (b.action === 'pipeline-write') return (await import('../lib/audit-pipeline.js')).writePipeline(orgId, m, c, b, a);
      if (['needs', 'need-piece', 'need-request'].includes(b.action)) await requireMissionAccess(orgId, m, a);
      if (b.action === 'needs') return (await import('../lib/procedure-needs.js')).procedureNeeds(orgId, m, c, a);
      if (b.action === 'need-piece') return (await import('../lib/procedure-needs.js')).depositForNeed(orgId, m, c, b, a, req);
      if (b.action === 'need-request') return (await import('../lib/procedure-needs.js')).requestForNeeds(orgId, m, c, b, a);
      if (b.action === 'population-preview') return w.populationPreview(orgId, m, c, b, a);
      if (b.action === 'population') return w.setPopulation(orgId, m, c, b, a);
      if (b.action === 'sample') return w.drawSample(orgId, m, c, b, a);
      if (b.action === 'evidence') return w.addEvidence(orgId, m, c, b, a);
      if (b.action === 'brain-plan') return (await import('../lib/enhanced-auditor-execution.js')).prepareProcedureBrain(orgId, m, c, a);
      if (b.action === 'ai') return w.aiProposal(orgId, m, c, b, a);
      if (b.action === 'item') return w.recordItem(orgId, m, c, b, a);
      if (b.action === 'conclusion') return w.saveConclusion(orgId, m, c, b, a);
      if (b.action === 'write-wp') return w.writeWorkpaper(orgId, m, c, a);
      if (b.action === 'submit') return w.submitProcedure(orgId, m, c, a);
      const r = await import('../lib/procedure-review.js');
      if (b.action === 'review-ai') return r.aiReview(orgId, m, c, a);
      if (b.action === 'return') return r.returnToPreparer(orgId, m, c, b, a);
      if (b.action === 'answer-point') return r.answerPoint(orgId, m, c, b, a);
      if (b.action === 'clear-point') return r.clearPoint(orgId, m, c, b, a);
      if (b.action === 'sign') return r.signOff(orgId, m, c, a);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'PROCEDURE_UNAVAILABLE'
  },
  // The secretariat (2026-10-12): the firm's document models, documents prepared for an opportunity or a mission,
  // CVs (specialists, CVs adapted to the TDR, MI + CVs in one PDF), approval, sending recorded with its proof.
  secretariat: {
    GET: users(ALL_ROLES, async (orgId, req) => (await import('../lib/secretariat.js')).secretariatView(orgId, req.account)),
    POST: users(ALL_ROLES, async (orgId, req) => {
      const b = req.body || {}, a = req.account;
      const T = () => import('../lib/doc-templates.js'), C = () => import('../lib/cv-bank.js'), S = () => import('../lib/secretariat.js');
      if (['locate-document', 'confirm-document', 'unavailable-document', 'upload-reference'].includes(b.action)) {
        if (!['owner', 'partner', 'manager', 'supervisor', 'bdm', 'secretary'].includes(a.role)) throw fail('ROLE_NOT_ALLOWED', 403);
        if (b.mission_id) await requireMissionAccess(orgId, b.mission_id, a);
        const index = await import('../lib/file-index.js');
        if (b.action === 'upload-reference') return index.uploadDocumentReference(orgId, b, a);
        if (b.action === 'unavailable-document') return index.confirmDocumentUnavailable(orgId, b, a);
        const done = b.action === 'locate-document' ? await index.locateRequiredDocument(orgId, b) : await index.confirmDocumentReference(orgId, b, a);
        // The missing place or model is now given: the direct missions waiting for it are prepared again (2026-10-19).
        if (b.action === 'confirm-document' && ['mission_root', 'mission_structure'].includes(b.document_type))
          done.resumed = await (await import('../lib/mission-quick.js')).resumeDirectMissions(orgId, req, a).catch(e => ({ error: String(e.message || e).slice(0, 120) }));
        return done;
      }
      // A PBC list recognised by its content: the person confirms once, or says it is not one (lib/pbc-lists.js).
      if (b.action === 'pbc-list-decide') {
        if (b.mission_id) await requireMissionAccess(orgId, b.mission_id, a);
        return (await import('../lib/pbc-lists.js')).decidePbcList(orgId, b, a);
      }
      if (b.action === 'upload-template') return (await T()).uploadTemplate(orgId, b, a);
      if (b.action === 'register-reference-template') return (await T()).registerTemplateReference(orgId, b, a);
      if (b.action === 'prepare') return (await T()).prepareValues(orgId, b, a);
      if (b.action === 'methodology-draft') return (await T()).rewriteMethodology(orgId, b, a);
      if (b.action === 'create-document') return (await T()).createDocument(orgId, b, a);
      if (b.action === 'specialist-cv') return (await C()).uploadSpecialistCv(orgId, b, a);
      if (b.action === 'adapted-cv') return (await C()).adaptedCv(orgId, b, a);
      if (b.action === 'package') return (await C()).packagePdf(orgId, b, a);
      if (b.action === 'approve') return (await S()).approveDocument(orgId, b, a);
      if (b.action === 'send') return (await S()).recordSending(orgId, b, a);
      if (b.action === 'settings') return (await S()).saveSecretariatSettings(orgId, b, a);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'SECRETARIAT_UNAVAILABLE'
  },
  // Tender watch (2026-10-11): the daily desk sends the tenders to the BDM and the partners; a partner
  // decides; the BDM obtains the TDR, creates the opportunity, records the submission and the result.
  tenders: {
    GET: users([...BUSINESS_DEV], async (orgId, req) => (await import('../lib/tender-watch.js')).tendersView(orgId, req.account)),
    POST: users([...BUSINESS_DEV], async (orgId, req) => {
      const t = await import('../lib/tender-watch.js'); const b = req.body || {}; const a = b.action;
      if (a === 'run') return t.startTenderWatch(orgId, req, { force: true, by: who(req) });
      if (a === 'decide') return t.decideTender(orgId, b, req.account);
      if (a === 'tdr') return t.markTdr(orgId, b, req.account);
      if (a === 'submitted') return t.recordSubmission(orgId, b, req.account);
      if (a === 'result') return t.recordResult(orgId, req, b, req.account);
      if (a === 'review-decide') { if (!SHADOW_VIEWERS.includes(req.account?.role)) throw fail('ROLE_NOT_ALLOWED', 403); return t.decideLossReview(orgId, b, req.account); }
      if (a === 'review-run') { if (!SHADOW_VIEWERS.includes(req.account?.role)) throw fail('ROLE_NOT_ALLOWED', 403); return t.reviewLoss(orgId, String(b.id || '')); }
      if (a === 'settings') return t.saveWatchSettings(orgId, b, req.account);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'TENDERS_UNAVAILABLE'
  },
  // Analytical review before the programme (moved from api/analytical-review.js to stay within 12 functions).
  'analytical-review': {
    GET: users([...EVERYONE], async (orgId, req) => (await import('../lib/analytical-review.js')).analyticalReviewContext(orgId, String(req.query?.mission_id || ''), req.account)),
    POST: users([...EVERYONE], async (orgId, req) => {
      const a = await import('../lib/analytical-review.js'); const body = req.body || {}, action = String(body.action || ''), missionId = String(body.mission_id || ''), account = req.account;
      if (action === 'choose-manager') return a.chooseAnalyticalManager(orgId, missionId, String(body.candidate_id || body.assignment_id || ''), account, {}, { planned_start: body.planned_start, planned_end: body.planned_end });
      if (action === 'organize-file') return a.organizeAnalyticalFile(orgId, missionId, String(body.file_id || ''), body.kind === 'review' ? 'review' : 'source', account);
      if (action === 'import-review') return a.importAnalyticalReview(orgId, missionId, String(body.file_id || ''), account);
      if (action === 'stage-files') return a.stageAnalyticalFiles(orgId, missionId, Array.isArray(body.file_ids) ? body.file_ids : [], account);
      if (action === 'delete-file') return a.deleteAnalyticalFile(orgId, missionId, String(body.file_id || ''), account);
      if (action === 'refresh-lab') return a.refreshEynowaKnowledge(orgId, missionId, account);
      if (action === 'start') return a.startAnalyticalReview(orgId, req, missionId, account);
      if (action === 'finalize') return a.finalizeAnalyticalReview(orgId, missionId, account);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'ANALYTICAL_REVIEW_UNAVAILABLE'
  },
  // Tool gateway diagnostic (moved from api/tool-gateway.js): never returns service URLs or credentials.
  'tool-gateway': {
    GET: async () => {
      const t = await import('../lib/tool-gateway.js');
      const health = await t.toolGatewayHealth(), config = t.toolGatewayConfig();
      return { ...health, configured: { ollama: Boolean(config.ollama), doctr: Boolean(config.doctr), gotenberg: Boolean(config.gotenberg), chroma: Boolean(config.chroma), meilisearch: Boolean(config.meilisearch), n8n: Boolean(config.n8n) }, note: 'Diagnostic endpoint only. Existing agents are not wired to the gateway yet.' };
    },
    unavailable: 'TOOL_GATEWAY_UNAVAILABLE'
  },
  // Several firms in one installation (2026-10-24): my firms, create one, join by invitation; administrators invite.
  // Signed-in identity only (a newcomer belongs to no firm yet); inviting needs an administrator of the firm.
  cabinets: {
    GET: open(async (orgId, req) => {
      // The personal session only (a person without a firm never holds the shared pilot token).
      if (!multiCabinet()) throw fail('CABINETS_NOT_ENABLED', 503);
      const c = await import('../lib/cabinet-onboarding.js'), u = await import('../lib/user-auth.js');
      if (req.query?.view === 'invitations') return { invitations: await c.listInvitations(orgId, await u.currentAccount(req, { orgId })) };
      return { cabinets: await c.myCabinets(await u.sessionUser(req)), current: orgId };
    }),
    POST: open(async (orgId, req) => {
      if (!multiCabinet()) throw fail('CABINETS_NOT_ENABLED', 503);
      const c = await import('../lib/cabinet-onboarding.js'), u = await import('../lib/user-auth.js');
      const b = req.body || {}, action = String(b.action || '');
      if (action === 'create') return c.createCabinet(await u.sessionUser(req), b);
      if (action === 'join') return c.acceptInvitation(await u.sessionUser(req), b);
      if (action === 'invite') return c.createInvitation(orgId, await u.currentAccount(req, { orgId }), b);
      if (action === 'revoke') return c.revokeInvitation(orgId, await u.currentAccount(req, { orgId }), String(b.id || ''));
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'CABINETS_UNAVAILABLE'
  },
  'tender-step': { POST: async (orgId, req) => (await import('../lib/tender-watch.js')).tenderStep(orgId, req, req.body || {}), unavailable: 'TENDERS_UNAVAILABLE' },
  'shadow-code-step': { POST: async (orgId, req) => (await import('../lib/shadow-code.js')).codeStep(orgId, req, req.body || {}), unavailable: 'SHADOW_UNAVAILABLE' },
  // Shadow's background investigations and exams (2026-10-11).
  'shadow-investigate-step': { POST: async (orgId, req) => (await import('../lib/shadow-investigate.js')).investigateStep(orgId, req, req.body || {}), unavailable: 'SHADOW_UNAVAILABLE' },
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
  // Several firms: one scheduler call runs the due passes of EVERY firm, each in its own context (its Google, its Drive).
  'scheduler-tick': { POST: open(async (orgId, req) => {
    if (!multiCabinet()) return tick(orgId, req);
    (await import('../lib/agent-passes.js')).requireSchedulerSecret(req);
    const firms = await rest('office_organizations?select=id&order=created_at.asc&limit=1000') || [];
    const results = [];
    for (const f of firms) results.push(await runInFirm(f.id, async () => {
      await loadGoogleConnection(f.id).catch(() => null);
      return tick(f.id, req).then(r => ({ org_id: f.id, ...r }), e => ({ org_id: f.id, error: String(e.message || e).slice(0, 200) }));
    }));
    return { firms: results.length, results };
  }), unavailable: 'SCHEDULER_UNAVAILABLE' },
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
    // Whose indicators: everybody for owners and partners; for a manager or a supervisor, the people who
    // report to them directly (when the firm allows it) and themselves.
    GET: users(MANAGERS, async (orgId, req) => {
      await logAccess(orgId, req.account, 'view_team_kpi'); await (await import('../lib/people-sync.js')).syncStaffFromUsers(orgId).catch(() => null);
      const k = await teamKpis(orgId); const seen = await visiblePeople(orgId, req.account);
      if (!seen) return k;
      const people = k.people.filter(p => seen.has(String(p.email || '').toLowerCase()));
      return { ...k, people, scope: 'direct_reports', team: { ...k.team, people: people.length, overloaded: people.filter(p => p.load_pct > 100).length } };
    }),
    unavailable: 'KPI_UNAVAILABLE'
  },
  'my-kpi': {
    GET: users([...EVERYONE], (orgId, req) => myKpis(orgId, req.account)),
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
      // Folders the Drive refuses: a person decides to continue without them (or to walk them again).
      const by = req.account?.email || (req.body?.approved_by ? 'propriétaire — ' + String(req.body.approved_by).slice(0, 80) : null);
      if (req.body?.action === 'mapping-exclude-blocked') return excludeBlockedFolders(orgId, req, { folderIds: req.body.folder_ids, by });
      if (req.body?.action === 'mapping-include') return includeFolder(orgId, { folderId: req.body.folder_id, by });
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'READINESS_UNAVAILABLE'
  },
  // Accounts: owner, partners and the IT administrator (personal session); each one acts as itself
  // (only an owner makes an owner; the IT administrator never touches the partners' accounts).
  users: {
    GET: users([...ACCOUNT_ADMINS], async (orgId) => ({ ...(await listAccounts(orgId)), role_labels: ROLE_LABELS })),
    POST: users([...ACCOUNT_ADMINS], async (orgId, req) => { await logAccess(orgId, req.account, 'manage_account', String(req.body?.auth_user_id || req.body?.email || '')).catch(() => null); return manageAccount(orgId, req.body || {}, { actor: req.account }); }),
    unavailable: 'USERS_UNAVAILABLE'
  },
  // The firm's settings for people (e.g. managers see the performance of their direct reports).
  'firm-settings': {
    GET: users([...EVERYONE], (orgId) => firmSettings(orgId)),
    POST: users(PARTNERS, (orgId, req) => saveFirmSettings(orgId, req.body || {}, who(req))),
    unavailable: 'SETTINGS_UNAVAILABLE'
  },
  // Firm Manager: roles and positions proposed from the firm's team sheet (a person confirms them).
  'team-roles': {
    GET: users([...ACCOUNT_ADMINS], async (orgId) => (await import('../lib/team-roles.js')).proposeTeamRoles(orgId)),
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
      if (req.body?.action === 'tidy-stop') return stopTidy(orgId, req.account?.display_name || req.account?.email || req.body?.by || 'propriétaire');
      if (req.body?.action === 'dedupe') return dedupeMissions(orgId, { ai: true, loadKnowledge: firmKnowledge });
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'KNOWLEDGE_UNAVAILABLE'
  },
  // Understanding the firm, then (same first scan) where every file goes.
  'firm-learn': { POST: async (orgId, req) => { const k = await learnFirm(orgId); if (req.body?.skip_tidy !== true) await startTidyPlan(orgId, req).catch(() => null); return k; }, unavailable: 'KNOWLEDGE_UNAVAILABLE' },
  // The settings wheel: close one's own account (typed e-mail), the interface in English.
  // A space closed earlier: its former owner restarts it from zero (identity re-checked, « EFFACER » typed).
  // The connected owner starts again from zero (everything erased but their login), typed « EFFACER ».
  'firm-reset': { POST: users(['owner'], (orgId, req) => resetFirm(orgId, req.account, req.body || {})), unavailable: 'ACCOUNTS_UNAVAILABLE' },
  'firm-restart': { POST: open((orgId, req) => restartFirm(orgId, req.body || {})), unavailable: 'ACCOUNTS_UNAVAILABLE' },
  'close-account': { POST: users([...EVERYONE], (orgId, req) => closeOwnAccount(orgId, req.account, req.body || {})), unavailable: 'ACCOUNTS_UNAVAILABLE' },
  translate: { POST: users([...EVERYONE], (orgId, req) => translateTexts(req.body || {})), unavailable: 'TRANSLATION_UNAVAILABLE' },
  // ---- 2026-10-08: capabilities, engagement preparation, submissions, Enhanced Auditor ----
  // Which AI providers are configured (keys in Vercel; nothing secret returned).
  'ai-providers': { GET: users(ALL_ROLES, async (orgId) => ({ ...providersStatus(), availability: await (await import('../lib/ai-pool.js')).poolStatus((await import('../lib/ai-providers.js')).providerOrder(null), { orgId }) })), POST: users(ACCOUNT_ADMINS, async (orgId,req)=>(await import('../lib/provider-diagnostics.js')).checkProvider(req.body?.provider)), unavailable: 'AI_UNAVAILABLE' },
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
      if (req.query?.settings) return o.opportunitySettingsView(orgId);
      if (req.query?.mission_id) { await requireMissionAccess(orgId, String(req.query.mission_id), req.account); return o.opportunityForMission(orgId, String(req.query.mission_id)); }
      return req.query?.id ? o.opportunityView(orgId, String(req.query.id), req.account) : o.listOpportunities(orgId);
    }),
    POST: users(ALL_ROLES, async (orgId, req) => {
      const o = await import('../lib/opportunities.js'); const b = req.body || {}; const a = b.action;
      if (a === 'create') return o.createOpportunity(orgId, req, b, req.account);
      if (a === 'upload-start') return o.startTdrUpload(orgId, b, req);
      if (a === 'answer') return o.answerRow(orgId, b, req.account, { req });
      if (a === 'answer-rows') return o.answerRows(orgId, b, req.account, { req });
      if (a === 'review-section') return o.reviewSection(orgId, b, req.account);
      if (a === 'prepare-again') return o.prepareAgain(orgId, req, b, req.account);
      if (a === 'settings') return o.saveOpportunitySettings(orgId, b, req.account);
      if (a === 'remove') return o.removeOpportunity(orgId, b, req.account, { req });
      if (a === 'not-duplicate') return o.notDuplicate(orgId, req, b, req.account);
      if (a === 'propose-team') { if (!MANAGERS.includes(req.account?.role)) throw fail('MANAGERS_ONLY', 403); return o.proposeTeam(orgId, req, b); }
      if (a === 'validate-team') return o.validateTeam(orgId, b, req.account, { req });
      if (a === 'find-specialists') return o.findSpecialists(orgId, b, req.account);
      if (['independence-decide','independence-applied','independence-override','independence-prohibit'].includes(a)) return o.independenceReviewAction(orgId,b,req.account);
      if (a === 'declare') return o.declareIndependence(orgId, b, req.account);
      if (a === 'declaration-draft') return o.saveDeclarationDraft(orgId, b, req.account);
      if (a === 'won') { if (!PARTNERS.concat('manager').includes(req.account?.role)) throw fail('MANAGERS_ONLY', 403); return o.markWon(orgId, req, b, req.account); }
      if (a === 'kyc-prepare') return o.prepareKyc(orgId, req, b, req.account);
      if (a === 'reception-date') return o.setReceptionDate(orgId, b, req.account);
      if (a === 'owner-override') return o.ownerWorkflowOverride(orgId, b, req.account, { req });
      if (a === 'transmit-documents') return o.requestOpportunityHandoff(orgId, req, b, req.account);
      if (a === 'prepare-mission-files') return o.requestMissionWorkspace(orgId, req, b, req.account);
      if (a === 'assign-kyc') return o.assignKyc(orgId, b, req.account, { req });
      if (a === 'commercial') return o.commercialAction(orgId, b, req.account, { req });
      if (a === 'parallel-kyc') return o.prepareParallelKyc(orgId, req, b, req.account);
      if (a === 'prepare-quotation') return o.prepareOpportunityQuotation(orgId, b, req.account);
      if (a === 'confirm-agreement') return o.confirmEngagementAgreement(orgId, b, req.account);
      if (a === 'accept-existing-kyc') return o.acceptExistingKyc(orgId, b, req.account);
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
  'opportunity-quotation-step': { POST: async (orgId, req) => (await import('../lib/opportunities.js')).quotationStep(orgId, req.body || {}), unavailable: 'OPPORTUNITIES_UNAVAILABLE' },
  'opportunity-commercial-step': { POST: async (orgId, req) => (await import('../lib/opportunities.js')).commercialDocumentStep(orgId, req.body || {}), unavailable: 'OPPORTUNITIES_UNAVAILABLE' },
  'opportunity-handoff-step': { POST: async (orgId, req) => (await import('../lib/opportunities.js')).opportunityHandoffStep(orgId, req, req.body || {}), unavailable: 'OPPORTUNITIES_UNAVAILABLE' },
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
  // Work files in Excel (Office Manager panel): sessions, review remarks, files left open.
  workfile: {
    GET: users(ALL_ROLES, (orgId, req) => req.query?.mine ? myWorkfileActions(orgId, req.account) : listRemarks(orgId, req.query || {})),
    POST: users(ALL_ROLES, (orgId, req) => {
      const b = req.body || {}, a = b.action;
      if (a === 'start') return startSession(orgId, req.account, b);
      if (a === 'beat') return beat(orgId, req.account, b);
      if (a === 'end') return endSession(orgId, b);
      if (a === 'review') return reviewWorkbook(orgId, req.account, b);
      if (a === 'remark') return updateRemark(orgId, req.account, b);
      if (a === 'decide') return decideWorkfileAction(orgId, req.account, b);
      // Learning from the auditor, from inside Excel: the procedures that work in this file (2026-10-25).
      if (a === 'learn-procedures') return import('../lib/workfile-learn.js').then(m => m.proceduresForFile(orgId, b, req.account));
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'WORKFILE_UNAVAILABLE'
  },
  'workfile-kpi': { GET: users(MANAGERS, async (orgId, req) => { await logAccess(orgId, req.account, 'view_workfile_kpi'); return workfileKpis(orgId); }), unavailable: 'WORKFILE_UNAVAILABLE' },
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
  // The questions that pop up on any page for the person signed in (independence, agents' questions, decision).
  'my-questions': { GET: users(ALL_ROLES, async (orgId, req) => {
    const out = await (await import('../lib/opportunities.js')).myQuestions(orgId, req.account, {independenceOnly:req.query?.independence_only==='1'}).catch(() => ({ questions: [] }));
    if (req.query?.independence_only === '1') return out;
    // « Ta procédure t'attend » (2026-10-12): the procedures of the validated programmes this person prepares.
    const mine = await (await import('../lib/procedure-work.js')).myProcedures(orgId, req.account).catch(() => ({ procedures: [] }));
    for (const p of mine.procedures.filter(x => ['to_do', 'in_progress', 'returned'].includes(x.status)).slice(0, 5)) out.questions.push({ id: 'proc|' + p.programme_id + '|' + p.code, kind: 'procedure', title: p.mission_name,
      question: (p.status === 'returned' ? 'Procédure renvoyée par la revue : ' : p.status === 'in_progress' ? 'Procédure en cours : ' : 'Votre procédure vous attend : ') + p.code + ' — ' + p.title, context: p.cycle_code + ' · ' + (p.cycle_title || ''),
      href: '/procedure.html?mission_id=' + encodeURIComponent(p.mission_id) + '&code=' + encodeURIComponent(p.code) });
    const rv = await (await import('../lib/procedure-review.js')).myReviews(orgId, req.account).catch(() => ({ reviews: [] }));
    for (const x of rv.reviews.slice(0, 5)) out.questions.push({ id: 'rev|' + x.mission_id + '|' + x.code + '|' + x.level, kind: 'procedure', title: x.mission_name,
      question: 'Revue ' + ({ senior: 'Senior', manager: 'Manager', supervisor: 'Superviseur', partner: 'Associé' }[x.level] || '') + ' à faire : ' + x.code, context: x.cycle_code + ' · préparée par ' + (x.preparer || '?'),
      href: '/procedure.html?mission_id=' + encodeURIComponent(x.mission_id) + '&code=' + encodeURIComponent(x.code) + '#revue' });
    // A PBC list recognised by its content, whatever its name (2026-10-18): confirmed once by someone of the mission.
    const toConfirm = ['owner', 'partner', 'quality_reviewer', 'manager', 'supervisor', 'senior', 'auditor'].includes(req.account?.role)
      ? await (await import('../lib/pbc-lists.js')).pbcListsToConfirm().catch(() => []) : [];
    for (const l of toConfirm.slice(0, 3)) {
      if (l.mission_id) { try { await requireMissionAccess(orgId, l.mission_id, req.account); } catch { continue; } }
      else if (req.account.role === 'auditor') continue;
      out.questions.push({ id: 'pbc-list|' + l.file_id + '|' + (l.version || ''), kind: 'pbc_list', title: 'Liste PBC reconnue par son contenu',
        question: 'Ce fichier est-il bien une liste PBC (les pièces demandées au client) ?', file_id: l.file_id, mission_id: l.mission_id || null,
        context: (l.path || l.name || l.file_id) + ' · certitude ' + l.confidence + ' % · ' + (l.evidence || []).slice(0, 2).join(' · '),
        href: /^local:/.test(l.file_id) ? null : 'https://drive.google.com/open?id=' + encodeURIComponent(l.file_id) });
    }
    // First connection (2026-10-17): the agents' questions that fit this person's position, answered on « Faire connaissance ».
    const intro = await (await import('../lib/agent-intro.js')).personView(orgId, req.account).catch(() => null);
    if (intro?.pending?.length) out.questions.push({ id: 'intro|' + intro.pending[0].key, kind: 'procedure', title: 'Faire connaissance avec les agents', question: 'Les agents ont ' + intro.pending.length + ' question(s) pour vous, adaptées à votre poste.', context: 'Une question à la fois, quelques secondes.', href: '/bienvenue.html' });
    return out;
  }), unavailable: 'OPPORTUNITIES_UNAVAILABLE' },
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
    GET: users(MANAGERS, async (orgId, req) => {
      await logAccess(orgId, req.account, 'view_management_card', String(req.query?.staff_id || '')).catch(() => null);
      const seen = await visiblePeople(orgId, req.account);
      if (seen) {
        const [p] = await rest('office_staff_profiles?org_id=eq.' + encodeURIComponent(orgId) + '&id=eq.' + encodeURIComponent(String(req.query?.staff_id || '')) + '&select=email&limit=1').catch(() => []) || [];
        if (!p || !seen.has(String(p.email || '').toLowerCase())) throw fail('NOT_YOUR_DIRECT_REPORT', 403);
      }
      return managementCard(orgId, String(req.query?.staff_id || ''));
    }),
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
    GET: users(ALL_ROLES, (orgId, req) => req.query?.live === '1' ? collaboration(orgId, req.account) : chatState(orgId, req.account, { conversation: req.query?.conversation || 'cabinet', archive: req.query?.archive === '1' })),
    POST: users(ALL_ROLES, (orgId, req) => ['heartbeat', 'read'].includes(req.body?.action) ? collaboration(orgId, req.account, req.body) : req.body?.action === 'group' ? createGroup(orgId, req.account, req.body) : sendChat(orgId, req.account, req.body || {})),
    unavailable: 'CHAT_UNAVAILABLE'
  },
  // Give an action to a person (« Sans responsable », or right after validating it).
  'assign-action': { POST: users(MANAGERS, (orgId, req) => assignAction(orgId, String(req.body?.id || ''), String(req.body?.staff_profile_id || ''), who(req))), unavailable: 'ACTIONS_UNAVAILABLE' },
  // The mission file (2026-10-08): everything the agents and the team know about one mission.
  'mission-file': { GET: users(ALL_ROLES, (orgId, req) => getMissionFull(orgId, String(req.query?.mission_id || ''))), unavailable: 'MISSION_UNAVAILABLE' },
  // Direct mission creation (2026-10-19): a name and a client, the mission exists « En cours » with its creator on the
  // team; acceptance, independence and the engagement letter stay open items to complete later (never blocking).
  'mission-quick': {
    GET: users(ALL_ROLES, async (orgId, req) => { const id = String(req.query?.mission_id || ''); await requireMissionAccess(orgId, id, req.account);
      const m = await import('../lib/mission-quick.js');
      return req.query?.view === 'tests' ? m.testsView(orgId, id, req.account) : m.missionFollowups(orgId, id); }),
    POST: users(ALL_ROLES, async (orgId, req) => {
      const b = req.body || {}, m = await import('../lib/mission-quick.js');
      if (b.action === 'create') return m.createMissionQuick(orgId, b, req.account, { req });
      // Everything below acts on one mission: the person must be on it (owner / partner: all).
      if (['prepare', 'piece', 'piece-start', 'pieces-done', 'tests-start'].includes(b.action)) await requireMissionAccess(orgId, String(b.mission_id || ''), req.account);
      if (b.action === 'memory-sync') {
        await requireMissionAccess(orgId,String(b.mission_id || ''),req.account);
        return m.syncSharedMissionMemory(orgId,req,String(b.mission_id || ''));
      }
      if (b.action === 'reconcile-documents') {
        await requireMissionAccess(orgId,String(b.mission_id || ''),req.account);
        return m.reconcileMissionDocuments(orgId,req,String(b.mission_id || ''),req.account);
      }
      if (b.action === 'prepare') return m.prepareDirectMission(orgId, req, String(b.mission_id || ''), req.account);
      if (b.action === 'piece') return m.uploadPiece(orgId, b, req.account);
      if (b.action === 'piece-start') return m.startPieceUpload(orgId, b, req.account, req);
      if (b.action === 'pieces-done') return m.piecesReceived(orgId, req, b, req.account);
      if (b.action === 'tests-start') return m.quickStartTests(orgId, String(b.mission_id || ''), b, req.account);
      if (b.action === 'followup') { await requireMissionAccess(orgId, String(b.mission_id || ''), req.account); return m.setFollowup(orgId, b, req.account); }
      if (b.action === 'folder') { await requireMissionAccess(orgId, String(b.mission_id || ''), req.account); const r = await m.setMissionFolder(orgId, b, req.account);
        return { ...r, workspace: await m.requestDirectWorkspace(orgId, req, String(b.mission_id), req.account).catch(e => ({ status: 'failed', error: String(e.message || e).slice(0, 120) })) }; }
      if (b.action === 'details') { await requireMissionAccess(orgId, String(b.mission_id || ''), req.account); return m.setMissionDetails(orgId, b, req.account); }
      if (b.action === 'dates') { await requireMissionAccess(orgId, String(b.mission_id || ''), req.account); return m.setMissionDates(orgId, b, req.account); }
      // The function of a person on THIS mission (manager here, supervisor elsewhere): partner, or the mission's manager / partner.
      if (b.action === 'function') { await requireMissionAccess(orgId, String(b.mission_id || ''), req.account); return (await import('../lib/mission-function.js')).setMissionFunction(orgId, b, req.account); }
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'MISSION_UNAVAILABLE'
  },
  // The firm's workflow (point 1, 2026-10-19): one per mission type, versioned; a partner confirms; missions follow it.
  //   GET  workflow                         every type: confirmed version, draft, history (everyone in the firm reads it)
  //   GET  workflow&mission_id=…            the mission's workflow, its current step and who acts
  //   POST workflow {action: save | confirm | propose}   a partner: draft, confirmation, proposal read from the firm's document
  //   POST workflow {action: advance, mission_id, outcome, reason?}   the outcome of the current step (gates: reason, traced)
  workflow: {
    GET: users(ALL_ROLES, async (orgId, req) => {
      const m = await import('../lib/firm-workflow.js'), id = String(req.query?.mission_id || '');
      // Accueil: the steps waiting for me, and (managers / partners) the steps stuck on my missions.
      if (req.query?.view === 'overview') { const o = await m.workflowOverview(orgId, req.account);
        return { ...o, mine: o.items.filter(x => x.mine), stuck: o.items.filter(x => x.stuck && x.lead), items: undefined }; }
      if (!id) return m.listWorkflows(orgId, req.account);
      await requireMissionAccess(orgId, id, req.account);
      const v = await m.missionWorkflow(orgId, id, req.account);
      const step = v.workflow?.steps.find(s => s.id === v.workflow.current);
      const o = step ? (await m.workflowOverview(orgId, req.account, { missionIds: [id] }).catch(() => ({ items: [] }))).items[0] || null : null;
      return { workflow: v.workflow, waiting: o ? { since: o.since, days: o.days, stuck: o.stuck, waiting_for: o.waiting_for } : null,
        me: step ? { may_act: !m.mayActOnStep(req.account, step, v.team), why_not: m.mayActOnStep(req.account, step, v.team), mine: m.isMyStep(req.account, step, v.team) } : null };
    }),
    POST: users(ALL_ROLES, async (orgId, req) => {
      const b = req.body || {}, m = await import('../lib/firm-workflow.js');
      if (b.action === 'save') return m.saveWorkflowDraft(orgId, b, req.account);
      if (b.action === 'confirm') return m.confirmWorkflow(orgId, b, req.account);
      if (b.action === 'propose') return m.proposeFromDocument(orgId, b, req.account);
      if (b.action === 'advance') { await requireMissionAccess(orgId, String(b.mission_id || ''), req.account); return m.advanceMission(orgId, b, req.account); }
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'WORKFLOW_UNAVAILABLE'
  },
  // Background step of the Mission Controller: the structure of a directly created mission from the firm's model.
  'mission-quick-step': { POST: async (orgId, req) => { const m=await import('../lib/mission-quick.js'); return req.body?.kind==='mission-memory-sync'?m.syncSharedMissionMemory(orgId,req,String(req.body.mission_id || '')):m.directWorkspaceStep(orgId,req.body || {}); }, unavailable: 'MISSION_UNAVAILABLE' },
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
  'mission-fact': { POST: users(ALL_ROLES, async (orgId, req) => { const mid=String(req.body?.mission_id || ''); await requireMissionAccess(orgId,mid,req.account); return addFact(mid,{...(req.body || {}),agent:who(req)},{orgId}); }), unavailable: 'MISSION_UNAVAILABLE' },
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
  // The missing-documents loop of a mission (point 7, 2026-10-19): one register, need → request → reply → control → filed.
  //   GET  pbc&mission_id=…                         the register (and the sending decided since)
  //   POST pbc {action: plan | existing | request | decide, mission_id, …}
  pbc: {
    GET: users(ALL_ROLES, async (orgId, req) => { const id = String(req.query?.mission_id || ''); await requireMissionAccess(orgId, id, req.account);
      return (await import('../lib/pbc-loop.js')).pbcView(orgId, id, req.account); }),
    POST: users(ALL_ROLES, async (orgId, req) => {
      const b = req.body || {}, id = String(b.mission_id || ''), m = await import('../lib/pbc-loop.js');
      await requireMissionAccess(orgId, id, req.account);
      if (b.action === 'plan') return m.planNeeds(orgId, id, req.account);
      if (b.action === 'existing') return m.findExisting(orgId, id, req.account);
      if (b.action === 'request') return m.draftRequest(orgId, id, b, req.account);
      if (b.action === 'decide') return m.decide(orgId, id, b, req.account);
      // « Lire les réponses maintenant » (the scheduler does it at each pass): the mission's team only.
      if (b.action === 'replies') { await m.pbcView(orgId, id, req.account); return m.syncReplies(orgId, id, { req }); }
      // A reply from a sender outside the request kept « à vérifier »: a person of the mission accepts it, then its pieces are deposited.
      if (b.action === 'trust') return m.trustReply(orgId, id, b, req.account, { req });
      // The pieces' content checked (proposal), and the complement sent in the same conversation once validated.
      if (b.action === 'control') { await m.pbcView(orgId, id, req.account); return m.controlPieces(orgId, id, {}); }
      if (b.action === 'complement') return m.requestComplement(orgId, id, b, req.account);
      if (b.action === 'assign') return m.assignPiece(orgId, id, b, req.account);
      if (b.action === 'file') return m.fileAccepted(orgId, id, b, req.account);
      throw fail('UNKNOWN_ACTION', 400);
    }),
    unavailable: 'PBC_UNAVAILABLE'
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
      // The agents' files found in the Drive's bin; the owner chooses which come back (2026-10-19).
      if (b.action === 'binned') return { files: await (await import('../lib/memory-home.js')).binnedMemoryFiles(orgId) };
      if (b.action === 'restore') return (await import('../lib/memory-home.js')).restoreMemoryFiles(orgId, b.ids, who(req));
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
  'mission-contacts': { GET: users(ALL_ROLES, (orgId, req) => getMissionContacts(orgId, req.query?.mission_id || null)), unavailable: 'CONTACTS_UNAVAILABLE' },
  // The firm's people-management policy, kept in the agents' Drive memory (owner).
  // Documents dropped on the Rangement page (40 max, one per request): named, placed, sent — after validation.
  // Small files through the app; large ones straight from the browser to Google (start / finish).
  drop: { POST: users(ALL_ROLES, async (orgId, req) => {
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
    GET: users(ALL_ROLES, (orgId) => agentPermissions(orgId)),
    POST: users(['owner', 'partner'], (orgId, req) => grantAgentPermissions(orgId, req)),
    unavailable: 'PERMISSIONS_UNAVAILABLE'
  },
  // First connection (2026-10-17): the agents introduce themselves in Démarrer; the human gives the link, the agent checks it.
  'agent-intro': {
    GET: users(ALL_ROLES, async (orgId, req) => {
      const m = await import('../lib/agent-intro.js');
      if (req.query?.screen) return m.screenIntro(orgId, req.account, String(req.query.screen));
      if (req.query?.me === '1') return m.personView(orgId, req.account);
      if (!['owner', 'partner'].includes(req.account?.role)) throw fail('FORBIDDEN', 403);
      return m.introView(orgId, req.account);
    }),
    POST: users(ALL_ROLES, async (orgId, req) => {
      const m = await import('../lib/agent-intro.js'); const b = req.body || {};
      if (b.action === 'me-answer') return m.answerPerson(orgId, req.account, b);
      if (b.action === 'screen-seen') return m.dismissScreen(orgId, req.account, String(b.screen || ''));
      if (!['owner', 'partner'].includes(req.account?.role)) throw fail('FORBIDDEN', 403);
      return m.saveIntro(orgId, b, req.account);
    }),
    unavailable: 'AGENT_INTRO_UNAVAILABLE'
  },
  'google-callback': {
    GET: open(async (orgId, req) => {
      // Started on a preview: Google always comes back to the ONE registered address (production); the browser is sent back to the
      // preview with Google's answer, and the preview finishes (lib/google-connection.js, relayTarget).
      try { const to = (await import('../lib/google-connection.js')).relayTarget(req); if (to) return { __relay: to }; } catch (e) { console.error('[google-callback] relay refused:', String(e.message || e).slice(0, 80)); }
      try {
        // Several firms: Google comes back without the firm header; the firm is the one in the state the server signed.
        let firm = orgId;
        if (multiCabinet()) {
          const peek = (() => { try { return JSON.parse(Buffer.from(String(req.query?.state || '').split('.')[0], 'base64url').toString('utf8')); } catch { return {}; } })();
          if (peek.org && peek.org !== orgId) { (await import('../lib/google-connection.js')).readState(req.query?.state, peek.org); firm = peek.org; }
        }
        const out = await runInFirm(firm, () => completeGoogleReturn(firm, req));
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

export const ROUTE_SCREENS = Object.freeze({
  search: 'documents', 'mission-view': 'mission', actions: 'validations', opportunities: 'opportunities', tenders: 'tenders', shadow: 'shadow',
  methodology: 'workpapers', 'work-programme': 'workpapers', procedure: 'workpapers', secretariat: 'engagement_letter'
});
const decisionLevel = req => req.body?.owner_override === true || ['approve', 'decide', 'validate', 'review-decide', 'settings', 'owner-override', 'accept-existing-kyc', 'confirm-agreement', 'independence-decide', 'independence-applied', 'independence-override', 'independence-prohibit'].includes(req.body?.action) ? 'approve' : ['sign'].includes(req.body?.action) ? 'review' : 'prepare';
const PILOT_ONLY = new Set(['bootstrap-owner', 'claim-owner', 'firm-restart']);
export async function handleApp(req) {
  const route = ROUTES[String(req.query?.route || '')];
  if (!route) { requirePilotAccess(req); throw fail('UNKNOWN_ROUTE', 404); }
  const run = route[req.method];
  if (typeof run !== 'function') { requirePilotAccess(req); throw fail('METHOD_NOT_ALLOWED', 405); }
  if (!run.public) requirePilotAccess(req);
  // The firm of the request (lib/firm-context.js). Several firms per installation: the shared pilot token is no
  // longer enough, the person must belong to the firm (or the call is a signed internal one). Switch off: DEFAULT_ORG_ID.
  const orgId = await resolveRequestOrg(req, { requireMember: !run.public });
  // The owner code and FIRST_OWNER_EMAILS are the pilot firm's: never a way into another firm.
  if (PILOT_ONLY.has(String(req.query?.route || '')) && orgId !== pilotOrgId()) throw fail('PILOT_FIRM_ONLY', 403);
  // Owner-only routes (2026-10-11): the owner's or a partner's personal session is enough — no code to type,
  // the product is sold to other firms. The owner code still works (older pages, scripts) — for the pilot firm only.
  if (run.ownerOnly) {
    try { if (orgId !== pilotOrgId()) throw fail('OWNER_SESSION_REQUIRED', 401); requireFirmOwner(req); }
    catch (e) { const acc = await requireRole(req, [...FIRM_LEAD]).catch(() => null); if (!acc) throw e; req.account = acc; }
  }
  if (!orgId && route !== ROUTES.diagnostic) throw new Error('DEFAULT_ORG_ID_MISSING');
  // Test mode (preview): never on the real firm's organisation (test run TATY TEST).
  if (route !== ROUTES.diagnostic) assertIsolatedOrg(orgId);
  if (run.userRoles) req.account = await requireRole(req, run.userRoles);
  const screen = ROUTE_SCREENS[String(req.query?.route || '')];
  if (screen) {
    if (!req.account) req.account = await requireRole(req, [...EVERYONE]);
    try {
      req.resourceAccess = await requireScreenAccess(orgId, req.account, screen, req.method === 'GET' ? 'view' : decisionLevel(req));
      const missionId = req.query?.mission_id || req.body?.mission_id;
      if (req.resourceAccess.mine && missionId) await requireMissionAccess(orgId, missionId, req.account);
    } catch (e) { await logAccess(orgId, req.account, 'ACCESS_REFUSED', String(req.query?.route || '') + ':' + e.message); throw e; }
  }
  // The firm's Google connection (Paramètres → Connecter Google), used by Drive and Gmail.
  if (orgId) await runInFirm(orgId, () => loadGoogleConnection(orgId)).catch(() => null);
  // « Mon IA »: a person's own requests may use the AI they connected (warning accepted); else the firm's.
  const invoke = () => import('../lib/local-storage.js').then(m => m.withDocumentContext(orgId, req.account, () => withOperationActor({orgId,actor:req.account?.email || 'office-manager-system',kind:req.account?'human':'system'},()=>run(orgId, req))));
  const inFirm = () => runInFirm(orgId, invoke);
  if (req.account?.auth_user_id) return (await import('../lib/personal-ai.js')).runAs(orgId, req.account, inFirm);
  return inFirm();
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
    // The Google relay only (built from a state this server signed, https, checked in relayTarget).
    if (out && typeof out.__relay === 'string' && /^https:\/\//.test(out.__relay) && req.query?.route === 'google-callback') { res.statusCode = 302; res.setHeader('Location', out.__relay); return res.end(); }
    if (out && typeof out.__redirect === 'string' && out.__redirect.startsWith('/')) {
      res.statusCode = 302; res.setHeader('Location', out.__redirect); return res.end();
    }
    return res.status(200).json(out);
  } catch (error) {
    const status = error.statusCode || 500;
    const route = ROUTES[String(req.query?.route || '')];
    const shown = [400, 401, 403, 404, 405, 409, 422, 429, 503].includes(status) ? error.message : (route?.unavailable || 'APP_UNAVAILABLE');
    const body = { error: shown };
    if (status >= 500) {
      // The real cause, short and without secrets, so the screen (and the logs) say what broke.
      const detail = String(error.message || error).replace(/(Bearer|token|secret|key)[^\s,;]*/gi, '$1…').slice(0, 160);
      body.detail = detail;
      console.error('[app] ' + String(req.query?.route || '') + ' failed:', detail);
    }
    if (Array.isArray(error.outside)) body.outside = error.outside;
    // What blocks a validation, listed (work programme, 2026-10-12) — codes only, no data.
    if (status < 500 && Array.isArray(error.gaps)) body.gaps = error.gaps.slice(0, 200);
    if (status < 500 && Array.isArray(error.unknown)) body.unknown = error.unknown.slice(0, 100);
    // A possible duplicate mission: which ones, so the person opens it or confirms (2026-10-19).
    if (status < 500 && Array.isArray(error.duplicates)) body.duplicates = error.duplicates.slice(0, 5);
    return res.status(status).json(body);
  }
}
