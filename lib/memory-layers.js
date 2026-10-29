// Firm Manager memory architecture — three distinct scopes.
// 1) mission: client/engagement operational memory, stored with the mission;
// 2) firm: cabinet-local learning/configuration, never shared automatically;
// 3) central: EYNOWA Lab collective learning, generalized and explicitly approved only.

export const MEMORY_LAYER = Object.freeze({
  MISSION: 'mission',
  FIRM: 'firm',
  CENTRAL: 'central'
});

export const MEMORY_RULES = Object.freeze({
  [MEMORY_LAYER.MISSION]: {
    may_contain_client_material: true,
    may_leave_firm: false,
    purpose: 'facts, documents, decisions, open questions and progress for one mission'
  },
  [MEMORY_LAYER.FIRM]: {
    may_contain_client_material: false,
    may_leave_firm: false,
    purpose: 'firm rules, agent lessons, preferences, methods and validated local learning'
  },
  [MEMORY_LAYER.CENTRAL]: {
    may_contain_client_material: false,
    may_leave_firm: true,
    purpose: 'generalized EYNOWA learning explicitly approved for collective use'
  }
});

const forbiddenCentralKeys = new Set([
  'mission_id', 'client_id', 'client', 'file_id', 'document_id', 'drive_id',
  'folder_id', 'webviewlink', 'url', 'path', 'filename', 'file_name', 'content',
  'excerpt', 'quote', 'evidence', 'attachment', 'attachments', 'source_document'
]);

const looksLikeEmail = value => /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(String(value || ''));
const looksLikeUrl = value => /https?:\/\//i.test(String(value || ''));

function inspectCentralValue(value, path = '$') {
  if (value == null) return;
  if (typeof value === 'string') {
    if (looksLikeEmail(value)) throw Object.assign(new Error('CENTRAL_MEMORY_EMAIL_FORBIDDEN'), { path });
    if (looksLikeUrl(value)) throw Object.assign(new Error('CENTRAL_MEMORY_URL_FORBIDDEN'), { path });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectCentralValue(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenCentralKeys.has(String(key).toLowerCase())) {
      throw Object.assign(new Error('CENTRAL_MEMORY_RAW_FIELD_FORBIDDEN'), { path: `${path}.${key}` });
    }
    inspectCentralValue(child, `${path}.${key}`);
  }
}

export function assertMemoryLayer(layer) {
  if (!Object.values(MEMORY_LAYER).includes(layer)) {
    throw new Error('UNKNOWN_MEMORY_LAYER');
  }
  return layer;
}

// Builds the ONLY shape that may later be sent from a firm to EYNOWA Lab.
// It intentionally does not reuse Shadow's evidence/situation/source fields.
// A separate central-share approval is required even if the firm already
// approved the lesson for its own local agents.
export function prepareCentralLesson({
  lesson,
  generalizedRule,
  approvedBy,
  approvalId,
  approvedAt = new Date().toISOString()
} = {}) {
  if (!lesson || typeof lesson !== 'object') throw new Error('LESSON_REQUIRED');
  if (lesson.status !== 'active') throw new Error('LESSON_NOT_ACTIVE');
  if (!lesson.validated_by && !(lesson.history || []).some(h => h?.status === 'active' && /approuv|valid/i.test(String(h?.why || '')))) {
    throw new Error('LESSON_NOT_VALIDATED');
  }
  if (lesson.mission_id) throw new Error('MISSION_SCOPED_LESSON_NOT_SHAREABLE');
  if (!approvedBy || !approvalId) throw new Error('CENTRAL_SHARE_APPROVAL_REQUIRED');

  const rule = String(generalizedRule || '').trim();
  if (rule.length < 10) throw new Error('GENERALIZED_RULE_REQUIRED');
  if (rule.length > 800) throw new Error('GENERALIZED_RULE_TOO_LONG');
  if (looksLikeEmail(rule) || looksLikeUrl(rule)) throw new Error('GENERALIZED_RULE_NOT_SANITIZED');

  const payload = {
    schema: 'eynowa.central-lesson/1',
    layer: MEMORY_LAYER.CENTRAL,
    agent: String(lesson.agent || '').slice(0, 80),
    category: String(lesson.category || 'general').slice(0, 100),
    type: String(lesson.type || 'experience_lesson').slice(0, 60),
    rule: rule.slice(0, 800),
    confidence: ['haute', 'moyenne', 'basse'].includes(lesson.confidence) ? lesson.confidence : 'basse',
    occurrences: Math.max(1, Number(lesson.occurrences) || 1),
    local_lesson_id: String(lesson.id || '').slice(0, 100) || null,
    sharing: {
      approved_by: String(approvedBy).slice(0, 160),
      approval_id: String(approvalId).slice(0, 160),
      approved_at: approvedAt
    }
  };

  inspectCentralValue(payload);
  return payload;
}

export function assertCentralMemoryPayload(payload) {
  if (!payload || payload.layer !== MEMORY_LAYER.CENTRAL) throw new Error('CENTRAL_MEMORY_LAYER_REQUIRED');
  if (payload.schema !== 'eynowa.central-lesson/1') throw new Error('CENTRAL_MEMORY_SCHEMA_INVALID');
  if (!payload.sharing?.approved_by || !payload.sharing?.approval_id) throw new Error('CENTRAL_SHARE_APPROVAL_REQUIRED');
  inspectCentralValue(payload);
  return true;
}

// Deliberately explicit: mission/client material can never be promoted by a
// generic "copy memory" operation. Callers must distil a new central lesson.
export function canCopyBetweenMemoryLayers(from, to) {
  assertMemoryLayer(from);
  assertMemoryLayer(to);
  if (from === to) return true;
  if (to === MEMORY_LAYER.CENTRAL) return false;
  return from === MEMORY_LAYER.MISSION && to === MEMORY_LAYER.FIRM ? false : true;
}
