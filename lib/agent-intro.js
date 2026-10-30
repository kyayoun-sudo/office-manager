import { rest } from './supabase.js';
import { audit as auditLog } from './audit-log.js';
import { driveAdapter } from './drive-adapter.js';

// FIRST CONNECTION — the agents introduce themselves (Paul, 2026-10-17, « Démarrer »).
// One step to pass in Démarrer: each agent says in a few lines who it is (about 15 seconds) and asks where the file it
// needs is. The HUMAN who gives the link validates, the AGENT checks (the file exists in the Drive, not in the bin) —
// « trouvé » is written only after that check, never on the word of the link. Skipped = can be seen again later;
// finished = never shown again. Someone connecting the firm as the IT person (as_it) is only asked where things are
// (technical locations); the agents otherwise ask what fits the position and the management card of the person.
// Kept in office_firm_settings.settings.onboarding.intro — no new table.
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const q = v => encodeURIComponent(String(v));
const cut = (s, n = 300) => s == null ? null : String(s).slice(0, n);

export const AGENT_INTROS = Object.freeze([
  { agent: 'grand-controleur', name: 'Firm Manager', says: 'Je suis la vue d’ensemble du cabinet : portefeuille, équipe, charge, appels d’offres. Je propose les équipes ; vous décidez.',
    needs: [{ key: 'cv_folder', label: 'Dossier des CV de l’équipe', why: 'proposer des équipes d’après les vrais CV', it: false },
      { key: 'acceptance_template', label: 'Classeur d’acceptation du cabinet (modèle)', why: 'préparer la Phase 0 et le KYC dans votre modèle', it: false }] },
  { agent: 'mission-controller', name: 'Mission Controller', says: 'Je suis le chef d’orchestre de chaque mission : étapes, pièces demandées (PBC), échéances. Je ne passe une étape que si ses conditions sont réunies.',
    needs: [{ key: 'missions_root', label: 'Dossier des clients et missions', why: 'créer et retrouver le dossier de chaque mission', it: true },
      { key: 'pbc_master', label: 'Liste PBC modèle', why: 'construire la liste des pièces à demander', it: false }] },
  { agent: 'enhanced-auditor', name: 'Enhanced Auditor', says: 'J’aide l’auditeur à aller plus vite et mieux : je lis les pièces et je propose. Je ne signe jamais et ne décide jamais de l’opinion.',
    needs: [{ key: 'sop_library', label: 'Dossier des procédures (SOP) du cabinet', why: 'appuyer mes propositions sur votre méthodologie', it: false }] },
  { agent: 'orpailleur', name: 'Orpailleur', says: 'Je lis vos documents pour de bon (pas seulement leur nom), je les nomme clairement et je les range ; chaque déplacement passe par « À valider ».',
    needs: [{ key: 'inbox_folder', label: 'Dossier où l’on dépose les documents à ranger', why: 'savoir où chercher les nouveaux documents', it: true }] },
  { agent: 'sika', name: 'Sika', says: 'Je suis les honoraires, factures et encaissements. Annoncé n’est pas vérifié : je ne dis « payé » qu’avec une preuve.',
    needs: [{ key: 'fees_register', label: 'Registre des honoraires / factures', why: 'suivre ce qui est facturé et encaissé', it: false }] },
  { agent: 'shadow', name: 'Shadow', says: 'Je suis le laboratoire d’apprentissage : j’observe les erreurs, je propose des leçons ; un humain valide chacune.', needs: [] }
]);

const NEED_KEYS = new Set(AGENT_INTROS.flatMap(a => a.needs.map(n => n.key)));
export const driveIdFromLink = link => { const m = String(link || '').match(/[-\w]{20,}/g); return m ? m.sort((a, b) => b.length - a.length)[0] : null; };

