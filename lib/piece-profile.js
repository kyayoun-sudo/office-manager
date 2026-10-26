// La fiche de chaque pièce d'une mission, faite UNE fois, dès le dépôt (Paul, 2026-10-26 : « si quand on dépose les documents l'IA les
// connaît tous, et que l'agent les range intelligemment, aura-t-on ce problème ? » ; « ici on a des GL auxiliaires et des GL : si l'IA est
// entraînée elle fera la différence, mais elle se perd ; et il n'apprend pas »).
//
// Avant : au dépôt, l'IA lisait les 20 000 premiers caractères et choisissait dans une liste fermée (« état financier », « autre »…) ; au
// remplissage, l'agent rouvrait les pièces en vitesse et ne voyait que leurs titres. Désormais :
//   1. le CODE mesure toute la pièce (feuilles, colonnes, lignes du début, du milieu et de la fin, années, classes de comptes, comptes et
//      leurs intitulés, catégories prouvées par leurs sommes) — des mesures, jamais une décision ;
//   2. l'IA dit ce qu'EST la pièce, avec ses mots et une famille (liste proposée, pas fermée), ce que veut dire chaque colonne, ce qu'est
//      une ligne, sa clé, la période — en s'appuyant sur les CORRECTIONS déjà faites par les auditeurs du cabinet (elle apprend) ;
//   3. le code contrôle ce qu'elle dit contre les mesures et ne fait que SIGNALER un doute (une personne tranche) ;
//   4. la fiche est gardée dans la mémoire de la mission (par version du fichier) ; le remplissage des feuilles la lit.
// Une correction de la personne (« ce n'est pas le grand livre général, c'est un auxiliaire ») est gardée pour tout le cabinet
// (OFFICE_MANAGER_PIECE_LESSONS.json, la forme de la pièce et la bonne réponse, jamais ses données) et donnée à l'IA les fois suivantes.
import { firstAvailable, parseJsonLoose } from './ai-plus.js';
import { fitJson } from './ai-input.js';
import { loadJsonFile, saveJsonFile } from './mapping-scan.js';
import { driveAdapter } from './drive-adapter.js';
import { memoryFolderId } from './memory-runtime.js';

const LESSONS = 'OFFICE_MANAGER_PIECE_LESSONS.json';
const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const isPdf = n => /\.pdf$/i.test(n || ''), isSheet = n => /\.(xlsx|xls|csv)$/i.test(n || '');
export const PROFILE_VERSION = 1;

// Families proposed to the AI so that the same kind of document gets the same name from one mission to the next. NOT a closed list:
// « autre:<mot> » is accepted and kept; what the firm's auditors correct becomes the firm's vocabulary.
export const FAMILIES = {
  grand_livre_general: 'grand livre général (toutes les classes de comptes : charges, produits, banque, immobilisations…)',
  grand_livre_auxiliaire: 'grand livre auxiliaire / de tiers (fournisseurs, clients, personnel…) — détail des comptes de tiers',
  grand_livre_analytique: 'grand livre analytique / par activité ou par projet',
  balance: 'balance générale ou auxiliaire (soldes par compte)',
  journal: 'journal / brouillard des écritures',
  budget_previsionnel: 'budget prévisionnel approuvé (PTBA, plan de travail et budget annuel, budget initial)',
  budget_revise: 'budget révisé / PTBA révisé / réallocation approuvée',
  execution_budgetaire: 'tableau d’exécution budgétaire (TEB, suivi budgétaire : budget, engagements, décaissements, réalisations)',
  releve_bancaire: 'relevé de compte bancaire',
  avis_de_credit: 'avis de crédit / bordereau de versement / avis de virement reçu',
  convention_financement: 'convention / accord de financement, accord de prêt ou de don, avenant',
  demande_de_fonds: 'demande de remboursement / de retrait de fonds (DRF, DRA), état certifié des dépenses',
  etats_financiers: 'états financiers (bilan, compte de résultat, notes)',
  rapport_financier: 'rapport financier / rapport de suivi du projet',
  plan_de_passation: 'plan de passation des marchés',
  facture: 'facture / pièce de dépense',
  contrat: 'contrat / marché / bon de commande',
  correspondance: 'lettre, courrier, avis de non-objection',
  autre: 'autre : préciser « autre:<ce que c’est> »',
};

