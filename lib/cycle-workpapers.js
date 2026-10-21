import ExcelJS from 'exceljs';
import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { methodologyState, findProcedure } from './methodology.js';
import { getBranding } from './branding.js';
import { audit } from './audit-log.js';

// ONE WORKING PAPER PER CYCLE (Paul, 2026-10-12: « chaque cycle a son working paper » ; the firm has no template yet).
// When the Manager validates the work programme, the Mission Controller creates, for each cycle in scope, a base
// Excel in the mission's working-papers folder (in the firm's Drive, under the mission): a cover page (mission,
// cycle, programme version, materiality, prepared by, the reviews THIS mission requires with empty « revu par / date »
// lines), one sheet per procedure of the programme (its card from the SOP, its steps, the WP columns of the SOP,
// numbered sample lines, the conclusion model) and a hidden AUDIT_META sheet (architecture §18). The auditor fills it
// in: it is the proof of the human work. Never overwritten: a file of the same name is kept as it is (idempotent).
// The folder is found under the mission (a sub-folder whose name says working papers / feuilles de travail), or the
// one the Manager pasted in the programme — never a path written for one firm.

const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const FOLDER = 'application/vnd.google-apps.folder';
export const WP_FOLDER_NAME = /(working[\s_-]*papers?|feuilles?[\s_-]*de[\s_-]*travail|dossier[\s_-]*de[\s_-]*travail|\bwp\b|papiers?[\s_-]*de[\s_-]*travail)/i;
export const COMMON_COLUMNS = ['Sample ID / Référence', 'Date', 'Tiers', 'Montant', 'Pièce / source', 'Attribut testé', 'Résultat PASS/EXCEPTION', 'Écart', 'Commentaire', 'Cross-reference'];
const REVIEW_LABELS = { senior: 'Revue Senior', manager: 'Revue Manager', supervisor: 'Revue Superviseur', partner: 'Revue Associé' };
const MODE = { none: 'Pas d’échantillon', walkthrough: '1 transaction dirigée', exhaustive: 'Toute la population', risk_targeted: 'Ciblage par risque', programme_sample: 'Échantillon du programme', random: 'Échantillon aléatoire', other: 'Voir le SOP' };
const TYPE = { CORE: 'Obligatoire', RISK_DEPENDENT: 'Selon le risque', OPTIONAL: 'Facultatif' };
const safe = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

export function workpaperName(mission, cycle) {
  return `WP_${safe(cycle.cycle_code || cycle.cycle_title)}_${safe(cycle.cycle_title).slice(0, 30)}_${safe(mission.name)}.xlsx`.replace(/_+/g, '_');
}

