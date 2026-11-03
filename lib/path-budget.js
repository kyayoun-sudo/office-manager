// Des chemins qu'Excel peut ouvrir (Paul, 2026-10-25 : « impossible d'ouvrir le fichier : le chemin fait plus de 259 caractères ; le
// rangement n'est donc pas intelligent »).
// Sur Windows, Excel refuse un fichier dont le chemin complet dépasse 259 caractères. Avec Google Drive pour ordinateur, ce chemin est
// « G:\Drive partagés\<Drive>\<dossiers…>\<fichier> ». Tout nom que l'application crée (dossier de mission, working paper, pièce
// renommée, rangement de l'Orpailleur) est donc ajusté pour que le chemin complet reste sous 240 caractères (marge pour la lettre de
// lecteur et « Mon Drive » / « Shared drives »). Les fichiers existants trop profonds sont signalés et un nom plus court est PROPOSÉ ;
// rien n'est renommé sans une personne (même fichier, même id : liens et registres restent valables, rien n'est supprimé).

export const EXCEL_LIMIT = 259;
export const TARGET = 240;
const PREFIX = 'G:\\Drive partagés\\'.length;          // the drive letter and the shared-drive folder of Google Drive for desktop
const FILLER = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'pour', 'en', 'mission', 'projet', 'projets', 'reporting', 'rapport', 'document', 'fichier', 'copie', 'copy', 'of', 'the', 'and']);

// The names from the top of the Drive down to this folder (cached for one request).
export async function folderNames(id, drive, cache = new Map(), seen = new Set(), requireKnownPath = false) {
  if (!id) return [];
  if (cache.has(id)) return cache.get(id);
  if (seen.has(id) || seen.size >= 100) throw new Error('FOLDER_PATH_CYCLE');
  seen.add(id);
  let meta = null; try { meta = await drive.getMeta(id); } catch { meta = null; }
  if (requireKnownPath && !meta?.name) throw new Error('FOLDER_PATH_UNAVAILABLE');
  const own = meta?.name || 'DRIVE_' + String(id).slice(0, 12);
  const parent = meta?.parents?.[0] || null;
  const out = parent && parent !== id ? [...(await folderNames(parent, drive, cache, seen, requireKnownPath)), own] : [own];
  cache.set(id, out);
  return out;
}
export const pathLength = (folders, name) => PREFIX + folders.join('\\').length + 1 + String(name || '').length;

// The usual audit words, shortened before anything is dropped (2026-11-03: « GRAND_LIVRE_GENERAL_PAGFIC_2023 » became « GRAND_20 »
// in a deep folder — the meaning and the year were cut). Applied in this order, longest first.
// (« _ » is a word character for \b: the words are bounded by the start, the end or an underscore.)
const W = w => new RegExp('(?<=^|_)' + w + '(?=_|$)', 'gi');
const ABBREV = [
  [W('GRAND_LIVRE'), 'GL'], [W('BALANCE_GENERALE'), 'BG'], [W('ETATS?_FINANCIERS?'), 'EF'], [W('RELEVES?_BANCAIRES?'), 'RELEVE'],
  [W('TABLEAU_D_EXECUTION_BUDGETAIRE'), 'TEB'], [W('CONVENTION_DE_FINANCEMENT'), 'CONVENTION'], [W('PROGRAMME_DE_TRAVAIL'), 'PROGRAMME'],
  [W('AUXILIAIRES?'), 'AUX'], [W('GENERALE?S?'), 'GEN'], [W('ANALYTIQUES?'), 'ANA'], [W('FOURNISSEURS?'), 'FRS'], [W('BALANCE'), 'BAL']
];
// A shorter file name that keeps what identifies it: its kind (abbreviated), the first code, years, version, extension — never cut in
// the middle of a word or a year: a name a little too long is better than a name that means nothing.
export function shortenName(name, room) {
  const s = String(name || '');
  if (s.length <= room) return s;
  const ext = (s.match(/\.[A-Za-z0-9]{1,5}$/) || [''])[0], keep = Math.max(8, room - ext.length);
  let base = s.slice(0, s.length - ext.length);
  const joined = base.replace(/\s+[—–-]\s+|\s+/g, '_');
  let abbreviated = joined; for (const [re, to] of ABBREV) abbreviated = abbreviated.replace(re, to);
  if (abbreviated.length <= keep) return abbreviated + ext;
  base = abbreviated;
  const parts = base.split(/_+/).filter(Boolean);
  const KIND = /^(GL|BG|EF|TEB|AUX|GEN|ANA|FRS|BAL|RELEVE)$/;
  const important = (p, i) => i === 0 || KIND.test(p) || /^(v\d+|\d{4}|[A-Z]{1,4}-?\d{1,3})$/i.test(p);
  let out = parts.filter((p, i) => important(p, i) || !FILLER.has(p.toLowerCase()));
  // still too long: drop the longest unimportant parts first
  while (out.join('_').length > keep && out.some((p, i) => !important(p, i))) {
    let at = -1; out.forEach((p, i) => { if (!important(p, i) && (at < 0 || p.length > out[at].length)) at = i; });
    out.splice(at, 1);
  }
  // Only important parts left and still too long: whole parts are kept (no word nor year cut in two).
  const b = out.join('_');
  return (b || base.slice(0, keep)) + ext;
}