async function readSettings(orgId, fetchRows) {
  const rows = await fetchRows('office_firm_settings?org_id=eq.' + q(orgId) + '&select=settings&limit=1').catch(() => null);
  return (Array.isArray(rows) && rows[0]?.settings) || {};
}
// change(settings) -> new settings, applied on the row as it is when written: the other settings of the firm are kept,
// even when another write comes first (audit 2026-10-30, lib/firm-settings-store.js).
async function writeSettings(orgId, change, by, fetchRows) {
  const { changeFirmSettings } = await import('./firm-settings-store.js');
  return changeFirmSettings(orgId, change, { fetchRows, by, missingCode: 'ROLES_SQL_NOT_INSTALLED' });
}
const intro = s => ({ status: null, as_it: false, needs: {}, ...(s.onboarding?.intro || {}) });

const needsFor = (asIt) => AGENT_INTROS.map(a => ({ ...a, needs: a.needs.filter(n => !asIt || n.it) }));

export async function introView(orgId, account, d = {}) {
  const st = intro(await readSettings(orgId, d.fetchRows || rest));
  // Finished: never shown again. Skipped or not started: shown (the step is still to pass).
  if (st.status === 'done') return { status: 'done', locked: true, done_at: st.done_at || null };
  return { status: st.status, locked: false, as_it: st.as_it === true, agents: needsFor(st.as_it === true).map(a => ({ ...a, needs: a.needs.map(n => ({ ...n, answer: st.needs[n.key] || null })) })), must_pass: st.status !== 'skipped' };
}

export async function saveIntro(orgId, body = {}, account = null, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const by = account?.display_name || account?.email || null;
  const settings = await readSettings(orgId, fetchRows);
  const st = intro(settings);
  if (st.status === 'done') throw fail('INTRO_ALREADY_DONE', 409);
  const action = String(body.action || '');
  const keep = async (extra, what, detail = {}) => {
    const saved = await writeSettings(orgId, s => {
      const cur = intro(s), next = { ...cur, ...extra, needs: { ...cur.needs, ...(extra.needs || {}) } };
      return { ...s, onboarding: { ...(s.onboarding || {}), intro: next } };
    }, by, fetchRows);
    await (d.audit || auditLog)(orgId, [{ agent: 'office-manager', action_type: 'FIRST_CONNECTION_' + what, decision: cut(JSON.stringify(detail), 300), reviewer: by }]).catch(() => null);
    return introView(orgId, account, { fetchRows: async (p, o) => (o ? fetchRows(p, o) : [{ settings: saved }]) });
  };
  if (action === 'role') return keep({ as_it: body.as_it === true }, 'ROLE', { as_it: body.as_it === true });
  if (action === 'skip') return keep({ status: 'skipped', skipped_at: new Date().toISOString(), skipped_by: by }, 'SKIPPED');
  if (action === 'later' || action === 'link') {
    const key = String(body.need || ''); if (!NEED_KEYS.has(key)) throw fail('UNKNOWN_NEED');
    if (action === 'later') return keep({ needs: { [key]: { status: 'later', by, at: new Date().toISOString() } } }, 'LATER', { need: key });
    // The human gives the link (and so validates it); the agent checks it in the Drive.
    const id = driveIdFromLink(body.link); if (!id) throw fail('LINK_NOT_RECOGNISED');
    let meta = null; try { meta = await (d.getMeta || driveAdapter.getMeta)(id); } catch { meta = null; }
    const found = !!(meta && meta.id && !meta.trashed);
    return keep({ needs: { [key]: found
      ? { status: 'verified', file_id: id, name: cut(meta.name, 200), kind: /folder/.test(meta.mimeType || '') ? 'dossier' : 'fichier', link_given_by: by, verified_at: new Date().toISOString() }
      : { status: 'not_found', file_id: id, link_given_by: by, checked_at: new Date().toISOString() } } }, found ? 'LINK_VERIFIED' : 'LINK_NOT_FOUND', { need: key, file_id: id });
  }
  if (action === 'finish') {
    const open = needsFor(st.as_it === true).flatMap(a => a.needs).filter(n => !['verified', 'later'].includes(st.needs[n.key]?.status));
    if (open.length) throw Object.assign(fail('INTRO_NEEDS_OPEN'), { open: open.map(n => n.key) });
    return keep({ status: 'done', done_at: new Date().toISOString(), done_by: by }, 'DONE');
  }
  throw fail('UNKNOWN_ACTION');
}

