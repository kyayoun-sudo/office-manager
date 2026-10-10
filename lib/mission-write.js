import crypto from 'node:crypto';
import { rest } from './supabase.js';
import { getPersona } from './agent-persona.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { proposeMessage, decideMessage, isColleague } from './agent-mail.js';
import { getMissionContacts } from './mission-view.js';
import { missionData, CONTACT_ROLES } from './mission-data.js';

// WRITING TO THE CLIENT FROM A MISSION (2026-10-08). « Écrire à l'équipe » is kept as it is; this
// adds writing to the mission's EXTERNAL people. The person chooses the purpose (PBC, PBC
// reminder, purchases / sales question, meeting, document request, confirmation, information,
// other) and the cycle; Office Manager proposes the recipients (To: the person in charge of that
// cycle; Cc: the client's CFO + the mission manager + the agent's alias); the person types what
// they want, the AI writes the professional message, the person reads and edits it.
// NOTHING leaves before a validation: a manager / partner / owner who clicks « Valider et
// envoyer » validates; a collaborator's message waits in « Messagerie » for a manager.
// Only addresses REGISTERED on the mission can receive it (validated contacts) — plus colleagues.

export const PURPOSES = Object.freeze({ pbc: 'Demande PBC', relance_pbc: 'Relance PBC', achats: 'Question Achats', ventes: 'Question Ventes', reunion: 'Réunion',
  document: 'Demande de document', confirmation: 'Confirmation', information: 'Information', autre: 'Autre' });
export const CYCLES = Object.freeze({ achats: 'Achats', ventes: 'Ventes', tresorerie: 'Trésorerie', paie: 'Paie / personnel', immobilisations: 'Immobilisations', stocks: 'Stocks',
  fiscalite: 'Fiscalité', it: 'Systèmes d’information', cloture: 'Clôture / états financiers', juridique: 'Juridique', autre: 'Autre' });
const CYCLE_ROLE = { achats: 'achats', ventes: 'ventes', tresorerie: 'tresorerie', paie: 'paie', it: 'it', juridique: 'juridique', immobilisations: 'comptabilite', stocks: 'comptabilite', fiscalite: 'comptabilite', cloture: 'comptabilite' };
const VALIDATORS = new Set(['owner', 'partner', 'manager']);
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const cut = (s, n) => String(s ?? '').slice(0, n);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Pure: who should receive it.
export function suggestRecipients({ purpose, cycle }, contacts, team, persona) {
  const ok = contacts.filter(c => c.email && c.status === 'validé');
  const byRole = k => ok.filter(c => c.role_key === k);
  const byCycle = k => ok.filter(c => c.role_key === 'cycle' && norm(c.cycle).includes(norm(CYCLES[k] || k).slice(0, 5)));
  let to = [];
  const roleFor = purpose === 'achats' ? 'achats' : purpose === 'ventes' ? 'ventes' : CYCLE_ROLE[cycle] || null;
  if (cycle && cycle !== 'autre') to = [...byCycle(cycle), ...(roleFor ? byRole(roleFor) : [])];
  else if (roleFor) to = byRole(roleFor);
  if (!to.length && ['confirmation'].includes(purpose)) to = [...byRole('tcwg'), ...byRole('cfo')];
  if (!to.length) to = byRole('comptabilite').length ? byRole('comptabilite') : byRole('cfo');
  const cfo = byRole('cfo').filter(c => !to.includes(c));
  const manager = team.find(t => /manager|chef|responsable|lead|associ|partner/i.test(t.role || '')) || null;
  const cc = [...cfo.map(c => ({ email: c.email, label: (c.name || c.email) + ' — ' + CONTACT_ROLES.cfo })),
    ...(manager ? [{ email: manager.email, label: manager.name + ' — manager de la mission' }] : []),
    ...(persona?.sender_email ? [{ email: String(persona.sender_email).toLowerCase(), label: (persona.agent_display_name || 'Agent') + ' — alias de l’agent' }] : [])];
  const seen = new Set();
  const uniq = l => l.filter(x => x.email && !seen.has(x.email) && seen.add(x.email));
  return { to: uniq(to.map(c => ({ email: c.email, label: (c.name || c.email) + ' — ' + (c.role || CONTACT_ROLES[c.role_key] || 'contact') }))), cc: uniq(cc),
    missing: !to.length ? 'Aucun interlocuteur client validé pour ce cycle : ajoutez-le dans « Contacts client » de la mission.' : null };
}

export function meetingLink(missionName) {
  const slug = norm(missionName).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'reunion';
  return 'https://meet.jit.si/OM-' + slug + '-' + crypto.randomBytes(4).toString('hex');
}