// The name to give a file created / renamed in `parentId` so its full path stays under TARGET.
export async function fitName(name, parentId, drive, cache = new Map(), { target = TARGET, requireKnownPath = false } = {}) {
  const original = name;
  name = windowsName(name);
  const folders = await folderNames(parentId, drive, cache, new Set(), requireKnownPath);
  const room = target - (PREFIX + folders.join('\\').length + 1);
  const fitted = room >= 12 ? shortenName(name, room) : shortenName(name, 12);
  return { name: fitted, shortened: fitted !== original, length: pathLength(folders, fitted), too_deep: room < 12 };
}

export function windowsName(name) {
  let value = String(name || 'Fichier').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/g, '');
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)) value = '_' + value;
  return value || 'Fichier';
}

// The mission's files whose path is too long for Excel, each with a proposed shorter name (and the folders too deep to be fixed by the
// file name alone). Nothing renamed here.
export async function longPaths(rootId, drive, { target = TARGET, maxItems = 3000 } = {}) {
  const cache = new Map(), out = [], deep = new Map();
  const base = await folderNames(rootId, drive, cache);
  let rootName = base[base.length - 1];
  const queue = [{ id: rootId, folders: base, chain: [{ id: rootId, name: rootName }] }]; let seen = 0;
  while (queue.length && seen < maxItems) {
    const f = queue.shift();
    let kids = []; try { kids = await drive.listChildren(f.id); } catch { kids = []; }
    for (const k of kids) {
      seen++;
      if (k.mimeType === 'application/vnd.google-apps.folder') {
        const folders = [...f.folders, k.name]; cache.set(k.id, folders);
        queue.push({ id: k.id, folders, chain: [...f.chain, { id: k.id, name: k.name }] });
        continue;
      }
      const len = pathLength(f.folders, k.name);
      if (len <= EXCEL_LIMIT && len <= target) continue;
      const room = target - (PREFIX + f.folders.join('\\').length + 1);
      out.push({ id: k.id, name: k.name, parent: f.id, folder: f.folders.join('/'), length: len, over_excel: len > EXCEL_LIMIT,
        proposed: room >= 12 ? shortenName(k.name, room) : null, folder_too_deep: room < 12 });
      // The folders of the mission that make this path long (long names): a shorter name proposed for each, once.
      for (const c of f.chain) if (c.name.length > 40 && !deep.has(c.id)) deep.set(c.id, { id: c.id, name: c.name, length: len, proposed: shortenName(c.name, 40) });
    }
  }
  return { files: out, folders: [...deep.values()], complete: seen < maxItems };
}
