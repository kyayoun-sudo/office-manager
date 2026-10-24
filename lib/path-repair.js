// Les fichiers de la mission qu'Excel ne peut pas ouvrir (chemin > 259 caractères sous Windows) : signalés, nom plus court PROPOSÉ,
// renommés seulement sur « Oui, raccourcis » d'une personne (même fichier, même id ; jamais par-dessus un autre nom : suffixe _2).
// Paul, 2026-10-25 : « impossible d'ouvrir le fichier ; le rangement n'est donc pas intelligent ».
import { rest } from './supabase.js';
import { procedureView } from './procedure-work.js';
import { driveAdapter } from './drive-adapter.js';
import { longPaths } from './path-budget.js';
import { audit } from './audit-log.js';

const q = encodeURIComponent;
const fail = code => Object.assign(new Error(code), { statusCode: 409 });

async function missionRoot(org, missionId, d) {
  const m = (await (d.fetchRows || rest)(`office_missions?org_id=eq.${q(org)}&id=eq.${q(missionId)}&select=id,drive_folder_id&limit=1`))?.[0];
  if (!m?.drive_folder_id) throw fail('MISSION_FOLDER_REQUIRED');
  return m.drive_folder_id;
}

export async function missionLongPaths(org, missionId, code, account, d = {}) {
  await (d.view || procedureView)(org, missionId, code, account, d); // same access as the procedure
  return longPaths(await missionRoot(org, missionId, d), d.drive || driveAdapter);
}

export async function shortenMissionPaths(org, missionId, code, account, body = {}, d = {}) {
  const view = await (d.view || procedureView)(org, missionId, code, account, d);
  if (view.editable === false) throw fail('NOT_PREPARER');
  const wanted = new Set((Array.isArray(body.ids) ? body.ids : []).map(String));
  const found = await longPaths(await missionRoot(org, missionId, d), d.drive || driveAdapter);
  const td = d.tidyDrive || (await import('./tidy-drive.js')).tidyDrive;
  const done = [], skipped = [];
  // Folders first (deepest first), then files: each one renamed to the name proposed by the code, verified.
  const items = [...found.folders.filter(x => x.proposed).sort((a, b) => b.length - a.length).map(x => ({ ...x, kind: 'folder' })), ...found.files.filter(x => x.proposed).map(x => ({ ...x, kind: 'file' }))]
    .filter(x => !wanted.size || wanted.has(x.id));
  for (const x of items) {
    try {
      const meta = await td.getFile(x.id);
      if (!meta || meta.trashed || meta.name !== x.name) { skipped.push({ id: x.id, name: x.name, reason: 'CHANGED_MEANWHILE' }); continue; }
      const parent = meta.parents?.[0];
      let name = x.proposed;
      for (let i = 2; i < 10 && parent && td.nameTaken && await td.nameTaken(parent, name, x.id); i++) name = x.proposed.replace(/(\.[a-z0-9]+)?$/i, '_' + i + '$1');
      await td.move(x.id, null, null, name);
      const back = await td.getFile(x.id);
      if (back?.name !== name) { skipped.push({ id: x.id, name: x.name, reason: 'NOT_VERIFIED' }); continue; }
      done.push({ id: x.id, kind: x.kind, from: x.name, to: name });
    } catch (e) { skipped.push({ id: x.id, name: x.name, reason: String(e.message || e).slice(0, 80) }); }
  }
  if (done.length) await (d.audit || audit)(org, { agent: 'orpailleur', mission_id: missionId, action_type: 'PATHS_SHORTENED', status: 'succeeded', approved_by: account?.email || null,
    decision: done.slice(0, 20).map(x => '« ' + x.from + ' » → « ' + x.to + ' »').join(' ; ').slice(0, 900) }).catch(() => null);
  return { done, skipped };
}