// The short name of a family, for the file's name (« GRAND_LIVRE_GENERAL_PROJET_X_2023.xlsx ») — an « autre:<mot> » keeps its word.
export const FAMILY_TITLE = { grand_livre_general: 'Grand livre général', grand_livre_auxiliaire: 'Grand livre auxiliaire', grand_livre_analytique: 'Grand livre analytique', balance: 'Balance',
  journal: 'Journal', budget_previsionnel: 'Budget prévisionnel PTBA', budget_revise: 'Budget révisé', execution_budgetaire: 'Tableau d’exécution budgétaire', releve_bancaire: 'Relevé bancaire',
  avis_de_credit: 'Avis de crédit', convention_financement: 'Convention de financement', demande_de_fonds: 'Demande de fonds', etats_financiers: 'États financiers', rapport_financier: 'Rapport financier',
  plan_de_passation: 'Plan de passation', facture: 'Facture', contrat: 'Contrat', correspondance: 'Correspondance' };
export const familyTitle = f => FAMILY_TITLE[f] || (/^autre:/.test(String(f || '')) ? String(f).slice(6).trim() : null);
const PROFILE = `Tu es l'Enhanced Auditor d'un cabinet d'audit. Pour chaque pièce d'une mission, dis ce qu'elle EST, d'après son CONTENU et les
MESURES faites par le code sur TOUTE la pièce (jamais d'après le nom du fichier seul : il est donné comme simple indice).
Mesures du code (content.sheets[]) : en-têtes, lignes du début / du milieu / de la fin, nombre de lignes, "shape" = ce que le code a mesuré
(classes de comptes et leur part, liste des comptes avec leur intitulé, années des dates, catégories dont le montant est PROUVÉ égal à la
somme des lignes qu'elles couvrent, colonne principale des montants) et "shape.looks_like" = un INDICE du code, que tu peux contredire en
le disant. Pour un PDF : le début de son texte.
Distingue avec soin : un grand livre GÉNÉRAL couvre plusieurs classes de comptes (charges 6, produits 7, banque 5, immobilisations 2…) ; un
grand livre AUXILIAIRE ne contient que des comptes de tiers (fournisseurs 40, clients 41, personnel 42…, ou des codes tiers) ; un budget
prévisionnel (PTBA) donne des montants prévus par catégorie / activité sans exécution ; un tableau d'exécution budgétaire (TEB) met en face
du budget les engagements / décaissements / réalisations ; une lettre qui approuve un budget n'est pas le budget.
Familles (garde ces noms quand ils conviennent, sinon "autre:<ce que c'est>") : FAMILIES.
Les CORRECTIONS déjà faites par les auditeurs du cabinet (corrections[]) sont la vérité du cabinet : une pièce de même forme reçoit la
même réponse.
Pour chaque pièce : "family", "what" (description précise et courte : quoi, quelle entité, quelle période, combien de lignes), "entity",
"period", "sheet" (la feuille utile si plusieurs), "line_unit" (ce qu'est UNE ligne : « une écriture comptable », « une catégorie
budgétaire », « une activité », « une ligne budgétaire par compte », « une opération bancaire »…), "key" (la colonne qui identifie une
ligne et ce qu'elle contient : numéro de compte, code budgétaire, code d'activité…), "columns" (pour CHAQUE en-tête : ce qu'il contient
vraiment, en quelques mots ; null si vide), "categories" (si la pièce est un budget : à quel niveau sont ses catégories et comment on les
reconnaît), "confidence" (haute|moyenne|faible), "evidence" (un en-tête ou un texte RECOPIÉ de la pièce qui le prouve).
N'invente rien : si tu ne sais pas, "confidence":"faible" et dis pourquoi dans "doubt".
JSON STRICT : {"pieces":[{"file_id":"…","family":"…","what":"…","entity":"…|null","period":"…|null","sheet":"…|null","line_unit":"…|null","key":{"heading":"…|null","contains":"…"},"columns":[{"heading":"…","meaning":"…"}],"categories":"…|null","confidence":"haute|moyenne|faible","evidence":"…","doubt":"…|null"}]}`;

