import test from 'node:test';
import assert from 'node:assert/strict';
import { independenceQuestions, keepProposals, riskProposals, commercialAction, recordOpportunitySending, prepareParallelKyc, saveDeclarationDraft, confirmEngagementAgreement, requestMissionWorkspace, missionWorkspaceStep } from '../lib/opportunities.js';
import ExcelJS from 'exceljs';
import { describeWorkbook, writeCells, readCells, validateWrites, namingRule, copyName, patchSheetXml } from '../lib/acceptance-workbook.js';
import { createOpportunity, opportunityStep, answerRow, answerRows, opportunityTasks, myQuestions, removeOpportunity, listOpportunities, notDuplicate, findSpecialists, deciderOf, reviewSection, agentWrites, prepareAgain, markWon, onOpportunityWon, prepareKyc, kycStep, opportunityView, sheetOwner, rowAuthority, opportunityRound, teamStep, validateTeam, declareIndependence, assignKyc, getOpportunity, acceptExistingKyc } from '../lib/opportunities.js';

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
    updateBinary: async (id, { buffer, expectedModifiedTime }) => { const f = files.get(id); if (!expectedModifiedTime) throw new Error('EXPECTED_MODIFIED_TIME_REQUIRED'); if (f.modifiedTime !== expectedModifiedTime) throw new Error('MEMORY_CONFLICT'); f.buffer = buffer; f.modifiedTime = 't' + (++clock); return { modifiedTime: f.modifiedTime }; },
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

async function setup(templateOverride = null) {
  const template = templateOverride || await buildTemplate();
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
    fileForAI: async id => ({ id, name: drive.files.get(id).name, text: 'TERMES DE RÉFÉRENCE — Société Ivoirienne Test — AO N°2026/015 — mission d’audit légal — offres avant le 30 novembre 2026', url: 'https://drive/' + id, visual: false }),
    fetchRows: async () => [{ id: 'm1', name: 'Audit SOCIETE IVOIRIENNE TEST 2024', mission_code: 'SIT-24', status: 'closed' }],
    capabilityContext: async () => ({ people: [{ kind: 'employee', full_name: 'A. Senior', title: 'Senior', load_pct: 40 }] }) };
  return { drive, d, fired, events, audits };
}
const run = async (id, d) => { let o; for (let i = 0; i < 5; i++) { o = await opportunityStep('org', {}, { opportunity_id: id }, d); if (o.status !== 'running') break; } return o; };

test('AMI → MI → shortlist → proposal uses the same dossier and preserves KYC, team, answers and workbook', async () => {
  const { d, drive } = await setup(), actor = { email: 'owner@cab.ci', role: 'owner', display_name: 'Owner' };
  const created = await createOpportunity('org', {}, { name: 'AMI.pdf', base64: Buffer.from('x').toString('base64') }, actor, d);
  const initial = await run(created.opportunity.id, d), workbook = initial.workbook.id;
  await commercialAction('org', { opportunity_id: initial.id, milestone: 'classify', entry_kind: 'ami' }, actor, d);
  await prepareParallelKyc('org', {}, { opportunity_id: initial.id }, actor, d);
  const before = await getOpportunity(initial.id, d);
  assert.equal(before.status, 'phase0', 'preparing KYC does not invent a commercial decision');
  await assert.rejects(markWon('org', {}, { opportunity_id: initial.id, link: 'unused' }, actor, d), /AWARD_IS_NOT_SHORTLISTING/);
  await recordOpportunitySending(initial.id, { kind: 'mi', status: 'declared', proof: { kind: 'link' } }, d);
  await assert.rejects(commercialAction('org', { opportunity_id: initial.id, milestone: 'shortlisted', file_id: 'x'.repeat(30) }, actor, d), /COMMERCIAL_TRANSITION_INVALID/);
  await recordOpportunitySending(initial.id, { kind: 'mi', status: 'sent', proof: { kind: 'receipt' } }, d);
  const result = drive.add({ name: 'Presélection.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') });
  await commercialAction('org', { opportunity_id: initial.id, milestone: 'shortlisted', file_id: result.id }, actor, d);
  const ddp = drive.add({ name: 'DDP.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') });
  await commercialAction('org', { opportunity_id: initial.id, milestone: 'proposal_received', file_id: ddp.id }, actor, d);
  const after = await getOpportunity(initial.id, d);
  assert.equal(after.commercial.stage, 'proposal_prepare'); assert.equal(after.workbook.id, workbook);
  assert.deepEqual(after.answers, before.answers); assert.deepEqual(after.team, before.team); assert.deepEqual(after.phase1, before.phase1);
  assert.ok(after.tdr_files.some(f => f.id === ddp.id));
  await assert.rejects(commercialAction('org', { opportunity_id: initial.id, milestone: 'lost', file_id: result.id }, { role: 'auditor', email: 'a@cab.ci' }, d), /ROLE_NOT_ALLOWED/);
});

