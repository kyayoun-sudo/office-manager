// Needs are interpreted by the shared content brain; the code exposes the complete mission catalogue.
import { procedureView } from './procedure-work.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';

import { reasonWithDocuments, documentIdsIn } from './document-reasoning.js';
// What the working file expects: its pieces, the tests that need each, and the data sheets fed by them.
export function expectedPieces(map, card = null) {
  const items = (map.pbc?.items || []).map(x => ({ id: String(x.id), name: x.name || x.id, type: x.type || null, expected: x.expected || null, tests: x.tests || [] }));
  for (const t of map.tests || []) for (const id of [...(t.pbc_required || []), ...(t.pbc_optional || [])]) {
    const it = items.find(x => x.id === id); if (it && !it.tests.includes(t.code)) it.tests.push(t.code);
  }
  if (!items.length && card?.ask?.length) card.ask.forEach((a, i) => items.push({ id: 'SOP-' + (i + 1), name: String(a.text || a), type: null, expected: null, tests: [] }));
  const sheets = (map.sheets || []).filter(s => ['data', 'lead', 'reconciliation'].includes(s.role)).map(s => {
    const readers = (map.tests || []).filter(t => (t.reads || []).includes(s.name)).map(t => t.code);
    const ids = items.filter(it => it.tests.some(c => readers.includes(c))).map(it => it.id);
    return { sheet: s.name, title: s.title, read_by: readers, pieces: ids };
  });
  return { items, sheets };
}

// Where each expected piece is in the mission's memory: confirmed link, or a close match by what the document IS.
export function locatePieces(items, memory) {
  return items.map(it => {
    const linked = memory.filter(doc => doc.pbc_ref === it.id || (doc.uses || []).some(u => u.what === 'pbc' && u.where === it.id));
    if (linked.length) return { ...it, status: 'linked', docs: linked.map(slim) };
    return { ...it, status: 'unresolved', docs: [] };
  });
}
const slim = d => ({ id: d.id, name: d.name, url: d.url || null, title: d.title || d.type || null, period: d.period || null, location: d.location || null });

export async function workfileNeeds(org, mission, code, account, d = {}) {
  d = { ...d, orgId: org };
  const view = await (d.view || procedureView)(org, mission, code, account, d);
  const map = d.map || await (async () => {
    const ExcelJS = (await import('exceljs')).default, drive = d.drive || (await import('./drive-adapter.js')).driveAdapter;
    if (!view.workpaper?.file_id) throw Object.assign(new Error('NO_WORKPAPER_FOR_CYCLE'), { statusCode: 409 });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await drive.downloadBuffer(view.workpaper.file_id)));
    return (await import('./workfile-map.js')).mapWorkingFile(wb);
  })();
  const memory = await (d.missionMemory || (async () => (await import('./mission-files.js')).missionMemory(mission, d)))();
  if (!Array.isArray(memory)) throw new Error('DOCUMENT_INVENTORY_UNAVAILABLE');
  const sources = await (d.sources || (await import('./step-runner.js')).stepSources)(org, mission, { ...d, strictSources: true });
  const documents = [...new Map([...memory, ...sources.map(f => ({ ...memory.find(m => m.id === f.file_id), ...f, id: f.file_id }))].map(f => [f.id, f])).values()];
  const exp = expectedPieces(map, view.card);
  let located = locatePieces(exp.items, memory), ai = 'not_needed', decision = null;
  if (located.some(x => x.status !== 'linked')) {
    decision = await (d.reasonWithDocuments || reasonWithDocuments)({ org, mission, code, view, documents,
      drive: d.drive || (await import('./drive-adapter.js')).driveAdapter, task: 'Comprendre les besoins du SOP et du working file et identifier les pièces par leur contenu.',
      context: { sop: view.card, working_file: map, expected: exp.items },
      schema: 'JSON {"checks":[{"pbc":"identifiant attendu","file_id":"pièce examinée","answers":true,"why":"raison fondée sur le contenu lu"}],"questions":["ambiguïtés restantes"]}. Plusieurs pièces peuvent répondre ensemble à un besoin. Si aucune correspondance n’est prouvée, laisse le besoin à examiner ; ne le déclare pas absent.',
      evidenceIds: documentIdsIn, key: 'needs:' + code, account, body: d.body || {} }, d);
    ai = decision.provider || (decision.ai_error ? 'unavailable' : 'reading');
    if (decision.result) located = located.map(it => {
      if (it.status === 'linked') return it;
      const checks = (decision.result.checks || []).filter(c => c.pbc === it.id && c.answers === true && documents.some(f => f.id === c.file_id));
      return { ...it, status: checks.length ? 'probable' : 'unresolved', docs: checks.map(c => ({ ...slim(documents.find(f => f.id === c.file_id)), ai: true, why: c.why })) };
    });
  }
  // What a person chose for each data sheet (mission memory) is shown first: it overrides the working file's guess.
  const { chosenIn } = await import('./workfile-sources.js');
  for (const sh of exp.sheets) { const ids = chosenIn(memory || [], sh.sheet); sh.chosen = (memory || []).filter(doc => ids.includes(doc.id)).map(slim); }
  const current = (map.tests || []).find(t => t.code === String(code).toUpperCase());
  return { ...decision, ai, questions: decision?.result?.questions || [], current_test: current ? { code: current.code, pieces: [...(current.pbc_required || []), ...(current.pbc_optional || [])] } : null,
    sheets: exp.sheets, items: located,
    counts: { expected: located.length, found: located.filter(x => ['linked','probable'].includes(x.status)).length, missing: 0, unresolved: located.filter(x => x.status === 'unresolved').length } };
}

// « C'est bien ça » / « Ce n'est pas ça » : the link is written in the mission's memory (for every agent), or noted as refused.
export async function linkNeed(org, mission, code, body = {}, account, d = {}) {
  await (d.view || procedureView)(org, mission, code, account, d);
  const pbc = String(body.pbc || ''), fileId = String(body.file_id || '');
  if (!pbc || !fileId) throw Object.assign(new Error('PBC_AND_FILE_REQUIRED'), { statusCode: 400 });
  const yes = body.decision !== 'no';
  await (d.noteMissionEvent || (await import('./mission-files.js')).noteMissionEvent)(org, mission, fileId, yes
    ? { agent: 'enhanced-auditor', what: 'reconnu comme pièce attendue', detail: pbc + ' (confirmé par ' + (account?.email || '?') + ')', by: account?.email || null, uses: [{ what: 'pbc', where: pbc }] }
    : { agent: 'enhanced-auditor', what: 'écarté pour une pièce attendue', detail: pbc + ' (par ' + (account?.email || '?') + ')', by: account?.email || null }, d);
  return { pbc, file_id: fileId, linked: yes };
}
