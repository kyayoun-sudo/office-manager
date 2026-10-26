// LA MÉMOIRE DES LEÇONS SUR LE SERVEUR EYNOWA (Paul, 2026-10-26 : « que sa mémoire soit stockée sur le serveur de Christian » ;
// « les leçons restent et les documents disparaissent »).
// Ce qui y va : des LEÇONS (comment le cabinet travaille : méthode, structure d'un dossier, façon de conclure, de nommer, de ranger),
// jamais un document ni une donnée d'un client. Le code retire ce qui ressemble à une donnée (montant, date, courriel, téléphone,
// compte bancaire, noms signalés par l'IA ou le titre de l'entraînement) avant tout envoi.
// La liste des leçons reste aussi dans la base de l'application (office_gym_lessons) : si le serveur est éteint, rien n'est perdu,
// et les leçons validées y sont renvoyées dès qu'il répond (`syncPending`).
import { rest } from './supabase.js';

export const COLLECTION = 'office_manager_lessons';
export const AGENTS = {
  'firm-manager': 'Firm Manager', 'mission-controller': 'Mission Controller', 'enhanced-auditor': 'Enhanced Auditor',
  orpailleur: 'Orpailleur', sika: 'Sika' };
const q = v => encodeURIComponent(String(v ?? ''));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// What looks like a client's data is removed; the lesson keeps the method.
export function redact(text, hide = []) {
  let t = String(text || ''), removed = 0;
  const sub = (re, by) => { t = t.replace(re, () => { removed++; return by; }); };
  sub(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[courriel]');
  sub(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/g, '[compte]');
  sub(/(?:\+|00)\d[\d\s.-]{7,}\d/g, '[téléphone]');
  sub(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, '[date]');
  sub(/\b\d{1,3}(?:[ .  ]\d{3})+(?:,\d+)?\b|\b\d{4,}(?:[.,]\d+)?\b/g, '[montant]');
  for (const w of [...new Set(hide.map(x => String(x || '').trim()).filter(x => x.length >= 3))].sort((a, b) => b.length - a.length))
    sub(new RegExp('\\b' + esc(w) + '\\b', 'gi'), '[nom]');
  return { text: t.replace(/\s+/g, ' ').trim(), removed };
}

const lab = d => d.labMemory || (async (op, body, o) => (await import('./eynowa-lab.js')).labMemory(op, body, o));
const ready = async d => (d.labReady ? d.labReady() : (await import('./eynowa-lab.js')).labReady());

export async function pushLesson(row, d = {}) {
  if (!(await ready(d))) throw new Error('EYNOWA_LAB_NOT_CONFIGURED');
  const agent = row.context?.agent || 'enhanced-auditor';
  const text = `${AGENTS[agent] || agent} — ${row.context?.theme || 'méthode'} : ${row.lesson}`;
  const r = await lab(d)('store', { collection: COLLECTION, id: 'om-' + row.id, text,
    metadata: { org: String(row.org_id || ''), agent, theme: String(row.context?.theme || ''), kind: String(row.context?.document_kind || ''), lesson_id: String(row.id) } }, { timeoutMs: 30000 });
  if (!r?.stored) throw new Error('EYNOWA_MEMORY_NOT_STORED');
  return { id: r.id, at: new Date().toISOString() };
}

// Lessons from the server that speak about this work; empty when the server is not ready or slow (the base is used instead).
let downUntil = 0;   // a server that did not answer is not asked again for 10 minutes: the work never waits on it
export async function searchLessons(org, agent, query, d = {}) {
  if (!query || !(await ready(d)) || (!d.labMemory && Date.now() < downUntil)) return null;
  try {
    const r = await lab(d)('search', { collection: COLLECTION, query: String(query).slice(0, 800), nResults: 8, where: { $and: [{ org: String(org) }, { agent }] } }, { timeoutMs: d.memoryTimeoutMs || 8000 });
    const docs = r?.result?.documents?.[0] || [], metas = r?.result?.metadatas?.[0] || [];
    return docs.map((x, i) => ({ lesson: String(x), from: 'mémoire EYNOWA', lesson_id: metas[i]?.lesson_id || null }));
  } catch { downUntil = Date.now() + 10 * 60 * 1000; return null; }
}

export async function memoryStatus(d = {}) {
  if (!(await ready(d))) return { ready: false, reason: 'EYNOWA_LAB_NOT_CONFIGURED' };
  try { await lab(d)('search', { collection: COLLECTION, query: 'test', nResults: 1 }, { timeoutMs: 15000 }); return { ready: true }; }
  catch (e) { return { ready: false, reason: String(e.message || e).slice(0, 160) }; }
}

// Validated lessons not yet on the server are sent again (at most 20 per call).
export async function syncPending(org, d = {}) {
  const rows = (await (d.fetchRows || rest)(`office_gym_lessons?org_id=eq.${q(org)}&step=eq.archive&status=eq.validated&select=id,org_id,lesson,context&order=created_at.asc&limit=200`).catch(() => [])) || [];
  const todo = rows.filter(r => !r.context?.memory?.id).slice(0, 20);
  let sent = 0, error = null;
  for (const r of todo) {
    try { const m = await pushLesson(r, d); await (d.fetchRows || rest)(`office_gym_lessons?id=eq.${q(r.id)}`, { method: 'PATCH', body: JSON.stringify({ context: { ...(r.context || {}), memory: m, memory_error: null } }) }); sent++; }
    catch (e) { error = String(e.message || e).slice(0, 160); break; }
  }
  return { sent, waiting: rows.filter(r => !r.context?.memory?.id).length - sent, error };
}