// A shape signature of a piece (no data): its column titles and what the code measured — used to recognise « the same kind of piece ».
export function signatureOf(content) {
  const sh = (content?.sheets || [])[0];
  if (!sh) return content?.text ? { pdf: true, start: fold(content.text).slice(0, 120) } : {};
  const s = sh.shape || {};
  return { headers: (sh.headers || []).filter(Boolean).map(fold).slice(0, 20), classes: s.account_classes ? Object.keys(s.account_classes).sort() : undefined,
    categories: (s.categories_proved_by_sum || []).length || undefined, hint: s.looks_like || undefined };
}
const similar = (a, b) => {
  if (!a?.headers || !b?.headers) return 0;
  const A = new Set(a.headers), B = new Set(b.headers); let n = 0; for (const x of A) if (B.has(x)) n++;
  const h = n / Math.max(A.size, B.size, 1), c = a.classes && b.classes ? (a.classes.join() === b.classes.join() ? 1 : 0) : 0.5;
  return 0.8 * h + 0.2 * c;
};

async function loadLessons(d) { return (d.loadJsonFile || loadJsonFile)(LESSONS, d.drive || driveAdapter, d.folder || memoryFolderId()).catch(() => ({ state: null })); }
// The firm's corrections closest to these pieces (by shape), the most recent first.
export async function lessonsFor(contents, d = {}) {
  const all = (await loadLessons(d)).state?.lessons || [];
  if (!all.length) return [];
  const sigs = contents.map(signatureOf);
  return all.map(l => ({ l, s: Math.max(0, ...sigs.map(x => similar(x, l.signature))) })).sort((a, b) => b.s - a.s || String(b.l.at).localeCompare(String(a.l.at)))
    .slice(0, 24).map(({ l }) => ({ family: l.family, what: l.what || null, line_unit: l.line_unit || null, signature: l.signature, note: l.note || null, was: l.was || null }));
}

// What the code measured contradicts what the AI said: a DOUBT (shown, a person decides), never a silent override.
export function codeDoubt(profile, content) {
  const sh = (content?.sheets || []).find(x => !profile.sheet || x.name === profile.sheet) || (content?.sheets || [])[0];
  const s = sh?.shape || {}, f = String(profile.family || '');
  const cls = s.account_classes ? Object.keys(s.account_classes).filter(c => c !== 'tiers') : null;
  if (f === 'grand_livre_general' && s.account_classes && (cls.length < 2 || /AUXILIAIRE/.test(s.looks_like || ''))) return 'le code ne trouve que des comptes de tiers (' + Object.keys(s.account_classes).join(', ') + ') : est-ce bien le grand livre général ?';
  if (f === 'grand_livre_auxiliaire' && cls && cls.length >= 3) return 'le code trouve ' + cls.length + ' classes de comptes (' + cls.join(', ') + ') : un auxiliaire n’en a qu’une ou deux';
  if (/^grand_livre|^balance|^journal/.test(f) && sh && !s.account_classes && !s.entries) return 'aucune colonne de comptes mesurée par le code';
  return null;
}

