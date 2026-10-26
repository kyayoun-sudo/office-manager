// Entraîner les agents avec de vraies personnes (Paul, 2026-10-26 : « je veux donner à un auditeur aujourd'hui, qui n'a pas accès à toute
// l'application ; le but c'est d'entraîner les agents ; il crée sa mission, ouvre sa session, met son Drive, travaille et corrige ; il fait et
// refait »).
// L'auditeur travaille dans SON cabinet d'entraînement (plusieurs cabinets dans une installation) : il ne voit rien du cabinet de Paul.
// Chacune de ses corrections est enregistrée ICI, pour toute la plateforme (table office_agent_feedback) : ce que l'agent proposait, ce
// que la personne a dit, l'étape. Le propriétaire de la plateforme (propriétaire / associé du cabinet pilote) valide ou refuse ; une
// correction VALIDÉE est donnée à l'IA dans tous les cabinets (fiches des pièces, remplissage des feuilles). Aucune donnée de client :
// familles, en-têtes, phrase de la personne. Une erreur d'enregistrement ne bloque jamais le travail de l'auditeur.
import { rest } from './supabase.js';
import { pilotOrgId } from './firm-context.js';

const q = v => encodeURIComponent(String(v ?? ''));
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const PLATFORM_LEADS = ['owner', 'partner'];

// One correction. Never throws (the auditor's work goes on); returns the row or null.
export async function recordFeedback(orgId, f = {}, account = {}, d = {}) {
  if (!orgId || !f.agent || !f.kind) return null;
  const row = { source_org_id: orgId, mission_id: f.mission_id || null, agent: clip(f.agent, 40), step: clip(f.step || f.kind, 60), kind: clip(f.kind, 40),
    model_key: clip(f.model_key, 200), sheet: clip(f.sheet, 80), proposed: clip(f.proposed, 2000), correction: clip(f.correction, 2000),
    subject: f.subject && typeof f.subject === 'object' ? JSON.parse(JSON.stringify(f.subject).slice(0, 20000) || '{}') : {}, by_email: clip(account.email, 254) };
  try { const r = await (d.fetchRows || rest)('office_agent_feedback', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([row]) }); return r?.[0] || null; }
  catch { return null; }
}

const isPlatformLead = (orgId, account) => orgId === pilotOrgId() && PLATFORM_LEADS.includes(account?.role);

// The list: the platform's leads see every cabinet's corrections; anyone else only those of their own cabinet.
export async function listFeedback(orgId, account, query = {}, d = {}) {
  const status = ['proposed', 'validated', 'rejected'].includes(query.status) ? query.status : null;
  const all = isPlatformLead(orgId, account);
  const rows = await (d.fetchRows || rest)(`office_agent_feedback?select=id,source_org_id,mission_id,agent,step,kind,model_key,sheet,proposed,correction,subject,by_email,created_at,status,decided_by,decided_at,decision_note${all ? '' : '&source_org_id=eq.' + q(orgId)}${status ? '&status=eq.' + status : ''}&order=created_at.desc&limit=300`).catch(e => { if (/office_agent_feedback/.test(String(e.message))) throw fail('AGENT_TRAINING_SQL_NOT_INSTALLED', 409); throw e; });
  return { may_decide: all, items: rows || [], progress: progress(rows || []) };
}

// How the agents are doing, step by step: the share of steps validated WITHOUT a correction (first time right).
export function progress(rows) {
  const by = {};
  for (const r of rows) { const k = r.agent + ' · ' + r.step; const x = (by[k] ||= { agent: r.agent, step: r.step, accepted: 0, corrected: 0 }); if (r.kind === 'accepted_as_is') x.accepted++; else x.corrected++; }
  return Object.values(by).map(x => ({ ...x, first_time_right: x.accepted + x.corrected ? Math.round(100 * x.accepted / (x.accepted + x.corrected)) : null }));
}

export async function decideFeedback(orgId, account, body = {}, d = {}) {
  if (!isPlatformLead(orgId, account)) throw fail('PLATFORM_LEAD_REQUIRED', 403);
  const decision = body.decision === 'validated' ? 'validated' : body.decision === 'rejected' ? 'rejected' : null;
  if (!body.id || !decision) throw fail('ID_AND_DECISION_REQUIRED');
  const r = await (d.fetchRows || rest)(`office_agent_feedback?id=eq.${q(body.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: decision, decided_by: account.email || null, decided_at: new Date().toISOString(), decision_note: clip(body.note, 500) }) });
  if (!r?.[0]) throw fail('FEEDBACK_NOT_FOUND', 404);
  await (d.audit || (async (o, x) => (await import('./audit-log.js')).audit(o, x)))(orgId, { agent: 'shadow', action_type: 'AGENT_FEEDBACK_' + decision.toUpperCase(), status: 'succeeded', actor: account.email || null, decision: (r[0].agent + ' / ' + r[0].step + ' : ' + (r[0].correction || '')).slice(0, 900) }).catch(() => null);
  return r[0];
}

// What the AI receives in EVERY cabinet: the validated corrections of this kind (and of this working-file model / sheet when given).
export async function validatedFeedback({ kind, model_key, sheet, limit = 30 } = {}, d = {}) {
  const rows = await (d.fetchRows || rest)(`office_agent_feedback?status=eq.validated${kind ? '&kind=eq.' + q(kind) : ''}${model_key ? '&model_key=eq.' + q(model_key) : ''}${sheet ? '&sheet=eq.' + q(sheet) : ''}&select=kind,step,model_key,sheet,proposed,correction,subject,decided_at&order=decided_at.desc&limit=${Math.min(100, limit)}`).catch(() => []);
  return rows || [];
}
