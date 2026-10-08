import crypto from 'node:crypto';
import { rest } from './supabase.js';
import { cockpit } from './cockpit.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile } from './mapping-scan.js';

// NOTIFICATIONS — ONE GLOBAL BELL (2026-10-08). Computed from what the agents and the team already
// record (no new store): PBC received, PBC late, deadline, critical risk, new document, review
// point, mission assigned, important e-mail, availability conflict, recommended training.
// Each event has a STABLE key: the same event never makes two notifications (the bell dedupes,
// and « lu » is remembered per person). Managers see the firm; a collaborator sees what concerns
// their missions and their own work.

const q = encodeURIComponent;
const DAY = 86400000;
const key = (...p) => crypto.createHash('sha1').update(p.join('|')).digest('hex').slice(0, 16);
const MANAGERS = new Set(['owner', 'partner', 'manager']);
export const TYPES = Object.freeze({ pbc_received: 'PBC reçue', pbc_late: 'PBC en retard', deadline: 'Échéance', critical_risk: 'Risque critique', new_document: 'Nouveau document',
  review_point: 'Point de revue', mission_assigned: 'Mission attribuée', important_email: 'E-mail important', availability_conflict: 'Conflit de disponibilité', training: 'Formation recommandée' });

const cache = new Map();
async function cockpitCached(orgId, d) {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < 60000) return hit.value;
  const value = await (d.cockpit || cockpit)(orgId, d);
  cache.set(orgId, { at: Date.now(), value });
  return value;
}

// Pure: notifications from the cockpit and the person's own facts.
export function buildNotifications(c, extra = {}, now = Date.now()) {
  const k = Object.fromEntries((c.kpis || []).map(x => [x.key, x]));
  const out = [];
  const add = (type, title, meta, href, id, at = null) => out.push({ key: key(type, id || title), type, label: TYPES[type], title: String(title || '').slice(0, 200), meta: meta || null, href: href || null, at });
  for (const it of k.pbc_missing?.items || []) { const m = /attendue le (\d{4}-\d{2}-\d{2})/.exec(it.meta || ''); if (m && Date.parse(m[1]) < now - DAY / 2) add('pbc_late', it.label, it.meta, it.href, 'pbc|' + it.label + '|' + it.meta); }
  for (const it of k.deadlines?.items || []) { const d = Date.parse(it.at); if (Number.isFinite(d) && d - now <= 3 * DAY) add('deadline', it.label, it.meta, it.href, 'dl|' + it.label + '|' + it.at, it.at); }
  for (const it of k.risks?.items || []) if (/élev|eleve|high|fraud|significati|critique/i.test(it.meta || '') || /non couvert/.test(it.meta || '')) add('critical_risk', it.label, it.meta, it.href, 'risk|' + it.label + '|' + it.meta);
  for (const it of k.review_points?.items || []) add('review_point', it.label, it.meta, it.href, 'rp|' + it.label);
  for (const it of k.mails?.items || []) if (/haute/.test(it.meta || '')) add('important_email', it.label, it.meta, '/accueil.html#mails', 'mail|' + it.label + '|' + it.meta);
  for (const it of k.conflicts?.items || []) add('availability_conflict', it.label, it.meta, it.href, 'conf|' + it.label + '|' + it.meta);
  for (const it of k.training?.items || []) add('training', it.label, it.meta, it.href, 'tr|' + it.label);
  for (const x of extra.pbcReceived || []) add('pbc_received', x.title, x.meta, x.href, 'pbcr|' + x.id, x.at);
  for (const x of extra.documents || []) add('new_document', x.title, x.meta, x.href, 'doc|' + x.id, x.at);
  for (const x of extra.assigned || []) add('mission_assigned', x.title, x.meta, x.href, 'asg|' + x.id, x.at);
  const seen = new Set();
  return out.filter(n => !seen.has(n.key) && seen.add(n.key));
}

export async function notifications(orgId, account, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const org = 'org_id=eq.' + q(orgId);
  const since = new Date(Date.now() - 3 * DAY).toISOString();
  const [c, received, me] = await Promise.all([
    cockpitCached(orgId, d).catch(() => ({ kpis: [] })),
    fetchRows('office_action_queue?' + org + '&action_type=eq.PBC_MAIL_RECEIVED&created_at=gte.' + q(since) + '&select=id,summary,office_mission_id,created_at&order=created_at.desc&limit=30').catch(() => []),
    account?.email ? fetchRows('office_staff_profiles?' + org + '&email=eq.' + q(String(account.email).toLowerCase()) + '&select=id&limit=1').then(r => r?.[0] || null).catch(() => null) : null
  ]);
  // New documents: deposits of the last 3 days (Rangement).
  const deposits = (await loadJsonFile('OFFICE_MANAGER_DEPOSITS.json', d.drive || driveAdapter, d.folder || memoryFolderId()).catch(() => ({ state: null }))).state?.deposits || {};
  const documents = Object.entries(deposits).filter(([, x]) => x.started_at && x.started_at >= since).slice(0, 20)
    .map(([id, x]) => ({ id, title: (x.documents || []).length + ' document(s) déposé(s)' + (x.label ? ' — ' + x.label : ''), meta: [x.by, (x.documents || []).slice(0, 3).map(y => y.name).join(', ')].filter(Boolean).join(' · '), href: '/rangement.html', at: x.started_at }));
  let assigned = [], myMissions = null;
  if (me) {
    const rows = await fetchRows('office_mission_assignments?' + org + '&staff_profile_id=eq.' + q(me.id) + '&status=not.in.(rejected,cancelled,completed)&select=id,office_mission_id,mission_role,planned_start,planned_end&limit=50').catch(() => []) || [];
    myMissions = new Set(rows.map(r => r.office_mission_id));
    const names = rows.length ? Object.fromEntries((await fetchRows('office_missions?' + org + '&id=in.(' + [...myMissions].join(',') + ')&select=id,name&limit=50').catch(() => []) || []).map(m => [m.id, m.name])) : {};
    assigned = rows.filter(r => !r.planned_end || Date.parse(r.planned_end) >= Date.now()).map(r => ({ id: r.id, title: 'Vous êtes sur « ' + (names[r.office_mission_id] || 'une mission') + ' »', meta: [r.mission_role, [r.planned_start, r.planned_end].filter(Boolean).join(' → ')].filter(Boolean).join(' · '), href: '/mission.html?id=' + encodeURIComponent(r.office_mission_id) }));
  }
  let list = buildNotifications(c, { pbcReceived: (received || []).map(r => ({ id: r.id, title: r.summary, meta: 'pièce reçue par e-mail', href: '/validations.html', at: r.created_at })), documents, assigned });
  // A collaborator: what concerns their missions and their own work.
  if (!MANAGERS.has(account?.role)) {
    const mine = n => n.type === 'mission_assigned' || n.type === 'new_document' || (n.href && myMissions && [...myMissions].some(id => n.href.includes(id)));
    list = list.filter(n => mine(n) && !['important_email', 'training', 'availability_conflict'].includes(n.type));
  }
  return { notifications: list.slice(0, 80), types: TYPES, at: new Date().toISOString() };
}
