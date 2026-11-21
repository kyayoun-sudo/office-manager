import { rest } from './supabase.js';
import { ownedSimulation } from './simulation.js';
import { readJournal } from './simulation-journal.js';
import { primeOrgKind } from './simulation-guard.js';
import { runInFirm } from './firm-context.js';

// Lessons from a simulation to the PARENT firm's memory (2026-11-21, step 4): the AI drafts, the owner of the simulation corrects and
// sends, a partner of the parent validates in Entraînement. Nothing is stored by the draft; a sent lesson is « under_review » only.
const q = encodeURIComponent;
const fail = (code, statusCode = 400) => Object.assign(new Error(code), { statusCode });
const cut = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_DRAFTS = 8, MAX_SEND = 10, MAX_PENDING = 20;

const INSTRUCTIONS = `Tu es SHADOW, le laboratoire d'apprentissage d'agents IA d'un cabinet d'audit. On te donne le journal numéroté d'une SIMULATION d'entraînement : consignes données aux agents, réponses des agents, corrections faites par des personnes.
Rédige au plus ${MAX_DRAFTS} leçons GÉNÉRIQUES, utiles à tous les cabinets et toutes les missions : une règle à l'impératif, courte, et la situation qui l'explique.
INTERDIT dans une leçon : tout nom de client, de personne, de société ou de projet, toute adresse e-mail ou web, tout montant ou numéro. Décris la situation en termes généraux.
Ne propose JAMAIS de réduire un contrôle, une validation humaine, une permission, la confidentialité, l'indépendance, une signature ou un envoi externe.
Une leçon doit s'appuyer sur au moins une entrée du journal (refs = numéros). Si rien n'enseigne rien de général, rends une liste vide.
Agents possibles : orpailleur, mission-controller, grand-controleur, enhanced-auditor, sika.
JSON STRICT : {"lessons":[{"agent":"","category":"(court)","situation":"","lesson":"","rule":"","refs":[1]}]}`;

function parseJson(text) {
  const t = String(text || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw fail('LESSON_AI_UNREADABLE', 502);
  try { return JSON.parse(t.slice(a, b + 1)); } catch { throw fail('LESSON_AI_UNREADABLE', 502); }
}

// The code can only catch what it can name: e-mails, web addresses, long numbers, the simulation's name, its members. A client's
// name written in clear stays to the owner's reading and the partner's validation.
export function genericProblem(text, terms = []) {
  const t = String(text || '');
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(t)) return 'adresse e-mail';
  if (/https?:\/\/|www\./i.test(t)) return 'adresse web';
  if (/\d{5,}/.test(t) || /\d[\d  .,]{4,}\d/.test(t.replace(/\b\d{4}\b/g, ''))) return 'nombre ou montant';
  const low = t.toLowerCase();
  const hit = terms.find(x => x && low.includes(x));
  return hit ? 'nom connu (« ' + hit + ' »)' : null;
}

async function knownTerms(fetchRows, simOrg) {
  const terms = new Set();
  const org = (await fetchRows('office_organizations?id=eq.' + q(simOrg) + '&select=name&limit=1').catch(() => []))?.[0];
  if (org?.name && String(org.name).trim().length >= 4) terms.add(String(org.name).trim().toLowerCase());
  const members = await fetchRows('office_app_users?org_id=eq.' + q(simOrg) + '&select=display_name,email&limit=500').catch(() => []) || [];
  for (const m of members) {
    const n = String(m.display_name || '').trim().toLowerCase(); if (n.length >= 4) terms.add(n);
    const e = String(m.email || '').trim().toLowerCase(); if (e) { terms.add(e); const l = e.split('@')[0]; if (l.length >= 4) terms.add(l); }
  }
  return [...terms];
}

