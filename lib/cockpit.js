import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile } from './mapping-scan.js';
import { loadFacts, coordinationFrom, teamKpisFrom, doneAt } from './kpi.js';
import { canonicalStatus, isLive } from './mission-status.js';
import { importantMails } from './mail-triage.js';

// HOME COCKPIT (2026-10-08): the heart of the system's KPI in one place. Every indicator says
// WHAT it measures, HOW it is computed, WHICH data and sources were used, and lists the
// ELEMENTS that make up the figure (each with a link). Facts only: assignments, actions,
// missions, validations, the agents' results (Enhanced Auditor, capability gaps, learnings,
// e-mail triage). Nothing here decides anything.

const DAY = 86400000;
const q = encodeURIComponent;
const t = v => (v ? Date.parse(v) : NaN);
const cut = (s, n = 160) => String(s ?? '').slice(0, n);
const mHref = id => id ? '/mission.html?id=' + encodeURIComponent(id) : null;
const IN_PROGRESS = ['fieldwork', 'review', 'partner_review', 'report_issued'];
const RISK_HIGH = /élev|eleve|high|significati|fraud|critique|important/i;

function kpi(key, label, value, o = {}) {
  return { key, label, value, unit: o.unit || null, tone: o.tone || 'neutral', detail: o.detail || null,
    measured: o.measured, method: o.method, sources: o.sources || [], items: (o.items || []).slice(0, 60), total_items: (o.items || []).length, href: o.href || null };
}
const tone = (n, warn = 1, bad = 5) => n >= bad ? 'bad' : n >= warn ? 'warn' : 'ok';