// ---- Per person (2026-10-17, Paul): each agent asks only what fits the PERSON'S POSITION, and a short presentation
// of each screen is shown once (« Ne plus afficher »). Everything stays in office_firm_settings.settings.onboarding.people[email].
// Honest limit: the answers are kept here and read by the agents; they do not (yet) write themselves into the Management Card.
const ALL = ['owner', 'partner', 'manager', 'supervisor', 'senior', 'auditor', 'bdm', 'secretary', 'quality_reviewer', 'it'];
const TEAM = ['manager', 'supervisor', 'senior', 'auditor', 'bdm'];
export const PERSON_QUESTIONS = Object.freeze([
  { key: 'work_style', agent: 'shadow', roles: ALL, text: 'Plutôt autonomie ou cadre précis pour travailler ?', options: ['Autonomie', 'Cadre précis', 'Selon la mission'] },
  { key: 'availability', agent: 'grand-controleur', roles: TEAM, text: 'Combien de jours par semaine pouvez-vous consacrer aux missions, en général ?' },
  { key: 'sectors', agent: 'grand-controleur', roles: [...TEAM, 'partner', 'owner'], text: 'Dans quels secteurs avez-vous le plus travaillé ?' },
  { key: 'pbc_followup', agent: 'mission-controller', roles: ['manager', 'supervisor', 'senior'], text: 'Sur vos missions, qui relance le client pour les pièces demandées ?', options: ['Moi', 'Un auditeur', 'Le secrétariat'] },
  { key: 'review_style', agent: 'enhanced-auditor', roles: ['manager', 'supervisor', 'partner', 'quality_reviewer'], text: 'Pour une revue préparée par l’Enhanced Auditor, que préférez-vous ?', options: ['Résumé court', 'Détail complet'] },
  { key: 'help_wanted', agent: 'enhanced-auditor', roles: ['senior', 'auditor'], text: 'Sur quels cycles voulez-vous le plus d’aide ?' },
  { key: 'where_files', agent: 'orpailleur', roles: ['secretary', 'auditor', 'senior', 'manager'], text: 'Où déposez-vous d’habitude les documents que vous recevez ?' },
  { key: 'billing_who', agent: 'sika', roles: ['owner', 'partner', 'secretary'], text: 'Qui valide les factures avant leur envoi ?' }
]);
const AGENT_NAME = Object.fromEntries(AGENT_INTROS.map(a => [a.agent, a.name]));
const emailOf = a => String(a?.email || '').toLowerCase();
const person = (settings, account) => ({ answers: {}, screens_seen: [], ...(settings.onboarding?.people?.[emailOf(account)] || {}) });
// change(person) -> the person's new record, applied on the row as it is when written.
async function savePerson(orgId, account, change, fetchRows) {
  await writeSettings(orgId, s => {
    const next = change(person(s, account));
    if (next === undefined) return undefined;
    return { ...s, onboarding: { ...(s.onboarding || {}), people: { ...(s.onboarding?.people || {}), [emailOf(account)]: next } } };
  }, account.display_name || account.email || null, fetchRows);
}