// The workbook of one cycle (pure: the same inputs give the same file).
export async function buildCycleWorkpaper({ firm, mission, programme, cycle, procedures, by = null, now = new Date() }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mission Controller (IA)'; wb.created = now;
  const bold = { bold: true }, title = { bold: true, size: 14 };
  const cover = wb.addWorksheet('Page de garde');
  cover.columns = [{ width: 34 }, { width: 70 }];
  cover.addRow([firm || '', '']).font = title;
  cover.addRow([`Working Paper — ${cycle.cycle_code ? cycle.cycle_code + ' — ' : ''}${cycle.cycle_title}`]).font = title;
  cover.addRow([]);
  const m = programme.materiality || {}, money = v => v == null ? '' : Number(v).toLocaleString('fr-FR') + ' ' + (m.currency || '');
  [['Mission', mission.name], ['Client', mission.client_name || ''], ['Cycle', `${cycle.cycle_code || ''} ${cycle.cycle_title}`.trim()], ['Statut du cycle', cycle.status],
    ['SOP de référence', cycle.sop_file_name || ''], ['Programme de travail', `version ${programme.version}, validé par ${programme.validated_by || '?'} le ${String(programme.validated_at || '').slice(0, 10)}`],
    ['Seuil de signification', money(m.overall)], ['Seuil de planification', money(m.performance)], ['Anomalies insignifiantes', money(m.trivial)], ['Base de la matérialité', m.basis || ''],
    ['Préparé par', cycle.preparer || ''], ['Date de préparation', '']].forEach(r => { const row = cover.addRow(r); row.getCell(1).font = bold; });
  cover.addRow([]);
  cover.addRow(['Revues requises par la mission', 'Revu par — date']).font = bold;
  for (const [k, label] of Object.entries(REVIEW_LABELS)) if (programme.reviews?.[k]) cover.addRow([label, '']);
  cover.addRow([]);
  cover.addRow(['Procédures du programme', '']).font = bold;
  for (const p of procedures) cover.addRow([p.code, p.title]);
  cover.addRow([]);
  cover.addRow(['Conclusion du cycle (Senior)', '']).getCell(1).font = bold;

  for (const p of procedures) {
    const ws = wb.addWorksheet(String(p.code).slice(0, 31));
    const cols = (p.wp_columns && p.wp_columns.length >= 3 ? p.wp_columns : COMMON_COLUMNS).slice(0, 20);
    ws.columns = cols.map((c, i) => ({ width: i === 0 ? 22 : Math.min(40, Math.max(14, c.length + 4)) }));
    ws.addRow([`${p.code} — ${p.title}`]).font = title;
    const info = [['Objectif', p.objective], ['Risque', p.risk], ['Assertion', p.assertion], ['Type', (TYPE[p.type] || '') + (p.condition ? ' ' + p.condition : '')], ['Niveau', p.level],
      ['Population', p.population], ['Sélection', [MODE[p.sampling_mode] || p.selection, p.sample_size ? p.sample_size + ' élément(s)' : ''].filter(Boolean).join(' — ')],
      ['Raison (programme)', p.justification], ['Préparé par', p.preparer || cycle.preparer]];
    for (const [k, v] of info) if (v) { const r = ws.addRow([k, v]); r.getCell(1).font = bold; }
    if (p.steps?.length) {
      ws.addRow([]); ws.addRow(['Étapes (SOP)']).font = bold;
      p.steps.forEach((s, i) => ws.addRow([`${i + 1}.`, s.text || s]));
    }
    ws.addRow([]);
    const head = ws.addRow(cols); head.font = bold;
    head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } }; c.border = { bottom: { style: 'thin' } }; });
    const lines = Math.min(200, Number(p.sample_size) || (p.sampling_mode === 'walkthrough' ? 1 : 10));
    for (let i = 1; i <= lines; i++) ws.addRow([p.sample_size ? i : '']);
    ws.addRow([]);
    ws.addRow(['Conclusion']).font = bold;
    ws.addRow([p.conclusion_template ? '« ' + p.conclusion_template + ' »' : '']);
    ws.addRow(['Préparé par / date', '']); ws.addRow(['Revu par / date', '']);
  }

  const meta = wb.addWorksheet('AUDIT_META');
  meta.state = 'veryHidden';
  [['Engagement_ID', mission.id], ['Cycle_ID', cycle.cycle_code || ''], ['WP_ID', `WP-${cycle.cycle_code || ''}`], ['SOP_File_ID', cycle.sop_file_id], ['Programme_ID', programme.id],
    ['Programme_Version', programme.version], ['Procedures', procedures.map(p => p.code).join(',')], ['Preparer_ID', cycle.preparer || ''],
    ['Reviewers_Required', Object.keys(REVIEW_LABELS).filter(k => programme.reviews?.[k]).join(',')], ['Status', 'TO_PREPARE'], ['Created_By', 'Mission Controller (IA)'],
    ['Created_On_Behalf_Of', by || ''], ['Created_At', now.toISOString()]].forEach(r => meta.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// The mission's working-papers folder: the one pasted in the programme, else a sub-folder of the mission (2 levels),
// else (Paul, 2026-10-19 : « la fiche de travail de l'Enhanced Auditor ne sait pas où elle se trouve ») one is CREATED
// under the mission folder, once (found again by name next time). Only a mission with no known folder still stops.
export const WP_FOLDER_DEFAULT = '05_WORKING_PAPERS';
export async function findWorkpapersFolder(mission, programme, drive = driveAdapter, d = {}) {
  const pasted = String(programme.materiality?.workpapers_folder || '').match(/[-\w]{20,}/)?.[0];
  if (pasted) return { id: pasted, how: 'pasted' };
  const root = mission?.drive_folder_id || mission?.client_folder_id;
  if (!root) throw fail('MISSION_FOLDER_NOT_KNOWN', 409);
  const level1 = (await drive.listChildren(root)).filter(f => f.mimeType === FOLDER);
  let hit = level1.find(f => WP_FOLDER_NAME.test(f.name || ''));
  if (!hit) for (const f of level1.slice(0, 30)) { hit = (await drive.listChildren(f.id).catch(() => [])).find(x => x.mimeType === FOLDER && WP_FOLDER_NAME.test(x.name || '')); if (hit) break; }
  if (hit) return { id: hit.id, name: hit.name, how: 'found' };
  if (d.create === false) throw fail('WORKPAPERS_FOLDER_NOT_FOUND', 409);
  const make = d.findOrCreateFolder || (async (p, n) => (await import('./tidy-drive.js')).tidyDrive.findOrCreateFolder(p, n));
  const made = await make(root, WP_FOLDER_DEFAULT).catch(() => null);
  if (!made?.id) throw fail('WORKPAPERS_FOLDER_NOT_FOUND', 409);
  return { id: made.id, name: made.name || WP_FOLDER_DEFAULT, how: 'created' };
}

// The cycle's working paper, always known: when the programme has none recorded for this cycle (nobody clicked
// « Créer les Working Papers »), the Mission Controller prepares the missing ones now (same code, never overwrites,
// checked in the Drive) and the programme is read again.
export async function ensureCycleWorkpaper(orgId, missionId, programme, cycleCode, account, d = {}) {
  const has = p => (p?.workpapers || []).find(w => w.cycle_code === cycleCode && w.file_id && w.model?.id && ['ALREADY_EXISTS','CREATED_FROM_MODEL'].includes(w.status)) || null;
  // Legacy generated files must not hide a missing cabinet model.
  const codes = p => (p?.cycles || []).find(c => c.cycle_code === cycleCode)?.procedures?.filter(x => x.active).map(x => x.code).sort() || [];
  const bound=has(programme);
  if (bound && bound.programme_version === programme.version && JSON.stringify([...(bound.active_codes || [])].sort()) === JSON.stringify(codes(programme))) return { programme, workpaper: bound };
  const fetchRows = d.fetchRows || rest;
  const out = await (d.prepare || prepareCycleWorkpapers)(orgId, missionId, account, d).catch(e => ({ error: e.message }));
  const fresh = (await fetchRows(`office_work_programmes?org_id=eq.${q(orgId)}&id=eq.${q(programme.id)}&select=*&limit=1`).catch(() => []))?.[0] || programme;
  // Why there is still none (e.g. WAITING_MODELS_FOLDER: the Enhanced Auditor asked where the models are).
  const entry = (out?.workpapers || fresh?.workpapers || []).find(w => w.cycle_code === cycleCode) || null;
  return { programme: fresh, workpaper: has(fresh), error: out?.error || (has(fresh) ? null : entry?.status || null), folder: out?.folder || null };
}

// Creates the missing working papers of a validated programme; checks each file in the Drive afterwards.
export async function prepareCycleWorkpapers(orgId, missionId, account, d = {}) {
  const fetchRows = d.fetchRows || rest, drive = d.drive || driveAdapter;
  const mission = (await fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}&select=id,name,client_name,drive_folder_id,client_folder_id&limit=1`))?.[0];
  if (!mission) throw fail('MISSION_NOT_FOUND', 404);
  const programme = (await fetchRows(`office_work_programmes?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&status=eq.validated&select=*&order=version.desc&limit=1`))?.[0];
  if (!programme) throw fail('NO_VALIDATED_PROGRAMME', 409);
  const folder = await findWorkpapersFolder(mission, programme, drive, d);
  const lib = await (d.methodology || methodologyState)({}, orgId);
  const by = account?.email || null;
  const results = [];
  // Cabinet models only. A missing or ambiguous model is never permission to invent a workbook.
  const T = await import('./workfile-templates.js');
  const models = d.templatesFolder || !d.drive ? await (d.templatesFolder || T.templatesFolder)(orgId, d) : { status: 'NONE' };
  const modelFiles = models.status === 'KNOWN' ? await (d.listTemplateFiles || T.listTemplateFiles)(models.folder_id, drive) : [];
  const texts = new Map(), read = d.readTemplate || (async (id, o) => {
    if (!drive.downloadBuffer) return drive.readText(id, o); // injected connector contract
    try {
    const bytes = Buffer.from(await drive.downloadBuffer(id));
    if (bytes.length > 20 * 1024 * 1024) throw fail('MODEL_TOO_LARGE_FOR_INSPECTION', 422);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
    // Inspect every sheet/cell for procedure codes, not only the first text window.
    const codes = new Set();
    const add = text => { for (const m of String(text || '').toUpperCase().matchAll(/\b[A-Z][A-Z0-9]{1,15}-\d{1,3}\b/g)) codes.add(m[0]); };
    for (const ws of wb.worksheets) { add(ws.name); ws.eachRow(row => row.eachCell(cell => { if(cell.value!=null)add(cell.text); })); }
    return [...codes].join(' ');
    } catch (binaryError) {
      // Some existing connectors expose readable Office content but no binary download.
      // Selection still requires every active procedure code in the returned content.
      const readable=await drive.readText(id,{maxChars:1000000});
      if(readable?.supported===false || !(typeof readable==='string'?readable:readable?.text))throw binaryError;
      return typeof readable==='string'?readable:readable.text;
    }
  });
  for (const cycle of programme.cycles || []) {
    if (cycle.status === 'N/A_JUSTIFIED') continue;
    const procedures = cycle.procedures.filter(p => p.active).map(p => ({ ...(findProcedure(lib, p.code) || {}), ...p }));
    if (!procedures.length) continue;
    const baseName = workpaperName(mission, cycle);
    const recorded = (programme.workpapers || []).find(w => w.cycle_code === cycle.cycle_code && (w.file_id || w.previous_file_id));
    let name = baseName;
    const previous = recorded ? { previous_file_id: recorded.file_id || recorded.previous_file_id, previous_name: recorded.file_id ? recorded.name : recorded.previous_name } : {};
    // A copy of a cabinet model remains valid across programme versions if its sheets cover the active tests.
    // No legacy AUDIT_META format is imposed on the firm's own model.
    if (recorded?.model?.id) {
      try {
        const text = await read(recorded.file_id, { maxChars: 1000000 });
        const score = T.scoreTemplate(typeof text === 'string' ? text : text?.text || '', cycle);
        const meta = await drive.getMeta(recorded.file_id);
        if (score.score === 1 && meta && !meta.trashed && meta.parents?.includes(folder.id)) {
          results.push({ ...recorded, cycle_code: cycle.cycle_code, status: 'ALREADY_EXISTS', programme_version: programme.version,
            active_codes: procedures.map(p => p.code), note: 'Modèle du cabinet conservé ; couverture des tests actifs vérifiée.' }); continue;
        }
      } catch { /* Keep the old file; try the registered models, never replace its contents. */ }
    }
    // The Enhanced Auditor asked where the models are and nobody answered yet: it waits (no generic file in their place).
    if (models.status === 'ASKED') { results.push({ cycle_code: cycle.cycle_code, name, ...previous, status: 'WAITING_MODELS_FOLDER', note: models.question }); continue; }
    let fromModel = null;
    if (recorded) {
      const locked=await fetchRows(`office_procedure_work?org_id=eq.${q(orgId)}&office_mission_id=eq.${q(missionId)}&cycle_code=eq.${q(cycle.cycle_code)}&status=in.(submitted,reviewed)&select=id&limit=1`);
      if(locked?.length) { results.push({...recorded,cycle_code:cycle.cycle_code,...previous,name:recorded.name || name,status:'MODEL_REPLACEMENT_REQUIRES_REVIEW',note:'Travaux soumis ou revus : ancien fichier conservé, aucun nouveau rattachement automatique.'});continue; }
    }
    if (models.status === 'KNOWN') {
      const pick = await T.pickTemplate(cycle, modelFiles, read, { texts });
      if (pick.status === 'FOUND') {
        name = String(pick.file.name || baseName).replace(/\.xlsx$/i, '') + '_mission_' + String(missionId).slice(0,8) + '_v' + programme.version + '.xlsx';
        try {
          // A name collision without a recorded binding is not evidence that this file is our model copy.
          const collisions = await drive.findFilesByExactName(name, folder.id);
          if (collisions?.length) fromModel = { status: 'MODEL_COPY_REVIEW_REQUIRED', candidates: collisions.map(f => ({ id: f.id, name: f.name })) };
          else fromModel = await (d.copyTemplate || T.copyTemplate)(pick.file, name, folder.id, drive);
          fromModel.matched = pick.found.length + '/' + pick.total + ' tests du cycle trouvés dans le modèle';
        }
        catch (e) { fromModel = { status: 'MODEL_COPY_FAILED', error: String(e.message || e).slice(0, 160) }; }
      } else fromModel = { status: pick.status, candidates: pick.candidates, error: pick.error };
      if (fromModel.file_id && fromModel.status === 'CREATED_FROM_MODEL') { results.push({ cycle_code: cycle.cycle_code, ...previous, ...fromModel, programme_version: programme.version, active_codes: procedures.map(p => p.code) }); continue; }
    }
    results.push({ cycle_code: cycle.cycle_code, name, ...previous, status: fromModel?.status || 'CABINET_MODEL_REQUIRED',
      model_candidates: fromModel?.candidates, error: fromModel?.error,
      note: 'Aucun classeur inventé. Le fichier antérieur est conservé ; un modèle du cabinet couvrant les tests actifs est requis.' });
  }
  const at = new Date().toISOString();
  const saved = await fetchRows(`office_work_programmes?id=eq.${q(programme.id)}&org_id=eq.${q(orgId)}` + (programme.updated_at ? '&updated_at=eq.' + q(programme.updated_at) : ''),
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ workpapers: results.map(r => ({ ...r, at })), updated_at: at }) });
  if (programme.updated_at && !saved?.length) throw fail('PROGRAMME_CHANGED_RETRY', 409);
  await (d.audit || audit)(orgId, { agent: 'mission-controller', mission_id: missionId, action_type: 'CYCLE_WORKPAPERS_PREPARED', approved_by: by,
    output_ref: results.map(r => `${r.cycle_code}:${r.status}`).join(' '), status: results.some(r => /FAILED/.test(r.status)) ? 'failed' : results.every(r=>r.file_id && ['CREATED_FROM_MODEL','ALREADY_EXISTS'].includes(r.status))?'succeeded':'skipped' }).catch(() => null);
  return { folder, programme_version: programme.version, workpapers: results };
}
