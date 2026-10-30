// Le cerveau commun : l'IA comprend et ordonne, le code vérifie et exécute ; la mémoire partagée de la mission (Paul, 2026-10-26).
import test from 'node:test';
import assert from 'node:assert/strict';
import { think, runApproved } from '../lib/agent-brain.js';
import { noteMission, closeNote, missionNotes, missionBrief, mergeNotes } from '../lib/mission-brief.js';

// An in-memory Drive register for the mission's notes (central index + the mission's own folder).
function store() {
  const files = {};
  return { files,
    updateJsonFile: async (name, fn, o) => { const k = (o.folder || '') + '/' + name; files[k] = fn(files[k] || null); return { state: files[k], fileId: k }; },
    loadFile: (name, folder) => ({ state: files[(folder || '') + '/' + name] || null }) };
}

test('l’IA ordonne parmi les actions permises ; le code refuse ce qui n’est pas permis ou pas valable, et met en attente ce qui touche une personne', async () => {
  const ran = [], written = [];
  const actions = {
    rename: { describe: 'renommer un fichier : file_id, name', check: p => (p.file_id === 'F1' && p.name ? { ok: true } : { ok: false, why: 'fichier hors mission' }), run: p => { ran.push(p); return { renamed: p.name }; } },
    send_mail: { describe: 'envoyer un mail au client : to, text', approval: true, run: () => { throw new Error('jamais sans accord'); } }
  };
  const r = await think({ orgId: 'O', missionId: 'M', agent: 'orpailleur', task: 'ranger', read: { files: [{ id: 'F1', text: 'TEB 2023' }] }, actions, by: 'p@x' }, {
    missionBrief: async () => ({ mission: { id: 'M' }, documents: [], open: [{ id: 'n1', kind: 'manquant', text: 'TEB 2023 à obtenir' }], settled: [] }),
    noteMission: async (o, m, n) => { written.push(...n); }, closeNote: async (o, m, id, x) => { written.push({ closed: id, ...x }); },
    ai: async (pr, o) => { const inp = JSON.parse(o.input); assert.equal(inp.mission_memory.open[0].text, 'TEB 2023 à obtenir'); assert.deepEqual(inp.actions.map(a => a.action), ['rename', 'send_mail']);
      return { provider: 'ia', text: JSON.stringify({ understanding: 'F1 est le TEB 2023', orders: [
        { action: 'rename', params: { file_id: 'F1', name: 'TEB_2023.xlsx' }, why: 'c’est le TEB' }, { action: 'rename', params: { file_id: 'Z' }, why: 'x' },
        { action: 'delete_everything', params: {} }, { action: 'send_mail', params: { to: 'c@x', text: 'merci' }, why: 'accusé de réception' }],
        notes: [{ kind: 'fait', text: 'Le TEB 2023 est reçu (F1)', for: ['mission-controller', 'enhanced-auditor'] }], close: [{ id: 'n1', why: 'reçu' }, { id: 'inconnue' }] }) }; } });
  assert.deepEqual(ran, [{ file_id: 'F1', name: 'TEB_2023.xlsx' }]);
  assert.deepEqual(r.refused.map(x => x.refused), ['fichier hors mission', 'action inconnue pour cet agent']);
  assert.equal(r.proposed[0].action, 'send_mail', 'ce qui touche une personne attend son accord');
  assert.ok(written.some(n => n.kind === 'fait' && /TEB 2023 est reçu/.test(n.text)), 'ce que l’IA a compris va dans la mémoire de la mission');
  assert.ok(written.some(n => n.kind === 'action' && /rename/.test(n.text)) && written.some(n => /À valider : send_mail/.test(n.text)));
  assert.deepEqual(written.filter(n => n.closed).map(n => n.closed), ['n1'], 'seule une note ouverte connue peut être réglée');
});

test('l’IA ne répond pas : le code ne décide rien, la panne est dite', async () => {
  let ran = false;
  const r = await think({ orgId: 'O', agent: 'sika', task: 't', actions: { a: { describe: 'x', run: () => { ran = true; } } } }, { ai: async () => { throw new Error('AI_TIMEOUT'); } });
  assert.equal(r.ai, 'unavailable'); assert.match(r.ai_error, /AI_TIMEOUT/); assert.equal(ran, false); assert.deepEqual(r.done, []);
});

