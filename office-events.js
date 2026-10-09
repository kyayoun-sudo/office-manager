import { randomUUID, createHash } from 'node:crypto';

export const OFFICE_EVENT_TYPES = Object.freeze([
  'TDR_UPLOADED','TEAM_PROPOSED','INDEPENDENCE_COMPLETED','ENGAGEMENT_APPROVED',
  'ENGAGEMENT_LETTER_SENT','MISSION_CREATED','PRELIMINARY_DOCUMENT_RECEIVED',
  'KICKOFF_COMPLETED','RISK_ASSESSMENT_VALIDATED','WORK_PROGRAMME_VALIDATED',
  'PBC_REQUEST_SENT','PBC_DOCUMENT_RECEIVED','PBC_STATE_CHANGED','WP_CHANGED',
  'WP_SUBMITTED','REVIEW_POINT_CREATED','REVIEW_POINT_CLEARED','WP_SIGNED_OFF',
  'CYCLE_SIGNED_OFF','MISSION_READY_FOR_PARTNER_REVIEW','QUALITY_REVIEW_SIGNED_OFF',
  'PARTNER_OPINION_APPROVED','REPORT_ISSUED','MISSION_READY_FOR_ARCHIVE',
  'ARCHIVE_BLOCKED','MISSION_ARCHIVED','POST_ARCHIVE_CHANGE_DETECTED'
]);

const MAX_SMALL_PAYLOAD_BYTES = 8 * 1024;
const size = v => Buffer.byteLength(JSON.stringify(v ?? {}), 'utf8');

export function stableIdempotencyKey(parts) {
  const normalized = (Array.isArray(parts) ? parts : [parts])
    .map(v => String(v ?? '').trim()).join('|');
  return createHash('sha256').update(normalized).digest('hex');
}

export function makeOfficeEvent({
  type, tenantId, engagementId = null, actorId = null, agentId = null,
  objectType = null, objectId = null, sourceReference = null,
  idempotencyKey = null, payload = {}, occurredAt = new Date().toISOString(),
  eventId = randomUUID()
}) {
  if (!OFFICE_EVENT_TYPES.includes(type)) throw new Error(`UNKNOWN_EVENT_TYPE: ${type}`);
  if (!tenantId) throw new Error('TENANT_ID_REQUIRED');
  if (size(payload) > MAX_SMALL_PAYLOAD_BYTES) {
    throw new Error('EVENT_PAYLOAD_TOO_LARGE: store documents externally and pass references only');
  }
  return Object.freeze({
    event_id: eventId, tenant_id: String(tenantId),
    engagement_id: engagementId ? String(engagementId) : null,
    actor_id: actorId ? String(actorId) : null,
    agent_id: agentId ? String(agentId) : null,
    event_type: type, object_type: objectType ? String(objectType) : null,
    object_id: objectId ? String(objectId) : null,
    source_reference: sourceReference ? String(sourceReference) : null,
    occurred_at: occurredAt,
    idempotency_key: idempotencyKey || stableIdempotencyKey([
      tenantId, engagementId, type, objectType, objectId, sourceReference
    ]),
    small_payload: payload
  });
}

export function consumersForEvent(type) {
  const routes = {
    TDR_UPLOADED: ['firm-manager'],
    ENGAGEMENT_LETTER_SENT: ['mission-controller'],
    MISSION_CREATED: ['mission-controller','orpailleur'],
    PRELIMINARY_DOCUMENT_RECEIVED: ['mission-controller','orpailleur'],
    WORK_PROGRAMME_VALIDATED: ['mission-controller'],
    PBC_REQUEST_SENT: ['mission-controller'],
    PBC_DOCUMENT_RECEIVED: ['mission-controller','orpailleur'],
    PBC_STATE_CHANGED: ['mission-controller'],
    WP_CHANGED: ['enhanced-auditor'],
    WP_SUBMITTED: ['enhanced-auditor','mission-controller'],
    REVIEW_POINT_CREATED: ['mission-controller','firm-manager'],
    REVIEW_POINT_CLEARED: ['mission-controller'],
    WP_SIGNED_OFF: ['mission-controller'],
    CYCLE_SIGNED_OFF: ['mission-controller','firm-manager'],
    MISSION_READY_FOR_PARTNER_REVIEW: ['firm-manager'],
    QUALITY_REVIEW_SIGNED_OFF: ['firm-manager','mission-controller'],
    PARTNER_OPINION_APPROVED: ['mission-controller'],
    REPORT_ISSUED: ['mission-controller','sika'],
    MISSION_READY_FOR_ARCHIVE: ['orpailleur'],
    ARCHIVE_BLOCKED: ['mission-controller','firm-manager'],
    MISSION_ARCHIVED: ['firm-manager','sika','shadow'],
    POST_ARCHIVE_CHANGE_DETECTED: ['firm-manager','mission-controller','orpailleur']
  };
  return Object.freeze([...(routes[type] || [])]);
}
