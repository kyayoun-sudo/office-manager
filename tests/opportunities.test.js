import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { describeWorkbook, writeCells, readCells, validateWrites, namingRule, copyName, patchSheetXml } from '../lib/acceptance-workbook.js';
import { createOpportunity, opportunityStep, answerRow, answerRows, opportunityTasks, myQuestions, reviewSection, agentWrites, prepareAgain, markWon, onOpportunityWon, prepareKyc, kycStep, opportunityView, sheetOwner, rowAuthority, opportunityRound, teamStep, validateTeam, declareIndependence } from '../lib/opportunities.js';

// A small workbook built like a firm's acceptance template (legend, mode d'emploi, sections, header
// rows, input cells, lists, dates, formulas) — no firm's real template in the repository.
const INPUT = 'FFFFF2CC', LABEL = 'FFD9E1F2', DARK = 'FF1F3864', GREY = 'FFEDEDED';
const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
async function buildTemplate() {
  const wb = new ExcelJS.Workbook();
  const put = (ws, a, v, f) => { const c = ws.getCell(a); if (v !== undefined) c.value = v; if (f) c.fill = fill(f); return c; };
  const list = (ws, a, values) => { ws.getCell(a).dataValidation = { type: 'list', allowBlank: true, formulae: ['"' + values.join(',') + '"'] }; };
  const date = (ws, a) => { ws.getCell(a).dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))] }; };

  const s1 = wb.addWorksheet('01_OPPORTUNITE');
  put(s1, 'B3', 'Onglet 01 — Fiche prospect');
  put(s1, 'B7', 'Préparé par', LABEL); put(s1, 'C7', null, INPUT);
  put(s1, 'B9', 'Revu par', LABEL); put(s1, 'C9', null, INPUT);
  put(s1, 'B13', "MODE D'EMPLOI", DARK);
  put(s1, 'B14', '1. Copier', LABEL); put(s1, 'C14', "Faire une copie de ce template, la renommer « CAB_PH0-1_[CLIENT]_[REFERENCE].xlsx » et la déposer dans 03_APPELS / [dossier de l'opportunité]. Le modèle original reste dans 06_METHODES / 03_TEMPLATES et n'est jamais modifié.");
  put(s1, 'B21', 'LÉGENDE', DARK);
  put(s1, 'B22', 'Exemple', INPUT); put(s1, 'C22', 'Cellule à compléter (saisie libre ou liste déroulante)');
  put(s1, 'B32', "FICHE D'IDENTIFICATION", DARK);
  put(s1, 'B33', 'Rubrique', DARK); put(s1, 'C33', 'Information à saisir', DARK); put(s1, 'E33', 'Aide', DARK);
  const rows1 = [[35, 'Nom du prospect / client'], [36, "Référence de l'opportunité"], [41, 'Nature du service demandé'], [48, 'Date de réception'], [49, 'Date limite de soumission'], [54, 'TDR reçu'], [55, 'Nom du fichier TDR'], [56, 'Lien Drive vers le TDR'], [57, "Lien Drive du dossier de l'opportunité"], [59, "Chiffre d'affaires approximatif"]];
  for (const [r, l] of rows1) { put(s1, 'B' + r, l, LABEL); put(s1, 'C' + r, null, INPUT); put(s1, 'E' + r, 'aide ' + r); }
  list(s1, 'C41', ['Audit légal', 'Audit contractuel', 'Conseil', 'Autre']); list(s1, 'C54', ['Oui', 'Non']); date(s1, 'C48'); date(s1, 'C49');
  put(s1, 'C50', { formula: 'IF(C49="","",C49-TODAY())' }, GREY);

  const s2 = wb.addWorksheet('02_PHASE_0');
  put(s2, 'B3', 'Onglet 02 — PHASE 0 : identification');
  put(s2, 'C7', 'Préparé par', LABEL); put(s2, 'D7', null, INPUT);
  put(s2, 'C9', 'Revu par', LABEL); put(s2, 'D9', null, INPUT);
  put(s2, 'B21', 'PROCÉDURES DE LA PHASE 0', DARK);
  for (const [c, h] of [['B', 'N°'], ['C', "Ce qu'il faut faire"], ['D', 'Instruction'], ['E', 'Résultat'], ['F', 'Oui / Non / N-A'], ['G', 'Preuve / lien'], ['J', 'Statut'], ['K', 'Préparé par'], ['L', 'Date']]) put(s2, c + '22', h, DARK);
  for (const [r, n, t] of [[23, '1', 'Vérification préliminaire de conflit'], [24, '2', "Aucune information confidentielle n'a-t-elle été communiquée ?"]]) {
    put(s2, 'B' + r, n); put(s2, 'C' + r, t); put(s2, 'D' + r, 'Instruction ' + n);
    for (const c of ['E', 'F', 'G', 'K', 'L']) put(s2, c + r, null, INPUT);
    list(s2, 'F' + r, ['Oui', 'Non', 'N-A']); date(s2, 'L' + r);
    put(s2, 'J' + r, { formula: 'IF(F' + r + '="","A FAIRE","TERMINÉ")' }, GREY);
  }
  put(s2, 'B41', 'CONCLUSION PHASE 0', DARK);
  put(s2, 'C44', "DÉCISION DE L'ASSOCIÉ", LABEL); put(s2, 'D44', null, INPUT); list(s2, 'D44', ['POURSUIVRE VERS PHASE 1', 'NE PAS POURSUIVRE']);
  put(s2, 'C45', "Nom de l'Associé", LABEL); put(s2, 'D45', null, INPUT);

  const s3 = wb.addWorksheet('03_PHASE_1');
  put(s3, 'B3', 'Onglet 03 — PHASE 1 : Acceptation');
  put(s3, 'B48', 'SECTION B — KYC / AML', DARK);
  for (const [c, h] of [['B', 'Réf'], ['C', 'Contrôle'], ['D', 'Personne / entité concernée'], ['E', 'Résultat'], ['F', 'Preuve / lien'], ['H', 'Red flag Oui/Non']]) put(s3, c + '50', h, DARK);
  put(s3, 'B61', 'B.11'); put(s3, 'C61', 'Sanctions internationales');
  for (const c of ['D', 'E', 'F', 'H']) put(s3, c + '61', null, INPUT);
  list(s3, 'H61', ['Oui', 'Non', 'N-A']);
  put(s3, 'B73', 'SECTION C — INDÉPENDANCE', DARK);
  for (const [c, h] of [['B', 'Réf'], ['C', 'Contrôle'], ['D', 'Résultat'], ['I', 'Conclusion']]) put(s3, c + '75', h, DARK);
  put(s3, 'B76', 'C.01'); put(s3, 'C76', 'Intérêts financiers'); put(s3, 'D76', null, INPUT); put(s3, 'I76', null, INPUT); list(s3, 'I76', ['AUCUNE MENACE', 'MENACE MAITRISEE', 'MENACE NON MAITRISEE']);

  const s4 = wb.addWorksheet('04_CONCLUSION');
  put(s4, 'B3', 'Onglet 04 — Synthèse et décision');
  put(s4, 'B69', "6. DÉCISION DE L'ASSOCIÉ HABILITÉ", DARK);
  put(s4, 'B70', 'Décision', LABEL); put(s4, 'C70', null, INPUT); list(s4, 'C70', ['ACCEPTE', 'ACCEPTE SOUS CONDITIONS', 'REFUSE']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// An in-memory Drive: files with parents, buffers, modified times.
function fakeDrive(template) {
  let n = 0, clock = 0;
  const files = new Map();
  const add = (f) => { const id = f.id || 'id' + (++n) + 'xxxxxxxxxxxxxxxxxxxxxxxxxx'; files.set(id, { modifiedTime: 't' + (++clock), webViewLink: 'https://drive/' + id, ...f, id }); return files.get(id); };
  const drive = {
    files, add,
    getMeta: async id => { const f = files.get(id); return f ? { id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, modifiedTime: f.modifiedTime, webViewLink: f.webViewLink } : null; },
    downloadBuffer: async id => files.get(id).buffer,
    findFilesByExactName: async (name, parent) => [...files.values()].filter(f => f.name === name && (f.parents || []).includes(parent)).map(f => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime })),
    createBinary: async ({ name, parentId, buffer, mimeType }) => add({ name, parents: [parentId], buffer, mimeType }),
    updateBinary: async (id, { buffer, expectedModifiedTime }) => { const f = files.get(id); if (expectedModifiedTime && f.modifiedTime !== expectedModifiedTime) throw new Error('MEMORY_CONFLICT'); f.buffer = buffer; f.modifiedTime = 't' + (++clock); return { modifiedTime: f.modifiedTime }; },
    copyFile: async (id, name, parent) => { const src = files.get(id); return add({ name, parents: [parent], buffer: Buffer.from(src.buffer), mimeType: src.mimeType }); },
    changedSince: async () => [...files.values()].map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, webViewLink: f.webViewLink })),
    readText: async id => ({ text: String(files.get(id)?.buffer || '') })
  };
  add({ id: 'TPLxxxxxxxxxxxxxxxxxxxxxxxxxxxx', name: 'CAB_PHASE_0_1_OPPORTUNITE_ACCEPTATION_TEMPLATE.xlsx', parents: ['F06'], buffer: template, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return drive;
}
function fakeTidy(drive) {
  return {
    findOrCreateFolder: async (parent, name) => [...drive.files.values()].find(f => f.name === name && (f.parents || []).includes(parent)) || { ...drive.add({ name, parents: [parent], mimeType: 'application/vnd.google-apps.folder' }), created: true },
    nameTaken: async (parent, name, except) => [...drive.files.values()].some(f => f.name === name && (f.parents || []).includes(parent) && f.id !== except),
    move: async (id, from, to, newName) => { const f = drive.files.get(id); f.parents = [to]; if (newName) f.name = newName; return f; }
  };
}

async function setup() {
  const template = await buildTemplate();
  const drive = fakeDrive(template);
  // The Drive map the agents keep (scan state) and the opportunities folder.
  drive.add({ id: 'F03xxxxxxxxxxxxxxxxxxxxxxxxxxxx', name: '03_APPELS', parents: ['ROOT'], mimeType: 'application/vnd.google-apps.folder' });
  drive.add({ name: 'OFFICE_MANAGER_SCAN_STATE.json', parents: ['MEM'], mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ items: [
    { id: 'F03xxxxxxxxxxxxxxxxxxxxxxxxxxxx', name: '03_APPELS', mimeType: 'application/vnd.google-apps.folder', path: '03_APPELS' },
    { id: 'TPLxxxxxxxxxxxxxxxxxxxxxxxxxxxx', name: 'CAB_PHASE_0_1_OPPORTUNITE_ACCEPTATION_TEMPLATE.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', path: '06_METHODES/03_WORKING_PAPER_TEMPLATES/CAB_PHASE_0_1_OPPORTUNITE_ACCEPTATION_TEMPLATE.xlsx' }
  ] })) });
  const fired = [], events = [], audits = [];
  const ai = async (order, { instructions }) => {
    if (/LIS un TDR/.test(instructions)) return { provider: 'fake', text: JSON.stringify({ client: 'SOCIÉTÉ IVOIRIENNE TEST', reference: 'AO 2026/015', document_kind: 'TDR', summary: 'Audit des comptes 2026', submission_deadline: '2026-11-30',
      values: [{ cell: 'C35', value: 'SOCIÉTÉ IVOIRIENNE TEST', quote: 'Société Ivoirienne Test' }, { cell: 'C36', value: 'AO 2026/015', quote: 'AO N°2026/015' }, { cell: 'C41', value: 'audit légal', quote: 'audit légal' }, { cell: 'C49', value: '2026-11-30', quote: '30 novembre 2026' }, { cell: 'C50', value: 'x', quote: '' }] }) };
    if (/PRÉPARES la Phase 0/.test(instructions)) return { provider: 'fake', text: JSON.stringify({ rows: [
      { sheet: '02_PHASE_0', row: 23, values: { E23: 'Aucune mission au même nom', F23: 'Oui', K23: 'Firm Manager' }, why: 'recherche dans les missions', sources: [] },
      { sheet: '02_PHASE_0', row: 24, values: {}, for_team: true, question: 'Avez-vous communiqué une information confidentielle ?' },
      { sheet: '02_PHASE_0', row: 44, values: { D44: 'POURSUIVRE VERS PHASE 1' }, why: 'never' },
      { sheet: '01_OPPORTUNITE', row: 59, values: { C59: '≈ 12 milliards FCFA (source : EF 2025)' }, sources: ['https://example.org'] }
    ], conclusion: { proposed: 'POURSUIVRE VERS PHASE 1', why: 'rien de bloquant' } }) };
    if (/PRÉPARES la Phase 1/.test(instructions)) return { provider: 'fake', text: JSON.stringify({ rows: [
      { sheet: '03_PHASE_1', row: 61, values: { D61: 'SOCIÉTÉ IVOIRIENNE TEST', E61: 'aucune correspondance trouvée (ONU, UE, OFAC) au 2026-10-10', F61: 'https://sanctions.example', H61: 'Non' }, sources: ['https://sanctions.example'] },
      { sheet: '03_PHASE_1', row: 76, values: { D76: 'aucun', I76: 'AUCUNE MENACE' }, why: 'should be dropped' }
    ] }) };
    throw new Error('unexpected prompt');
  };
  const d = { drive, folder: 'MEM', home: 'HOME', tidy: fakeTidy(drive), ai, research: async () => ({ text: 'rien de négatif [source](https://example.org)', sources: [{ url: 'https://example.org' }], web: true, provider: 'fake' }),
    fire: async (req, path, body) => { fired.push({ path, body }); }, handleMissionEvents: async () => null, emit: async (org, ev) => { events.push(ev); return { recorded: true }; }, audit: async (org, e) => { audits.push(e); },
    fileForAI: async id => ({ id, name: drive.files.get(id).name, text: 'TERMES DE RÉFÉRENCE — Société Ivoirienne Test — AO N°2026/015', url: 'https://drive/' + id, visual: false }),
    fetchRows: async () => [{ id: 'm1', name: 'Audit SOCIETE IVOIRIENNE TEST 2024', mission_code: 'SIT-24', status: 'closed' }],
    capabilityContext: async () => ({ people: [{ kind: 'employee', full_name: 'A. Senior', title: 'Senior', load_pct: 40 }] }) };
  return { drive, d, fired, events, audits };
}
const run = async (id, d) => { let o; for (let i = 0; i < 5; i++) { o = await opportunityStep('org', {}, { opportunity_id: id }, d); if (o.status !== 'running') break; } return o; };