async function context(orgId, missionId, d) {
  const fetchRows = d.fetchRows || rest;
  const m = (await fetchRows('office_missions?org_id=eq.' + encodeURIComponent(orgId) + '&id=eq.' + encodeURIComponent(missionId) + '&select=id,name,mission_code,client_contact_emails&limit=1'))?.[0];
  if (!m) throw fail('MISSION_NOT_FOUND', 404);
  const [persona, data, team] = await Promise.all([(d.getPersona || getPersona)(orgId).catch(() => null), (d.missionData || missionData)(missionId, d).catch(() => ({ contacts: [] })),
    (d.getMissionContacts || getMissionContacts)(orgId, missionId, d).catch(() => ({ team: [] }))]);
  // Addresses registered on the mission without a contact card still count.
  const contacts = [...(data.contacts || [])];
  for (const e of m.client_contact_emails || []) if (!contacts.some(c => c.email === String(e).toLowerCase())) contacts.push({ email: String(e).toLowerCase(), status: 'validé', role_key: 'autre' });
  return { mission: m, persona, contacts: contacts.map(c => (m.client_contact_emails || []).map(x => String(x).toLowerCase()).includes(c.email) ? { ...c, status: 'validé' } : c), team: team.team || [] };
}

export async function suggest(orgId, missionId, input, d = {}) {
  const c = await context(orgId, missionId, d);
  const s = suggestRecipients(input, c.contacts, c.team, c.persona);
  return { ...s, contacts: c.contacts.filter(x => x.email && x.status === 'validé').map(x => ({ email: x.email, label: (x.name || x.email) + (x.role ? ' — ' + x.role : '') })),
    team: c.team.map(t => ({ email: t.email, label: t.name + (t.role ? ' — ' + t.role : '') })), purposes: PURPOSES, cycles: CYCLES,
    meeting_link: input.purpose === 'reunion' ? meetingLink(c.mission.name) : null };
}

const DRAFT = `Tu rédiges, pour un cabinet d'audit, un e-mail PROFESSIONNEL à un interlocuteur du client, à partir de ce que le collaborateur veut dire. Français (ou la langue demandée), courtois, précis, concis. Pour une demande PBC ou de document : liste claire des pièces, format attendu, date souhaitée si elle est donnée. Pour une réunion : objet, date et heure, durée, participants, et le LIEN DE RÉUNION fourni tel quel dans le message. N'invente ni pièce, ni date, ni chiffre. Signe au nom du collaborateur et du cabinet.
JSON STRICT : {"subject":"","body":""}`;

export async function draft(orgId, missionId, input, account, d = {}) {
  const c = await context(orgId, missionId, d);
  if (String(input.request || '').trim().length < 3) throw fail('REQUEST_REQUIRED');
  const meeting = input.purpose === 'reunion' ? { subject: cut(input.meeting?.subject, 200), slot: cut(input.meeting?.slot, 60), duration: cut(input.meeting?.duration, 30), participants: cut(input.meeting?.participants, 500), link: /^https:\/\//.test(input.meeting?.link || '') ? cut(input.meeting.link, 300) : meetingLink(c.mission.name) } : null;
  const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: DRAFT, maxTokens: 2500,
    input: 'MISSION : ' + c.mission.name + '\nBUT : ' + (PURPOSES[input.purpose] || 'Autre') + (input.cycle ? '\nCYCLE : ' + (CYCLES[input.cycle] || input.cycle) : '') +
      '\nDESTINATAIRES : ' + cut((input.to || []).join(', '), 400) + '\nCE QUE VEUT DIRE ' + (account?.display_name || 'le collaborateur') + ' : ' + cut(input.request, 3000) +
      (meeting ? '\nRÉUNION : ' + JSON.stringify(meeting) : '') + '\nSIGNATURE : ' + (account?.display_name || '') + (c.persona?.agent_display_name ? ', ' + c.persona.agent_display_name : '') });
  let x = {};
  try { x = parseJsonLoose(r.text); } catch { x = { body: r.text }; }
  let body = cut(x.body || '', 10000);
  if (meeting && !body.includes(meeting.link)) body += '\n\nLien de la réunion : ' + meeting.link;
  return { subject: cut(x.subject || (PURPOSES[input.purpose] + ' — ' + c.mission.name), 200), body, meeting };
}

// Validated and sent by a manager, or waiting for one (collaborator).
export async function submit(orgId, missionId, input, account, d = {}) {
  const to = (input.to || []).map(e => String(e).trim().toLowerCase()).filter(Boolean);
  if (!to.length) throw fail('RECIPIENTS_REQUIRED');
  const persona = await (d.getPersona || getPersona)(orgId);
  const external = [...to, ...(input.cc || [])].some(e => !isColleague(e, persona));
  const saved = await (d.proposeMessage || proposeMessage)(orgId, { audience: external ? 'client' : 'colleagues', office_mission_id: missionId, recipients: to, cc: input.cc || [],
    subject: input.subject, body: input.body, source: 'person', topic: '[' + (PURPOSES[input.purpose] || 'Autre') + (input.cycle ? ' · ' + (CYCLES[input.cycle] || input.cycle) : '') + '] ' + cut(input.request, 300) }, account, d.mailDeps || {});
  if (VALIDATORS.has(account?.role) && input.send === true) {
    const r = await (d.decideMessage || decideMessage)(orgId, { id: saved.id, decision: 'approve', seen_sha256: saved.content_sha256 }, account, d.mailDeps || {});
    return { message_id: saved.id, status: r?.status || 'sending', sent: r?.status === 'sent' };
  }
  return { message_id: saved.id, status: 'pending_approval', sent: false };
}
