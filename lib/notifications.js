import crypto from 'node:crypto';
import { rest } from './supabase.js';
import { cockpit } from './cockpit.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile } from './mapping-scan.js';
import { accessibleMissionIds } from './mission-access.js';
import { visiblePeople } from './roles.js';
import { listPendingActions } from './action-decisions.js';

// Alerts derive from existing records, never from a second workflow store.
const q = encodeURIComponent, DAY = 86400000;
const key = (...p) => crypto.createHash('sha1').update(p.join('|')).digest('hex').slice(0, 16);
const LEADS = new Set(['owner', 'partner']);
const MANAGERS = new Set(['owner', 'partner', 'manager', 'supervisor']);
const ACTION_TYPES = new Set(['pbc_late', 'deadline', 'critical_risk', 'review_point', 'important_email', 'availability_conflict', 'people_question', 'shadow_survey', 'personal_training', 'opportunity', 'tender', 'pending_action']);
export const TYPES = Object.freeze({ pbc_received: 'PBC reçue', pbc_late: 'PBC en retard', deadline: 'Échéance', critical_risk: 'Risque critique', new_document: 'Nouveau document',
  review_point: 'Point de revue', mission_assigned: 'Mission attribuée', important_email: 'E-mail important', availability_conflict: 'Conflit de disponibilité', training: 'Formation recommandée',
  people_question: 'Une question sur l’équipe', shadow_survey: 'Questionnaire des agents', personal_training: 'Mon entraînement mensuel', opportunity: 'Opportunité', tender: 'Appel d’offres', pending_action: 'À valider', message: 'Message reçu' });
