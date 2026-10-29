// LE CERVEAU COMMUN DES AGENTS (Paul, 2026-10-26 : « IA intelligence dirige le code partout et pour tous les agents » ; « le code a la
// capacité de lire, mais sa capacité de comprendre et son cerveau, c'est l'IA »).
// Une seule façon de travailler pour chaque agent :
//   1. le CODE LIT ce qui concerne la tâche (fichiers, mails, tableaux…) et la MÉMOIRE PARTAGÉE de la mission (ce dont cet agent a besoin) ;
//   2. l'IA COMPREND et rend des ORDRES, choisis dans la liste des actions permises à CET agent (chacune décrite : ce qu'elle fait, ses
//      paramètres), chaque ordre avec sa raison ; elle écrit aussi ce qu'elle a compris pour les autres agents (notes de mission) ;
//   3. le CODE VÉRIFIE chaque ordre (action permise, paramètres valables, règle dure de l'action) — un ordre refusé est DIT, jamais remplacé
//      par une idée du code — puis EXÉCUTE ceux qui peuvent l'être ; ceux qui touchent une personne ou un fichier du cabinet attendent
//      l'accord d'une personne (approval) ;
//   4. après exécution, le CODE relit/vérifie la postcondition quand l'action expose verify(); exécuter n'est jamais confondu avec vérifier ;
//   5. ce qui a été compris, exécuté, vérifié, refusé ou proposé est écrit dans la mémoire de la mission, pour tous les agents.
// Sans réponse de l'IA : rien n'est décidé par le code, la panne est dite.
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { fitJson } from './ai-input.js';
import { AGENT_BRAIN_CONTRACT } from './agent-contract.js';
import { describePoolError } from './ai-pool.js';

const cut = (v, n) => String(v ?? '').slice(0, n);
const COMMON = `Tu es l'intelligence d'un agent d'Office Manager AI, le système d'un cabinet d'audit. Le code ne sait que lire, exécuter et
vérifier : c'est TOI qui comprends et qui décides, puis tu donnes des ordres au code. Tu reçois :
- "task" : ce qu'il faut faire maintenant ;
- "read" : ce que le code a lu pour cette tâche (contenus, tableaux, mails…) ;
- "mission_memory" : la mémoire partagée de la mission — ses documents (ce qu'ils sont, où ils sont, qui s'en sert) et les notes des autres
  agents (faits, décisions, ce qui manque, questions ouvertes). Sers-t'en : ne redemande pas ce qui est déjà su, ne refais pas ce qui est fait ;
- "actions" : les SEULES actions que le code sait exécuter pour cet agent, avec leurs paramètres.
Règles :
- Juge par le CONTENU, jamais par un nom de fichier seul.
- Chaque ordre = une action de la liste, ses paramètres exacts, et "why" (la raison, en une phrase, tirée de ce que tu as lu).
- N'invente aucune donnée : seulement ce que tu vois dans "read" ou "mission_memory".
- Tu ne prends jamais une décision professionnelle à la place d'une personne (acceptation, conclusion, signature, opinion) : tu la prépares.
- "notes" = ce que tu as compris qui sera utile aux autres agents de la mission (kind : fait | decision | manquant | question ; "for" : les
  agents concernés parmi firm-manager, mission-controller, enhanced-auditor, orpailleur, sika ; vide = tous).
- "close" = les ids des notes ouvertes de la mémoire que ta lecture règle (une pièce manquante enfin reçue…), avec la raison.
JSON STRICT : {"understanding":"…","orders":[{"action":"…","params":{},"why":"…"}],"notes":[{"kind":"fait","text":"…","about":"…","for":[]}],
"close":[{"id":"…","why":"…"}],"questions":["…"]}`;

function verificationOutcome(value) {
  if (value === true) return { verified: true, detail: null };
  if (value === false || value == null) return { verified: false, detail: value ?? null };
  if (typeof value === 'object') return {
    verified: value.verified === true || value.ok === true,
    detail: value
  };
  return { verified: false, detail: value };
}

async function executeAction(a, params, ctx) {
  const result = await a.run(params, ctx);
  if (typeof a.verify !== 'function') {
    return { result, work_state: 'executed_unverified', verification: null };
  }
  try {
    const checked = verificationOutcome(await a.verify(params, result, ctx));
    return {
      result,
      work_state: checked.verified ? 'verified' : 'executed_unverified',
      verification: checked.detail
    };
  } catch (error) {
    return {
      result,
      work_state: 'executed_unverified',
      verification: { ok: false, error: cut(error?.message || error, 200) }
    };
  }
}

