import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile } from './mapping-scan.js';
import { getMissionView } from './mission-view.js';
import { missionData, CONTACT_ROLES } from './mission-data.js';
import { canonicalStatus, LABELS, STATUSES, canMove } from './mission-status.js';

// THE MISSION FILE (2026-10-08, « un véritable dossier mission »). Everything the agents and the
// team know about one mission, from their structured results — nothing re-typed:
// TDR briefing, objectives, scope, deliverables, deadlines, risks (Mission Controller / industry
// briefing, auditors, Enhanced Auditor coverage), team needed / proposed / assigned, required
// capabilities, documents, PBC, budget, time, actions, client contacts, messages, review, history.
// Read-only. Added on top of the existing mission view (lib/mission-view.js), which is unchanged.

const DAY = 86400000;
const q = encodeURIComponent;
const cut = (s, n = 400) => s == null ? null : String(s).slice(0, n);

export function phaseOf(m, today = new Date().toISOString().slice(0, 10)) {
  const c = canonicalStatus(m.status);
  if (c === 'opportunity') return { key: 'waiting', label: 'Active — proposition soumise, en attente du résultat' };
  if (c === 'acceptance' || c === 'planning') return { key: 'won', label: 'Active — gagnée, pas encore commencée' };
  if (['fieldwork', 'review', 'partner_review', 'report_issued'].includes(c)) return m.planned_start && m.planned_start > today ? { key: 'won', label: 'Active — gagnée, pas encore commencée' } : { key: 'running', label: 'En cours — travaux commencés' };
  if (c === 'closed' || c === 'archived') return { key: 'ended', label: 'Terminée' };
  return { key: 'cancelled', label: 'Annulée' };
}