test('independence draft is private, resumes, and never certifies a person or completes the workbook', async () => {
  const { d, drive } = await setup();
  const created = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, null, d);
  const o = await run(created.opportunity.id, d), member = { name: 'Auditor', email: 'a@cab.ci', role: 'Auditeur' };
  await validateTeam('org', { opportunity_id: o.id, members: [member] }, { role: 'owner', email: 'owner@cab.ci' }, d);
  const bytes = Buffer.from(drive.files.get(o.workbook.id).buffer);
  await saveDeclarationDraft('org', { opportunity_id: o.id, answers: { 'C.01': 'Oui', 'C.11': 'Non' }, details: { 'C.01': 'À préciser' } }, { email: member.email, display_name: member.name }, d);
  const mine = await opportunityView('org', o.id, { email: member.email, display_name: member.name }, d);
  assert.equal(mine.my_declaration_draft.answers['C.01'], 'Oui'); assert.equal(mine.my_declaration, null);
  const other = await opportunityView('org', o.id, { role: 'owner', email: 'owner@cab.ci' }, d);
  assert.equal(other.declaration_drafts, undefined); assert.equal(other.my_declaration_draft, null);
  assert.deepEqual(drive.files.get(o.workbook.id).buffer, bytes);
});

test('written agreement is a separate partner review, never an automatic start', async () => {
  const { d, drive } = await setup(), actor = { role: 'owner', email: 'owner@cab.ci' };
  const created = await createOpportunity('org', {}, { name: 'DDP.pdf', base64: Buffer.from('x').toString('base64') }, actor, d);
  const o = await run(created.opportunity.id, d);
  await commercialAction('org', { opportunity_id: o.id, milestone: 'classify', entry_kind: 'proposal' }, actor, d);
  await markWon('org', {}, { opportunity_id: o.id, name: 'Attribution.pdf', base64: Buffer.from('yes').toString('base64') }, actor, d);
  const agreement = drive.add({ name: 'Contrat signé.pdf', mimeType: 'application/pdf', buffer: Buffer.from('signed') });
  const body = { opportunity_id: o.id, file_id: agreement.id, confirm: true, signatory: 'Client', version: 'v1' };
  await assert.rejects(confirmEngagementAgreement('org', body, { role: 'manager', email: 'manager@cab.ci' }, d), /PARTNER_DECISION_ONLY/);
  await assert.rejects(confirmEngagementAgreement('org', { ...body, confirm: false }, actor, d), /AGREEMENT_CONFIRMATION_REQUIRED/);
  const result = await confirmEngagementAgreement('org', body, actor, d);
  assert.equal(result.agreement.status, 'verified'); assert.equal(result.mission_started, false);
  assert.equal((await getOpportunity(o.id, d)).mission_id, undefined);
});

test('KYC finishing in the background preserves commercial progress and human answers entered during research', async () => {
  const { d } = await setup(), actor = { role: 'owner', email: 'owner@cab.ci' };
  const created = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, actor, d);
  const o = await run(created.opportunity.id, d);
  await prepareParallelKyc('org', {}, { opportunity_id: o.id }, actor, d);
  const after = await kycStep('org', {}, { opportunity_id: o.id }, { ...d, ai: async (order, input) => {
    await commercialAction('org', { opportunity_id: o.id, milestone: 'classify', entry_kind: 'ami' }, actor, d);
    await answerRow('org', { opportunity_id: o.id, sheet: '03_PHASE_1', row: 61, values: { D61: 'Information confirmée pendant la recherche' } }, actor, d);
    return d.ai(order, input);
  } });
  assert.equal(after.commercial.stage, 'mi_prepare');
  assert.ok(after.answers.some(a => a.row === 61));
  assert.equal(after.phase1.status, 'ready');
});

