// La mémoire de l'IA d'une mission (Paul / Christian, 2026-11-01) : ce que les personnes ont décidé, corrigé, annulé, et ce que l'IA a appris
// en ligne quand elle ne comprenait pas. Rien de nouveau à stocker : ce sont des notes de la mémoire de la mission (lib/mission-brief.js),
// lues par l'IA à chaque tour. Une note vient d'une personne, d'un agent ou du web ; une note du web reste « à confirmer » tant qu'une
// personne ne l'a pas confirmée. Rien n'est supprimé : « retirer » ferme la note, avec qui et pourquoi.
import { noteMission, closeNote, updateNote, missionNotes } from './mission-brief.js';
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { MANAGERS } from './roles.js';

const cut = (v, n) => String(v ?? '').slice(0, n);
const fail = (code, status = 400) => Object.assign(new Error(code), { statusCode: status });
const AGENT = 'enhanced-auditor';

// What may leave for a web search: a general term, never a name, an amount or an account of the mission.
export function generalTerm(term, mission = {}) {
  const t = String(term ?? '').replace(/\s+/g, ' ').trim();
  if (t.length < 3 || t.length > 80) throw fail('SEARCH_TERM_NOT_GENERAL');
  if (/\d{5,}|@|https?:|[€$£]|\d[\d  .,]{3,}\d/.test(t)) throw fail('SEARCH_TERM_NOT_GENERAL');
  const fold = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const own = [mission.client_name, mission.name, mission.firm_name].flatMap(x => fold(x).split(/[^a-z0-9]+/)).filter(w => w.length >= 4);
  const words = fold(t).split(/[^a-z0-9]+/);
  if (own.some(w => words.includes(w))) throw fail('SEARCH_TERM_NOT_GENERAL');
  return t;
}

async function missionOf(orgId, missionId, d) {
  if (d.mission) return d.mission;
  const { rest } = await import('./supabase.js');
  return (await (d.fetchRows || rest)(`office_missions?org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(missionId)}&select=id,name,client_name&limit=1`).catch(() => []))?.[0] || {};
}

// A decision, a correction or a cancellation of a person, kept for the next turns (and the next days).
export async function recordDecision(orgId, missionId, entry, d = {}) {
  const text = cut(entry.text, 500).trim(); if (!missionId || !text) return null;
  return noteMission(orgId, missionId, { agent: AGENT, kind: 'decision', origin: 'personne', confirm: 'confirmed', about: cut(entry.about, 120) || null, text, by: entry.by || null, source: cut(entry.source || 'chat', 200), for: ['enhanced-auditor', 'mission-controller'] }, d).catch(() => null);
}

// The AI says it does not understand a term: one search on the general term, sources required; what it finds waits for a person.
export async function searchWeb(orgId, missionId, body, account, d = {}) {
  const mission = await missionOf(orgId, missionId, d), term = generalTerm(body.term, mission);
  const out = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], {
    instructions: 'Tu cherches sur le web le sens ou la pratique d\'un terme général d\'audit ou de comptabilité, pour un cabinet d\'audit. Réponds uniquement avec ce que les sources disent, en français, sans rien inventer ni supposer sur un client. Si les sources se contredisent ou sont faibles, dis-le dans "doubts". JSON STRICT : {"finding":"2 à 4 phrases","doubts":["…"],"confidence":"haute|moyenne|basse"}',
    input: JSON.stringify({ term, why: cut(body.why, 200) || null }), maxTokens: 900, webSearch: true });
  const j = parseJsonLoose(out.text || ''), sources = (out.sources || []).filter(x => x?.url).slice(0, 5);
  if (!j || typeof j.finding !== 'string' || !j.finding.trim()) return { status: 'unreadable', term, note: 'réponse illisible : rien retenu' };
  // Without a source it is not knowledge: nothing is kept.
  if (!sources.length) return { status: 'no_source', term, note: 'aucune source trouvée : rien retenu', provider: out.provider || null };
  const doubts = (Array.isArray(j.doubts) ? j.doubts : []).map(x => cut(x, 160)).filter(Boolean).slice(0, 3);
  const text = cut('Selon le web (à confirmer) — ' + term + ' : ' + j.finding.trim() + (doubts.length ? ' Doutes : ' + doubts.join(' ; ') : ''), 600);
  await noteMission(orgId, missionId, { agent: AGENT, kind: 'fait', origin: 'web', confirm: 'to_confirm', about: 'web : ' + term, text, sources, source: 'recherche web', by: account?.email || null, for: ['enhanced-auditor', 'mission-controller'] }, d);
  return { status: 'learned', term, finding: cut(j.finding, 500), doubts, confidence: j.confidence || null, sources, provider: out.provider || null, to_confirm: true };
}