test('the template structure is read from the template itself (legend, sections, headers, lists, name rule)', async () => {
  const s = await describeWorkbook(await buildTemplate());
  assert.equal(s.input_fill, INPUT);
  assert.deepEqual(s.naming, { pattern: 'CAB_PH0-1_[CLIENT]_[REFERENCE].xlsx', destination_folder: '03_APPELS', template_path: ['06_METHODES', '03_TEMPLATES'] });
  const p0 = s.sheets.find(x => x.name === '02_PHASE_0');
  const r23 = p0.rows.find(r => r.row === 23);
  assert.equal(r23.ref, '1');
  assert.deepEqual(r23.fields.map(f => [f.cell, f.header]), [['E23', 'Résultat'], ['F23', 'Oui / Non / N-A'], ['G23', 'Preuve / lien'], ['K23', 'Préparé par'], ['L23', 'Date']]);
  assert.deepEqual(r23.fields[1].options, ['Oui', 'Non', 'N-A']);
  assert.equal(s.sheets[0].rows.some(r => r.row === 22), false, 'the legend is not a question');
  assert.equal(s.sheets[0].rows.find(r => r.row === 49).fields[0].type, 'date');
  assert.equal(sheetOwner(s.sheets[0]), 'firm-manager'); assert.equal(sheetOwner(p0), 'firm-manager');
  assert.equal(sheetOwner(s.sheets[2]), 'mission-controller'); assert.equal(sheetOwner(s.sheets[3]), 'decision');
  assert.equal(rowAuthority(p0.rows.find(r => r.row === 44)), 'partner');
  assert.equal(copyName(s.naming.pattern, { client: 'Société Ivoirienne', reference: 'AO 2026/015' }), 'CAB_PH0-1_SOCIETE_IVOIRIENNE_AO_2026_015.xlsx');
  assert.deepEqual(namingRule('rien'), { pattern: null, destination_folder: null, template_path: null });
});