// Working days between two dates (Mon–Fri), for the planned time.
export function workingDays(start, end) {
  const s = Date.parse(start), e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
  let n = 0;
  for (let t = s; t <= e && n < 2000; t += DAY) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

export function timeBudget(mission, assignments, tdr) {
  const rows = (assignments || []).filter(a => !['rejected', 'cancelled', 'canceled'].includes(String(a.status || '').toLowerCase()))
    .map(a => ({ person: a.full_name || a.staff_profile_id, role: a.mission_role || null, days: Math.round(workingDays(a.planned_start || mission.planned_start, a.planned_end || mission.planned_end) * (Number(a.allocation_pct) || 100) / 10) / 10 }));
  const planned = Math.round(rows.reduce((s, r) => s + r.days, 0) * 10) / 10;
  const budgetDays = Number(String(tdr?.budget_or_days || '').match(/(\d+(?:[.,]\d+)?)\s*(?:j|jours|days|homme|h\/j|hj|man)/i)?.[1]?.replace(',', '.')) || null;
  return { planned_days: planned, by_person: rows, budget_text: tdr?.budget_or_days || null, budget_days: budgetDays,
    gap_days: budgetDays != null ? Math.round((planned - budgetDays) * 10) / 10 : null,
    method: 'Temps prévu = jours ouvrés de chaque affectation × pourcentage d’affectation. Budget = ce que dit le TDR ou la lettre de mission (en jours quand il est exprimé ainsi).' };
}

export async function getMissionFull(orgId, missionId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const safe = p => Promise.resolve(p).catch(() => null);
  const view = await (d.getMissionView || getMissionView)(orgId, missionId);
  const org = 'org_id=eq.' + q(orgId);
  const [row, engagements, reviews, data, messages, events, memory] = await Promise.all([
    safe(fetchRows('office_missions?' + org + '&id=eq.' + q(missionId) + '&select=client_contact_emails,client_name,memory_file_id,status_changed_at,closed_at&limit=1').then(r => r?.[0]))
      .then(r => r || safe(fetchRows('office_missions?' + org + '&id=eq.' + q(missionId) + '&select=client_contact_emails&limit=1').then(x => x?.[0]))),
    safe(loadJsonFile('OFFICE_MANAGER_ENGAGEMENTS.json', drive, folder).then(r => r.state?.engagements?.[missionId] || null)),
    safe(loadJsonFile('OFFICE_MANAGER_ENHANCED_AUDITOR.json', drive, folder).then(r => r.state?.reviews?.[missionId] || null)),
    safe((d.missionData || missionData)(missionId, { drive, folder })),
    safe(fetchRows('office_agent_messages?' + org + '&office_mission_id=eq.' + q(missionId) + '&select=id,subject,recipients,status,audience,created_at,sent_at,requested_by&order=created_at.desc&limit=40')),
    safe(fetchRows('office_audit_events?' + org + '&mission_id=eq.' + q(missionId) + '&select=at,agent,action_type,status,decision,reviewer&order=at.desc&limit=40')),
    safe(d.readMissionMemory ? d.readMissionMemory(orgId, missionId) : import('./mission-memory.js').then(m => m.readMissionMemory(orgId, missionId)))
  ]);
  const m = view.mission || {};
  const e = engagements || {}, t = e.tdr || {}, match = e.match || {};
  const status = canonicalStatus(m.status);
  const phase = phaseOf(m);
  const pbc = (view.actions || []).filter(a => /PBC/i.test(a.action_type || ''));
  const coverage = reviews?.coverage || [];
  const riskRows = [
    ...(t.risks_mentioned || []).map(r => ({ risk: r, source: 'TDR', level: null, verdict: null })),
    ...coverage.map(c => ({ risk: c.risk, source: /audit/i.test(c.source || '') ? 'Auditeur' : /grand|mission|gc|secteur|industr/i.test(c.source || '') ? 'Mission Controller / secteur' : (c.source || 'Revue'), level: c.level || null, verdict: c.verdict || null, missing: c.missing_procedures || [] })),
    ...((data?.facts) || []).filter(f => f.kind === 'risque').map(f => ({ risk: f.label || f.value, source: f.agent, level: null, verdict: null, note: f.value }))
  ];
  const contacts = (data?.contacts || []).map(c => ({ ...c, role_label: CONTACT_ROLES[c.role_key] || c.role || 'Interlocuteur', registered: (row?.client_contact_emails || []).map(x => String(x).toLowerCase()).includes(c.email || '') }));
  for (const em of row?.client_contact_emails || []) if (!contacts.some(c => c.email === String(em).toLowerCase())) contacts.push({ id: null, email: String(em).toLowerCase(), name: null, role_key: 'autre', role_label: 'Contact enregistré', status: 'validé', registered: true });
  const history = [
    ...((memory?.memory?.status_history) || []).map(h => ({ at: h.at, what: 'Statut : ' + (h.label || LABELS[h.status] || h.status), who: 'Mission Controller' })),
    ...((events) || []).map(ev => ({ at: ev.at, what: ev.action_type + ' — ' + ev.status + (ev.decision ? ' (' + ev.decision + ')' : ''), who: ev.reviewer || ev.agent })),
    ...((e.log) || []).map(l => ({ at: l.at, what: 'Préparation : ' + l.m, who: 'Mission Controller' })),
    ...((reviews?.log) || []).map(l => ({ at: l.at, what: 'Revue : ' + l.m, who: 'Enhanced Auditor' })),
    ...((data?.facts) || []).map(f => ({ at: f.at, what: (f.label || f.kind) + (f.value ? ' : ' + cut(f.value, 140) : ''), who: f.agent }))
  ].filter(h => h.at).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 80);

  return {
    ...view,
    status: { key: status, label: LABELS[status], phase: phase.key, phase_label: phase.label, moves: STATUSES.filter(s => canMove(m.status, s)).map(s => ({ key: s, label: LABELS[s] })) },
    client: row?.client_name || t.client || null,
    // A saved plan's briefing (Assistant) when the TDR has not been read.
    plan_briefing: data?.structured ? { ...data.structured } : null,
    briefing: e.status ? { status: e.status, finished_at: e.finished_at || null, client: t.client || null, country: t.country || null, industry: [t.industry, t.sub_industry].filter(Boolean).join(' / ') || null,
      engagement_type: t.engagement_type || null, funder: t.financing_or_funder || null, framework: t.reporting_framework || null, standards: t.applicable_standards || [],
      objectives: t.objectives || [], scope: t.scope || null, deliverables: t.deliverables || [], timeline: t.timeline || null, evaluation_criteria: t.evaluation_criteria || [], open_questions: t.open_questions || [],
      key_experts: t.key_experts || [], risk_brief: e.risk_brief?.text ? cut(e.risk_brief.text, 12000) : null, risk_doc: e.risk_doc?.url || null, report_doc: e.report_doc?.url || null,
      research_sources: (e.research?.sources || []).slice(0, 12), tdr_sources: e.tdr_sources || [] } : null,
    deadlines: [
      ...(t.deliverables || []).filter(x => x.due).map(x => ({ what: 'Livrable : ' + x.name, due: x.due })),
      ...(t.timeline?.submission_deadline ? [{ what: 'Date limite de soumission', due: t.timeline.submission_deadline }] : []),
      ...(m.planned_start ? [{ what: 'Début prévu', due: m.planned_start }] : []), ...(m.planned_end ? [{ what: 'Fin prévue', due: m.planned_end }] : []),
      ...(view.actions || []).filter(a => a.due_at && !['verified', 'rejected', 'cancelled'].includes(a.work_state || a.status)).map(a => ({ what: a.summary, due: String(a.due_at).slice(0, 10) })),
      ...((data?.facts) || []).filter(f => f.kind === 'echeance').map(f => ({ what: f.label, due: f.value }))
    ].sort((a, b) => String(a.due).localeCompare(String(b.due))),
    risks: riskRows,
    team_needed: (match.requirements || []).length ? (match.requirements || []).map(r => ({ capability: r.capability, category: r.category, level: r.level || null, internal: r.internal || null, people: (r.people || []).map(p => p.name).filter(Boolean), gap: Boolean(r.gap), source: r.source || null })) : ((data?.structured?.skills) || []).map(r => ({ capability: r.capability, category: null, level: r.level || null, internal: null, people: [], gap: false, source: 'plan enregistré' })),
    team_proposed: (match.proposed_team || []).map(p => ({ name: p.name, role: p.role, why: p.why, covers: p.covers || [] })),
    team_assigned: view.assignments || [],
    external_specialists: (e.externals?.items || []).map(x => ({ gap: x.gap, suggestions: x.suggestions || [] })),
    pbc: pbc.map(a => ({ id: a.id, summary: a.summary, status: a.work_state || a.status, due_at: a.due_at || null })),
    time_budget: timeBudget(m, view.assignments, t),
    contacts,
    messages: messages || [],
    review: reviews ? { status: reviews.status, finished_at: reviews.finished_at || null, summary: reviews.summary || null, overall: cut(reviews.overall, 3000), coverage, priority_actions: reviews.priority_actions || [], report: reviews.report?.url || null, matrix: reviews.matrix?.url || null } : null,
    facts: data?.facts || [],
    client_memory: memory?.memory ? { recurring_risks: memory.memory.client_permanent?.recurring_risks || [], previous_missions: (memory.memory.client_permanent?.missions_history || []).filter(x => x.id !== missionId) } : null,
    history
  };
}