export async function personView(orgId, account, d = {}) {
  if (!emailOf(account)) throw fail('ACCOUNT_REQUIRED', 401);
  const p = person(await readSettings(orgId, d.fetchRows || rest), account);
  const mine = PERSON_QUESTIONS.filter(x => x.roles.includes(account.role));
  const pending = mine.filter(x => !(x.key in p.answers)).map(x => ({ key: x.key, agent: x.agent, agent_name: AGENT_NAME[x.agent], text: x.text, options: x.options || null }));
  // The work-style question is asked first: the Management Card of the person starts from it.
  pending.sort((a, b) => (b.key === 'work_style') - (a.key === 'work_style'));
  return { pending, answered: mine.length - pending.length, total: mine.length };
}
export async function answerPerson(orgId, account, body = {}, d = {}) {
  const fetchRows = d.fetchRows || rest;
  const q0 = PERSON_QUESTIONS.find(x => x.key === String(body.key || ''));
  if (!q0 || !q0.roles.includes(account?.role)) throw fail('UNKNOWN_QUESTION');
  const answer = cut(String(body.answer || '').trim(), 400); if (!answer) throw fail('ANSWER_REQUIRED');
  if (q0.options && !q0.options.includes(answer)) throw fail('ANSWER_NOT_IN_OPTIONS');
  await savePerson(orgId, account, p => ({ ...p, answers: { ...p.answers, [q0.key]: { answer, at: new Date().toISOString() } } }), fetchRows);
  return personView(orgId, account, { fetchRows: async (path, o) => o ? fetchRows(path, o) : fetchRows(path) });
}

// Mini-presentation of each screen: what it is for, by position. Shown once; « Ne plus afficher » = never again on this screen.
export const SCREEN_INTROS = Object.freeze({
  accueil: { default: 'Votre accueil : ce qui vous attend aujourd’hui.', partner: 'Accueil du cabinet : indicateurs, e-mails, missions, décisions qui vous attendent.', owner: 'Accueil du cabinet : indicateurs, e-mails, missions, décisions qui vous attendent.', auditor: 'Mon travail : vos missions, vos tâches et leurs échéances.', senior: 'Mon travail : vos missions, vos tâches et leurs échéances.' },
  opportunites: { default: 'Les appels d’offres et AMI : le Firm Manager lit le document, prépare la fiche ; les décisions restent aux personnes désignées.' },
  validations: { default: '« À valider » : tout ce que les agents proposent (rangements, envois). Rien ne part sans votre accord.' },
  equipe: { default: 'L’équipe : personnes, compétences, charge. Les indicateurs sont montrés selon vos droits.' },
  mission: { default: 'Une mission : étapes, pièces demandées, échéances et documents.' },
  programme: { default: 'Le programme de travail : cycles et contrôles choisis dans les procédures du cabinet.' },
  procedure: { default: 'Votre procédure : population, échantillon, pièces, conclusion. L’agent propose, vous concluez.' },
  secretariat: { default: 'Secrétariat et modèles : envois avec preuve, modèles Word, CV adaptés.' },
  veille: { default: 'Veille des appels d’offres : les avis trouvés ; un associé décide de suivre.' },
  entrainement: { default: 'Entraînement : ce que Shadow observe et apprend ; une personne valide chaque leçon.' },
  parametres: { default: 'Paramètres du cabinet : Drive, horaires des agents, droits.' }
});
export async function screenIntro(orgId, account, screen, d = {}) {
  const s = SCREEN_INTROS[String(screen || '')]; if (!s || !emailOf(account)) return { text: null };
  const p = person(await readSettings(orgId, d.fetchRows || rest), account);
  if (p.screens_seen.includes(screen)) return { text: null };
  return { screen, text: s[account.role] || s.default };
}
export async function dismissScreen(orgId, account, screen, d = {}) {
  const fetchRows = d.fetchRows || rest;
  if (!SCREEN_INTROS[String(screen || '')]) throw fail('UNKNOWN_SCREEN');
  await savePerson(orgId, account, p => (p.screens_seen.includes(screen) ? undefined : { ...p, screens_seen: [...p.screens_seen, screen].slice(-40) }), fetchRows);
  return { text: null };
}
