// Un nom qui dit ce qu'est le document — pour TOUS les agents qui rangent ou renomment (Paul, 2026-10-25 : « l'Enhanced Auditor ne range
// pas selon ce qui est, ou c'est l'Orpailleur ; tout rangement doit comprendre le fichier, savoir ce qu'il est, et le renommer ; le tableau
// budgétaire a été appelé « tableau » ; tous les agents doivent travailler sur ça »).
//   - Le nom vient de ce qui a été LU (le titre précis du document), jamais du nom d'origine ni d'un libellé de demande seul.
//   - Un mot générique seul (« Tableau », « Document », « Fichier », « Pièce », « Scan », « Export »…) n'est jamais un nom : on cherche
//     un titre précis (titre, type, rôle, résumé) ; si rien de précis, le nom d'origine est GARDÉ et la pièce est signalée « à identifier ».
//   - Forme : TITRE_CLIENT_PÉRIODE.ext (ASCII, extension gardée), puis raccourci pour qu'Excel puisse l'ouvrir (lib/path-budget.js).
// Utilisé par : dépôt de pièces (renamePieces), classement des pièces confirmées (PBC), pièces des tests de l'Enhanced Auditor,
// propositions de l'Orpailleur et du Mission Controller (garde sur le nom proposé par l'IA).

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const slug = (x, n = 50) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase().slice(0, n).replace(/_+$/, '');

const GENERIC = new Set(['tableau', 'tableaux', 'table', 'document', 'documents', 'doc', 'fichier', 'file', 'piece', 'pieces', 'piece jointe', 'scan', 'scanne',
  'image', 'img', 'photo', 'feuille', 'feuil', 'sheet', 'classeur', 'workbook', 'autre', 'autres', 'divers', 'annexe', 'export', 'extrait', 'extraction', 'liste',
  'donnees', 'data', 'rapport', 'courrier', 'pdf', 'excel', 'word', 'untitled', 'sans titre', 'copie', 'copy', 'nouveau', 'new', 'version', 'final', 'definitif', 'brouillon', 'draft']);
const FILLER = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'en', 'au', 'aux', 'un', 'une', 'of', 'the']);
const ROLE_TITLE = { tdr: 'Termes de reference', contrat: 'Contrat', lettre_de_mission: 'Lettre de mission', convention: 'Convention de financement',
  programme_de_travail: 'Programme de travail', evaluation_des_risques: 'Evaluation des risques', etat_financier: 'Etats financiers', facture: 'Facture', cv: 'CV' };

// A title that says nothing on its own: only generic words, years, numbers or the original file name's noise.
export function isGeneric(title) {
  const words = fold(title).split(' ').map(w => (/^\d+$/.test(w) ? w : w.replace(/\d+$/, ''))).filter(w => w && !FILLER.has(w) && !/^\d+$/.test(w) && !/^(v\d+|n|no|num)$/.test(w));
  if (!words.length) return true;
  return words.every(w => GENERIC.has(w)) || GENERIC.has(words.join(' '));
}

// The precise title of a document from what was read: its title, its type, its role, then the start of its summary — the first that
// is not generic. Null when nothing precise is known (then nothing is renamed).
export function preciseTitle(u = {}) {
  const tries = [u.title, u.type, u.doc_type, ROLE_TITLE[u.role], ROLE_TITLE[u.pbc_role]];
  for (const t of tries) if (t && !isGeneric(t)) return String(t).trim().slice(0, 80);
  // « Tableau » + what the summary says it holds (« tableau budgétaire du projet… » → « Tableau budgetaire projet »)
  const s = String(u.summary || '').replace(/^(il s'agit d'|c'est |ce document est |document :)\s*/i, '');
  const first = s.split(/[.;:\n]/)[0].trim().split(/\s+/).slice(0, 7).join(' ');
  if (first && !isGeneric(first)) return first.slice(0, 80);
  return null;
}

// TITLE_CLIENT_PERIOD.ext, or null when the document is not identified precisely enough.
export function contentName(u = {}, { client = '', period = '', original = '', prefix = '' } = {}) {
  const title = preciseTitle(u); if (!title) return null;
  const ext = (String(original || u.name || '').match(/\.[A-Za-z0-9]{1,5}$/) || [''])[0].toLowerCase();
  const t = slug(title, 50), c = slug(u.client || client, 30), p = slug(u.period || period, 12);
  const parts = [prefix ? slug(prefix, 30) : '', t, c && !t.includes(c) ? c : '', p && !t.includes(p) ? p : ''].filter(Boolean);
  return parts.join('_') + ext;
}

// A name proposed by an AI (Orpailleur, Mission Controller): refused when generic (« TABLEAU_2023.xlsx »), when it drops the extension,
// or when it is just the original name again. Returns the name to use, or null (keep the current name) with the reason.
export function checkProposedName(proposed, original) {
  if (!proposed) return { name: null, reason: null };
  const extOf = s => (String(s).match(/\.[A-Za-z0-9]{1,5}$/) || [''])[0].toLowerCase();
  if (extOf(proposed) !== extOf(original)) return { name: null, reason: 'EXTENSION_CHANGED' };
  const base = String(proposed).replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_-]+/g, ' ');
  if (isGeneric(base)) return { name: null, reason: 'GENERIC_NAME_REFUSED' };
  if (fold(proposed) === fold(original)) return { name: null, reason: 'SAME_NAME' };
  return { name: String(proposed).slice(0, 250), reason: null };
}

// The naming rule given to every AI that reads a document (one sentence, the same everywhere).
export const NAMING_RULE = 'Le type / titre est le libellé PRÉCIS de ce qu’est le document, tel qu’on le lit (ex. « Tableau budgétaire PTBA 2023 », « Balance générale », « Grand livre général », « Grand livre auxiliaire fournisseurs », « Convention de financement », « Relevé bancaire SGCI décembre ») ; jamais un mot générique seul (« Tableau », « Document », « Fichier », « Pièce », « Scan », « Export »).';

// A file name that says nothing about the content: generic words, camera / scanner names, copies.
export function meaninglessName(name) {
  const base = String(name || '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  return isGeneric(base.replace(/[_-]+/g, ' ')) || /^(img|dsc|dcim|scan|scanne|cam|photo|whatsapp|document|doc|fichier|file|image|untitled|sans titre|capture|numeriser|numérisation|copie de|copy of)\b[\s_()-]*\d*/i.test(base.trim());
}

// The name an AI decision leads to: the AI's own name if it is precise; otherwise a name built by the code from what the AI READ
// (type, client, period, summary). When the AI did not ask to rename, only a meaningless current name is replaced.
export function resolveName(x = {}, original = '', aiAskedRename = false) {
  const c = checkProposedName(x.new_name, original);
  if (c.name && (aiAskedRename || meaninglessName(original))) return c.name;
  if (aiAskedRename || meaninglessName(original)) {
    const built = contentName({ type: x.doc_type || x.type, title: x.title, client: x.client, period: x.period, summary: x.summary, role: x.pbc_role, name: original }, { original });
    if (built && built !== original) return built;
  }
  return null;
}
