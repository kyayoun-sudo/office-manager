import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { loadJsonFile, updateJsonFile } from './mapping-scan.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';

// WHO IS IN THE FIRM (Paul, 2026-10-08: « il a mis des gens fictifs et d'autres qui ne sont pas du
// cabinet ; l'IA doit connaître les membres du cabinet un minimum »). One source of truth:
//   1. the firm's team sheet in its HR folder (e.g. 04_EQUIPE_RH_CV / TATY_EQUIPE_RESPONSABLES),
//   2. the people who use the application,
//   3. the profiles the owner confirmed in Équipe.
// Nobody else is a member: not the experts of a proposal (consortium, partners), not the people of
// a training mission (fictive), not a client contact. Those stay where they belong (capability
// database as external experts, mission contacts). Profiles added by an agent that match none of
// these are taken OUT of Équipe (deactivated, never deleted: the owner can bring them back).

const FILE = 'OFFICE_MANAGER_FIRM_MEMBERS.json';
const FOLDER = 'application/vnd.google-apps.folder';
const q = encodeURIComponent;
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').trim();
const TEAM_SHEET = /(equipe|équipe|team|responsables|effectif|personnel|staff|organigramme|annuaire|collaborateurs)/i;
const NOT_FIRM = /(entrainement|fictif|training|appel[s]? d.offres?|propositions?|consortium|offre|implus|ami|eoi|rfp|tdr)/i;

const READ = `Tu lis le tableau de l'ÉQUIPE d'un cabinet (audit, expertise, conseil). Relève UNIQUEMENT les personnes qui en sont membres (associés, managers, collaborateurs, assistants, stagiaires du cabinet).
N'inclus pas : experts externes, partenaires d'un consortium, sous-traitants, clients, personnes d'une proposition.
JSON STRICT : {"members":[{"full_name":"","email":"","role":"","grade":""}],"excluded":[{"name":"","why":""}]}`;

export function sameName(a, b) {
  const A = norm(a).split(' ').filter(w => w.length > 1), B = norm(b).split(' ').filter(w => w.length > 1);
  if (!A.length || !B.length) return false;
  if (A.join(' ') === B.join(' ')) return true;
  // « Walid » vs « Walid Benali »: a single first name only matches a unique full name (checked by the caller).
  const [s, l] = A.length <= B.length ? [A, B] : [B, A];
  return s.every(w => l.includes(w)) && s.length >= 2;
}

// The team sheet, read by the AI only when it changed (its result kept in the agents' memory).
export async function teamSheetMembers(d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const { hrFolderId } = await import('./people-policy.js');
  const hr = await (d.hrFolderId || hrFolderId)(d).catch(() => null);
  if (!hr) return { members: [], source: null, reason: 'HR_FOLDER_NOT_FOUND' };
  const files = (await drive.listChildren(hr).catch(() => []) || []).filter(f => f.mimeType !== FOLDER && /sheet|excel|csv/i.test(f.mimeType || '') && TEAM_SHEET.test(f.name || '') && !NOT_FIRM.test(f.name || ''));
  const sheet = files.sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')))[0];
  if (!sheet) return { members: [], source: null, reason: 'TEAM_SHEET_NOT_FOUND' };
  const { state } = await loadJsonFile(FILE, drive, folder).catch(() => ({ state: null }));
  if (state?.sheet_id === sheet.id && state?.sheet_modified === sheet.modifiedTime && (state.members || []).length) return { members: state.members, source: sheet.name, cached: true };
  const t = await drive.readText(sheet.id, { maxChars: 40000 }).catch(() => null);
  const text = String(t?.text ?? t ?? '');
  if (text.trim().length < 10) return { members: [], source: sheet.name, reason: 'TEAM_SHEET_UNREADABLE' };
  const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: READ, input: '### ' + sheet.name + '\n' + text, maxTokens: 4000 }, d);
  const out = parseJsonLoose(r.text);
  const members = (out.members || []).filter(m => String(m.full_name || '').trim()).slice(0, 200).map(m => ({ full_name: String(m.full_name).trim().slice(0, 120), email: String(m.email || '').toLowerCase().trim().slice(0, 254) || null, role: String(m.role || '').slice(0, 120) || null, grade: String(m.grade || '').slice(0, 80) || null }));
  await (d.updateJsonFile || updateJsonFile)(FILE, () => ({ sheet_id: sheet.id, sheet_name: sheet.name, sheet_modified: sheet.modifiedTime || null, read_at: new Date().toISOString(), members, excluded: (out.excluded || []).slice(0, 100) }), { drive, folder });
  return { members, source: sheet.name };
}

