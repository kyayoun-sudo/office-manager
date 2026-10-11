// THE AGENTS' OWN FILES — never treated as firm documents (Paul, 2026-10-11: « arrêter, après chaque passage, de
// demander s'il doit mettre l'audit log et la mémoire »). The Orpailleur used to see its own memory, its journal and
// the audit log as loose documents (e.g. in a folder created after the Drive map, « (dossier hors carte) », or a home
// folder written with underscores) and asked where to file them at every pass. One rule, used by the Orpailleur and by
// the purge: by name, by path, or because the file sits directly in the agents' home / memory folder.

// Files the agents write (memory, journal, audit log, Shadow, tender pipeline) and their folders.
export const AGENT_FILE_NAME = /^(OFFICE_MANAGER_[\w.-]+|SHADOW_LAB\.json|ORPAILLEUR_[\w.-]+|[A-Z_]+_MEMORY\.json|PIPELINE_APPELS_OFFRES\.xlsx|AUDIT_LOG(\.\w+)?|MEMORY|AGENTS|CLIENTS)$/;
// Folders that belong to the agents (their home « … AI MANAGER », its memory, audit logs and reports).
// The drop folder (A_RANGER) is NOT one of them: what people drop there is to be filed.
const AGENT_SEGMENT = /^(00_OFFICE_MANAGER\w*|.*\bAI[ _]+MANAGER\b.*|.*\bMANAGER[ _]+AI\b.*|.*[ _]AI[ _]OFFICE[ _]MANAGER.*|MEMORY|atelier m[ée]moire.*|AUDIT LOGS?|EVALUATION_DES_RISQUES|PREPARATION_DES_MISSIONS|ENHANCED_AUDITOR|SUIVI_DES_SOUMISSIONS|CAPACITES_DU_CABINET|ANALYSES_DES_DEPOTS|ENTRAINEMENT.*)$/i;

export function isAgentPath(path) {
  return String(path || '').split('/').slice(0, -1).some(seg => AGENT_SEGMENT.test(seg.trim()));
}

// f: { name, path, parents }; homeIds: ids of the agents' home and memory folders (when known).
export function isAgentOwnFile(f, homeIds = []) {
  if (!f) return false;
  if (AGENT_FILE_NAME.test(String(f.name || ''))) return true;
  if (isAgentPath(f.path)) return true;
  const ids = new Set((homeIds || []).filter(Boolean));
  return (f.parents || []).some(p => ids.has(p));
}