test('une proposition validée est revérifiée avant d’être exécutée', async () => {
  const actions = { send_mail: { describe: 'x', approval: true, check: p => (p.to === 'c@x' ? { ok: true } : { ok: false, why: 'destinataire inconnu' }), run: p => ({ sent: p.to }) } };
  // Executed without a read-back: said « not verified », never « verified » (kernel, 2026-10-29).
  assert.deepEqual(await runApproved({ orgId: 'O', agent: 'mission-controller', proposal: { action: 'send_mail', params: { to: 'c@x' } }, actions, by: 'm@x' }, { noteMission: async () => null }), { sent: 'c@x', work_state: 'executed_unverified', verification: null });
  const checked = { send_mail: { ...actions.send_mail, verify: (p, result) => ({ verified: result.sent === p.to, evidence: 'message id' }) } };
  const v = await runApproved({ orgId: 'O', agent: 'mission-controller', proposal: { action: 'send_mail', params: { to: 'c@x' } }, actions: checked, by: 'm@x' }, { noteMission: async () => null });
  assert.equal(v.work_state, 'verified');
  await assert.rejects(runApproved({ orgId: 'O', agent: 'x', proposal: { action: 'send_mail', params: { to: 'z@x' } }, actions, by: 'm@x' }), /ORDER_NO_LONGER_VALID/);
  await assert.rejects(runApproved({ orgId: 'O', agent: 'x', proposal: { action: 'send_mail', params: { to: 'c@x' } }, actions }), /HUMAN_IDENTITY_REQUIRED/);
});

test('mémoire de mission : notes gardées une fois, réglées sans être supprimées, et chaque agent lit sa part', async () => {
  const s = store();
  const d = { updateJsonFile: s.updateJsonFile, missionHome: 'HOME', folder: 'CENTRAL', drive: {} };
  await noteMission('O', 'M', [{ agent: 'orpailleur', kind: 'fait', text: 'TEB 2023 rangé dans 02_PIECES' }, { agent: 'enhanced-auditor', kind: 'manquant', text: 'Convention à obtenir', for: ['mission-controller'] },
    { agent: 'sika', kind: 'fait', text: 'Facture n°12 reçue', for: ['sika'] }], d);
  await noteMission('O', 'M', { agent: 'orpailleur', kind: 'fait', text: 'TEB 2023 rangé dans 02_PIECES' }, d);
  const central = s.files['CENTRAL/OFFICE_MANAGER_MISSION_FILES.json'].missions.M.notes, own = s.files['HOME/OFFICE_MANAGER_MISSION_MEMORY.json'].notes;
  assert.equal(central.length, 3); assert.equal(central[0].seen, 2); assert.equal(own.length, 3, 'la même mémoire suit la mission dans son dossier');
  const conv = central.find(n => /Convention/.test(n.text));
  await closeNote('O', 'M', conv.id, { by: 'mission-controller', why: 'reçue le 26/10' }, d);
  const all = s.files['CENTRAL/OFFICE_MANAGER_MISSION_FILES.json'].missions.M.notes;
  assert.equal(all.length, 3, 'rien n’est supprimé'); assert.equal(all.find(n => n.id === conv.id).status, 'closed');
  const read = { missionNotes: async () => all, missionMemory: async () => [{ id: 'F1', name: 'TEB.xlsx', title: 'TEB 2023', profile: { family: 'execution_budgetaire' }, uses: [{ what: 'colonne', where: 'D2!D' }] }], fetchRows: async () => [{ id: 'M', name: 'Audit projet', period_label: '2023' }] };
  const mc = await missionBrief('O', 'M', 'mission-controller', read), sk = await missionBrief('O', 'M', 'sika', read), ea = await missionBrief('O', 'M', 'enhanced-auditor', read);
  assert.ok(mc.settled.some(n => /Convention/.test(n.text)) && !mc.open.some(n => /Facture/.test(n.text)), 'le Mission Controller sait que la convention est réglée, ne voit pas ce qui est pour Sika');
  assert.ok(sk.open.some(n => /Facture/.test(n.text)));
  assert.equal(ea.documents[0].profile.family, 'execution_budgetaire', 'l’Enhanced Auditor voit ce qu’est chaque pièce');
  assert.equal(sk.documents[0].profile, undefined, 'Sika ne reçoit que ce dont il a besoin');
  assert.equal(mergeNotes([{ id: 'a', at: '1', text: 'x' }], [{ id: 'a', at: '1', updated_at: '2', text: 'y' }])[0].text, 'y');
});
