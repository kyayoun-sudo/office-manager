// WHAT ONE TEST NEEDS, AND ASKING FOR IT (2026-10-19, Paul : « pour le walkthrough il doit aller vers ce que ça demande, déjà préparer
// les mails pour demander les pièces nécessaires si elles manquent et les envoyer ; comprendre le walkthrough et le but ; en dessous de
// l'Excel, des cases pour déposer les documents dont il a besoin, par exemple le GL ; à côté, l'option envoyer le mail »).
// Everything here is CODE (works without AI): the aim comes from the SOP card; the needs are its « Ce qu'il faut demander » kept in the
// mission's one register of missing documents (lib/pbc-loop.js); a document already read for the mission is offered « à confirmer »;
// the request of the missing ones goes through the validated sending (a manager approves; a manager may send it at once); a piece a
// person deposits goes into the mission's PIECES_RECUES, is attached to its line « à confirmer », and is read by the agents.
import { rest } from './supabase.js';
import { methodologyState, currentProcedure, SAMPLING_LABELS } from './methodology.js';
import { context } from './procedure-work.js';

const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const SENDERS = ['owner', 'partner', 'manager'];

const WHY_MODE = {
  walkthrough: 'Walkthrough : suivre UNE transaction réelle de bout en bout (de son origine à son enregistrement en comptabilité), pour comprendre le processus et vérifier que les contrôles décrits existent vraiment. On ne conclut pas sur une population : on documente le chemin, les personnes, les pièces et les contrôles vus.',
  exhaustive: 'Toute la population est testée : rapprocher d’abord la population du grand livre, puis contrôler chaque élément.',
  risk_targeted: 'Ciblage par risque : sélectionner les éléments les plus risqués (montants élevés, inhabituels, en fin de période…) selon les critères du SOP.',
  programme_sample: 'Échantillon de la taille fixée par le Manager dans le programme, tiré de la population rapprochée.',
  random: 'Échantillon aléatoire tiré de la population rapprochée (tirage reproductible).',
  none: 'Pas d’échantillon : procédure analytique ou d’entretien.'
};

export function aimOf(card, line) {
  const mode = line?.sampling_mode || card?.sampling_mode || null;
  return { code: card?.code || line?.code || null, title: card?.title || line?.title || null, objective: card?.objective || null, risk: card?.risk || null,
    assertion: card?.assertion || null, mode, mode_label: SAMPLING_LABELS[mode] || null, how: WHY_MODE[mode] || null,
    steps: (card?.steps || []).filter(s => !s.common).map(s => s.text).slice(0, 15), exceptions: (card?.exceptions || []).slice(0, 10) };
}

export async function procedureNeeds(orgId, missionId, code, account, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const ctx = await (d.context || context)(orgId, missionId, code, fetchRows);
  const lib = await (d.methodology || methodologyState)({}, orgId);
  const card = await currentProcedure(lib, code, ctx.cycle.sop_file_id, d) || {};
  const loop = d.loop || await import('./pbc-loop.js');
  const mission = (await fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}&select=id,period_label,client_contact_emails&limit=1`)
    .catch(() => fetchRows(`office_missions?org_id=eq.${q(orgId)}&id=eq.${q(missionId)}&select=id,client_contact_emails&limit=1`)))?.[0] || {};
  const period = loop.periodOf(mission.period_label);
  let rows = [], sql = true;
  try {
    rows = await loop.ensureProcedureNeeds(orgId, missionId, { cycle: ctx.cycle.cycle_code, code, documents: card.ask || [], period }, account, d);
    // A document already read for the mission (by its content) is offered « à confirmer » rather than asked again.
    if (rows.some(r => r.status === 'needed')) { await loop.findExisting(orgId, missionId, account, d).catch(() => null); rows = await loop.ensureProcedureNeeds(orgId, missionId, { cycle: ctx.cycle.cycle_code, code, documents: [], period }, account, d); }
  } catch (e) { if (e.message === 'PBC_SQL_NOT_INSTALLED') sql = false; else throw e; }
  return { aim: aimOf(card, ctx.line), sql_installed: sql, asked_in_sop: (card.ask || []).length,
    items: rows.map(r => ({ id: r.id, document: r.document, status: r.status, label: loop.PBC_STATUS[r.status], period: r.period_label, pieces: (r.pieces || []).slice(-3),
      request: r.request ? { at: r.request.at, to: r.request.to, status: r.status } : null, missing: r.status === 'needed' })),
    contacts: (mission.client_contact_emails || []).filter(Boolean), may_send: SENDERS.includes(account?.role) };
}

// A file put in the zone of one document: into the mission's PIECES_RECUES (never overwriting), attached to its line, read by the agents.
export async function depositForNeed(orgId, missionId, code, body = {}, account, req, d = {}) {
  const quick = d.quick || await import('./mission-quick.js');
  const loop = d.loop || await import('./pbc-loop.js');
  let file;
  if (body.file_id) file = await quick.verifyReceivedPiece(orgId, missionId, body.file_id, d);
  else file = await quick.uploadPiece(orgId, { mission_id: missionId, name: body.name, base64: body.base64, mime: body.mime }, account, d);
  const attached = await loop.attachPiece(orgId, missionId, { id: body.id, file_id: file.file_id, name: file.name, url: file.url, source: 'procedure:' + code }, account, d);
  const reading = await quick.piecesReceived(orgId, req, { mission_id: missionId, files: [{ id: file.file_id }], note: 'Pièce déposée pour la procédure ' + code }, account, d).catch(e => ({ error: String(e.message || e).slice(0, 120) }));
  return { ...attached, file, reading: reading?.error ? { error: reading.error } : { started: true } };
}

// The e-mail asking for the missing documents of this test (one line or all): written by the code, validated before it leaves.
export async function requestForNeeds(orgId, missionId, code, body = {}, account, d = {}) {
  const loop = d.loop || await import('./pbc-loop.js');
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter(Boolean);
  if (!ids.length) throw fail('CHOOSE_DOCUMENTS');
  return loop.draftRequest(orgId, missionId, { ids, to: body.to, cc: body.cc, send: body.send === true && SENDERS.includes(account?.role) }, account, d);
}