// Profiles of the pieces given (one AI call per batch). content = what peekDocument measured. Returns { [file_id]: profile }.
export async function profilePieces(pieces, d = {}) {
  const out = {};
  const ready = pieces.filter(p => p.content && !p.content.unreadable && (p.content.sheets?.length || p.content.text));
  if (!ready.length) return out;
  const corrections = await lessonsFor(ready.map(p => p.content), d);
  const payload = { corrections, pieces: ready.map(p => ({ file_id: p.id, file_name_hint: p.name, content: p.content })) };
  const input = fitJson(payload, 90000, [
    o => o.pieces.forEach(x => (x.content.sheets || []).forEach(s => { s.middle_lines = (s.middle_lines || []).slice(0, 1); s.first_lines = (s.first_lines || []).slice(0, 4); })),
    o => o.pieces.forEach(x => (x.content.sheets || []).forEach(s => { if (s.shape?.accounts_list) s.shape.accounts_list = s.shape.accounts_list.slice(0, 80); })),
    o => o.pieces.forEach(x => { x.content.sheets = (x.content.sheets || []).slice(0, 2); if (x.content.text) x.content.text = x.content.text.slice(0, 1500); }),
  ]);
  const instructions = PROFILE.replace('FAMILIES', Object.entries(FAMILIES).map(([k, v]) => k + ' = ' + v).join(' ; '));
  let r = null;
  for (let attempt = 0; attempt < 2 && !r; attempt++) { try { r = await (d.ai || firstAvailable)(['anthropic', 'openai', 'gemini'], { instructions, input, maxTokens: 8000 }); } catch (e) { if (attempt) throw e; } }
  const parsed = parseJsonLoose(r?.text ?? r) || {};
  for (const x of Array.isArray(parsed.pieces) ? parsed.pieces : []) {
    const p = ready.find(y => y.id === String(x.file_id || '')); if (!p) continue;
    const family = String(x.family || 'autre').trim().slice(0, 60);
    const prof = { version: PROFILE_VERSION, family, what: String(x.what || '').slice(0, 300), entity: x.entity ? String(x.entity).slice(0, 120) : null, period: x.period ? String(x.period).slice(0, 40) : null,
      sheet: x.sheet ? String(x.sheet).slice(0, 60) : null, line_unit: x.line_unit ? String(x.line_unit).slice(0, 120) : null,
      key: x.key && typeof x.key === 'object' ? { heading: x.key.heading ? String(x.key.heading).slice(0, 80) : null, contains: String(x.key.contains || '').slice(0, 120) } : null,
      columns: (Array.isArray(x.columns) ? x.columns : []).slice(0, 40).map(c => ({ heading: String(c.heading ?? '').slice(0, 80), meaning: c.meaning ? String(c.meaning).slice(0, 160) : null })),
      categories: x.categories ? String(x.categories).slice(0, 300) : null, confidence: ['haute', 'moyenne', 'faible'].includes(x.confidence) ? x.confidence : 'moyenne',
      evidence: x.evidence ? String(x.evidence).slice(0, 200) : null, doubt: x.doubt ? String(x.doubt).slice(0, 300) : null,
      by: r?.provider || 'ia', at: new Date().toISOString(), file_version: p.version || null, signature: signatureOf(p.content) };
    // the evidence quoted is looked for in what was measured (a sample of the piece: not found = noted, not a doubt by itself)
    if (prof.evidence) prof.evidence_found = fold(JSON.stringify(p.content)).replace(/\s+/g, ' ').includes(fold(prof.evidence).replace(/\s+/g, ' ').slice(0, 60));
    const doubt = codeDoubt(prof, p.content);
    if (doubt) Object.assign(prof, { code_doubt: doubt, confidence: prof.confidence === 'haute' ? 'moyenne' : prof.confidence });
    out[p.id] = prof;
  }
  return out;
}

const versionOf = meta => (meta ? String(meta.modifiedTime || '') + '|' + String(meta.size || '') : null);

// Profiles the mission's pieces that have none (or whose file changed), as many as the time allows; written to the mission's memory.
// docs = [{ id, name, profile? }]. Returns { done: n, left: n, profiles: { id: profile } }.
export async function ensureProfiles(orgId, missionId, docs, d = {}) {
  const drive = d.drive || driveAdapter, t0 = Date.now(), budget = d.profileBudgetMs ?? 60000, batchSize = d.profileBatch || 4;
  const { peekDocument } = await import('./sheet-understanding.js');
  const todo = [];
  for (const x of docs.filter(y => isSheet(y.name) || isPdf(y.name))) {
    const meta = await drive.getMeta(x.id).catch(() => null);
    if (!meta || meta.trashed) continue;
    const v = versionOf(meta);
    if (x.profile?.version === PROFILE_VERSION && (!x.profile.file_version || x.profile.file_version === v) && !x.profile.corrected_stale) continue;
    todo.push({ ...x, version: v });
  }
  const profiles = {}; let done = 0;
  for (let i = 0; i < todo.length && Date.now() - t0 < budget; i += batchSize) {
    const batch = todo.slice(i, i + batchSize);
    for (const p of batch) p.content = await peekDocument({ id: p.id, name: p.name }, drive, { ...d, maxRows: 200000 }).catch(e => ({ unreadable: String(e.message || e).slice(0, 80) }));
    let got = {};
    try { got = await profilePieces(batch, d); } catch (e) { if (d.throwOnAi) throw e; break; }
    for (const p of batch) {
      const prof = got[p.id]; if (!prof) continue;
      // a person's correction stays: the AI never overrides what an auditor said this piece is
      if (p.profile?.corrected_by) Object.assign(prof, { family: p.profile.family, what: p.profile.what || prof.what, corrected_by: p.profile.corrected_by, corrected_at: p.profile.corrected_at });
      profiles[p.id] = prof; done++;
    }
    if (Object.keys(got).length && missionId) await saveProfiles(orgId, missionId, batch.filter(p => profiles[p.id]).map(p => ({ id: p.id, name: p.name, profile: profiles[p.id] })), d);
  }
  return { done, left: Math.max(0, todo.length - done), profiles };
}