test('shared independence facts are prepared once; personal declarations and manager conclusions stay human', async () => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await buildTemplate());
  const ws = wb.getWorksheet('03_PHASE_1');
  ws.getCell('B77').value = 'C.11'; ws.getCell('C77').value = 'Honoraires antérieurs impayés';
  for (const cell of ['D77', 'I77']) ws.getCell(cell).fill = fill(INPUT);
  const structure = await describeWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.deepEqual(independenceQuestions(structure).map(q => q.ref), ['C.01']);
  const props = keepProposals(structure, [
    { sheet: '03_PHASE_1', row: 77, values: { D77: 'Facture en attente', I77: 'AUCUNE MENACE' }, sources: ['Comptabilité du cabinet'] },
    { sheet: '03_PHASE_1', row: 76, values: { D76: 'aucun intérêt financier' }, sources: ['web'] }
  ], ['mission-controller']);
  assert.deepEqual(props['03_PHASE_1!77'].values, { D77: 'Facture en attente' });
  assert.equal(props['03_PHASE_1!76'], undefined);
  const writes = agentWrites(structure, props, {}, 'mission-controller').writes;
  assert.equal(writes.find(w => w.cell === 'D77').value, 'Facture en attente');
  assert.equal(writes.some(w => w.cell === 'I77' || w.cell === 'D76'), false);
  assert.equal(agentWrites(structure, props, { '03_PHASE_1!D77': 'Réponse humaine' }, 'mission-controller').writes.length, 0);

  const { d, drive } = await setup(Buffer.from(await wb.xlsx.writeBuffer()));
  const created = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, null, d);
  const o = await run(created.opportunity.id, d);
  const partner = { role: 'partner', display_name: 'Associée', email: 'partner@cab.ci' };
  const members = [{ name: 'Manager', email: 'm@cab.ci', role: 'Manager' }, { name: 'Auditor', email: 'a@cab.ci', role: 'Auditeur' }];
  await validateTeam('org', { opportunity_id: o.id, members }, partner, d);
  await onOpportunityWon('org', { object_id: o.id }, d);
  await answerRow('org', { opportunity_id: o.id, sheet: '03_PHASE_1', row: 77, values: { D77: 'Facture à recouvrer' } }, partner, d);
  for (const m of members) await declareIndependence('org', { opportunity_id: o.id, answers: { 'C.01': 'Non' }, certify: true }, { display_name: m.name, email: m.email }, d);
  const back = await readCells(drive.files.get(o.workbook.id).buffer, [{ sheet: '03_PHASE_1', cell: 'D77' }]);
  assert.equal(back['03_PHASE_1!D77'], 'Facture à recouvrer', 'personal declarations never clear or certify shared firm facts');
});

test('AI risk proposals require evidence, respect template lists and cannot write manager ratings or signatures', () => {
  const structure = { sheets: [{ name: '03_PHASE_1', rows: [
    { row: 10, label: 'Risque KYC', section: 'SECTION H — COTATION DU RISQUE', fields: [{ cell: 'D10', header: 'Cotation proposée', type: 'list', options: ['FAIBLE', 'MODERE', 'ELEVE'] }, { cell: 'F10', header: 'Justification', type: 'text' }] },
    { row: 11, label: 'Cotation proposée par (Manager) / date', section: 'SECTION H — COTATION DU RISQUE', fields: [{ cell: 'D11', header: 'Nom du Manager', type: 'text' }] }
  ] }] };
  const rows = [
    { sheet: '03_PHASE_1', row: 10, values: { D10: 'MODERE', F10: 'Pièces à compléter' }, why: 'Vérification incomplète', sources: ['Dossier client'] },
    { sheet: '03_PHASE_1', row: 11, values: { D11: 'Manager inventé' }, sources: ['web'] }
  ];
  const proposals = riskProposals(structure, rows);
  assert.deepEqual(Object.keys(proposals), ['03_PHASE_1!10']);
  assert.equal(proposals['03_PHASE_1!10'].requires_manager_validation, true);
  assert.equal(agentWrites(structure, proposals, {}, 'mission-controller').writes.length, 0);
  assert.deepEqual(riskProposals(structure, [{ ...rows[0], sources: [] }]), {});
  assert.deepEqual(riskProposals(structure, [{ ...rows[0], values: { D10: 'INVENTE' } }]), {});
});