const kept = n => n.origin === 'web' || n.origin === 'personne' || (n.agent === AGENT && n.kind === 'decision');
export async function memoryView(orgId, missionId, d = {}) {
  const notes = await (d.missionNotes || missionNotes)(missionId, { ...d, orgId }).catch(() => []);
  return { items: notes.filter(kept).slice(-80).reverse().map(n => ({ id: n.id, kind: n.kind, text: n.text, about: n.about || null, origin: n.origin || (n.agent === AGENT ? 'agent' : 'personne'), confirm: n.confirm || null, sources: n.sources || [],
    by: n.by || null, at: n.at, status: n.status || 'open', closed_why: n.closed_why || null, promoted: n.promoted || null })) };
}

// A person confirms, retires or corrects a line. Retiring closes it (kept, with who and why); correcting closes it and writes the new wording.
export async function memoryAct(orgId, missionId, body, account, d = {}) {
  if (!account?.email) throw fail('HUMAN_IDENTITY_REQUIRED', 401);
  if (body.op === 'cancelled') { await recordDecision(orgId, missionId, { about: cut(body.sheet, 80), text: 'Proposition pour ' + cut(body.sheet, 80) + ' annulée par ' + account.email, by: account.email, source: 'annulation d’une proposition' }, d); return { ok: true }; }
  const notes = await (d.missionNotes || missionNotes)(missionId, { ...d, orgId }), n = notes.find(x => x.id === String(body.id || ''));
  if (!n || !kept(n)) throw fail('MEMORY_ITEM_NOT_FOUND', 404);
  if (n.status === 'closed') throw fail('MEMORY_ITEM_CLOSED', 409);
  if (body.op === 'confirm') { await updateNote(orgId, missionId, n.id, { confirm: 'confirmed', confirmed_by: account.email }, d); return { ok: true, id: n.id }; }
  if (body.op === 'retire') { await closeNote(orgId, missionId, n.id, { by: account.email, why: cut(body.why, 300) || 'retiré par une personne' }, d); return { ok: true, id: n.id }; }
  if (body.op === 'correct') {
    const text = cut(body.text, 500).trim(); if (text.length < 5) throw fail('TEXT_REQUIRED');
    await closeNote(orgId, missionId, n.id, { by: account.email, why: 'corrigé' }, d);
    await noteMission(orgId, missionId, { agent: AGENT, kind: n.kind, origin: 'personne', confirm: 'confirmed', about: n.about, text, by: account.email, source: 'correction de ' + cut(n.text, 80), sources: n.sources, for: n.for }, d);
    return { ok: true };
  }
  if (body.op === 'propose') return proposeToFirm(orgId, missionId, n, account, d);
  throw fail('MEMORY_OP_UNKNOWN');
}

// A general fact learned online and confirmed becomes a lesson PROPOSED to the firm: it waits in Shadow for a partner, never applied by itself.
// Only web notes (general by construction: the term was checked before the search). A decision on one mission stays on that mission.
async function proposeToFirm(orgId, missionId, n, account, d) {
  if (!MANAGERS.includes(account.role)) throw fail('MANAGER_OR_PARTNER_ONLY', 403);
  if (n.origin !== 'web') throw fail('ONLY_GENERAL_WEB_KNOWLEDGE_CAN_BE_PROPOSED', 409);
  if (n.confirm !== 'confirmed') throw fail('CONFIRM_BEFORE_PROPOSING', 409);
  if (n.promoted) throw fail('ALREADY_PROPOSED', 409);
  const s = d.shadow || await import('./shadow.js');
  let lessonId = null;
  await s.changeLab(lab => {
    const m = s.mergeLesson(lab, { agent: AGENT, category: 'connaissance_web', situation: n.about || 'terme non compris', error: 'terme ou pratique mal compris', cause: 'connaissance trouvée en ligne et confirmée par ' + account.email,
      lesson: cut(n.text.replace(/^Selon le web \(à confirmer\) — /, ''), 400), rule: '', type: 'hypothesis', confidence: 'moyenne', source: cut((n.sources || []).map(x => x.url).join(' '), 200), evidence: (n.sources || []).map(x => x.url).concat(['confirmé:' + account.email]) });
    if (m) lessonId = m.lesson.id;
  }, d);
  if (!lessonId) throw fail('LESSON_REFUSED', 409);
  await updateNote(orgId, missionId, n.id, { promoted: lessonId }, d);
  return { ok: true, lesson_id: lessonId, note: 'proposée au cabinet : un associé la valide dans Entraînement' };
}
