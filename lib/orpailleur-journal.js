// THE ORPAILLEUR'S JOURNAL (Paul, 2026-10-09: « au lieu de mettre sa mémoire dans Supabase, une infime
// mémoire ira dans Supabase et il écrira dans un Excel ce qu'il fait ; à son prochain passage, pour être plus économe, il regarde
// dans cette mémoire que lui-même a remplie, ce qu'il a vu à l'heure de sa mémoire, refait son
// travail sur les nouveaux fichiers après cette heure et réécrit dans sa mémoire son dernier passage »).
//  - in Supabase, only a SMALL checkpoint (office_agent_checkpoints): hour of the last pass + result,
//    so a deleted or damaged Drive memory never makes him start everything again;
//  - his memory: OFFICE_MANAGER_TIDY_STATE.json in 00_TATY_AI_MANAGER/MEMORY (last pass hour, what
//    he saw, the state of each file, his questions, his passes);
//  - his journal: ONE Excel, ORPAILLEUR_JOURNAL.xlsx in 00_TATY_AI_MANAGER, rewritten in place
//    at the end of each pass (never a new file);
//  - « découvert » is not « traité »: each file has its step; a pass that did not finish says
//    PASSAGE INCOMPLET and why (« je ne suis pas évalué sur ma capacité à afficher du vert »).

export const JOURNAL = 'ORPAILLEUR_JOURNAL';
export const STEPS = ['découvert', 'inspecté', 'illisible', 'en place', 'proposé (À valider)', 'en REVIEW — question envoyée', 'en REVIEW — question en attente d’envoi', 'confirmation reçue', 'déplacé', 'déplacé et vérifié', 'terminé'];
const MAX_STATES = 4000, MAX_PASSES = 60;
const cut = (s, n) => String(s ?? '').slice(0, n);

export function noteFile(st, f, state, note = '') {
  st.states = st.states || {};
  const prev = st.states[f.id] || {};
  st.states[f.id] = { name: cut(f.name || prev.name, 200), path: cut(f.path || prev.path, 400), state, note: cut(note, 300) || prev.note || null, at: new Date().toISOString() };
  const ids = Object.keys(st.states);
  if (ids.length > MAX_STATES) {
    // The oldest finished ones leave first; what is still open always stays.
    const old = ids.filter(id => ['terminé', 'en place', 'déplacé et vérifié'].includes(st.states[id].state)).sort((a, b) => String(st.states[a].at).localeCompare(String(st.states[b].at)));
    for (const id of old.slice(0, ids.length - MAX_STATES)) delete st.states[id];
  }
}

// A misplaced document is also a signal for the Firm Manager (procedure, training).
export function noteMisplaced(st, x, f) {
  const where = String(f.path || '').split('/').slice(0, -1).join('/') || '(racine)';
  const key = (x.doc_type || 'document') + ' | ' + where;
  st.misplaced = st.misplaced || {};
  st.misplaced[key] = (st.misplaced[key] || 0) + 1;
}

export function signals(st, min = 3) {
  return Object.entries(st.misplaced || {}).filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([k, n]) => { const [type, where] = k.split(' | '); return { type, where, count: n, statement: n + ' « ' + type + ' » déposés au mauvais endroit (' + where + ') : probablement une question de procédure ou de formation.' }; });
}

// Complete or not, and why — said plainly.
export function passReport(st) {
  const total = st.total ?? (st.files || []).length ?? 0, done = Math.min(st.done || 0, total || st.done || 0);
  const asked = Object.values(st.asked || {});
  const reasons = [];
  if (st.status === 'failed') reasons.push('arrêté en route : ' + cut(st.error || 'erreur', 160) + ' (il reprendra là où il s’est arrêté)');
  if (total && done < total) reasons.push((total - done) + ' fichier(s) encore à inspecter sur ' + total);
  const waiting = asked.filter(a => a.status === 'open');
  if (waiting.length) reasons.push(waiting.length + ' réponse(s) humaine(s) attendue(s)');
  const notSent = asked.filter(a => a.status === 'open' && !a.sent);
  if (notSent.length) reasons.push(notSent.length + ' question(s) non envoyée(s) (en attente dans « À valider » ou Gmail indisponible' + (notSent.find(a => a.send_error) ? ' : ' + cut(notSent.find(a => a.send_error).send_error, 80) : '') + ')');
  const unreadable = Object.values(st.states || {}).filter(s => s.state === 'illisible').length;
  if (unreadable) reasons.push(unreadable + ' fichier(s) illisible(s) : non rangés automatiquement');
  const pendingScans = Object.keys(st.pending_read || {}).length;
  if (pendingScans) reasons.push(pendingScans + ' scan(s) pas encore regardé(s) (lecture visuelle limitée par passage) : repris au prochain passage');
  const status = st.status === 'done' && !reasons.some(r => /arrêté|à inspecter|pas encore regardé/.test(r)) ? 'PASSAGE COMPLET' : 'PASSAGE INCOMPLET';
  return { status, reasons, counts: { inspectes: done, total, ok: st.ok || 0, deplaces: st.moves || 0, renommes: st.renames || 0, auto: st.auto || 0, verifies: st.verified || 0, questions: st.questions || 0, reponses: asked.filter(a => ['answered', 'resolved'].includes(a.status)).length } };
}

