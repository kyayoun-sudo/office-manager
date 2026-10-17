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
async function writeSettings(orgId, settings, by, fetchRows) {
  try {
    await fetchRows('office_firm_settings?on_conflict=org_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ org_id: orgId, settings, updated_by: by, updated_at: new Date().toISOString() }]) });
  } catch (e) { throw fail(/office_firm_settings|PGRST205|42P01/i.test(String(e?.message || e)) ? 'ROLES_SQL_NOT_INSTALLED' : String(e?.message || e), 409); }
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
    const next = { ...st, ...extra, needs: { ...st.needs, ...(extra.needs || {}) } };
    await writeSettings(orgId, { ...settings, onboarding: { ...(settings.onboarding || {}), intro: next } }, by, fetchRows);
    await (d.audit || auditLog)(orgId, [{ agent: 'office-manager', action_type: 'FIRST_CONNECTION_' + what, decision: cut(JSON.stringify(detail), 300), reviewer: by }]).catch(() => null);
    return introView(orgId, account, { fetchRows: async (p, o) => (o ? fetchRows(p, o) : [{ settings: { ...settings, onboarding: { ...(settings.onboarding || {}), intro: next } } }]) });
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
