// Semantic mission-source enrichment for the Working File.
//
// A filename, PBC label or folder is only a hint. The AI must receive what the mission
// already knows about the document (summary, facts, classification, PBC link, prior uses)
// before deciding whether it needs to read the bytes again.

const cut = (value, limit = 1200) => value == null ? null : String(value).slice(0, limit);
const compactArray = (value, limit = 12) => Array.isArray(value) ? value.slice(0, limit) : [];
const genericRole = value => /^(piece_recue|piece_pbc|preuve|autre|document|mission)$/i.test(String(value || '').trim());

function compactObject(value, limit = 3000) {
  if (value == null) return null;
  if (typeof value !== 'object') return cut(value, limit);
  try {
    const text = JSON.stringify(value);
    return text.length <= limit ? value : { summary: text.slice(0, limit), truncated: true };
  } catch {
    return null;
  }
}

export function semanticSourceLabel(source = {}) {
  const filename = cut(source.name, 120);
  const role = (!genericRole(source.pbc_role) && source.pbc_role) || (!genericRole(source.role) && source.role) || null;
  const summary = cut(source.summary, 110);
  const meaning = cut(source.title, 120) || cut(role, 120) || summary || cut(source.document, 120) || 'Pièce de mission';
  if (!filename || String(filename).toLowerCase() === String(meaning).toLowerCase()) return meaning;
  return `${meaning} — ${filename}`;
}

export function semanticProjection(doc = {}) {
  return {
    file_id: doc.id || doc.file_id || null,
    // Name/location remain useful hints, never semantic proof.
    name: doc.name || null,
    path: doc.path || doc.location || null,
    document: doc.type || doc.role || null,
    role: doc.role || null,
    title: doc.title || null,
    period: doc.period || null,
    summary: cut(doc.summary, 1800),
    key_facts: compactArray(doc.key_facts, 12).map(x => compactObject(x, 800)),
    figures: compactArray(doc.figures, 12).map(x => compactObject(x, 800)),
    classification_quote: cut(doc.classification_quote, 1200),
    pbc_ref: doc.pbc_ref || null,
    pbc_role: doc.pbc_role || null,
    pbc_status: doc.pbc_status || null,
    read_status: doc.read_status || null,
    profile: compactObject(doc.profile, 2000),
    audit_read: compactObject(doc.audit_read, 2500),
    uses: compactArray(doc.uses, 12).map(x => compactObject(x, 600)),
    history: compactArray(doc.history, 8).map(x => compactObject(x, 600)),
    confidence: doc.confidence ?? null,
    semantic_memory: true
  };
}

export async function enrichMissionSources(baseSources = [], missionId, d = {}) {
  const byId = new Map();
  for (const source of baseSources || []) {
    if (!source?.file_id) continue;
    byId.set(String(source.file_id), { ...source, file_id: String(source.file_id) });
  }

  const readMissionDocuments = d.missionDocuments || (async id => {
    const mod = await import('./mission-files.js');
    return mod.missionDocuments(id, d);
  });

  let remembered = [];
  try {
    remembered = await readMissionDocuments(missionId) || [];
  } catch (error) {
    if (d.strictSources) throw Object.assign(new Error('MISSION_SEMANTIC_MEMORY_UNAVAILABLE'), { statusCode: 503, cause: error });
    return [...byId.values()];
  }

  for (const doc of remembered) {
    const semantic = semanticProjection(doc);
    if (!semantic.file_id) continue;
    const id = String(semantic.file_id);
    const existing = byId.get(id) || {};
    // Semantic mission memory enriches a PBC/Drive catalogue entry. It must never be
    // discarded merely because the same file_id was already encountered in the PBC list.
    byId.set(id, {
      ...existing,
      ...semantic,
      file_id: id,
      // Preserve the actual current filename from the inventory when available.
      name: existing.name || semantic.name,
      // Preserve current request status while keeping semantic PBC status separately.
      status: existing.status || 'mission'
    });
  }

  return [...byId.values()];
}
