// ENTRAÎNEMENT DES AGENTS (Paul, 2026-10-26) : un lien personnel, une vraie mission déposée, l'agent fait l'étape, l'entraîneur corrige,
// la correction devient une leçon redonnée à l'agent (« refaire ») ; seules les leçons validées par le cabinet vont aux vrais agents.
// L'IA est simulée ici : la vraie IA n'est pas essayée.
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { gym, createTrainer, lessonsFor, decideLesson, listLessons, hashToken, progressOf } from '../lib/agent-gym.js';
import { corpus } from './corpus/pieces.js';
import { workingFile } from './corpus/working-file.js';

process.env.DEFAULT_ORG_ID = '00000000-0000-4000-8000-0000000000aa';
const ORG = process.env.DEFAULT_ORG_ID;
const PAUL = { email: 'paul@cabinet', role: 'partner' };

// A tiny PostgREST: eq / neq / or(sheet.is.null,sheet.eq.X), POST, PATCH.
function db() {
  const T = {}; let n = 0;
  const table = p => p.split('?')[0];
  const match = (row, qs) => {
    for (const part of qs.split('&')) {
      let m = part.match(/^([a-z_]+)=(eq|neq)\.(.*)$/); if (m) { const v = decodeURIComponent(m[3]); const x = String(row[m[1]] ?? ''); if (m[2] === 'eq' ? x !== v : x === v) return false; continue; }
      m = part.match(/^or=\(sheet\.is\.null,sheet\.eq\.(.*)\)$/); if (m) { if (row.sheet != null && row.sheet !== decodeURIComponent(m[1])) return false; }
    }
    return true;
  };
  const fetchRows = async (path, o = {}) => {
    const t = table(path), qs = path.split('?')[1] || '';
    T[t] ||= [];
    if (o.method === 'POST') { const rows = JSON.parse(o.body).map(x => ({ id: 'id' + (++n), status: t === 'office_gym_lessons' ? 'proposed' : undefined, active: t === 'office_gym_trainers' ? true : undefined, files: t === 'office_gym_sessions' ? [] : undefined, steps: t === 'office_gym_sessions' ? {} : undefined, created_at: new Date(Date.now() + n).toISOString(), ...x })); T[t].push(...rows); return rows; }
    const rows = T[t].filter(r => match(r, qs));
    if (o.method === 'PATCH') { const p = JSON.parse(o.body); rows.forEach(r => Object.assign(r, p)); return rows; }
    return rows.slice().reverse();
  };
  return { T, fetchRows };
}

test('le lien d’un entraîneur : créé par un associé du cabinet pilote, montré une fois, seul son haché est gardé ; un faux lien est refusé', async () => {
  const { T, fetchRows } = db();
  await assert.rejects(createTrainer(ORG, { email: 'x', role: 'auditor' }, { name: 'Awa' }, { fetchRows }), /PLATFORM_LEAD_REQUIRED/);
  const r = await createTrainer(ORG, PAUL, { name: 'Awa' }, { fetchRows });
  const token = r.link_path.split('#')[1];
  assert.equal(T.office_gym_trainers[0].token_hash, hashToken(token)); assert.ok(!JSON.stringify(T).includes(token));
  await assert.rejects(gym(ORG, {}, { token: 'faux-lien-de-plus-de-vingt-car' }, { fetchRows }), /GYM_LINK_INVALID/);
  const me = await gym(ORG, {}, { token, action: 'me' }, { fetchRows });
  assert.equal(me.trainer.name, 'Awa'); assert.ok(me.steps.some(s => s.key === 'remplissage'));
});