async function saveProfiles(orgId, missionId, list, d) {
  if (!list.length) return;
  const save = d.recordMissionDocuments || (async (m, docs, dd) => (await import('./mission-files.js')).recordMissionDocuments(m, docs, dd));
  const rows = await (d.fetchRows || (await import('./supabase.js')).rest)(`office_missions?org_id=eq.${encodeURIComponent(orgId)}&id=eq.${encodeURIComponent(missionId)}&select=id,name&limit=1`).catch(() => []);
  const m = rows?.[0] || { id: missionId, name: null };
  await save({ ...m, org_id: orgId }, list.map(x => ({ id: x.id, ...(x.name ? { name: x.name } : {}), profile: x.profile, title: x.profile.what || undefined, event: { agent: 'enhanced-auditor', what: 'fiche de la pièce faite', detail: x.profile.family + ' — ' + (x.profile.what || '') } })), { ...d, orgId }).catch(() => null);
}

// A person corrects what a piece is: kept on the piece (never overridden by the AI) AND for the whole firm (the AI learns it).
export async function correctProfile(orgId, missionId, body = {}, account = {}, d = {}) {
  const id = String(body.file_id || ''), family = String(body.family || '').trim().slice(0, 60);
  if (!id || !family) { const e = new Error('FILE_AND_FAMILY_REQUIRED'); e.status = 400; throw e; }
  const memory = await (d.missionMemory || (async () => (await import('./mission-files.js')).missionMemory(missionId, d)))().catch(() => []);
  const doc = memory.find(x => x.id === id);
  if (!doc) { const e = new Error('PIECE_NOT_IN_MISSION'); e.status = 404; throw e; }
  const was = doc.profile?.family || null;
  const profile = { ...(doc.profile || { version: PROFILE_VERSION }), family, what: body.what ? String(body.what).slice(0, 300) : (doc.profile?.what || null),
    line_unit: body.line_unit ? String(body.line_unit).slice(0, 120) : (doc.profile?.line_unit || null), confidence: 'haute', code_doubt: null, doubt: null,
    corrected_by: account.email || null, corrected_at: new Date().toISOString() };
  await saveProfiles(orgId, missionId, [{ id, profile }], d);
  const L = await loadLessons(d), st = L.state || { lessons: [] };
  st.lessons = [{ family, was, what: profile.what, line_unit: profile.line_unit, note: body.note ? String(body.note).slice(0, 300) : null, signature: doc.profile?.signature || null, by: account.email || null, at: profile.corrected_at }, ...(st.lessons || [])].slice(0, 300);
  st.updated_at = profile.corrected_at;
  await (d.saveJsonFile || saveJsonFile)(LESSONS, d.drive || driveAdapter, d.folder || memoryFolderId(), L.fileId || null, st);
  await (d.audit || (async (o, x) => (await import('./audit-log.js')).audit(o, x)))(orgId, { agent: 'enhanced-auditor', mission_id: missionId, action_type: 'PIECE_PROFILE_CORRECTED', status: 'succeeded', actor: account.email || null, decision: (doc.name || id) + ' : ' + (was || '?') + ' → ' + family }).catch(() => null);
  return { file_id: id, profile, learned: true };
}
