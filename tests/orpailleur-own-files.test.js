import test from 'node:test';
import assert from 'node:assert/strict';
import { isAgentOwnFile } from '../lib/agent-files.js';
import { tidyCandidates } from '../lib/tidy-plan.js';
import { findAtelier, HOME_NAME } from '../lib/memory-home.js';
import { existingMemoryRequired } from '../lib/memory-runtime.js';

test('the agents’ own files are never filing candidates (no question after each pass)', () => {
  const items = [
    { id: '1', name: 'AUDIT_LOG', mimeType: 'application/vnd.google-apps.spreadsheet', path: '(dossier hors carte)/AUDIT_LOG' },
    { id: '2', name: 'ORPAILLEUR_JOURNAL', path: '00_CABINET_AI_MANAGER/ORPAILLEUR_JOURNAL' },
    { id: '3', name: 'OFFICE_MANAGER_TIDY_STATE.json', path: 'X/OFFICE_MANAGER_TIDY_STATE.json' },
    { id: '4', name: 'rapport.docx', path: '00_OFFICE_MANAGER_AI/ENHANCED_AUDITOR/rapport.docx' },
    { id: '5', name: 'note.pdf', path: '(dossier hors carte)/note.pdf', parents: ['HOME'] },
    { id: '6', name: 'Facture client.pdf', path: 'A_RANGER/Facture client.pdf' },
    { id: '7', name: 'Contrat.pdf', path: 'Contrat.pdf', parents: ['ROOT'] }
  ];
  assert.deepEqual(items.filter(i => isAgentOwnFile(i, ['HOME'])).map(i => i.id), ['1', '2', '3', '4', '5']);
  const left = tidyCandidates(items).map(i => i.id);
  assert.ok(left.includes('6'), 'what people drop in A_RANGER is filed');
  assert.ok(left.includes('7'), 'loose files at the root are filed');
  for (const id of ['1', '2', '3', '4']) assert.ok(!left.includes(id), id);
});

test('a firm-chosen Drive gets its memory created; « existing memory required » stays for the pilot’s server folder', () => {
  assert.equal(existingMemoryRequired({ OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY: 'false' }), false);
  // No Drive chosen in this process: the server-set folder is the pilot's, its migrated memory must exist.
  assert.equal(existingMemoryRequired({ OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY: 'true' }), true);
});

test('a Drive with no « … AI MANAGER » folder: the agents’ home and its MEMORY are created, once', async () => {
  const created = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'POST') { const b = JSON.parse(init.body); created.push(b); return { ok: true, status: 200, json: async () => ({ id: 'id-' + created.length, name: b.name }) }; }
    return { ok: true, status: 200, json: async () => ({ files: [] }) };
  };
  const H = { headers: {} };
  assert.equal(await findAtelier(H, { kind: 'drive', driveId: 'D', fetchImpl }), null, 'without create: nothing made');
  const a = await findAtelier(H, { kind: 'drive', driveId: 'D', fetchImpl, create: true });
  assert.deepEqual(created.map(c => [c.name, c.parents[0]]), [[HOME_NAME, 'D'], ['MEMORY', 'id-1']]);
  assert.equal(a.manager.created, true);
  assert.equal(a.name, 'MEMORY');
});

test('« Comprendre le cabinet » never sees the agents’ folders nor asks about the audit log', async () => {
  const { folderOutline, firmKnowledge } = await import('../lib/firm-learning.js');
  const F = 'application/vnd.google-apps.folder';
  const out = folderOutline([{ mimeType: F, path: '01_CLIENTS' }, { mimeType: F, path: '00_OFFICE_MANAGER_AI' }, { mimeType: F, path: '00_OFFICE_MANAGER_AI/AUDIT LOGS' },
    { mimeType: F, path: 'AUDIT LOGS' }, { mimeType: F, path: '00_CABINET_AI_MANAGER/MEMORY' }, { mimeType: F, path: 'A_RANGER' }]);
  assert.deepEqual(out.split('\n'), ['01_CLIENTS', 'A_RANGER']);
  const state = { status: 'applied', questions: ['Où dois-je placer le dossier AUDIT LOGS ?', 'Qui est l’associé de la mission Nova 2026 ?'], open_questions: ['Faut-il garder la mémoire des agents dans MEMORY ?'] };
  const drive = { findFilesByExactName: async () => [{ id: 'k' }], downloadBuffer: async () => Buffer.from(JSON.stringify(state)) };
  const k = await firmKnowledge({ drive, folder: 'm' });
  assert.deepEqual(k.questions, ['Qui est l’associé de la mission Nova 2026 ?']);
  assert.deepEqual(k.open_questions, []);
});

test('the Orpailleur never asks (nor moves to review) one of the agents’ files', async () => {
  const { askMissing } = await import('../lib/orpailleur-ask.js');
  let moved = false;
  const r = await askMissing('org', { id: 'a', name: 'AUDIT_LOG', path: '(dossier hors carte)/AUDIT_LOG', parents: ['X'] }, { question: 'Où ranger ?' }, {},
    { whoToAsk: async () => ({ email: 'p@c.ci' }), tidyDrive: { move: async () => { moved = true; } }, reviewFolderId: 'R' });
  assert.equal(r.skipped, 'AGENT_OWN_FILE'); assert.equal(moved, false);
});
