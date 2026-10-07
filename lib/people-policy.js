import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';
import { PEOPLE_RULES } from './people-intelligence.js';

// The firm's people-management policy (Paul, 2026-10-07: « pour la people intelligence, utilise
// celle de TATY & Associés, mais garde les règles que tu avais »). The owner gives the document
// once (Paramètres); it is kept in the agents' memory in the Drive (00_OFFICE_MANAGER /
// OFFICE_MANAGER_PEOPLE_POLICY.md), never in the application code. Every agent run receives it,
// together with the app's own rules R009–R012, which always prevail.

const FILE = 'OFFICE_MANAGER_PEOPLE_POLICY.md';
const MAX = 120000;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });

export async function loadPeoplePolicy(d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const found = await drive.findFilesByExactName(FILE, folder).catch(() => []);
  if (!found?.[0]) return { text: '', file_id: null, updated_at: null };
  const buf = await drive.downloadBuffer(found[0].id);
  return { text: Buffer.from(buf).toString('utf8'), file_id: found[0].id, updated_at: found[0].modifiedTime || null };
}

export async function savePeoplePolicy(body = {}, d = {}) {
  const drive = d.drive || driveAdapter, folder = d.folder || memoryFolderId();
  const text = String(body.text || '').trim();
  if (!text) throw fail('POLICY_EMPTY');
  if (text.length > MAX) throw fail('POLICY_TOO_LONG');
  const found = await drive.findFilesByExactName(FILE, folder).catch(() => []);
  const buffer = Buffer.from(text, 'utf8');
  if (found?.[0]) {
    const meta = await drive.getMeta(found[0].id);
    await drive.updateBinary(found[0].id, { buffer, mimeType: 'text/markdown', expectedModifiedTime: meta?.modifiedTime });
  } else {
    await drive.createBinary({ name: FILE, parentId: folder, buffer, mimeType: 'text/markdown' });
  }
  return { saved: true, characters: text.length };
}

// What every agent receives: the firm's policy, under the app's hard rules.
export function peoplePolicyContext(text) {
  return {
    hard_rules_always_prevail: PEOPLE_RULES,
    firm_people_management_policy: text ? String(text).slice(0, 60000) : null,
    how_to_use: text
      ? 'Apply the firm\'s people-management policy when staffing, briefing, writing to a colleague (use each person\'s COMMUNICATION PROTOCOL), building a mission RACI, detecting team misfit, recommending training or reading KPIs. The hard rules above always prevail: no clinical diagnosis, no sensitive HR decision from a questionnaire alone, profiles revised only on validated post-mission evidence, check skills/availability/load before staffing. Propose; a manager decides.'
      : 'No firm policy given yet: apply the hard rules above.'
  };
}