test('l’agent fait l’étape, l’entraîneur explique ce qui ne va pas, l’agent refait AVEC la leçon ; validée, elle va aux vrais agents', async () => {
  const { fetchRows } = db();
  const pieces = await corpus(), aux = pieces.find(p => /SAGE/.test(p.name));
  const files = {}; let k = 0;
  const seenLessons = [];
  const d = { fetchRows, gymHome: 'HOME', findOrCreateFolder: async (p, nme) => ({ id: p + '/' + nme }),
    createBinary: async ({ name, buffer }) => { const id = 'F' + (++k); files[id] = { name, buffer }; return { id }; },
    drive: { getMeta: async id => ({ id, name: files[id].name, size: files[id].buffer.length, modifiedTime: 'x', parents: [] }), downloadBuffer: async id => files[id].buffer },
    loadJsonFile: async () => ({ state: null }), saveJsonFile: async () => null,
    ai: async (p, o) => { const inp = JSON.parse(o.input); seenLessons.push(inp.lessons_from_trainers || []);
      // first the AI calls the general ledger « auxiliaire »; after the lesson it says « général »
      const fam = (inp.lessons_from_trainers || []).length ? 'grand_livre_general' : 'grand_livre_auxiliaire';
      return { provider: 'ia', text: JSON.stringify({ pieces: inp.pieces.map(x => ({ file_id: x.file_id, family: fam, what: 'grand livre', confidence: 'haute' })) }) }; } };
  const token = (await createTrainer(ORG, PAUL, { name: 'Awa' }, { fetchRows })).link_path.split('#')[1];
  const t = await gym(ORG, {}, { token, action: 'create', title: 'Projet X 2023', period_label: '2023' }, d);
  const up = await gym(ORG, {}, { token, action: 'upload', training_id: t.id, name: 'GL SAGE 2023.xls', base64: aux.buffer.toString('base64'), role: 'piece' }, d);
  assert.equal(up.files.length, 1);
  const r1 = await gym(ORG, {}, { token, action: 'run', training_id: t.id, step: 'pieces' }, d);
  assert.match(r1.proposal.items[0].value, /grand_livre_auxiliaire/);
  await assert.rejects(gym(ORG, {}, { token, action: 'verdict', training_id: t.id, step: 'pieces', verdict: 'faux' }, d), /EXPLANATION_REQUIRED/);
  const v1 = await gym(ORG, {}, { token, action: 'verdict', training_id: t.id, step: 'pieces', verdict: 'faux', explanation: 'Il y a des comptes de charges (6) et de banque (5) : c’est le grand livre GÉNÉRAL, pas un auxiliaire.', correct: 'grand_livre_general' }, d);
  assert.ok(v1.lesson?.id);
  const r2 = await gym(ORG, {}, { token, action: 'run', training_id: t.id, step: 'pieces' }, d);
  assert.match(seenLessons.at(-1)[0].lesson, /GÉNÉRAL/, 'la leçon est redonnée à l’agent');
  assert.match(r2.proposal.items[0].value, /grand_livre_general/);
  await gym(ORG, {}, { token, action: 'verdict', training_id: t.id, step: 'pieces', verdict: 'juste' }, d);
  const p = progressOf([{ steps: r2.training.steps }].map(x => ({ steps: { pieces: { attempts: [{ verdict: 'faux' }, { verdict: 'juste' }] } } })));
  assert.deepEqual([p[0].right_first_rate, p[0].avg_attempts], [0, 2]);
  // in the application: nothing until a partner validates
  assert.equal((await lessonsFor('pieces', { orgId: ORG }, { fetchRows })).length, 0);
  const [l] = await listLessons(ORG, PAUL, { status: 'proposed' }, { fetchRows });
  await decideLesson(ORG, PAUL, { id: l.id, decision: 'validated' }, { fetchRows });
  assert.equal((await lessonsFor('pieces', { orgId: ORG }, { fetchRows })).length, 1);
  // another trainer cannot open Awa's training
  const other = (await createTrainer(ORG, PAUL, { name: 'Koffi' }, { fetchRows })).link_path.split('#')[1];
  await assert.rejects(gym(ORG, {}, { token: other, action: 'view', training_id: t.id }, d), /TRAINING_NOT_FOUND/);
});

