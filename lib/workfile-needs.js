// Les pièces dont le working file a besoin, et où elles sont (Paul, 2026-10-25 : « l'agent n'arrive pas à travailler parce qu'il ne sait
// pas où sont les pièces ; le SOP nous donne déjà les pièces à suivre ; quand on ouvre le working file, il doit savoir de quelle pièce il a
// besoin pour y travailler »).
//   1. Ce qui est attendu, lu dans le working file lui-même (CODE, sans IA) : sa liste de pièces (PBC-…, nom, type) et la matrice test ↔
//      pièce ; une feuille de données a besoin des pièces des tests qui la lisent (D2_BUDGET est lue par PRJ-03, qui demande PBC-PRJ-01
//      « Budget initial, amendements… budget final par catégorie »). À défaut de liste dans le fichier : « Ce qu'il faut demander » du SOP.
//   2. Où elles sont : dans la mémoire de la mission (ce que chaque document est, où il est rangé). Un lien déjà confirmé (pbc_ref, usage
//      « pbc ») d'abord ; sinon le CODE rapproche le nom de la pièce attendue et ce qu'est le document (mots communs) ; l'IA, si elle
//      répond, confirme ou écarte ces rapprochements (marqué « selon l'IA ») — jamais un document qu'aucun indice ne relie.
//   3. Une personne confirme (« C'est bien ça ») : le lien est écrit dans la mémoire de la mission, pour tous les agents.
import { procedureView } from './procedure-work.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';

const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'ou', 'en', 'au', 'aux', 'par', 'pour', 'sur', 'un', 'une', 'n', 'l', 'd', 'a', 'document', 'documents', 'piece', 'pieces', 'detail', 'liste', 'annuel', 'annuelle', 'projet', 'projets']);
// Common audit abbreviations spelled out, so « GL » meets « grand livre » and « PTBA » meets « budget ».
const SPELL = [[/\bgl\b/g, 'grand livre'], [/\bptba\b/g, 'plan travail budget annuel'], [/\bbg\b/g, 'balance generale'], [/\btdr\b/g, 'termes reference'], [/\bef\b/g, 'etats financiers']];
const words = s => [...new Set(SPELL.reduce((t, [re, w]) => t.replace(re, w), String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 2 && !STOP.has(w)).map(w => w.slice(0, 6)))];

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
    // Ranked by what the sheet says it holds (its title and instructions).
    const own = words([s.title, ...(s.instructions || []).map(i => i.text)].join(' '));
    const ranked = ids.map(id => ({ id, score: words(items.find(x => x.id === id).name).filter(w => own.includes(w)).length })).sort((a, b) => b.score - a.score);
    const top = ranked[0]?.score || 0;
    return { sheet: s.name, title: s.title, read_by: readers, pieces: ranked.filter(r => (top ? r.score >= Math.max(1, Math.ceil(top / 2)) : ranked.length === 1)).map(r => r.id) };
  });
  return { items, sheets };
}

// Where each expected piece is in the mission's memory: confirmed link, or a close match by what the document IS.
export function locatePieces(items, memory) {
  return items.map(it => {
    const linked = memory.filter(doc => doc.pbc_ref === it.id || (doc.uses || []).some(u => u.what === 'pbc' && u.where === it.id));
    if (linked.length) return { ...it, status: 'linked', docs: linked.map(slim) };
    const need = words(it.name + ' ' + (it.type || ''));
    const refused = doc => (doc.history || []).some(h => h.what === 'écarté pour une pièce attendue' && String(h.detail || '').startsWith(it.id + ' '));
    const scored = memory.filter(doc => doc.read && !refused(doc)).map(doc => {
      const has = words([doc.title, doc.type, doc.summary].join(' '));
      const common = need.filter(w => has.includes(w));
      return { doc, score: common.length, common };
    }).filter(x => x.score >= 2 || (x.score >= 1 && need.length <= 2)).sort((a, b) => b.score - a.score).slice(0, 3);
    return scored.length ? { ...it, status: 'probable', docs: scored.map(x => ({ ...slim(x.doc), why: 'mots communs : ' + x.common.join(', ') })) } : { ...it, status: 'missing', docs: [] };
  });
}
const slim = d => ({ id: d.id, name: d.name, url: d.url || null, title: d.title || d.type || null, period: d.period || null, location: d.location || null });

const CONFIRM = `Tu es l'Enhanced Auditor d'un cabinet d'audit. Pour chaque pièce attendue par le working file, le code propose des documents de la mission
qui pourraient y répondre (titre lu, résumé). Dis pour chacun s'il répond VRAIMENT à la pièce attendue : même nature de document ET même niveau de détail
(un plan de travail / PTBA par activité ne répond pas à un budget approuvé par catégorie ; un tableau d'exécution donne le budget de
l'exercice, pas le budget initial de la convention), pas seulement des mots communs. N'invente aucun document. JSON STRICT : {"checks":[{"pbc":"","file_id":"","answers":true,"why":""}]}`;

export async function workfileNeeds(org, mission, code, account, d = {}) {
  const view = await (d.view || procedureView)(org, mission, code, account, d);
  const map = d.map || await (async () => {
    const ExcelJS = (await import('exceljs')).default, drive = d.drive || (await import('./drive-adapter.js')).driveAdapter;
    if (!view.workpaper?.file_id) throw Object.assign(new Error('NO_WORKPAPER_FOR_CYCLE'), { statusCode: 409 });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await drive.downloadBuffer(view.workpaper.file_id)));
    return (await import('./workfile-map.js')).mapWorkingFile(wb);
  })();
  const memory = await (d.missionMemory || (async () => (await import('./mission-files.js')).missionMemory(mission, d)))().catch(() => []);
  const exp = expectedPieces(map, view.card);
  let located = locatePieces(exp.items, memory || []), ai = 'not_needed';
  const toCheck = located.filter(x => x.status === 'probable');
  if (toCheck.length) {
    try {
      const r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions: CONFIRM, maxTokens: 1500,
        input: JSON.stringify(toCheck.map(x => ({ pbc: x.id, expected: x.name, type: x.type, candidates: x.docs.map(doc => ({ file_id: doc.id, is: doc.title, summary: (memory.find(m => m.id === doc.id)?.summary || '').slice(0, 300) })) }))).slice(0, 20000) });
      const out = parseJsonLoose(r.text) || {}; ai = r.provider || 'ai';
      located = located.map(x => {
        if (x.status !== 'probable') return x;
        const docs = x.docs.map(doc => { const c = (out.checks || []).find(k => k.pbc === x.id && k.file_id === doc.id); return c ? { ...doc, ai: c.answers === true, ai_why: String(c.why || '').slice(0, 200) } : doc; })
          .filter(doc => doc.ai !== false);
        return docs.length ? { ...x, docs } : { ...x, status: 'missing', docs: [], ai_rejected: true };
      });
    } catch { ai = 'unavailable'; }
  }
  // What a person chose for each data sheet (mission memory) is shown first: it overrides the working file's guess.
  const { chosenIn } = await import('./workfile-sources.js');
  for (const sh of exp.sheets) { const ids = chosenIn(memory || [], sh.sheet); sh.chosen = (memory || []).filter(doc => ids.includes(doc.id)).map(slim); }
  const current = (map.tests || []).find(t => t.code === String(code).toUpperCase());
  return { ai, current_test: current ? { code: current.code, pieces: [...(current.pbc_required || []), ...(current.pbc_optional || [])] } : null,
    sheets: exp.sheets, items: located,
    counts: { expected: located.length, found: located.filter(x => x.status !== 'missing').length, missing: located.filter(x => x.status === 'missing').length } };
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
