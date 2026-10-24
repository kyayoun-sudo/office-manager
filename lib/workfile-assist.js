// L'agent qui aide vraiment à remplir le working file (Paul, 2026-10-24 : « il sait qui prépare, pourquoi il ne remplit pas ? j'ai déjà
// déposé les pièces, il devait les comprendre, les renommer et les proposer ; il doit demander la permission avant de remplir »).
//
//   1. Ce que l'application SAIT déjà (sans IA) : qui prépare et la date, la mission, l'entité, le cabinet, l'exercice. Proposé dans
//      les cases d'identité que la carte du fichier a trouvées (« Préparé par / date », « Mission / Engagement ID »…), jamais dans
//      « Revu par », une conclusion, une signature ou une case déjà remplie. La personne dit « Oui, remplis » : le serveur recalcule
//      les propositions (rien de ce que le navigateur envoie n'est écrit tel quel), écrit, relit, trace.
//   2. Les pièces REÇUES : ce qui est dans PIECES_RECUES, ce que les agents en ont compris (type, période, résumé), celles qui n'ont
//      pas encore été lues. « Revoir les pièces » relance la lecture du contenu par le même chemin que le dépôt (lire, identifier,
//      renommer d'après le contenu, rapprocher des demandes de pièces), avec l'IA qui répond (firstAvailable, toutes les IA du cabinet).
import ExcelJS from 'exceljs';
import { rest } from './supabase.js';
import { driveAdapter } from './drive-adapter.js';
import { procedureView, isPreparer } from './procedure-work.js';
import { mapWorkingFile, cellText } from './workfile-map.js';
import { sheetView } from './workfile-map-view.js';
import { destinationRole } from './client-table-understanding.js';
import { audit } from './audit-log.js';