test('remplir une feuille : le travail de l’agent est comparé, case par case, au working file rempli par l’entraîneur', async () => {
  const { fetchRows } = db();
  const pieces = await corpus(), gl = pieces.find(p => /SAGE/.test(p.name));
  const blank = Buffer.from(await (await workingFile()).xlsx.writeBuffer());
  // the trainer's own working file: D1 filled with the general ledger's 7 entries (amounts only, to compare)
  const wb = await workingFile(); const s = wb.getWorksheet('D1_GL_PROJET');
  for (const r of [11, 12]) for (const c of 'ABCDE') s.getCell(c + r).value = null;   // the template's example lines removed
  [150000, 82500, 410000, 395000, -150000, 25000000, 1200000].forEach((v, i) => { s.getCell('D' + (11 + i)).value = v; });
  const reference = Buffer.from(await wb.xlsx.writeBuffer());
  const files = {}; let k = 0;
  const d = { fetchRows, gymHome: 'HOME', findOrCreateFolder: async (p, nme) => ({ id: p + '/' + nme }),
    createBinary: async ({ name, buffer }) => { const id = 'F' + (++k); files[id] = { name, buffer }; return { id }; },
    drive: { getMeta: async id => ({ id, name: files[id].name, size: files[id].buffer.length, modifiedTime: 'x', parents: [] }), downloadBuffer: async id => files[id].buffer },
    loadJsonFile: async () => ({ state: null }), saveJsonFile: async () => null,
    ai: async (p, o) => { if (/vérifies le plan|Voici des libellés/.test(o.instructions)) return { text: '{}' }; if (/Pour chaque pièce d'une mission/.test(o.instructions)) return { text: JSON.stringify({ pieces: JSON.parse(o.input).pieces.map(x => ({ file_id: x.file_id, family: 'grand_livre_general', what: 'GL', confidence: 'haute' })) }) };
      const inp = JSON.parse(o.input), gid = inp.documents.find(x => /SAGE/.test(x.name)).id;
      return { provider: 'ia', text: JSON.stringify({ rows_from: { document_id: gid, which: 'lines' }, columns: inp.columns.map(c => ({ col: c.col, document_id: gid, heading: null })) }) }; } };
  const token = (await createTrainer(ORG, PAUL, { name: 'Awa' }, { fetchRows })).link_path.split('#')[1];
  const t = await gym(ORG, {}, { token, action: 'create', title: 'Projet X 2023', period_label: '2023' }, d);
  await gym(ORG, {}, { token, action: 'upload', training_id: t.id, name: 'GL SAGE 2023.xls', base64: gl.buffer.toString('base64'), role: 'piece' }, d);
  await gym(ORG, {}, { token, action: 'upload', training_id: t.id, name: 'NL-T01 vierge.xlsx', base64: blank.toString('base64'), role: 'workfile' }, d);
  await gym(ORG, {}, { token, action: 'upload', training_id: t.id, name: 'NL-T01 rempli par Awa.xlsx', base64: reference.toString('base64'), role: 'reference' }, d);
  const list = await gym(ORG, {}, { token, action: 'run', training_id: t.id, step: 'remplissage' }, d);
  assert.ok(list.proposal.sheets.includes('D1_GL_PROJET'));
  const r = await gym(ORG, {}, { token, action: 'run', training_id: t.id, step: 'remplissage', sheet: 'D1_GL_PROJET' }, d);
  assert.equal(r.proposal.rows, 7);
  assert.ok(r.proposal.comparison, 'comparé au working file de l’entraîneur');
  assert.deepEqual([r.proposal.comparison.same, r.proposal.comparison.missing, r.proposal.comparison.score], [7, 0, 100], JSON.stringify(r.proposal.comparison));
  assert.equal(r.step, 'remplissage:D1_GL_PROJET');
});

test('comprendre la mission : chaque fait porte le passage du document, retrouvé ou non par le code', async () => {
  const { fetchRows } = db(); const files = {}; let k = 0;
  const d = { fetchRows, gymHome: 'HOME', findOrCreateFolder: async (p, nme) => ({ id: p + '/' + nme }),
    createBinary: async ({ name, buffer }) => { const id = 'F' + (++k); files[id] = { name, buffer }; return { id }; },
    fileForAI: async id => ({ id, name: files[id].name, text: 'ACCORD DE FINANCEMENT entre la Banque X et la République Y pour le Projet Eau Potable. Période d’exécution : 2021-2025. Montant : 10 000 000 DTS.' }),
    ai: async () => ({ provider: 'ia', text: JSON.stringify({ founding_document: { file_id: 'F1', why: 'accord de financement' }, facts: [{ label: 'projet', value: 'Projet Eau Potable', quote: 'pour le Projet Eau Potable' }, { label: 'montant', value: '12 000 000', quote: 'Montant : 12 000 000 DTS' }] }) }) };
  const token = (await createTrainer(ORG, PAUL, { name: 'Awa' }, { fetchRows })).link_path.split('#')[1];
  const t = await gym(ORG, {}, { token, action: 'create', title: 'Projet Eau' }, d);
  await gym(ORG, {}, { token, action: 'upload', training_id: t.id, name: 'accord.pdf', base64: Buffer.from('%PDF-1.4').toString('base64'), role: 'piece' }, d);
  const r = await gym(ORG, {}, { token, action: 'run', training_id: t.id, step: 'mission' }, d);
  assert.equal(r.proposal.founding_document.name, 'accord.pdf');
  assert.deepEqual(r.proposal.items.map(x => x.verified), [true, false], 'un montant inventé n’est pas retrouvé dans le document');
});