// Pure: everything from the facts, testable offline.
export function cockpitFrom(f, now = Date.now()) {
  const missionsById = new Map((f.missions || []).map(m => [m.id, m]));
  const mName = id => missionsById.get(id)?.name || missionsById.get(id)?.mission_code || null;
  const today = new Date(now).toISOString().slice(0, 10);
  const out = [];

  // 1. Missions: in progress / waiting for the result / won, not started.
  const phase = m => {
    const c = canonicalStatus(m.status);
    if (c === 'opportunity') return 'waiting';
    if (c === 'acceptance' || c === 'planning') return 'won';
    if (IN_PROGRESS.includes(c)) return m.planned_start && m.planned_start > today ? 'won' : 'running';
    return null;
  };
  const live = (f.missions || []).filter(m => isLive(m.status) && !/entra[iî]nement|training/i.test(m.name || ''));
  const byPhase = p => live.filter(m => phase(m) === p).map(m => ({ label: m.name || m.mission_code, meta: [canonicalStatus(m.status), m.planned_start && ('début ' + m.planned_start), m.planned_end && ('fin ' + m.planned_end)].filter(Boolean).join(' · '), href: mHref(m.id) }));
  const statusMethod = 'Statut de chaque mission ramené à la liste commune (opportunité, acceptation, planification, terrain, revue, revue associé, rapport émis, clôturée, archivée, annulée ; les anciens statuts sont traduits).';
  out.push(kpi('missions_running', 'Missions en cours', byPhase('running').length, { measured: 'Missions acceptées dont les travaux ont commencé.', method: statusMethod + ' En cours = terrain, revue, revue associé ou rapport émis, avec une date de début passée (ou absente).', sources: ['office_missions (statut, dates)'], items: byPhase('running'), href: '/mission.html' }));
  out.push(kpi('missions_waiting', 'En attente de résultat', byPhase('waiting').length, { measured: 'Propositions / réponses à TDR soumises dont on attend le résultat.', method: statusMethod + ' Compte les missions au statut « opportunité ».', sources: ['office_missions (statut)'], items: byPhase('waiting'), href: '/mission.html' }));
  out.push(kpi('missions_won', 'Gagnées, pas commencées', byPhase('won').length, { measured: 'Missions gagnées dont les travaux n’ont pas commencé.', method: statusMethod + ' Statut acceptation ou planification, ou mission en cours dont la date de début est future.', sources: ['office_missions (statut, date de début)'], items: byPhase('won'), href: '/mission.html' }));

  // 2. Important risks (Enhanced Auditor coverage + industry briefing).
  const risks = [];
  for (const [mid, r] of Object.entries(f.reviews || {})) {
    if (!missionsById.has(mid) || !isLive(missionsById.get(mid).status)) continue;
    for (const c of r.coverage || []) if (c.verdict !== 'couvert' && (RISK_HIGH.test(c.level || '') || c.verdict === 'non couvert')) risks.push({ label: cut(c.risk, 140), meta: [mName(mid), 'niveau ' + (c.level || '?'), c.verdict].join(' · '), href: '/auditeur.html?mission=' + encodeURIComponent(mid) });
  }
  out.push(kpi('risks', 'Risques importants', risks.length, { tone: tone(risks.length, 1, 4), measured: 'Risques élevés ou non couverts sur les missions actives.', method: 'Registre des risques de chaque revue Enhanced Auditor (risques du Grand Contrôleur + de l’auditeur) : un risque compte s’il est de niveau élevé / significatif / fraude et pas entièrement couvert, ou s’il n’est pas couvert du tout. Verdict le plus prudent des modèles.', sources: ['OFFICE_MANAGER_ENHANCED_AUDITOR.json (revues)', 'office_missions'], items: risks, href: '/auditeur.html' }));

  // 3. Missing PBC.
  const open = (f.actions || []).filter(a => doneAt(a) === null && !['rejected', 'cancelled', 'canceled'].includes(String(a.status || '').toLowerCase()));
  const pbc = open.filter(a => /PBC/i.test(a.action_type || '') && a.action_type !== 'PBC_MAIL_RECEIVED');
  out.push(kpi('pbc_missing', 'PBC manquantes', pbc.length, { tone: tone(pbc.length, 1, 10), measured: 'Pièces demandées au client (PBC) toujours attendues.', method: 'Actions PBC ouvertes (relances PBC proposées ou validées, non exécutées) des missions. Une pièce reçue par e-mail en attente de dépôt n’est pas comptée comme manquante.', sources: ['office_action_queue (PBC_*)'], items: pbc.map(a => ({ label: cut(a.summary), meta: [mName(a.office_mission_id), a.due_at && ('attendue le ' + String(a.due_at).slice(0, 10))].filter(Boolean).join(' · '), href: mHref(a.office_mission_id) })), href: '/validations.html' }));

  // 4. Delays.
  const coord = coordinationFrom(f, now);
  const lateMissions = coord.missions.filter(m => m.days_left != null && m.days_left < 0);
  const delays = [...lateMissions.map(m => ({ label: 'Mission en dépassement : ' + m.name, meta: (-m.days_left) + ' j après la fin prévue (' + m.planned_end + ')', href: mHref(m.id) })),
    ...coord.overdue.map(a => ({ label: cut(a.summary), meta: [a.mission, a.assignee, a.days_late + ' j de retard'].filter(Boolean).join(' · '), href: mHref(a.mission_id) }))];
  out.push(kpi('delays', 'Retards', delays.length, { tone: tone(delays.length, 1, 6), measured: 'Actions en retard et missions qui dépassent leur fin prévue.', method: 'Action en retard = ouverte et date d’échéance passée. Mission en dépassement = active et date de fin prévue passée. Calcul à la date du jour.', sources: ['office_action_queue (échéance, exécution)', 'office_missions (fin prévue)'], items: delays, href: '/equipe.html' }));

  // 5. Load and capacity.
  const team = teamKpisFrom(f, now);
  const over = team.people.filter(p => p.load_pct > 100), free = team.people.filter(p => p.load_pct < 30 && !p.actions_open);
  out.push(kpi('capacity', 'Charge et capacité', over.length + ' / ' + free.length, { tone: tone(over.length, 1, 3), detail: 'surchargés / disponibles',
    measured: 'Personnes au-dessus de 100 % de charge, et personnes disponibles (moins de 30 % et aucune action ouverte).', method: 'Charge du jour = somme des pourcentages d’affectation des missions actives ce jour-là. Uniquement les affectations et actions, jamais un questionnaire ni un jugement.', sources: ['office_mission_assignments', 'office_action_queue', 'office_staff_profiles'],
    items: [...over.map(p => ({ label: p.name + ' — ' + p.load_pct + ' %', meta: 'surchargé · ' + p.missions_active + ' mission(s)', href: '/equipe.html' })), ...free.map(p => ({ label: p.name + ' — ' + p.load_pct + ' %', meta: 'disponible', href: '/equipe.html' }))], href: '/equipe.html' }));

  // 6. Assignment conflicts: same person, overlapping periods, more than 100 % together.
  const conflicts = [];
  const byPerson = new Map();
  for (const a of f.assignments || []) { if (['rejected', 'cancelled', 'canceled', 'completed'].includes(String(a.status || '').toLowerCase()) || !a.planned_start || !a.planned_end || a.planned_end < today) continue; if (!byPerson.has(a.staff_profile_id)) byPerson.set(a.staff_profile_id, []); byPerson.get(a.staff_profile_id).push(a); }
  const nameOf = Object.fromEntries((f.staff || []).map(s => [s.id, s.full_name]));
  for (const [pid, list] of byPerson) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const s = a.planned_start > b.planned_start ? a.planned_start : b.planned_start, e = a.planned_end < b.planned_end ? a.planned_end : b.planned_end;
    const pct = (Number(a.allocation_pct) || 100) + (Number(b.allocation_pct) || 100);
    if (s <= e && pct > 100 && a.office_mission_id !== b.office_mission_id) conflicts.push({ label: (nameOf[pid] || 'Personne') + ' : ' + (mName(a.office_mission_id) || '?') + ' + ' + (mName(b.office_mission_id) || '?'), meta: s + ' → ' + e + ' · ' + pct + ' %', href: '/equipe.html' });
  }
  out.push(kpi('conflicts', 'Conflits d’affectation', conflicts.length, { tone: tone(conflicts.length, 1, 3), measured: 'Une même personne affectée à deux missions sur des dates qui se chevauchent, à plus de 100 % au total.', method: 'Pour chaque personne, chaque paire d’affectations actives (non refusées, non terminées) : chevauchement des dates et somme des pourcentages > 100 %.', sources: ['office_mission_assignments', 'office_staff_profiles'], items: conflicts, href: '/equipe.html' }));

  // 7. Review points.
  const review = [];
  for (const [mid, r] of Object.entries(f.reviews || {})) { if (!missionsById.has(mid) || !isLive(missionsById.get(mid).status)) continue; for (const p of r.priority_actions || []) review.push({ label: cut(p, 160), meta: (mName(mid) || '') + ' · Enhanced Auditor', href: '/auditeur.html?mission=' + encodeURIComponent(mid) }); }
  for (const a of open.filter(a => a.action_type === 'MISSION_DOCUMENT_REVIEW')) review.push({ label: cut(a.summary), meta: (mName(a.office_mission_id) || '') + ' · document à contrôler', href: mHref(a.office_mission_id) });
  out.push(kpi('review_points', 'Points de revue', review.length, { tone: tone(review.length, 1, 10), measured: 'Points à revoir ouverts sur les missions actives.', method: 'Actions prioritaires des revues Enhanced Auditor des missions actives + documents déposés à contrôler (MISSION_DOCUMENT_REVIEW) non encore traités.', sources: ['OFFICE_MANAGER_ENHANCED_AUDITOR.json', 'office_action_queue'], items: review, href: '/auditeur.html' }));

  // 8. Quality.
  const since = now - 30 * DAY;
  const done = (f.actions || []).filter(a => { const d = doneAt(a); return Number.isFinite(d) && d >= since; });
  const verified = done.filter(a => Number.isFinite(t(a.verified_at)));
  const withDue = done.filter(a => Number.isFinite(t(a.due_at)));
  const onTime = withDue.filter(a => doneAt(a) <= t(a.due_at) + DAY);
  const vr = done.length ? Math.round(100 * verified.length / done.length) : null, ot = withDue.length ? Math.round(100 * onTime.length / withDue.length) : null;
  out.push(kpi('quality', 'Qualité', vr == null ? '–' : vr + ' %', { tone: vr == null ? 'neutral' : vr >= 80 ? 'ok' : vr >= 50 ? 'warn' : 'bad', detail: 'vérifié' + (ot == null ? '' : ' · ' + ot + ' % à temps'),
    measured: 'Part du travail terminé sur 30 jours qui a été vérifié, et part terminée à temps.', method: 'Actions terminées sur 30 jours (exécutées ou vérifiées) : % avec une vérification enregistrée ; parmi celles qui avaient une échéance, % terminées au plus tard le jour de l’échéance.', sources: ['office_action_queue (executed_at, verified_at, due_at)'],
    items: done.filter(a => !Number.isFinite(t(a.verified_at))).map(a => ({ label: 'Non vérifié : ' + cut(a.summary), meta: mName(a.office_mission_id) || '', href: mHref(a.office_mission_id) })) }));

  // 9. Deadlines (next 14 days).
  const soon = now + 14 * DAY;
  const deadlines = [...live.filter(m => Number.isFinite(t(m.planned_end)) && t(m.planned_end) >= now - DAY && t(m.planned_end) <= soon).map(m => ({ label: 'Fin de mission : ' + (m.name || m.mission_code), meta: m.planned_end, href: mHref(m.id), at: m.planned_end })),
    ...open.filter(a => Number.isFinite(t(a.due_at)) && t(a.due_at) >= now && t(a.due_at) <= soon).map(a => ({ label: cut(a.summary), meta: [mName(a.office_mission_id), String(a.due_at).slice(0, 10)].filter(Boolean).join(' · '), href: mHref(a.office_mission_id), at: a.due_at })),
    ...(f.mails || []).filter(m => m.deadline && t(m.deadline) >= now - DAY && t(m.deadline) <= soon).map(m => ({ label: 'E-mail : ' + cut(m.subject, 120), meta: m.deadline, href: '#mails', at: m.deadline }))]
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  out.push(kpi('deadlines', 'Échéances (14 j)', deadlines.length, { tone: tone(deadlines.length, 3, 10), measured: 'Ce qui arrive à échéance dans les 14 prochains jours.', method: 'Fins de mission prévues, échéances des actions ouvertes et échéances relevées dans les e-mails importants, entre aujourd’hui et dans 14 jours.', sources: ['office_missions', 'office_action_queue', 'e-mails triés'], items: deadlines }));

  // 10. Important validations.
  const IMPORTANT = /MISSION_UPDATE|MISSION_FOLDER_LINK|PBC_EXTERNAL|STAFF|ASSIGN|PEOPLE|INDEPEND|ETHIC|WORKFILE|FILE_MOVE/i;
  const pend = (f.pending || []).map(a => ({ label: cut(a.summary), meta: [a.action_type, mName(a.office_mission_id)].filter(Boolean).join(' · '), href: '/validations.html', important: IMPORTANT.test(a.action_type || '') }))
    .sort((a, b) => Number(b.important) - Number(a.important));
  const msgs = (f.pendingMessages || []).map(m => ({ label: 'Message à valider : ' + cut(m.subject, 120), meta: (m.recipients || []).join(', '), href: '/messagerie.html', important: m.audience === 'client' }));
  const allPend = [...pend, ...msgs];
  out.push(kpi('validations', 'Validations importantes', allPend.filter(x => x.important).length, { tone: tone(allPend.filter(x => x.important).length, 1, 8), detail: allPend.length + ' en attente au total',
    measured: 'Décisions qui attendent une personne : changements de mission, relances client, équipes, rangements, messages externes.', method: 'Propositions des agents au statut « proposé » ou « en attente » non décidées, et messages à valider. Sont « importantes » celles qui changent une mission, l’équipe, le Drive ou partent chez un client.', sources: ['office_action_queue', 'office_agent_messages'], items: allPend, href: '/validations.html' }));

  // 11. Ethics / independence.
  const ethics = [...open.filter(a => /INDEPEND|ETHIC|CONFLICT_OF|CONFLIT/i.test((a.action_type || '') + ' ' + (a.summary || ''))).map(a => ({ label: cut(a.summary), meta: mName(a.office_mission_id) || '', href: mHref(a.office_mission_id) })),
    ...(f.independence || []).map(x => ({ label: cut(x.label || x, 160), meta: x.mission || '', href: x.mission_id ? mHref(x.mission_id) : null }))];
  out.push(kpi('ethics', 'Éthique / indépendance', ethics.length, { tone: ethics.length ? 'bad' : 'ok', measured: 'Alertes d’éthique, d’indépendance ou de conflit d’intérêts ouvertes.', method: 'Actions ouvertes signalées par les agents sur l’indépendance, l’éthique ou un conflit d’intérêts, et points d’indépendance notés dans la mémoire permanente des clients. L’IA alerte, elle ne décide jamais de l’indépendance.', sources: ['office_action_queue', 'CLIENT_MEMORY.json (indépendance)'], items: ethics }));

  // 12. Training needs.
  const training = [...(f.recurringGaps || []).map(g => ({ label: g.category || g.capability, meta: (g.missions || []).length + ' mission(s) · manque récurrent', href: '/pilotage.html' })),
    ...(f.learnings || []).filter(l => l.category === 'training_need').map(l => ({ label: cut(l.statement), meta: l.status + ' · ' + l.occurrences + ' mission(s)', href: '/pilotage.html' }))];
  out.push(kpi('training', 'Besoins de formation', training.length, { tone: tone(training.length, 1, 5), measured: 'Compétences qui manquent de façon répétée au cabinet.', method: 'Manques de compétences relevés par Mission Controller lors des préparations, regroupés par catégorie ; récurrent = vu sur 2 missions ou plus. S’ajoutent les apprentissages « besoin de formation » tirés des missions clôturées.', sources: ['OFFICE_MANAGER_CAPABILITY_GAPS.json', 'office_learnings'], items: training, href: '/pilotage.html' }));

  // 13. Important e-mails that need an action.
  const mails = (f.mails || []).map(m => ({ label: cut(m.subject, 140), meta: [m.from, m.importance, mName(m.mission_id)].filter(Boolean).join(' · '), href: '#mails' }));
  out.push(kpi('mails', 'E-mails à traiter', mails.length, { tone: tone((f.mails || []).filter(m => m.importance === 'haute').length, 1, 3), measured: 'E-mails reçus récemment qui demandent une action du cabinet.', method: 'Boîte autorisée du cabinet (lecture seule), 4 derniers jours hors promotions et réseaux sociaux. Une IA dit si l’e-mail demande une action, son importance, la mission concernée et l’action suggérée. Retiré dès qu’il est traité.', sources: ['Gmail du cabinet (lecture seule)', 'OFFICE_MANAGER_INBOX_TRIAGE.json'], items: mails, href: '#mails' }));

  return { generated_at: new Date(now).toISOString(), kpis: out };
}