test('KYC preparation receives existing answers and the internal mission register for named conflict research', async () => {
  const { d } = await setup();
  const created = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, null, d);
  const o = await run(created.opportunity.id, d);
  await onOpportunityWon('org', { object_id: o.id }, d);
  await answerRow('org', { opportunity_id: o.id, sheet: '03_PHASE_1', row: 61, values: { D61: 'Dirigeante déjà confirmée' } }, { role: 'partner', email: 'partner@cab.ci', display_name: 'Associée' }, d);
  await prepareKyc('org', {}, { opportunity_id: o.id }, null, d);
  let prompt;
  const after = await kycStep('org', {}, { opportunity_id: o.id }, { ...d, ai: async (order, input) => { prompt = input; return d.ai(order, input); } });
  assert.equal(after.phase1.status, 'ready', after.phase1.error);
  assert.match(prompt.input, /Dirigeante déjà confirmée/);
  assert.match(prompt.input, /Audit SOCIETE IVOIRIENNE TEST 2024/);
  assert.match(prompt.instructions, /noms complets/);
  assert.match(prompt.instructions, /COTATION/);
});

test('already-filled workbook decisions are not asked again; assigning KYC preserves the original file and answers', async () => {
  const { d, drive } = await setup();
  const created = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('TDR').toString('base64') }, { display_name: 'Owner' }, d);
  const o = await run(created.opportunity.id, d);
  const file = drive.files.get(o.workbook.id);
  file.buffer = await writeCells(file.buffer, [{ sheet: '02_PHASE_0', cell: 'D44', value: 'POURSUIVRE VERS PHASE 1' }]);
  const questions = await myQuestions('org', { role: 'owner', email: 'owner@example.org', display_name: 'Owner' }, d);
  assert.equal(questions.questions.some(q => q.id === 'dec|' + o.id), false, 'decision imported from the real workbook is reused');
  await validateTeam('org', { opportunity_id: o.id, members: [{ name: 'Manager', email: 'manager@example.org', role: 'Manager' }, { name: 'Auditor', email: 'auditor@example.org', role: 'Auditeur' }] }, { role: 'owner', email: 'owner@example.org' }, d);
  await assignKyc('org', { opportunity_id: o.id, email: 'auditor@example.org' }, { role: 'manager', email: 'manager@example.org', display_name: 'Manager' }, d);
  const after = await getOpportunity(o.id, d);
  assert.equal(after.workbook.id, o.workbook.id);
  assert.equal(after.kyc_responsible.email, 'auditor@example.org');
  assert.equal((await readCells(file.buffer, [{ sheet: '02_PHASE_0', cell: 'D44' }]))['02_PHASE_0!D44'], 'POURSUIVRE VERS PHASE 1');
  await assert.rejects(assignKyc('org', { opportunity_id: o.id, email: 'auditor@example.org' }, { role: 'manager', email: 'outside@example.org' }, d), /NOT_THE_MISSION_MANAGER/);
});

test('accepting existing KYC is a signed human decision and never rewrites the workbook or certifies team members', async () => {
  const { d, drive } = await setup();
  const created = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('TDR').toString('base64') }, { display_name: 'Owner' }, d);
  const o = await run(created.opportunity.id, d);
  const before = Buffer.from(drive.files.get(o.workbook.id).buffer);
  const account = { role: 'owner', email: 'owner@example.org' };
  await assert.rejects(acceptExistingKyc('org', { opportunity_id: o.id }, account, d), /CERTIFICATION_REQUIRED/);
  const result = await acceptExistingKyc('org', { opportunity_id: o.id, confirm: true }, account, d);
  assert.equal(result.review.file_id, o.workbook.id);
  assert.equal(result.review.basis, 'human_confirmation');
  assert.equal(result.review.by, account.email);
  assert.deepEqual(drive.files.get(o.workbook.id).buffer, before);
  assert.equal((await getOpportunity(o.id, d)).declarations, undefined);
  await assert.rejects(acceptExistingKyc('org', { opportunity_id: o.id, confirm: true }, { role: 'auditor', email: 'auditor@example.org' }, d), /NOT_THE_MISSION_MANAGER/);
});