// The pass written into his memory (one line per pass, the latest replaces the same pass).
export function closePass(st) {
  const r = passReport(st);
  const entry = { id: st.pass_started_at || st.started_at, mode: st.mode || 'first-scan', since: st.since || null, started_at: st.started_at, ended_at: new Date().toISOString(), status: r.status, reasons: r.reasons, ...r.counts };
  st.passes = (st.passes || []).filter(p => p.id !== entry.id);
  st.passes.push(entry);
  st.passes = st.passes.slice(-MAX_PASSES);
  st.last_report = entry;
  return entry;
}

export function journalSheets(st) {
  const passes = [...(st.passes || [])].reverse();
  const states = Object.entries(st.states || {}).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)));
  const asked = Object.entries(st.asked || {}).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at)));
  return [
    { name: 'Passages', rows: [['Passage', 'Type', 'Fichiers depuis', 'Fin', 'Résultat', 'Inspectés', 'Sur', 'Déjà en place', 'Déplacés', 'Renommés', 'Faits seuls (sûrs)', 'Vérifiés', 'Questions', 'Réponses', 'Pourquoi incomplet'],
      ...passes.map(p => [p.started_at, p.mode === 'changes' ? 'passage' : 'premier scan', p.since || '', p.ended_at, p.status, p.inspectes, p.total, p.ok, p.deplaces, p.renommes, p.auto, p.verifies, p.questions, p.reponses, (p.reasons || []).join(' ; ')])] },
    { name: 'Fichiers', rows: [['Fichier', 'Chemin', 'Étape', 'Note', 'Depuis le'], ...states.slice(0, 3000).map(([, s]) => [s.name, s.path, s.state, s.note || '', s.at])] },
    { name: 'Questions', rows: [['Fichier', 'Posée le', 'À', 'Pourquoi cette personne', 'Ce qui était su', 'Ce qui manquait', 'Envoyée', 'Statut', 'Réponse (ce qu’elle confirme)', 'Par', 'Référence du message'],
      ...asked.map(([, a]) => [a.file?.name, a.at, a.to, a.why, a.known, a.missing, a.sent ? 'oui' : 'non' + (a.send_error ? ' (' + a.send_error + ')' : ''), a.status, a.answer || '', a.answer_by || '', a.answer_ref?.gmail_id || ''])] },
    { name: 'Doublons possibles', rows: [['Fichier', 'Chemin', 'Le', 'Pourquoi (POSSIBLE DUPLICATE — REVIEW REQUIRED)', 'Structure existante', 'Ce qui aurait été créé'],
      ...Object.values(st.duplicates || {}).sort((a, b) => String(b.at).localeCompare(String(a.at))).map(x => [x.file, x.path, x.at, x.why, x.existing_path || '', x.wanted || ''])] },
    { name: 'Signaux Firm Manager', rows: [['Type de document', 'Déposé dans', 'Nombre', 'Ce que cela suggère'], ...signals(st).map(s => [s.type, s.where, s.count, s.statement])] }
  ];
}

// The Excel in 00_TATY_AI_MANAGER, rewritten in place (same name → same file).
export async function writeJournal(st, d = {}) {
  const { saveWorkbook } = await import('./agent-outputs.js');
  const { homeFolderId } = await import('./memory-runtime.js');
  const parentId = d.home || homeFolderId();
  if (!parentId) return null;
  return (d.saveWorkbook || saveWorkbook)('orpailleur', JOURNAL, journalSheets(st), { ...d, parentId });
}

// The small memory in Supabase: one line (hour of the last pass, result). Never blocks a pass.
export async function saveCheckpoint(orgId, st, d = {}) {
  if (!orgId) return null;
  const fetchRows = d.fetchRows || (await import('./supabase.js')).rest;
  const r = st.last_report || {};
  return fetchRows('office_agent_checkpoints?on_conflict=org_id,agent_key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ org_id: orgId, agent_key: 'orpailleur', last_pass_at: st.status === 'done' ? st.last_pass_at || null : undefined, status: r.status || null,
      report: { mode: r.mode || null, since: r.since || null, ended_at: r.ended_at || null, inspectes: r.inspectes ?? null, total: r.total ?? null, deplaces: r.deplaces ?? null, auto: r.auto ?? null, verifies: r.verifies ?? null, questions: r.questions ?? null, reasons: (r.reasons || []).slice(0, 5).map(x => cut(x, 200)) },
      updated_at: new Date().toISOString() }].map(row => JSON.parse(JSON.stringify(row)))) }).catch(() => null);
}

export async function loadCheckpoint(orgId, d = {}) {
  if (!orgId) return null;
  const fetchRows = d.fetchRows || (await import('./supabase.js')).rest;
  const rows = await fetchRows('office_agent_checkpoints?org_id=eq.' + encodeURIComponent(orgId) + '&agent_key=eq.orpailleur&select=last_pass_at,status,report,updated_at&limit=1').catch(() => null);
  return Array.isArray(rows) ? rows[0] || null : null;
}