export async function draftLessons(user, parentOrg, simOrg, d = {}) {
  const { fetchRows } = await ownedSimulation(user, parentOrg, simOrg, d);
  const { entries } = await readJournal(user, parentOrg, simOrg, { limit: 150 }, d);
  const list = [...entries].reverse();
  if (list.length < 2) throw fail('JOURNAL_TOO_SHORT', 409);
  const { AGENT_KEYS, touchesProtected } = await import('./shadow.js');
  const input = list.map((e, i) => (i + 1) + '. [' + e.kind + ' | ' + e.agent + '] ' + cut(e.body, 600)).join('\n').slice(0, 60000);
  const ai = d.runAI || (await import('./ai.js')).runAI;
  let raw;
  try {
    raw = await runInFirm(simOrg, async () => { await primeOrgKind(simOrg, d); return ai({ agentKey: 'shadow', instructions: INSTRUCTIONS, maxTokens: 3000, input: 'JOURNAL DE LA SIMULATION :\n' + input }); });
  } catch (e) { throw fail('LESSON_AI_UNAVAILABLE', e?.statusCode || 502); }
  const terms = await knownTerms(fetchRows, simOrg);
  const drafts = [], refused = [];
  const parsed = parseJson(raw?.text);
  for (const x of (Array.isArray(parsed.lessons) ? parsed.lessons : []).slice(0, MAX_DRAFTS)) {
    const c = checkSync(x, AGENT_KEYS, touchesProtected, terms);
    const refs = [...new Set((Array.isArray(x?.refs) ? x.refs : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= list.length))].slice(0, 8).map(n => list[n - 1].id);
    if (c.problem) refused.push(c); else if (refs.length) drafts.push({ ...c, refs }); else refused.push({ ...c, problem: 'sans entrée du journal' });
  }
  return { drafts, refused, entries_read: list.length };
}

export async function sendLessons(user, parentOrg, simOrg, body = {}, d = {}) {
  const { fetchRows } = await ownedSimulation(user, parentOrg, simOrg, d);
  const items = (Array.isArray(body.lessons) ? body.lessons : []).slice(0, MAX_SEND);
  if (!items.length) throw fail('NO_LESSONS', 400);
  const { AGENT_KEYS, touchesProtected, changeLab, mergeLesson } = await import('./shadow.js');
  const terms = await knownTerms(fetchRows, simOrg);
  const source = 'simulation:' + simOrg;
  const receipt = { written: [], merged: [], refused: [] };
  await runInFirm(parentOrg, () => changeLab(lab => {
    let pending = lab.lessons.filter(l => l.source === source && l.status === 'under_review').length;
    for (const x of items) {
      const c = checkSync(x, AGENT_KEYS, touchesProtected, terms);
      if (c.problem) { receipt.refused.push({ lesson: c.lesson || c.rule, why: c.problem }); continue; }
      if (pending >= MAX_PENDING) { receipt.refused.push({ lesson: c.lesson || c.rule, why: 'plafond de ' + MAX_PENDING + ' leçons en attente atteint' }); continue; }
      const refs = (Array.isArray(x.refs) ? x.refs : []).filter(r => UUID.test(String(r))).slice(0, 8);
      const r = mergeLesson(lab, { agent: c.agent, category: c.category, situation: c.situation, lesson: c.lesson, rule: c.rule, type: 'hypothesis', confidence: 'basse', source, evidence: [source, ...refs] });
      if (!r) { receipt.refused.push({ lesson: c.lesson || c.rule, why: 'zone protégée' }); continue; }
      if (r.merged) receipt.merged.push({ id: r.lesson.id, agent: c.agent }); else { pending++; receipt.written.push({ id: r.lesson.id, agent: c.agent }); }
    }
  }, d));
  try {
    const log = d.audit || (async (o, e) => (await import('./audit-log.js')).audit(o, e));
    await log(parentOrg, { agent: 'shadow', action_type: 'SIMULATION_LESSONS_SENT', approved_by: user.email, output_ref: JSON.stringify({ simulation: simOrg, written: receipt.written.length, merged: receipt.merged.length, refused: receipt.refused.length }) });
  } catch { /* the audit never blocks */ }
  return receipt;
}

// Same checks as draft time, synchronous (the caller already read the terms).
function checkSync(draft, agentKeys, touchesProtected, terms) {
  const agent = String(draft?.agent || '');
  const out = { agent, category: cut(draft?.category || 'général', 60), situation: cut(draft?.situation, 300), lesson: cut(draft?.lesson, 400), rule: cut(draft?.rule, 300) };
  if (!agentKeys.includes(agent)) return { ...out, problem: 'agent inconnu' };
  if (!out.lesson && !out.rule) return { ...out, problem: 'leçon vide' };
  const why = genericProblem([out.situation, out.lesson, out.rule, out.category].join(' '), terms);
  if (why) return { ...out, problem: 'pas générique : ' + why };
  if (touchesProtected(out.lesson + ' ' + out.rule)) return { ...out, problem: 'zone protégée' };
  return out;
}