test('writing keeps formulas, refuses grey cells and values outside the list, and is read back', async () => {
  const tpl = await buildTemplate();
  const s = await describeWorkbook(tpl);
  assert.throws(() => validateWrites(s, [{ sheet: '01_OPPORTUNITE', cell: 'C50', value: '1' }]), /NOT_AN_INPUT_CELL/);
  assert.throws(() => validateWrites(s, [{ sheet: '01_OPPORTUNITE', cell: 'C41', value: 'Expertise comptable' }]), /VALUE_NOT_IN_LIST/);
  assert.throws(() => validateWrites(s, [{ sheet: '01_OPPORTUNITE', cell: 'C49', value: 'fin novembre' }]), /DATE_INVALID/);
  const w = validateWrites(s, [{ sheet: '01_OPPORTUNITE', cell: 'C35', value: 'A & B <SA>' }, { sheet: '01_OPPORTUNITE', cell: 'C41', value: 'audit légal' }, { sheet: '01_OPPORTUNITE', cell: 'C49', value: '30/11/2026' }]);
  assert.equal(w[1].value, 'Audit légal');
  const out = await writeCells(tpl, w);
  const back = await readCells(out, [{ sheet: '01_OPPORTUNITE', cell: 'C35' }, { sheet: '01_OPPORTUNITE', cell: 'C41' }, { sheet: '01_OPPORTUNITE', cell: 'C49' }]);
  assert.deepEqual(back, { '01_OPPORTUNITE!C35': 'A & B <SA>', '01_OPPORTUNITE!C41': 'Audit légal', '01_OPPORTUNITE!C49': '2026-11-30' });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(out);
  assert.equal(wb.getWorksheet('01_OPPORTUNITE').getCell('C50').value.formula, 'IF(C49="","",C49-TODAY())');
  assert.ok(wb.getWorksheet('01_OPPORTUNITE').dataValidations.model.C41, 'the drop-down list is still there');
  assert.throws(() => patchSheetXml('<sheetData><row r="5"><c r="A5"><f>1+1</f><v>2</v></c></row></sheetData>', [{ cell: 'A5', value: 'x' }]), /FORMULA_CELL_NOT_WRITABLE/);
  assert.match(patchSheetXml('<sheetData><row r="5"><c r="C5"/></row></sheetData>', [{ cell: 'B5', value: 'x' }]), /<c r="B5" t="inlineStr">.*<c r="C5"\/>/);
});

