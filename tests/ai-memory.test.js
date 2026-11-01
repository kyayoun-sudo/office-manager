import test from 'node:test';
import assert from 'node:assert/strict';
import { recordDecision, searchWeb, memoryView, memoryAct, generalTerm } from '../lib/ai-memory.js';
import { missionBrief } from '../lib/mission-brief.js';

function setup(extra = {}) {
  const files = {}, lessons = [];
  const d = { updateJsonFile: async (name, fn, o) => { const k = (o.folder || '') + '/' + name; files[k] = fn(files[k] || null); return { state: files[k], fileId: k }; },
    missionHome: 'HOME', folder: 'CENTRAL', drive: {}, mission: { id: 'M', name: 'Audit Hydromet 2024', client_name: 'Hydromet SA' },
    missionNotes: async () => files['CENTRAL/OFFICE_MANAGER_MISSION_FILES.json']?.missions?.M?.notes || [],
    shadow: { changeLab: async fn => { const lab = { lessons, refused: [], tests: [] }; fn(lab); }, mergeLesson: (lab, p) => { const l = { id: 'L1', ...p }; lab.lessons.push(l); return { lesson: l, merged: false }; } }, ...extra };
  return { d, files, lessons };
}

test('seul un terme général part en recherche : jamais un nom du client ou de la mission, un montant ou un numéro de compte', () => {
  const m = { name: 'Audit Hydromet 2024', client_name: 'Hydromet SA' };
  assert.equal(generalTerm('compte 4011 fournisseurs SYCEBNL', m), 'compte 4011 fournisseurs SYCEBNL');
  for (const bad of ['solde Hydromet', 'virement 12 500 000 FCFA', 'IBAN FR7612345678901234', 'contact@client.com', 'x', 'a'.repeat(90)]) assert.throws(() => generalTerm(bad, m), /SEARCH_TERM_NOT_GENERAL/, bad);
});

test('la recherche en ligne enregistre une note « à confirmer » avec ses sources ; sans source, rien n’est retenu', async () => {
  const { d, files } = setup(); let asked = null;
  const ai = async (order, req) => { asked = req; return { provider: 'x', text: JSON.stringify({ finding: 'Le compte 4011 enregistre les fournisseurs.', doubts: [], confidence: 'moyenne' }), sources: [{ url: 'https://exemple.org/syscohada', title: 'SYSCOHADA' }] }; };
  const r = await searchWeb('O', 'M', { term: 'compte 4011', why: 'ne comprend pas le plan de comptes' }, { email: 'a@x' }, { ...d, ai });
  assert.equal(r.status, 'learned'); assert.equal(asked.webSearch, true); assert.ok(!/Hydromet/.test(asked.input), 'rien du client ne sort');
  const note = files['CENTRAL/OFFICE_MANAGER_MISSION_FILES.json'].missions.M.notes[0];
  assert.equal(note.origin, 'web'); assert.equal(note.confirm, 'to_confirm'); assert.equal(note.sources[0].url, 'https://exemple.org/syscohada');
  const none = await searchWeb('O', 'M', { term: 'règle du bailleur' }, { email: 'a@x' }, { ...d, ai: async () => ({ text: JSON.stringify({ finding: 'peut-être' }), sources: [] }) });
  assert.equal(none.status, 'no_source'); assert.equal(files['CENTRAL/OFFICE_MANAGER_MISSION_FILES.json'].missions.M.notes.length, 1);
  await assert.rejects(searchWeb('O', 'M', { term: 'solde Hydromet' }, {}, { ...d, ai }), /SEARCH_TERM_NOT_GENERAL/);
});