const cache = new Map();
async function cockpitCached(orgId, d) {
  if (d.cockpit) return d.cockpit(orgId, d);
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < 60000) return hit.value;
  const value = await cockpit(orgId, d);
  cache.set(orgId, { at: Date.now(), value });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return value;
}
export function notificationMissionId(n) {
  if (n.mission_id) return n.mission_id;
  if (typeof n.href !== 'string' || !n.href.startsWith('/') || n.href.startsWith('//')) return null;
  try { const u = new URL(n.href, 'https://office.invalid'); return u.searchParams.get('mission_id') || (u.pathname === '/mission.html' ? u.searchParams.get('id') : null); }
  catch { return null; }
}
export function inMissionScope(n, ids) {
  const id = notificationMissionId(n);
  return ids === null || Boolean(id && ids.has(id));
}
export function buildNotifications(c, extra = {}, now = Date.now()) {
  const k = Object.fromEntries((c.kpis || []).map(x => [x.key, x])), out = [];
  const add = (type, title, meta, href, id, at = null, missionId = null) => out.push({ key: key(type, id || title), type, label: TYPES[type], title: String(title || '').slice(0, 200), meta: meta || null, href: href || null, at,
    mission_id: missionId, action_required: ACTION_TYPES.has(type), action_label: ['review_point', 'pending_action'].includes(type) ? 'Revoir' : ['message', 'people_question'].includes(type) ? 'Répondre' : 'Ouvrir' });
  for (const it of k.pbc_missing?.items || []) { const m = /attendue le (\d{4}-\d{2}-\d{2})/.exec(it.meta || ''); if (m && Date.parse(m[1]) < now - DAY / 2) add('pbc_late', it.label, it.meta, it.href, 'pbc|' + it.label + '|' + it.meta); }
  for (const it of k.deadlines?.items || []) { const date = Date.parse(it.at); if (Number.isFinite(date) && date - now <= 3 * DAY) add('deadline', it.label, it.meta, it.href, 'dl|' + it.label + '|' + it.at, it.at); }
  for (const it of k.risks?.items || []) if (/élev|eleve|high|fraud|significati|critique/i.test(it.meta || '') || /non couvert/.test(it.meta || '')) add('critical_risk', it.label, it.meta, it.href, 'risk|' + it.label + '|' + it.meta);
  for (const it of k.review_points?.items || []) add('review_point', it.label, it.meta, it.href, 'rp|' + it.label + '|' + it.href);
  for (const it of k.mails?.items || []) if (/haute/.test(it.meta || '')) add('important_email', it.label, it.meta, '/accueil.html#mails', 'mail|' + it.label + '|' + it.meta);
  for (const it of k.conflicts?.items || []) add('availability_conflict', it.label, it.meta, it.href, 'conf|' + it.label + '|' + it.meta);
  for (const it of k.training?.items || []) add('training', it.label, it.meta, it.href, 'tr|' + it.label);
  for (const [field, type] of [['pbcReceived', 'pbc_received'], ['documents', 'new_document'], ['assigned', 'mission_assigned'], ['opportunities', 'opportunity'], ['tenders', 'tender'], ['pending', 'pending_action'], ['messages', 'message']])
    for (const x of extra[field] || []) add(type, x.title, x.meta, x.href, type + '|' + x.id, x.at, x.mission_id || null);
  if (extra.personalTraining?.due) add('personal_training', 'Votre entraînement du mois : trois questions métier', 'Adapté à votre rôle · à faire à votre rythme', '/apprentissage.html?mode=monthly', 'learning|' + extra.personalTraining.month + '|' + extra.personalTraining.role);
  if (extra.survey) add('shadow_survey', 'Cinq questions pour aider les agents à s’améliorer', 'Une minute, une fois par semaine', '/questionnaire.html', 'survey|' + extra.survey.id);
  for (const x of extra.questions || []) add('people_question', x.question, x.situation, '/carte.html?staff=' + q(x.staff_id) + '#questions', 'pq|' + x.key, x.at);
  const seen = new Set(); return out.filter(n => !seen.has(n.key) && seen.add(n.key));
}
export function visibleChatMessage(m, account, missionIds, groups = []) {
  const email = String(account?.email || '').toLowerCase();
  if (!email || String(m.sender_email || '').toLowerCase() === email) return false;
  const conversation = String(m.conversation || ''), dm = /^dm:([^|]+)\|([^|]+)$/.exec(conversation);
  if (dm) return dm.slice(1).map(x => x.toLowerCase()).includes(email);
  if (conversation.startsWith('mission:')) return inMissionScope({ mission_id: conversation.slice(8) }, missionIds);
  if (conversation.startsWith('group:')) return groups.some(g => 'group:' + g.id === conversation && (g.members || []).some(x => String(x).toLowerCase() === email));
  return conversation === 'cabinet' && account.role !== 'it_admin';
}
export async function notifications(orgId, account, d = {}) {
  if (!account?.role || !account?.email) throw Object.assign(new Error('USER_SESSION_REQUIRED'), { statusCode: 401 });
  const fetchRows = d.fetchRows || rest, org = 'org_id=eq.' + q(orgId), email = String(account.email).toLowerCase();
  const now = typeof d.now === 'function' ? d.now() : d.now || Date.now(), since = new Date(now - 3 * DAY).toISOString();
  // Staffing failures must never fall back to global access.
  const allowed = await (d.accessibleMissionIds || accessibleMissionIds)(orgId, account, fetchRows);
  const [c, received, staff, pendingResult, recent, groups] = await Promise.all([
    cockpitCached(orgId, d).catch(() => ({ kpis: [] })),
    fetchRows('office_action_queue?' + org + '&action_type=eq.PBC_MAIL_RECEIVED&created_at=gte.' + q(since) + '&select=id,summary,office_mission_id,created_at&order=created_at.desc&limit=30').catch(() => []),
    fetchRows('office_staff_profiles?' + org + '&email=eq.' + q(email) + '&active=eq.true&select=id&limit=1').then(r => r?.[0] || null).catch(() => null),
    (d.pendingActions || listPendingActions)(orgId, fetchRows).catch(() => ({ actions: [] })),
    fetchRows('office_chat_messages?' + org + '&archived=eq.false&created_at=gte.' + q(new Date(now - DAY).toISOString()) + '&select=id,conversation,sender_email,sender_name,body,created_at&order=created_at.desc&limit=200').catch(() => []),
    fetchRows('office_chat_groups?' + org + '&members=cs.' + q('{"' + email.replace(/"/g, '') + '"}') + '&select=id,name,members&limit=100').catch(() => [])
  ]);
  const deposits = (await (d.loadJsonFile || loadJsonFile)('OFFICE_MANAGER_DEPOSITS.json', d.drive || driveAdapter, d.folder || memoryFolderId()).catch(() => ({ state: null }))).state?.deposits || {};
  const documents = Object.entries(deposits).filter(([, x]) => x.started_at && x.started_at >= since && inMissionScope({ mission_id: x.mission_id }, allowed))
    .sort((a, b) => String(b[1].started_at).localeCompare(String(a[1].started_at))).slice(0, 20)
    .map(([id, x]) => ({ id, title: (x.files || x.documents || []).length + ' document(s) déposé(s)' + (x.label ? ' — ' + x.label : ''), meta: [x.by, (x.understood || x.documents || []).slice(0, 3).map(y => y.name).join(', ')].filter(Boolean).join(' · '), href: '/rangement.html', at: x.started_at, mission_id: x.mission_id }));
  let assigned = [];
  if (staff) {
    const rows = await fetchRows('office_mission_assignments?' + org + '&staff_profile_id=eq.' + q(staff.id) + '&status=not.in.(rejected,cancelled,completed)&select=id,office_mission_id,mission_role,planned_start,planned_end&limit=50').catch(() => []) || [];
    const own = rows.filter(r => inMissionScope({ mission_id: r.office_mission_id }, allowed)), ids = [...new Set(own.map(r => r.office_mission_id).filter(Boolean))];
    const names = ids.length ? Object.fromEntries((await fetchRows('office_missions?' + org + '&id=in.(' + ids.map(q).join(',') + ')&select=id,name&limit=50').catch(() => []) || []).map(m => [m.id, m.name])) : {};
    assigned = own.filter(r => !r.planned_end || Date.parse(r.planned_end) >= now).map(r => ({ id: r.id, title: 'Vous êtes sur « ' + (names[r.office_mission_id] || 'une mission') + ' »', meta: [r.mission_role, [r.planned_start, r.planned_end].filter(Boolean).join(' → ')].filter(Boolean).join(' · '), href: '/mission.html?id=' + q(r.office_mission_id), mission_id: r.office_mission_id }));
  }
  let questions = MANAGERS.has(account.role) ? await (d.openQuestions || (async () => (await import('./people-questions.js')).openQuestions(d)))().catch(() => []) : [];
  if (!LEADS.has(account.role) && questions.length) {
    const people = await (d.visiblePeople || visiblePeople)(orgId, account, fetchRows);
    const profiles = people?.size ? await fetchRows('office_staff_profiles?' + org + '&email=in.(' + [...people].map(q).join(',') + ')&select=id,email&limit=500') || [] : [];
    const visible = new Set(profiles.filter(p => people?.has(String(p.email || '').toLowerCase())).map(p => p.id));
    questions = questions.filter(x => visible.has(x.staff_id));
  }
  const personalTraining = await (d.learningNotice || (async (o,a) => (await import('./personal-learning.js')).learningNotice(o,a,d)))(orgId, account).catch(() => null);
  const opportunities = await (d.opportunityTasks || (async a => (await import('./opportunities.js')).opportunityTasks(a, { ...d, orgId })))(account).catch(() => []);
  const tenders = await (d.tenderTasks || (async a => (await import('./tender-watch.js')).tenderTasks(orgId, a, d)))(account).catch(() => []);
  const actionable = (pendingResult.actions || []).filter(a => inMissionScope({ mission_id: a.office_mission_id }, allowed) && (a.retry_needed || !a.last_decision || a.last_decision.decision === 'defer'));
  const pending = actionable.map(a => ({ id: a.id, title: a.summary, meta: a.blocked_reason || a.agent_key, href: '/validations.html', at: a.created_at, mission_id: a.office_mission_id }));
  const messages = (recent || []).filter(m => visibleChatMessage(m, account, allowed, groups || [])).slice(0, 30)
    .map(m => ({ id: m.id, title: 'Message de ' + (m.sender_name || m.sender_email), meta: String(m.body || '').slice(0, 160), href: m.conversation.startsWith('dm:') ? '/messagerie.html?to=' + q(m.sender_email) : '/messagerie.html', at: m.created_at }));
  let global = buildNotifications(c, {}, now).filter(n => inMissionScope(n, allowed));
  if (!LEADS.has(account.role)) global = global.filter(n => !['important_email', 'training', 'availability_conflict'].includes(n.type));
  const personal = buildNotifications({ kpis: [] }, { personalTraining, opportunities, tenders, questions,
    pbcReceived: (received || []).filter(r => inMissionScope({ mission_id: r.office_mission_id }, allowed)).map(r => ({ id: r.id, title: r.summary, meta: 'pièce reçue par e-mail', href: '/validations.html', at: r.created_at, mission_id: r.office_mission_id })), documents, assigned, pending, messages }, now);
  const list = [...new Map([...global, ...personal].map(n => [n.key, n])).values()]
    .sort((a, b) => Number(b.action_required) - Number(a.action_required) || (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  return { notifications: list.slice(0, 80), truncated: list.length > 80, types: TYPES, at: new Date(now).toISOString(), counts: { pending_actions: actionable.length, messages: messages.length }, viewer: { org_id: orgId, user_id: account.auth_user_id || email } };
}