test('Firm Manager: TDR read, filed with the workbook in the opportunity folder, Phase 0 prepared', async () => {
  const { drive, d, fired, audits } = await setup();
  const r = await createOpportunity('org', {}, { name: 'TDR_audit.pdf', base64: Buffer.from('TDR').toString('base64'), mime: 'application/pdf' }, { display_name: 'Awa' }, d);
  assert.equal(fired[0].path, '/api/app?route=opportunity-step');
  const o = await run(r.opportunity.id, d);
  assert.equal(o.status, 'phase0', o.error);
  assert.equal(o.client, 'SOCIÉTÉ IVOIRIENNE TEST');
  // Folder under the folder the template names; TDR moved there and verified; workbook copied there.
  const folder = drive.files.get(o.folder.id);
  assert.deepEqual(folder.parents, ['F03xxxxxxxxxxxxxxxxxxxxxxxxxxxx']);
  assert.equal(folder.name, 'AO 2026/015 — SOCIÉTÉ IVOIRIENNE TEST'.replace(/\//g, ' ').replace(/\s+/g, ' '));
  assert.equal(o.tdr_files[0].filed, true);
  assert.deepEqual(drive.files.get(o.tdr_files[0].id).parents, [o.folder.id]);
  assert.equal(o.workbook.name, 'CAB_PH0-1_SOCIETE_IVOIRIENNE_TEST_AO_2026_015.xlsx');
  const back = await readCells(drive.files.get(o.workbook.id).buffer, ['C35', 'C41', 'C49', 'C54', 'C56', 'C57', 'C50'].map(cell => ({ sheet: '01_OPPORTUNITE', cell })));
  assert.equal(back['01_OPPORTUNITE!C35'], 'SOCIÉTÉ IVOIRIENNE TEST');
  assert.equal(back['01_OPPORTUNITE!C41'], 'Audit légal');
  assert.equal(back['01_OPPORTUNITE!C49'], '2026-11-30');
  assert.equal(back['01_OPPORTUNITE!C54'], 'Oui');
  assert.match(back['01_OPPORTUNITE!C56'], /^https:\/\/drive\//);
  assert.match(back['01_OPPORTUNITE!C57'], /^https:\/\/drive\//);
  assert.equal(o.fiche_written.verified, o.fiche_written.cells);
  // The template itself is never modified.
  assert.equal(drive.files.get('TPLxxxxxxxxxxxxxxxxxxxxxxxxxxxx').modifiedTime, 't1');
  // Proposals: the decision and the « préparé par » are never proposed; the attestation is a question.
  assert.deepEqual(Object.keys(o.proposals).sort(), ['01_OPPORTUNITE!59', '02_PHASE_0!23', '02_PHASE_0!24']);
  assert.deepEqual(o.proposals['02_PHASE_0!23'].values, { E23: 'Aucune mission au même nom', F23: 'Oui' });
  assert.equal(o.proposals['02_PHASE_0!24'].for_team, true);
  // Man + machine: the sourced answer is written straight into the workbook, signed by the agent; the
  // unsourced one stays a proposal (its cells empty); the question stays a question.
  const w = await readCells(drive.files.get(o.workbook.id).buffer, [{ sheet: '01_OPPORTUNITE', cell: 'C59' }, { sheet: '01_OPPORTUNITE', cell: 'C7' }, { sheet: '02_PHASE_0', cell: 'E23' }, { sheet: '02_PHASE_0', cell: 'K23' }]);
  assert.equal(w['01_OPPORTUNITE!C59'], '≈ 12 milliards FCFA (source : EF 2025)');
  assert.equal(w['01_OPPORTUNITE!C7'], 'Firm Manager (IA)');
  assert.match(w['02_PHASE_0!E23'], /missions du cabinet/, 'the conflict search is a fact Office Manager knows: written, not the unsourced proposal');
  assert.deepEqual(Object.keys(o.ai_filled).sort(), ['01_OPPORTUNITE!59', '02_PHASE_0!23']);
  assert.equal(o.ai_filled['01_OPPORTUNITE!59'].verified, true);
  assert.equal(o.conflicts.matches.length, 1, 'the earlier mission of the same client is found');
  assert.ok(audits.some(a => a.action_type === 'OPPORTUNITY_FILED'));
  // The same file never opens a second opportunity.
  const again = await createOpportunity('org', {}, { file_ids: [o.tdr_files[0].id] }, null, d);
  assert.equal(again.duplicate, true);
});

test('people answer, only the Associé decides (never the preparer), then the client confirms → Mission Controller', async () => {
  const { drive, d, events } = await setup();
  const { opportunity } = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, null, d);
  const o = await run(opportunity.id, d);
  const senior = { display_name: 'Awa Senior', role: 'collaborator' };
  const a = await answerRow('org', { opportunity_id: o.id, sheet: '02_PHASE_0', row: 23, values: { E23: 'Aucun conflit', F23: 'Oui' }, from_proposal: true }, senior, d);
  assert.equal(a.verified, true);
  let wb = drive.files.get(o.workbook.id).buffer;
  const v = await readCells(wb, ['E23', 'F23', 'K23', 'L23'].map(cell => ({ sheet: '02_PHASE_0', cell })));
  assert.equal(v['02_PHASE_0!K23'], 'Awa Senior');
  assert.match(v['02_PHASE_0!L23'], /^\d{4}-\d{2}-\d{2}$/);
  await answerRow('org', { opportunity_id: o.id, sheet: '02_PHASE_0', row: 7, values: { D7: 'Kofi Partner' } }, senior, d);
  await assert.rejects(answerRow('org', { opportunity_id: o.id, sheet: '02_PHASE_0', row: 44, values: { D44: 'POURSUIVRE VERS PHASE 1' } }, senior, d), /PARTNER_DECISION_ONLY/);
  await assert.rejects(answerRow('org', { opportunity_id: o.id, sheet: '02_PHASE_0', row: 44, values: { D44: 'POURSUIVRE VERS PHASE 1' } }, { display_name: 'Kofi Partner', role: 'partner' }, d), /SEPARATION_OF_FUNCTIONS/);
  await assert.rejects(answerRow('org', { opportunity_id: o.id, sheet: '03_PHASE_1', row: 61, values: { E61: 'x' } }, senior, d), /PHASE1_NOT_OPEN/);
  const dec = await answerRow('org', { opportunity_id: o.id, sheet: '02_PHASE_0', row: 44, values: { D44: 'POURSUIVRE VERS PHASE 1' } }, { display_name: 'Ama Associée', role: 'partner' }, d);
  assert.equal(dec.status, 'go');
  assert.equal((await readCells(drive.files.get(o.workbook.id).buffer, [{ sheet: '02_PHASE_0', cell: 'D45' }]))['02_PHASE_0!D45'], 'Ama Associée', 'who decided is written with the decision');
  // The client's confirmation letter, filed in the opportunity folder → event for Mission Controller.
  const won = await markWon('org', {}, { opportunity_id: o.id, name: 'Lettre_attribution.pdf', base64: Buffer.from('ok').toString('base64') }, { display_name: 'Ama Associée' }, d);
  assert.equal(won.letter.verified, true);
  assert.equal(events[0].type, 'OPPORTUNITY_WON');
  assert.equal(await onOpportunityWon('org', { object_id: o.id }, d), 'KYC et indépendance à faire pour « ' + o.title + ' »');
  assert.equal(await onOpportunityWon('org', { object_id: o.id }, d), 'déjà pris en charge');
  // Mission Controller prepares Phase 1: facts proposed, independence left to the people.
  await prepareKyc('org', {}, { opportunity_id: o.id }, senior, d);
  const k = await kycStep('org', {}, { opportunity_id: o.id }, d);
  assert.equal(k.phase1.status, 'ready', k.phase1.error);
  assert.deepEqual(Object.keys(k.phase1.proposals).sort(), ['03_PHASE_1!61']);
  // Sourced KYC facts are already in the workbook; independence never is (each person answers).
  const kw = await readCells(drive.files.get(o.workbook.id).buffer, [{ sheet: '03_PHASE_1', cell: 'H61' }, { sheet: '03_PHASE_1', cell: 'D76' }]);
  assert.equal(kw['03_PHASE_1!H61'], 'Non');
  assert.equal(kw['03_PHASE_1!D76'], '');
  assert.ok(k.ai_filled['03_PHASE_1!61']);
  await answerRow('org', { opportunity_id: o.id, sheet: '03_PHASE_1', row: 61, values: k.phase1.proposals['03_PHASE_1!61'].values, from_proposal: true }, senior, d);
  wb = drive.files.get(o.workbook.id).buffer;
  assert.equal((await readCells(wb, [{ sheet: '03_PHASE_1', cell: 'H61' }]))['03_PHASE_1!H61'], 'Non');
  // The page reads the workbook itself (hand-filled values included).
  const view = await opportunityView('org', o.id, senior, d);
  const r61 = view.sheets.find(s => s.name === '03_PHASE_1').rows.find(r => r.row === 61);
  assert.equal(r61.fields.find(f => f.cell === 'H61').value, 'Non');
  assert.equal(view.sheets.find(s => s.name === '02_PHASE_0').rows.find(r => r.row === 44).may_fill, false);
});

test('a second opportunity with the same reference is a possible duplicate: nothing is created', async () => {
  const { drive, d } = await setup();
  const first = await createOpportunity('org', {}, { name: 'TDR1.pdf', base64: Buffer.from('a').toString('base64') }, null, d);
  await run(first.opportunity.id, d);
  const folders = [...drive.files.values()].filter(f => f.mimeType === 'application/vnd.google-apps.folder').length;
  const second = await createOpportunity('org', {}, { name: 'TDR2.pdf', base64: Buffer.from('b').toString('base64') }, null, d);
  const o = await run(second.opportunity.id, d);
  assert.equal(o.status, 'duplicate');
  assert.equal([...drive.files.values()].filter(f => f.mimeType === 'application/vnd.google-apps.folder').length, folders);
});

test('Firm Manager round: a TDR dropped in the opportunities folder is signalled once', async () => {
  const { drive, d } = await setup();
  drive.add({ name: 'TDR_AMI_recrutement_auditeur.pdf', parents: ['F03xxxxxxxxxxxxxxxxxxxxxxxxxxxx'], mimeType: 'application/pdf', buffer: Buffer.from('x') });
  drive.add({ name: 'photo.jpg', parents: ['F03xxxxxxxxxxxxxxxxxxxxxxxxxxxx'], mimeType: 'image/jpeg', buffer: Buffer.from('x') });
  const r = await opportunityRound('org', d);
  assert.equal(r.new_tdr, 1);
  assert.equal((await opportunityRound('org', d)).new_tdr, 0);
});

test('Phase 2 then 3: « poursuivre » → the Firm Manager proposes the team; a manager validates; each member declares their own independence', async () => {
  const { d, fired } = await setup();
  const { opportunity } = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, null, d);
  const o = await run(opportunity.id, d);
  // The team is part of the bid: proposed with the Phase 0 (the TDR's key personnel against the CVs), before the decision.
  assert.equal(o.team.status, 'proposing');
  assert.ok(fired.some(f => f.path === '/api/app?route=opportunity-team-step'));
  const ai = async () => ({ provider: 'fake', text: JSON.stringify({ team: [{ name: 'A. Senior', role: 'Senior', requirement: 'Chef de mission', why: 'secteur distribution, 40 % de charge', checks: [{ criterion: '10 ans d’expérience', met: true, evidence: 'CV : 12 ans' }, { criterion: 'Expert-comptable diplômé', met: null, evidence: 'non indiqué' }] }, { name: 'Inconnu Externe', role: 'Manager', why: 'x' }], gaps: [{ requirement: 'Expert IFRS 17', why: 'personne au cabinet' }] }) });
  const t = await teamStep('org', {}, { opportunity_id: o.id }, { ...d, ai, capabilityContext: async () => ({ people: [{ kind: 'employee', full_name: 'A. Senior', email: 'senior@cab.ci', title: 'Senior', load_pct: 40 }] }) });
  assert.equal(t.team.status, 'proposed');
  assert.deepEqual(t.team.proposed.map(m => m.name), ['A. Senior'], 'nobody outside the firm is proposed');
  assert.deepEqual(t.team.proposed[0].checks.map(c => c.met), [true, null], 'each requirement of the post checked against the CV');
  assert.equal(t.team.gaps.length, 1);
  await assert.rejects(validateTeam('org', { opportunity_id: o.id, members: [{ name: 'A. Senior', role: 'Senior' }] }, { display_name: 'Awa', role: 'collaborator' }, d), /MANAGER_ONLY/);
  await validateTeam('org', { opportunity_id: o.id, members: [{ name: 'A. Senior', email: 'senior@cab.ci', role: 'Senior' }, { name: 'K. Manager', email: 'km@cab.ci', role: 'Manager' }] }, { display_name: 'Ama Associée', role: 'partner' }, d);
  await assert.rejects(declareIndependence('org', { opportunity_id: o.id, answers: { 'C.01': 'Non' }, certify: true }, { display_name: 'Quelqu’un', email: 'other@cab.ci' }, d), /NOT_IN_TEAM/);
  await assert.rejects(declareIndependence('org', { opportunity_id: o.id, answers: {}, certify: true }, { email: 'senior@cab.ci' }, d), /ANSWER_ALL_QUESTIONS/);
  const a = await declareIndependence('org', { opportunity_id: o.id, answers: { 'C.01': 'Oui' }, details: { 'C.01': 'actions de la société' }, certify: true }, { display_name: 'A. Senior', email: 'senior@cab.ci' }, d);
  assert.deepEqual([a.threats.length, a.all_declared], [1, false]);
  const b = await declareIndependence('org', { opportunity_id: o.id, answers: { 'C.01': 'Non' }, certify: true }, { display_name: 'K. Manager', email: 'km@cab.ci' }, d);
  assert.equal(b.all_declared, true);
  const view = await opportunityView('org', o.id, { display_name: 'A. Senior', email: 'senior@cab.ci', role: 'senior' }, d);
  assert.equal(view.viewer.in_team, true); assert.equal(view.my_declaration.threats.length, 1);
  assert.deepEqual(view.independence_questions, [{ ref: 'C.01', label: 'Intérêts financiers' }], 'the questions are the threats of the firm\'s own sheet');
});

test('man + machine: agents write only into empty cells; a Manager signs the review of a section once', async () => {
  const st = await describeWorkbook(await buildTemplate());
  const props = { '02_PHASE_0!23': { values: { E23: 'Aucune mission', F23: 'Oui' }, sources: ['missions du cabinet'], why: 'recherche' }, '02_PHASE_0!24': { values: {}, for_team: true, sources: [] } };
  const kept = agentWrites(st, props, { '02_PHASE_0!E23': 'Réponse de Awa' }, 'firm-manager');
  assert.deepEqual(kept.writes.map(w => w.cell).sort(), ['D7', 'F23', 'K23', 'L23'], 'a person\'s answer is never overwritten');
  assert.equal(kept.writes.find(w => w.cell === 'K23').value, 'Firm Manager (IA)');
  const unsourced = agentWrites(st, { '02_PHASE_0!23': { values: { E23: 'x' }, sources: [] } }, {}, 'firm-manager');
  assert.equal(unsourced.writes.length, 0, 'without a source it stays a proposal');
  const decision = agentWrites(st, {}, {}, 'firm-manager', [{ sheet: '02_PHASE_0', row: 44, values: { D44: 'POURSUIVRE VERS PHASE 1' } }]);
  assert.equal(decision.writes.length, 0, 'an agent never writes a decision');

  const { drive, d } = await setup();
  const { opportunity } = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, null, d);
  const o = await run(opportunity.id, d);
  const section = (await describeWorkbook(drive.files.get(o.workbook.id).buffer)).sheets[0].rows.find(r => r.row === 59).section || '';
  await assert.rejects(reviewSection('org', { opportunity_id: o.id, sheet: '01_OPPORTUNITE', section }, { display_name: 'Awa', role: 'collaborator' }, d), /MANAGER_ONLY/);
  await assert.rejects(reviewSection('org', { opportunity_id: o.id, sheet: '02_PHASE_0', section: 'CONCLUSION PHASE 0' }, { display_name: 'Moussa', role: 'manager' }, d), /NOTHING_TO_REVIEW/);
  const r = await reviewSection('org', { opportunity_id: o.id, sheet: '01_OPPORTUNITE', section }, { display_name: 'Moussa Manager', role: 'manager' }, d);
  assert.equal(r.verified, true);
  const back = await readCells(drive.files.get(o.workbook.id).buffer, [{ sheet: '01_OPPORTUNITE', cell: 'C9' }]);
  assert.equal(back['01_OPPORTUNITE!C9'], 'Moussa Manager', 'every section the agent filled is read: the sheet is signed « revu par »');
  // Phase 0 done again (new facts): the Firm Manager is asked again; cells already filled stay as they are.
  await assert.rejects(prepareAgain('org', {}, { opportunity_id: o.id }, { display_name: 'Awa', role: 'collaborator' }, d), /MANAGER_ONLY/);
  assert.equal((await prepareAgain('org', {}, { opportunity_id: o.id }, { display_name: 'Moussa', role: 'manager' }, d)).status, 'running');
  const again = await run(o.id, d);
  assert.equal(again.status, 'phase0');
  assert.equal((await readCells(drive.files.get(o.workbook.id).buffer, [{ sheet: '01_OPPORTUNITE', cell: 'C9' }]))['01_OPPORTUNITE!C9'], 'Moussa Manager');
});

test('Office Manager writes what it knows itself; one save for many rows; each person gets their tasks in the bell', async () => {
  const { drive, d } = await setup();
  const { opportunity } = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, { display_name: 'Awa' }, d);
  const o = await run(opportunity.id, d);
  // The conflict search done in the firm's missions is written without asking anyone (row 23 of the test template).
  const v = await readCells(drive.files.get(o.workbook.id).buffer, ['E23', 'F23', 'K23'].map(cell => ({ sheet: '02_PHASE_0', cell })));
  assert.match(v['02_PHASE_0!E23'], /missions du cabinet.*Audit SOCIETE IVOIRIENNE TEST 2024/);
  assert.equal(v['02_PHASE_0!F23'], 'Oui');
  assert.equal(v['02_PHASE_0!K23'], 'Firm Manager (IA)');
  // Several answers, one save.
  const r = await answerRows('org', { opportunity_id: o.id, rows: [{ sheet: '02_PHASE_0', row: 24, values: { F24: 'Oui' } }, { sheet: '01_OPPORTUNITE', row: 36, values: { C36: 'AO 2026/015 bis' } }] }, { display_name: 'Awa', role: 'collaborator' }, d);
  assert.equal(r.rows, 2); assert.equal(r.verified, true);
  // The bell: the Associé is asked for the decision; the person who dropped the TDR sees nothing left to answer.
  const tasks = await opportunityTasks({ display_name: 'Ama', role: 'partner' }, d);
  assert.ok(tasks.some(t => /Décision « poursuivre »/.test(t.title)));
  assert.ok(tasks.some(t => /À relire/.test(t.title)));
  assert.equal((await opportunityTasks({ display_name: 'Awa', role: 'collaborator' }, d)).some(t => /question/.test(t.title)), false);
});