test('les décisions sont relues par l’IA au tour suivant ; confirmer, corriger et retirer ferment sans rien supprimer', async () => {
  const { d, files } = setup();
  await recordDecision('O', 'M', { about: 'D2_BUDGET', text: 'Consigne de a@x pour D2_BUDGET : ce compte ne doit pas être inclus', by: 'a@x' }, d);
  await searchWeb('O', 'M', { term: 'compte 4011' }, { email: 'a@x' }, { ...d, ai: async () => ({ text: JSON.stringify({ finding: 'Fournisseurs.' }), sources: [{ url: 'https://exemple.org/a', title: 'a' }] }) });
  const brief = await missionBrief('O', 'M', 'enhanced-auditor', { ...d, missionMemory: async () => [], fetchRows: async () => [{ id: 'M', name: 'A' }] });
  assert.ok(brief.open.some(n => /ne doit pas être inclus/.test(n.text) && n.origin === 'personne' && n.confirm === 'confirmed'), 'la consigne est relue');
  const web = brief.open.find(n => n.origin === 'web'); assert.equal(web.confirm, 'to_confirm'); assert.equal(web.sources[0].url, 'https://exemple.org/a');
  let v = await memoryView('O', 'M', d); assert.equal(v.items.length, 2);
  await memoryAct('O', 'M', { op: 'confirm', id: web.id }, { email: 'b@x', role: 'auditor' }, d);
  await memoryAct('O', 'M', { op: 'correct', id: web.id, text: 'Le compte 4011 = fournisseurs, groupe.' }, { email: 'b@x' }, d);
  v = await memoryView('O', 'M', d);
  assert.equal(v.items.filter(x => x.status === 'closed').length, 1, 'l’ancienne ligne est fermée, pas supprimée'); assert.ok(v.items.some(x => /groupe/.test(x.text) && x.confirm === 'confirmed'));
  const dec = v.items.find(x => /ne doit pas/.test(x.text)); await memoryAct('O', 'M', { op: 'retire', id: dec.id, why: 'plus vrai' }, { email: 'b@x' }, d);
  assert.equal((await memoryView('O', 'M', d)).items.find(x => x.id === dec.id).closed_why, 'plus vrai');
  await assert.rejects(memoryAct('O', 'M', { op: 'retire', id: dec.id }, { email: 'b@x' }, d), /MEMORY_ITEM_CLOSED/);
  await assert.rejects(memoryAct('O', 'M', { op: 'confirm', id: 'nope' }, { email: 'b@x' }, d), /MEMORY_ITEM_NOT_FOUND/);
  assert.equal(files['CENTRAL/OFFICE_MANAGER_MISSION_FILES.json'].missions.M.notes.length, 3, 'rien n’est supprimé');
});

test('proposer une connaissance du web au cabinet : un manager, après confirmation, une seule fois ; elle attend un associé', async () => {
  const { d, lessons } = setup();
  await searchWeb('O', 'M', { term: 'compte 4011' }, { email: 'a@x' }, { ...d, ai: async () => ({ text: JSON.stringify({ finding: 'Fournisseurs.' }), sources: [{ url: 'https://exemple.org/a' }] }) });
  const id = (await memoryView('O', 'M', d)).items[0].id;
  await assert.rejects(memoryAct('O', 'M', { op: 'propose', id }, { email: 'm@x', role: 'manager' }, d), /CONFIRM_BEFORE_PROPOSING/);
  await memoryAct('O', 'M', { op: 'confirm', id }, { email: 'm@x', role: 'manager' }, d);
  await assert.rejects(memoryAct('O', 'M', { op: 'propose', id }, { email: 'a@x', role: 'auditor' }, d), /MANAGER_OR_PARTNER_ONLY/);
  const r = await memoryAct('O', 'M', { op: 'propose', id }, { email: 'm@x', role: 'manager' }, d);
  assert.equal(r.lesson_id, 'L1'); assert.equal(lessons[0].type, 'hypothesis'); assert.equal(lessons[0].agent, 'enhanced-auditor');
  await assert.rejects(memoryAct('O', 'M', { op: 'propose', id }, { email: 'm@x', role: 'manager' }, d), /ALREADY_PROPOSED/);
  await recordDecision('O', 'M', { text: 'décision propre à la mission' }, d);
  const dec = (await memoryView('O', 'M', d)).items.find(x => x.origin === 'personne');
  await assert.rejects(memoryAct('O', 'M', { op: 'propose', id: dec.id }, { email: 'm@x', role: 'manager' }, d), /ONLY_GENERAL_WEB/);
});