export async function cockpit(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const safe = p => p.catch(() => null);
  const org = 'org_id=eq.' + q(orgId);
  const [facts, pending, pendingMessages, reviews, gaps, learnings, mails] = await Promise.all([
    loadFacts(orgId, fetchRows),
    safe(fetchRows('office_action_queue?' + org + '&status=in.(proposed,awaiting_approval)&approved_at=is.null&action_type=neq.PEOPLE_INTELLIGENCE_RECOMMENDATION&select=id,action_type,summary,office_mission_id,created_at&order=created_at.desc&limit=200')),
    safe(fetchRows('office_agent_messages?' + org + '&status=eq.pending_approval&select=id,subject,recipients,audience&limit=100')),
    safe(loadJsonFile('OFFICE_MANAGER_ENHANCED_AUDITOR.json', drive, folder).then(r => r.state?.reviews || {})),
    safe(import('./capabilities.js').then(m => loadJsonFile(m.GAPS_FILE, drive, folder).then(r => m.recurringGaps(r.state?.gaps || []).filter(g => g.strategic)))),
    safe(fetchRows('office_learnings?' + org + '&status=neq.rejected&select=category,statement,occurrences,status&limit=200')),
    safe(importantMails({ drive, folder }))
  ]);
  return cockpitFrom({ ...facts, pending: pending || [], pendingMessages: pendingMessages || [], reviews: reviews || {}, recurringGaps: gaps || [],
    learnings: learnings || [], mails: mails?.items || [] }, d.now || Date.now());
}