test('the owner can explicitly override separation in the same workbook; a manager cannot acquire that exception', async () => {
  const { d, drive } = await setup();
  const created = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('TDR').toString('base64') }, { display_name: 'Owner' }, d);
  const o = await run(created.opportunity.id, d);
  const structure = await describeWorkbook(await buildTemplate());
  structure.sheets.find(s => s.name === '02_PHASE_0').rows.push({ row: 7, label: 'Préparé par', fields: [{ cell: 'C7', type: 'text', header: 'Nom' }] });
  d.templateStructure = async () => ({ structure });
  const file = drive.files.get(o.workbook.id);
  file.buffer = await writeCells(file.buffer, [{ sheet: '02_PHASE_0', cell: 'C7', value: 'Owner' }]);
  const body = { opportunity_id: o.id, sheet: '02_PHASE_0', row: 44, values: { D44: 'POURSUIVRE VERS PHASE 1' } };
  const owner = { role: 'owner', email: 'owner@example.org', display_name: 'Owner' };
  await assert.rejects(answerRow('org', body, owner, d), /SEPARATION_OF_FUNCTIONS/);
  const result = await answerRow('org', { ...body, owner_override: true }, owner, d);
  assert.equal(result.verified, true);
  const after = await getOpportunity(o.id, d);
  assert.equal(after.overrides.at(-1).target, 'workbook_decision');
  assert.equal(after.overrides.at(-1).by, owner.email);
  assert.equal(after.workbook.id, o.workbook.id);
  await assert.rejects(answerRow('org', { ...body, owner_override: true }, { role: 'manager', email: 'manager@example.org' }, d), /PARTNER_DECISION_ONLY|OWNER_ONLY/);
});

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
  // Section C of the workbook now says what the people declared, threat by threat; the conclusion stays empty (the Manager's).
  const c = await readCells(d.drive.files.get(t.workbook.id).buffer, [{ sheet: '03_PHASE_1', cell: 'D76' }, { sheet: '03_PHASE_1', cell: 'I76' }]);
  assert.equal(c['03_PHASE_1!D76'], 'A. Senior : actions de la société');
  assert.equal(c['03_PHASE_1!I76'], '');
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

test('an opportunity can be removed from the application; nothing is deleted in the Drive', async () => {
  const { drive, d } = await setup();
  const { opportunity } = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, { display_name: 'Awa' }, d);
  const o = await run(opportunity.id, d);
  await assert.rejects(removeOpportunity('org', { opportunity_id: o.id }, { display_name: 'Kofi', role: 'collaborator' }, d), /MANAGER_ONLY/);
  const r = await removeOpportunity('org', { opportunity_id: o.id, reason: 'test' }, { display_name: 'Awa', role: 'collaborator' }, d);
  assert.equal(r.status, 'removed');
  assert.ok(drive.files.get(o.workbook.id) && drive.files.get(o.folder.id) && drive.files.get(o.tdr_files[0].id), 'the TDR, folder and workbook stay');
  assert.equal((await listOpportunities('org', d)).opportunities.length, 0);
  assert.equal((await myQuestions('org', { display_name: 'Ama', role: 'partner' }, d)).questions.length, 0);
  // The same TDR can open a new opportunity again.
  assert.notEqual((await createOpportunity('org', {}, { file_ids: [o.tdr_files[0].id] }, null, d)).duplicate, true);
});

test('a possible duplicate carries on when its twin is removed, or when a person says it is not one', async () => {
  const { d } = await setup();
  const first = await createOpportunity('org', {}, { name: 'TDR1.pdf', base64: Buffer.from('a').toString('base64') }, { display_name: 'Awa' }, d);
  const a = await run(first.opportunity.id, d);
  const second = await createOpportunity('org', {}, { name: 'TDR2.pdf', base64: Buffer.from('b').toString('base64') }, { display_name: 'Awa' }, d);
  let b = await run(second.opportunity.id, d);
  assert.equal(b.status, 'duplicate');
  await removeOpportunity('org', { opportunity_id: a.id }, { display_name: 'Awa', role: 'manager' }, d);
  b = await run(b.id, d);
  assert.equal(b.status, 'phase0', 'the twin removed: the one left goes on by itself');
  // Or a person says it is not a duplicate.
  const third = await createOpportunity('org', {}, { name: 'TDR3.pdf', base64: Buffer.from('c').toString('base64') }, { display_name: 'Awa' }, d);
  let c = await run(third.opportunity.id, d);
  assert.equal(c.status, 'duplicate');
  await assert.rejects(notDuplicate('org', {}, { opportunity_id: c.id }, { display_name: 'Kofi', role: 'collaborator' }, d), /MANAGER_ONLY/);
  await notDuplicate('org', {}, { opportunity_id: c.id }, { display_name: 'Awa', role: 'collaborator' }, d);
  c = await run(c.id, d);
  assert.equal(c.status, 'phase0');
});