// actions = { name: { describe: 'ce que fait l'action, ses paramètres', approval?: true,
//   check?(params, ctx) → { ok, params?, why? }, run(params, ctx), verify?(params, result, ctx) → true | {ok|verified,...} } }
export async function think({ orgId, missionId = null, agent, task, read = {}, actions = {}, instructions = '', ctx = {}, by = null }, d = {}) {
  const catalog = Object.entries(actions).map(([name, a]) => ({ action: name, does: a.describe, needs_a_person_first: Boolean(a.approval) }));
  let briefError = null;
  const brief = missionId ? await (d.missionBrief || (await import('./mission-brief.js')).missionBrief)(orgId, missionId, agent, d).catch(e => { briefError = cut(e?.message || e, 200); return null; }) : null;
  const input = fitJson({ agent, task, read, mission_memory: brief, mission_memory_error: briefError, actions: catalog }, d.maxInput || 120000, [
    o => { if (o.mission_memory) o.mission_memory.documents = o.mission_memory.documents.slice(0, 60); },
    o => { if (o.mission_memory) o.mission_memory.open = o.mission_memory.open.slice(-25); }
  ]);
  let r, retried = null;
  const ask = inp => (d.ai || firstAvailable)(d.providers || ['anthropic', 'openai', 'gemini'], { agentKey: agent, missionId, instructions: COMMON + '\n' + AGENT_BRAIN_CONTRACT + (instructions ? '\n\n' + instructions : ''), input: inp, maxTokens: d.maxTokens || 6000, files: d.files || [] });
  try { try { r = await ask(input); } catch (e) { retried = cut(e?.message || e, 120); r = await ask(fitJson(JSON.parse(input), 50000)); } }
  catch (e) { return { ai: 'unavailable', ai_error: cut(describePoolError(e), 500), understanding: null, done: [], proposed: [], refused: [], questions: [], notes: [] }; }
  const out = parseJsonLoose(r?.text ?? r);
  if (!out) return { ai: r?.provider || 'ai', ai_error: 'AI_ANSWER_UNREADABLE', understanding: null, done: [], proposed: [], refused: [], questions: [], notes: [] };
  const done = [], proposed = [], refused = [];
  for (const o of (Array.isArray(out.orders) ? out.orders : []).slice(0, d.maxOrders || 30)) {
    const name = String(o?.action || ''), a = actions[name], why = cut(o?.why, 300) || null;
    if (!a) { refused.push({ action: name, why, refused: 'action inconnue pour cet agent' }); continue; }
    let params = o?.params && typeof o.params === 'object' ? o.params : {};
    if (a.check) { let c; try { c = await a.check(params, ctx); } catch (e) { c = { ok: false, why: cut(e?.message || e, 160) }; } if (!c?.ok) { refused.push({ action: name, params, why, refused: c?.why || 'paramètres refusés par le code' }); continue; } if (c.params) params = c.params; }
    if (a.approval) { proposed.push({ action: name, params, why }); continue; }
    try {
      const executed = await executeAction(a, params, ctx);
      done.push({ action: name, params, why, ...executed });
    }
    catch (e) { refused.push({ action: name, params, why, refused: 'échec à l’exécution : ' + cut(e?.message || e, 160) }); }
  }
  const memoryErrors = briefError ? [briefError] : [];
  const notes = (Array.isArray(out.notes) ? out.notes : []).slice(0, 20).map(n => ({ agent, kind: n?.kind, text: n?.text, about: n?.about, for: n?.for, by, source: 'IA de ' + agent }));
  // What happened is written in the mission's memory: understood, executed/verified, proposed, refused.
  if (missionId) {
    const log = [...done.map(x => ({ agent, kind: 'action', text: x.action + ' — ' + (x.why || ''), about: x.params?.file_id || x.params?.document_id || null, by,
      source: x.work_state === 'verified' ? 'exécuté puis vérifié par le code sur ordre de l’IA' : 'exécuté par le code sur ordre de l’IA — postcondition non vérifiée' })),
      ...proposed.map(x => ({ agent, kind: 'question', text: 'À valider : ' + x.action + ' — ' + (x.why || ''), about: x.params?.file_id || null, by, source: 'proposé par l’IA' }))];
    const write = d.noteMission || (await import('./mission-brief.js')).noteMission;
    await write(orgId, missionId, [...notes, ...log], d).catch(e => { memoryErrors.push(cut(e?.message || e, 200)); });
    const close = d.closeNote || (await import('./mission-brief.js')).closeNote;
    const openIds = new Set((brief?.open || []).map(n => n.id));
    for (const c of (Array.isArray(out.close) ? out.close : []).slice(0, 20)) if (openIds.has(String(c?.id))) await close(orgId, missionId, String(c.id), { by: 'IA de ' + agent + (by ? ' (pour ' + by + ')' : ''), why: c.why }, d).catch(e => { memoryErrors.push(cut(e?.message || e, 200)); });
  }
  return { memory_error: memoryErrors.length ? memoryErrors.join('; ') : null, ai: r?.provider || 'ai', ai_retried: retried, ai_error: null, understanding: cut(out.understanding, 800) || null, done, proposed, refused,
    questions: (Array.isArray(out.questions) ? out.questions : []).map(q => cut(q, 300)).filter(Boolean).slice(0, 8), notes };
}

// A proposal a person approved: checked again (the world may have changed), then run, then written in the mission's memory.
export async function runApproved({ orgId, missionId = null, agent, proposal, actions, ctx = {}, by }, d = {}) {
  const a = actions[proposal?.action];
  if (!a) throw Object.assign(new Error('UNKNOWN_ACTION'), { statusCode: 400 });
  if (!by) throw Object.assign(new Error('HUMAN_IDENTITY_REQUIRED'), { statusCode: 403 });
  let params = proposal.params || {};
  if (a.check) { const c = await a.check(params, ctx); if (!c?.ok) throw Object.assign(new Error('ORDER_NO_LONGER_VALID'), { statusCode: 409, why: c?.why || null }); if (c.params) params = c.params; }
  const result = await a.run(params, ctx);
  if (missionId) {
    try { await (d.noteMission || (await import('./mission-brief.js')).noteMission)(orgId, missionId, { agent, kind: 'action', text: proposal.action + ' — validé par ' + by + (proposal.why ? ' — ' + proposal.why : ''), by, source: 'validé par une personne' }, d); }
    catch (e) { return { ...(result && typeof result === 'object' ? result : { result }), memory_error: cut(e.message || e, 200), executed: true }; }
  }

  return result;
}