// Everyone who belongs to the firm (sheet ∪ users of the app ∪ profiles confirmed by the owner).
export async function firmMembers(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const sheet = await (d.teamSheetMembers || teamSheetMembers)(d).catch(e => ({ members: [], reason: String(e.message || e).slice(0, 80) }));
  const users = await fetchRows('office_app_users?org_id=eq.' + q(orgId) + '&active=eq.true&select=email,display_name,role&limit=500').catch(() => []) || [];
  const staff = await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&select=id,full_name,email,role_title,grade_title,active,profile_status&limit=1000').catch(() => []) || [];
  const out = [];
  const add = (m, source) => {
    const email = String(m.email || '').toLowerCase() || null;
    const hit = out.find(x => (email && x.email === email) || sameName(x.full_name, m.full_name));
    if (hit) { hit.sources.push(source); hit.email ||= email; hit.role ||= m.role || null; return; }
    out.push({ full_name: m.full_name, email, role: m.role || null, sources: [source] });
  };
  for (const m of sheet.members || []) add(m, 'tableau de l’équipe');
  for (const u of users) add({ full_name: u.display_name || String(u.email).split('@')[0], email: u.email, role: u.role }, 'utilisateur de l’application');
  for (const s of staff) if (s.active && s.profile_status && s.profile_status !== 'needs_review') add({ full_name: s.full_name, email: s.email, role: s.role_title }, 'confirmé dans Équipe');
  return { members: out, sheet: sheet.source || null, sheet_read: Boolean((sheet.members || []).length), reason: sheet.reason || null, staff };
}

export function isMember(members, p) {
  const email = String(p.email || '').toLowerCase();
  if (email && members.some(m => m.email === email)) return true;
  const named = members.filter(m => sameName(m.full_name, p.full_name || p.name));
  return named.length === 1;
}

// Équipe = the members. Agent-added profiles that are not members leave Équipe (deactivated).
// Only when the team sheet was really read: without it, nobody is taken out.
export async function cleanTeam(orgId, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const f = await (d.firmMembers || firmMembers)(orgId, d);
  if (!f.sheet_read) return { cleaned: [], skipped: f.reason || 'TEAM_SHEET_NOT_READ' };
  const cleaned = [];
  for (const s of f.staff.filter(x => x.active && (!x.profile_status || x.profile_status === 'needs_review'))) {
    if (isMember(f.members, s)) continue;
    await fetchRows('office_staff_profiles?org_id=eq.' + q(orgId) + '&id=eq.' + q(s.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active: false }) }).catch(() => null);
    cleaned.push(s.full_name);
  }
  return { cleaned, members: f.members.length, sheet: f.sheet };
}

// A short line for the agents' context: who the firm's people are.
export async function membersLine(orgId, d = {}) {
  const f = await firmMembers(orgId, d);
  if (!f.members.length) return null;
  return 'MEMBRES DU CABINET (seules ces personnes sont l’équipe ; les autres noms des documents sont des clients, des experts externes ou des personnes fictives d’entraînement) : ' +
    f.members.slice(0, 80).map(m => m.full_name + (m.role ? ' (' + m.role + ')' : '') + (m.email ? ' <' + m.email + '>' : '')).join(' ; ') + '.';
}