test('the team is ours: specialists searched in the country, externals added, they never block the declarations', async () => {
  const { d } = await setup();
  const { opportunity } = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, { display_name: 'Awa' }, d);
  const o = await run(opportunity.id, d);
  const searchSpecialists = async (org, input) => ({ web: true, specialists: [{ name: 'Cabinet Énergie CI', speciality: 'Stocks pétroliers', country: input.country || 'CI', source: 'https://example.org' }] });
  await assert.rejects(findSpecialists('org', { opportunity_id: o.id, gap: 'Expert stocks' }, { display_name: 'Awa', role: 'collaborator' }, { ...d, searchSpecialists }), /MANAGER_ONLY/);
  const f = await findSpecialists('org', { opportunity_id: o.id, gap: 'Expert stocks' }, { display_name: 'Moussa', role: 'manager' }, { ...d, searchSpecialists });
  assert.equal(f.list[0].name, 'Cabinet Énergie CI');
  await validateTeam('org', { opportunity_id: o.id, members: [{ name: 'A. Senior', email: 'senior@cab.ci', role: 'Senior' }, { name: 'Cabinet Énergie CI', role: 'Spécialiste', external: true, speciality: 'Stocks pétroliers', source: 'https://example.org' }] }, { display_name: 'Moussa', role: 'manager' }, d);
  const r = await declareIndependence('org', { opportunity_id: o.id, answers: { 'C.01': 'Non' }, certify: true }, { display_name: 'A. Senior', email: 'senior@cab.ci' }, d);
  assert.equal(r.all_declared, true, 'the external specialist does not block: their written declaration is obtained outside the app');
});

test('who decides: the business-development Associé named in Paramètres; the mission Manager rates; the mission Partner accepts', async () => {
  const { d } = await setup();
  const d2 = { ...d, fetchRows: async (path, opts) => String(path).startsWith('office_firm_settings') ? [{ settings: { business_partner: { name: 'Ama Associée' } } }] : d.fetchRows(path, opts) };
  const { opportunity } = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, { display_name: 'Awa' }, d2);
  const o = await run(opportunity.id, d2);
  await assert.rejects(answerRow('org', { opportunity_id: o.id, sheet: '02_PHASE_0', row: 44, values: { D44: 'POURSUIVRE VERS PHASE 1' } }, { display_name: 'Kofi Partner', role: 'partner' }, d2), /NOT_THE_DECIDING_PARTNER/);
  assert.equal((await myQuestions('org', { display_name: 'Kofi Partner', role: 'partner' }, d2)).questions.some(q => q.kind === 'decision'), false, 'another Associé does not get the decision');
  assert.ok((await myQuestions('org', { display_name: 'Ama Associée', role: 'partner' }, d2)).questions.some(q => q.kind === 'decision'));
  assert.equal((await answerRow('org', { opportunity_id: o.id, sheet: '02_PHASE_0', row: 44, values: { D44: 'POURSUIVRE VERS PHASE 1' } }, { display_name: 'Ama Associée', role: 'partner' }, d2)).status, 'go');
  // Phase 1 / sheet 04: the validated team's Manager and Partner.
  const team = { status: 'validated', members: [{ name: 'K. Manager', role: 'Manager' }, { name: 'P. Partner', role: 'Partner' }] };
  const sheet = { name: '03_PHASE_1', title: 'PHASE 1' }, rating = { label: 'Risque KYC', fields: [{ header: 'Cotation proposée' }] }, accept = { label: "DÉCISION DE L'ASSOCIÉ", fields: [] };
  assert.equal(deciderOf({ team }, sheet, rating, {}).who[0].name, 'K. Manager');
  assert.equal(deciderOf({ team }, { name: '04_CONCLUSION', title: 'Synthèse et décision' }, accept, {}).who[0].name, 'P. Partner');
  assert.equal(deciderOf({}, sheet, rating, {}), null, 'no team yet: any Manager may');
});