test('questions pop up for the right person: the agents\' question, the Associé\'s decision, each member\'s independence', async () => {
  const { d } = await setup();
  const { opportunity } = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, { display_name: 'Awa' }, d);
  const o = await run(opportunity.id, d);
  const awa = await myQuestions('org', { display_name: 'Awa', role: 'collaborator' }, d);
  const q = awa.questions.find(x => x.kind === 'question');
  assert.equal(q.question, 'Avez-vous communiqué une information confidentielle ?');
  assert.deepEqual(q.options, ['Oui', 'Non', 'N-A']);
  assert.equal(awa.questions.some(x => x.kind === 'decision'), false, 'a collaborator never gets the decision');
  assert.equal((await myQuestions('org', { display_name: 'Kofi', role: 'collaborator' }, d)).questions.length, 0, 'someone outside the opportunity gets nothing');
  const ama = await myQuestions('org', { display_name: 'Ama', role: 'partner' }, d);
  const dec = ama.questions.find(x => x.kind === 'decision');
  assert.equal(dec.choice_cell, 'D44'); assert.match(dec.context, /POURSUIVRE VERS PHASE 1/);
  await answerRow('org', { opportunity_id: o.id, sheet: q.sheet, row: q.row, values: { [q.choice_cell]: 'Non' } }, { display_name: 'Awa', role: 'collaborator' }, d);
  assert.equal((await myQuestions('org', { display_name: 'Awa', role: 'collaborator' }, d)).questions.some(x => x.kind === 'question'), false, 'answered once, asked no more');
});

test('nobody is asked for a Drive link: the fiche facts missing in the workbook are written again when the page opens', async () => {
  const { drive, d } = await setup();
  const { opportunity } = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, { display_name: 'Awa' }, d);
  const o = await run(opportunity.id, d);
  const f = drive.files.get(o.workbook.id);
  f.buffer = await writeCells(f.buffer, [{ sheet: '01_OPPORTUNITE', cell: 'C56', value: '' }, { sheet: '01_OPPORTUNITE', cell: 'C35', value: '' }]);
  const view = await opportunityView('org', o.id, { display_name: 'Awa', role: 'collaborator' }, d);
  const fiche = view.sheets.find(s => s.name === '01_OPPORTUNITE');
  assert.match(fiche.rows.find(r => r.row === 56).fields[0].value, /^https:\/\/drive\//);
  assert.equal(fiche.rows.find(r => r.row === 35).fields[0].value, 'SOCIÉTÉ IVOIRIENNE TEST');
  const back = await readCells(drive.files.get(o.workbook.id).buffer, [{ sheet: '01_OPPORTUNITE', cell: 'C56' }]);
  assert.match(back['01_OPPORTUNITE!C56'], /^https:\/\/drive\//);
});
