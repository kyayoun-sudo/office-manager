import { MISSION_DOCUMENT_MAX_CHARS } from './document-reading.js';
import { contentFingerprint, programmeNameLooksDraft } from './mission-engine.js';

// Read-only preparation. A source packet is never an approval or export permit.
export async function readDriveBudgetSources(input, io) {
  const issues = [];
  const metadata = await Promise.all([
    io.metadata(io.masterId), io.metadata(input.programme_file_id),
    ...(input.template_file_id ? [io.metadata(input.template_file_id)] : [])
  ]);
  if (metadata.some(m => m.trashed || !m.id || m.driveId !== io.driveId)) {
    return { status: 'SOURCE_SCOPE_REQUIRED', written: false, issues: ['Sources must belong to the configured Shared Drive and must not be trashed.'] };
  }
  const [master, programme, template] = metadata;
  const ranges = ['Collaborateurs!A1:T1000', 'Missions!A1:W2000', 'Planning!A1:P2000'];
  const [staffRows, missionRows, planningRows, programmeRead, templateRead] = await Promise.all([
    ...ranges.map(range => io.values(master.id, range)),
    io.read(programme.id, { maxChars: MISSION_DOCUMENT_MAX_CHARS }),
    template ? io.read(template.id, { maxChars: MISSION_DOCUMENT_MAX_CHARS }) : null
  ]);
  const table = (rows, fields, limit) => {
    if (rows.length >= limit) issues.push('REGISTER_RANGE_LIMIT_REACHED');
    const header = rows[0] || [];
    if (fields.some(field => !header.includes(field))) issues.push('REGISTER_HEADERS_REQUIRED');
    return rows.slice(1).filter(row => row.some(v => String(v ?? '').trim()))
      .map(row => Object.fromEntries(fields.map(field => [field, row[header.indexOf(field)] ?? ''])));
  };
  // Only operational identity fields; do not return CVs, phone numbers or questionnaire data.
  const staff = table(staffRows, ['ID', 'Nom', 'Prenom', 'Fonction', 'Actif'], 1000);
  const missions = table(missionRows, ['ID_Mission', 'Client', 'Objet', 'Equipe', 'URL_Planification_Validee'], 2000);
  const planning = table(planningRows, ['ID_Affectation', 'Collaborateur', 'Mission', 'Date_Debut', 'Date_Fin', 'Charge_Pct', 'Role_Mission', 'Cycle_Workstream', 'Reviewer', 'Statut', 'Source_Plan_File_ID', 'Source_Plan_Modified_At'], 2000);
  const matches = missions.filter(m => m.ID_Mission === input.mission_key);
  const mission = matches.length === 1 ? matches[0] : null;
  if (!mission) issues.push(matches.length ? 'MISSION_ID_AMBIGUOUS' : 'MISSION_NOT_IN_REGISTER');
  const assignments = planning.filter(p => p.Mission === input.mission_key);
  if (!assignments.length) issues.push('NO_REGISTER_ASSIGNMENTS');
  if (assignments.some(p => p.Source_Plan_File_ID !== programme.id || !p.Source_Plan_Modified_At || p.Source_Plan_Modified_At !== programme.modifiedTime)) issues.push('ASSIGNMENT_PROVENANCE_REVIEW_REQUIRED');
  if (programmeNameLooksDraft(programme.name)) issues.push('PROGRAMME_DRAFT');
  const packet = (meta, read, prefix) => {
    if (!read?.supported || !String(read.text || '').trim()) issues.push(`${prefix}_UNREADABLE`);
    if (read?.truncated) issues.push(`${prefix}_TRUNCATED`);
    if (!meta.modifiedTime || read?.file?.id !== meta.id || read?.file?.modifiedTime !== meta.modifiedTime) issues.push(`${prefix}_VERSION_REVIEW_REQUIRED`);
    return {
      file: { id: meta.id, name: meta.name, modifiedTime: meta.modifiedTime, mimeType: meta.mimeType },
      text: read?.supported ? String(read.text || '') : '',
      truncated: Boolean(read?.truncated),
      content_fingerprint: read?.supported && !read.truncated ? contentFingerprint(meta, read.text) : null
    };
  };
  const programmeSource = packet(programme, programmeRead, 'PROGRAMME');
  const templateSource = template ? packet(template, templateRead, 'TEMPLATE') : null;
  if (!template) issues.push('TEMPLATE_NOT_SELECTED');
  const currentMetadata = await Promise.all(metadata.map(m => io.metadata(m.id)));
  if (currentMetadata.some((m, index) => m.trashed || m.driveId !== io.driveId || !m.modifiedTime || m.modifiedTime !== metadata[index].modifiedTime)) issues.push('SOURCES_CHANGED_DURING_READ');
  return {
    status: 'REVIEW_REQUIRED', written: false, ready_to_export: false,
    register_file_id: master.id, mission, staff_directory: staff, assignments,
    programme: programmeSource, template: templateSource, issues: [...new Set(issues)],
    checks_remaining: ['Verify programme approval and mission/client/period from source evidence.', 'Extract explicit hours and named responsibilities from the programme; reconcile staff identities without guessing.', 'Verify approved rates and their source; template proposals are not approved rates.', 'Verify the canonical template and destination through the reviewed mapping before any copy or write.'],
    notice: 'Drive is the business source. No new Supabase review tables are required for this read. Allocation percentages are not hours. This packet does not confirm assignments, approval, rates, mapping or formula results.'
  };
}