test('validating the team queues the budget before KYC and independence, without duplicate work', async () => {
  const { d, fired } = await setup();
  const { opportunity } = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, { display_name: 'Awa' }, d);
  const o = await run(opportunity.id, d);
  const input = { opportunity_id: o.id, members: [{ name: 'Moussa', email: 'manager@example.org', role: 'Manager' }] };
  const account = { display_name: 'Moussa', email: 'manager@example.org', role: 'manager' };
  await validateTeam('org', input, account, { ...d, req: {} });
  const current = await getOpportunity(o.id, d);
  assert.equal(current.quotation.status, 'queued');
  assert.equal(current.team.status, 'validated');
  assert.ok(!current.phase1);
  assert.equal(fired.filter(f => f.path.includes('quotation-step')).length, 1);
  await validateTeam('org', input, account, { ...d, req: {} });
  assert.equal(fired.filter(f => f.path.includes('quotation-step')).length, 1);
});

test('mission workspace queues once, preserves dossier state, and rechecks authority in the worker', async () => {
  const { d, drive, fired } = await setup();
  const { opportunity } = await createOpportunity('org', {}, { name: 'TDR.pdf', base64: Buffer.from('x').toString('base64') }, { display_name: 'Awa' }, d);
  const o = await run(opportunity.id, d);
  const memory = [...drive.files.values()].find(f => f.name === 'OFFICE_MANAGER_OPPORTUNITIES.json');
  const state = JSON.parse(memory.buffer.toString());
  state.opportunities[o.id].mission_id = 'mission-id';
  state.opportunities[o.id].handoff = { status: 'complete', folder_id: 'dest' };
  memory.buffer = Buffer.from(JSON.stringify(state));
  const account = { role: 'owner', email: 'owner@example.org' }, body = { opportunity_id: o.id };
  await assert.rejects(requestMissionWorkspace('org', {}, body, { role: 'collaborator', email: 'other@example.org' }, d), /NOT_THE_MISSION_MANAGER/);
  await requestMissionWorkspace('org', {}, body, account, d);
  assert.equal((await requestMissionWorkspace('org', {}, body, account, d)).status, 'already_running');
  assert.equal(fired.filter(f => f.body.workspace === true).length, 1);
  let calls = 0;
  const result = await missionWorkspaceStep('org', body, { ...d, fetchRows: async path => path.startsWith('office_app_users?') ? [account] : [{ id: 'mission-id', status: 'planning', drive_folder_id: 'dest' }], prepareWorkspace: async () => { calls++; return { status: 'reported', summary: 'Modèle à confirmer', review_required: true }; } });
  assert.equal(result.status, 'reported'); assert.equal(calls, 1);
  assert.equal((await missionWorkspaceStep('org', body, d)).status, 'not_queued');
  const after = await getOpportunity(o.id, d);
  assert.deepEqual(after.workbook, o.workbook); assert.deepEqual(after.answers, o.answers);
  assert.equal(after.workspace.summary, 'Modèle à confirmer');
  await requestMissionWorkspace('org', {}, body, account, d);
  const revoked = await missionWorkspaceStep('org', body, { ...d, fetchRows: async () => [], prepareWorkspace: async () => { calls++; } });
  assert.equal(revoked.status, 'failed'); assert.equal(calls, 1);
});