const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const q = encodeURIComponent;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 20 * 1024 * 1024;
const frDate = (now = new Date()) => { const x = new Date(now); return String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0') + '/' + x.getFullYear(); };

// What the application knows for this procedure, each with where it comes from.
export function knownFacts({ mission = {}, preparer = null, account = null, firmName = null, now = new Date() } = {}) {
  const facts = {};
  const who = account && isPreparer(account, preparer) ? (account.display_name || account.email) : preparer;
  if (who) facts.preparer = { value: who, source: 'préparateur de ce test dans le programme de travail' };
  if (mission.name) facts.mission = { value: mission.name, source: 'nom de la mission dans Office Manager' };
  if (mission.client_name) facts.entity = { value: mission.client_name, source: 'client de la mission dans Office Manager' };
  if (mission.period_label) facts.period = { value: mission.period_label, source: 'période de la mission dans Office Manager' };
  if (firmName && firmName !== 'Office Manager') facts.firm = { value: firmName, source: 'nom du cabinet (Paramètres → marque)' };
  facts.today = { value: frDate(now), source: 'date du jour' };
  return facts;
}

// Proposals for the identity fields of the given sheets: only empty, writable fields with a known value.
export function proposeKnown(map, sheetNames, facts) {
  const out = [];
  for (const s of map.sheets.filter(x => sheetNames.includes(x.name))) {
    for (const f of s.fields || []) {
      if (!f.writable || f.value) continue;
      const k = f.kind === 'preparer' ? facts.preparer : facts[f.kind];
      if (!k) continue;
      const value = f.kind === 'preparer' && f.with_date ? k.value + ' — ' + facts.today.value : k.value;
      out.push({ sheet: s.name, address: f.address, label: f.label, kind: f.kind, value, source: k.source + (f.kind === 'preparer' && f.with_date ? ' ; date du jour' : '') });
    }
  }
  return out;
}

async function context(orgId, missionId, code, account, d) {
  const view = await (d.view || procedureView)(orgId, missionId, code, account, d);
  const fileId = view.workpaper?.file_id;
  if (!fileId) throw fail('NO_WORKPAPER_FOR_CYCLE', 409);
  const fetchRows = d.fetchRows || rest;
  const m = (await fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}&select=id,name,client_name,period_label&limit=1`).catch(() => []))?.[0] || view.mission || {};
  const firmName = await (d.firmName || (async () => (await (await import('./branding.js')).getBranding(orgId))?.firm_name))().catch(() => null);
  const drive = d.drive || driveAdapter;
  const meta = await drive.getMeta(fileId);
  if (Number(meta?.size || 0) > MAX_BYTES) throw fail('WORKBOOK_TOO_LARGE', 413);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await drive.downloadBuffer(fileId)));
  const map = mapWorkingFile(wb);
  const testSheet = map.sheets.find(s => s.test_code === String(code).toUpperCase())?.name;
  const sheets = [testSheet, ...map.sheets.filter(s => s.role === 'synthesis').map(s => s.name)].filter(Boolean);
  const facts = knownFacts({ mission: m, preparer: view.preparer, account, firmName, now: d.now || new Date() });
  return { view, fileId, meta, wb, map, drive, sheets, facts, mission: m };
}

// The received pieces and what the agents understood of them.
export async function piecesState(orgId, missionId, d = {}) {
  const listed = await (d.receivedPieces || (async () => (await import('./mission-quick.js')).receivedPieces(orgId, missionId, d)))().catch(e => ({ error: String(e.message || e).slice(0, 80), files: [] }));
  const docs = await (d.missionDocuments || (async () => (await import('./mission-files.js')).missionDocuments(missionId, d)))().catch(() => []);
  const byId = new Map((docs || []).map(x => [x.id, x]));
  const pieces = (listed.files || []).map(f => {
    const u = byId.get(f.id) || {};
    const understood = Boolean(u.type || u.summary);
    return { id: f.id, name: f.name, url: f.url, understood, type: u.type || null, period: u.period || null, summary: understood ? String(u.summary || '').slice(0, 300) : null, role: u.role || null };
  });
  const deposits = await (d.listDeposits || (async () => (await import('./deposit-analysis.js')).listDeposits(d)))().catch(() => []);
  const running = (deposits || []).find(x => x.mission === missionId && x.status === 'running' && x.purpose === 'pieces');
  return { pieces, to_read: pieces.filter(p => !p.understood).length, reading: running ? { id: running.id, started_at: running.started_at } : null, error: listed.error || null };
}

export async function workfileAssist(orgId, missionId, code, account, d = {}) {
  const ctx = await context(orgId, missionId, code, account, d);
  const known = proposeKnown(ctx.map, ctx.sheets, ctx.facts);
  const pieces = await piecesState(orgId, missionId, d);
  // Data sheets still empty that a piece can fill (grand livre, budget): the agent looks for the piece and proposes the import.
  const data_sheets = ctx.map.sheets.filter(s => s.role === 'data' && destinationRole(s.name) !== 'unknown')
    .map(s => ({ sheet: s.name, kind: destinationRole(s.name), capacity: s.main >= 0 ? s.tables[s.main].capacity : 0, filled: sheetView(ctx.wb, ctx.map, s.name)?.filled || 0 })).filter(x => !x.filled);
  return {
    known, pieces, data_sheets,
    editable: ctx.view.editable !== false && !['submitted', 'reviewed'].includes(ctx.view.work?.status),
    never: ctx.map.sheets.filter(s => ctx.sheets.includes(s.name)).flatMap(s => (s.fields || []).filter(f => !f.writable).map(f => ({ sheet: s.name, address: f.address, label: f.label })))
  };
}

// « Oui, remplis » : the proposals are recomputed here; only the addresses the person accepted are written.
export async function fillKnown(orgId, missionId, code, account, body = {}, d = {}) {
  const ctx = await context(orgId, missionId, code, account, d);
  if (ctx.view.editable === false) throw fail('NOT_PREPARER', 403);
  if (['submitted', 'reviewed'].includes(ctx.view.work?.status)) throw fail('IN_REVIEW_OR_REVIEWED', 409);
  const wanted = new Set((Array.isArray(body.cells) ? body.cells : []).map(c => String(c.sheet) + '!' + String(c.address).toUpperCase()));
  const chosen = proposeKnown(ctx.map, ctx.sheets, ctx.facts).filter(p => !wanted.size || wanted.has(p.sheet + '!' + p.address));
  if (!chosen.length) return { written: [], verified: true };
  for (const p of chosen) {
    const cell = ctx.wb.getWorksheet(p.sheet).getCell(p.address);
    if (cellText(cell.value).trim()) throw fail('FILLED_BY_SOMEONE_ELSE', 409);
    cell.value = p.value;
  }
  await ctx.drive.updateBinary(ctx.fileId, { buffer: Buffer.from(await ctx.wb.xlsx.writeBuffer()), mimeType: XLSX, expectedModifiedTime: ctx.meta?.modifiedTime });
  const back = new ExcelJS.Workbook(); await back.xlsx.load(Buffer.from(await ctx.drive.downloadBuffer(ctx.fileId)));
  const verified = chosen.every(p => cellText(back.getWorksheet(p.sheet)?.getCell(p.address).value) === p.value);
  await (d.audit || audit)(orgId, { agent: 'enhanced-auditor', mission_id: missionId, action_type: 'WORKFILE_KNOWN_FACTS_WRITTEN', source_ref: ctx.fileId + '#' + code,
    input: chosen.map(p => ({ sheet: p.sheet, address: p.address, value: p.value, source: p.source })), decision: 'proposed_by_agent_approved_by_person', reviewer: account?.email || null,
    status: verified ? 'succeeded' : 'failed', error: verified ? null : 'READ_BACK_MISMATCH', verified_at: verified ? new Date().toISOString() : null }).catch(() => null);
  if (!verified) throw fail('READ_BACK_MISMATCH', 502);
  return { written: chosen, verified };
}

// « Revoir les pièces reçues » : pieces already understood but badly named are renamed from what was read (no second reading);
// the others are read (identify, rename from the content, match to the requests) by the same path as a deposit.
export async function reviewPieces(orgId, req, missionId, code, account, d = {}) {
  await (d.view || procedureView)(orgId, missionId, code, account, d); // same access as the procedure
  const st = await piecesState(orgId, missionId, d);
  if (st.reading) return { started: false, reading: st.reading, pieces: st.pieces };
  if (!st.pieces.length) return { started: false, reason: 'NO_PIECES', pieces: [] };
  const dep = d.deposit || await import('./deposit-analysis.js');
  const understood = st.pieces.filter(p => p.understood).map(p => ({ id: p.id, name: p.name, path: 'PIECES_RECUES/' + p.name, type: p.type, period: p.period, role: p.role }));
  let renamed = [];
  if (understood.length) renamed = (await dep.renamePieces(orgId, { mission_id: missionId, understood, by: account?.display_name || account?.email || null }, d).catch(() => ({ done: [] }))).done;
  const toRead = st.pieces.filter(p => !p.understood).map(p => ({ id: p.id }));
  let analysis = null;
  if (toRead.length) analysis = (await (d.piecesReceived || (async (...a) => (await import('./mission-quick.js')).piecesReceived(...a)))(orgId, req,
    { mission_id: missionId, files: toRead, note: 'Pièces revues depuis la procédure ' + code + ' : lire, identifier, renommer d’après le contenu, rapprocher des demandes.' }, account, d))?.analysis || null;
  return { started: Boolean(toRead.length), renamed, to_read: toRead.length, analysis };
}