test('team and KYC responsibility are saved together, preserving personal independence and clearing removed assignees', async () => {
  const {d}=await setup(), actor={role:'owner',email:'owner@cab.ci'};
  const created=await createOpportunity('org',{}, {name:'TDR.pdf',base64:Buffer.from('x').toString('base64')},actor,d);
  const o=await run(created.opportunity.id,d), members=[{name:'Auditor',email:'a@cab.ci',role:'Auditeur'}];
  await assert.rejects(validateTeam('org',{opportunity_id:o.id,members,kyc_email:'outside@cab.ci'},actor,d),/KYC_RESPONSIBLE_MUST_BE_IN_TEAM/);
  await validateTeam('org',{opportunity_id:o.id,members,kyc_email:'a@cab.ci'},actor,d);
  const saved=await getOpportunity(o.id,d);
  assert.equal(saved.kyc_responsible.email,'a@cab.ci');assert.equal(saved.workbook.id,o.workbook.id);
  assert.equal(Object.keys(saved.declarations||{}).length,0);
  await validateTeam('org',{opportunity_id:o.id,members:[{name:'Other',email:'b@cab.ci',role:'Auditeur'}]},actor,d);
  assert.equal((await getOpportunity(o.id,d)).kyc_responsible,null);
});
test('independence explanation is required; partner popup, transcribed safeguard and new explanation invalidate prior decision',async()=>{
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(await buildTemplate());const ws=wb.getWorksheet('03_PHASE_1');ws.getCell('E75').value='Garde-fous / justification';ws.getCell('E75').fill=fill(DARK);ws.getCell('E76').fill=fill(INPUT);
 const {d,drive}=await setup(Buffer.from(await wb.xlsx.writeBuffer()));const created=await createOpportunity('org',{}, {name:'TDR.pdf',base64:Buffer.from('x').toString('base64')}, {role:'partner',email:'p@cab.ci'},d);const o=await run(created.opportunity.id,d);
 await validateTeam('org',{opportunity_id:o.id,members:[{name:'A. Senior',email:'senior@cab.ci',role:'Senior'}]},{role:'partner',email:'p@cab.ci'},d);
 const body={opportunity_id:o.id,answers:{'C.01':'Oui'},certify:true};const person={email:'senior@cab.ci',display_name:'A. Senior'};
 await assert.rejects(declareIndependence('org',body,person,d),/INDEPENDENCE_EXPLANATION_REQUIRED/);
 await declareIndependence('org',{...body,details:{'C.01':'Mon conjoint est employé du client.'}},person,d);
 const light=await myQuestions('org',{role:'partner',email:'p@cab.ci'},{...d,independenceOnly:true,templateStructure:async()=>{throw Error('MUST_NOT_READ_TEMPLATE');},documentRequests:async()=>{throw Error('MUST_NOT_SEARCH_DOCUMENTS');}});assert.ok(light.questions.some(q=>q.kind==='independence_review'));
 const popup=await myQuestions('org',{role:'partner',email:'p@cab.ci'},d);assert.ok(popup.questions.some(q=>q.kind==='independence_review'));
 const {independenceReviewAction}=await import('../lib/opportunities.js');const view=await opportunityView('org',o.id,{role:'partner',email:'p@cab.ci'},d),c=view.independence_cases[0];
 const result=await independenceReviewAction('org',{opportunity_id:o.id,case_id:c.id,version:c.version,action:'independence-decide',selected:['independent_review'],note:'Revue distincte justifiée après analyse'}, {role:'partner',email:'p@cab.ci'},d);
 assert.equal(result.decision.status,'measures_pending');assert.equal(result.workbook_sync.status,'verified');
 const cells=await readCells(drive.files.get(o.workbook.id).buffer,[{sheet:'03_PHASE_1',cell:'E76'},{sheet:'03_PHASE_1',cell:'I76'}]);assert.match(cells['03_PHASE_1!E76'],/p@cab.ci/);assert.equal(cells['03_PHASE_1!I76'],'');
 await declareIndependence('org',{...body,details:{'C.01':'Je détiens aussi des actions.'}},person,d);const after=await opportunityView('org',o.id,{role:'partner',email:'p@cab.ci'},d);assert.equal(after.independence_cases[0].status,'pending');assert.equal(after.declaration_history.length,1);
 await assert.rejects(independenceReviewAction('org',{opportunity_id:o.id,case_id:c.id,version:c.version,action:'independence-applied',note:'Revu',evidence:'WP'}, {role:'partner',email:'p@cab.ci'},d),/DECLARATION_CHANGED/);
});

// Plan B5 (2026-10-30): the quote the AI gives for each value of the fiche is checked in the TDR before anything is written.
test('fiche values: written only when their quote is in the TDR; otherwise a proposal, with the reason', async () => {
  const { splitQuoted } = await import('../lib/opportunities.js');
  const text = 'TERMES DE RÉFÉRENCE — Société Ivoirienne Test — « Audit légal des comptes 2026 » — date limite : 30 novembre 2026';
  const s = splitQuoted([{ cell: 'C35', value: 'SIT', quote: 'Société  Ivoirienne TEST' }, { cell: 'C41', value: 'audit légal', quote: 'audit legal des comptes 2026' },
    { cell: 'C44', value: '50 M FCFA', quote: 'budget de 50 millions' }, { cell: 'C50', value: 'x', quote: '' }], text);
  assert.deepEqual(s.verified.map(v => v.cell), ['C35', 'C41'], 'accents, case and spaces aside');
  assert.deepEqual(s.proposals.map(p => [p.cell, p.reason]), [['C44', 'citation non retrouvée dans le TDR'], ['C50', 'aucune citation donnée']]);
  const scan = splitQuoted([{ cell: 'C35', value: 'SIT', quote: 'Société Ivoirienne Test' }], '', true);
  assert.equal(scan.proposals[0].reason, 'TDR lu sur un scan : à relire');
});
