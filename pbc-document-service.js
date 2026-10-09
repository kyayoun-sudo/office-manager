import { createHash } from 'node:crypto';
import { evaluatePbcCompleteness } from './pbc-state.js';
import { makeOfficeEvent } from './office-events.js';

const safeName = value => String(value ?? '').normalize('NFKD')
  .replace(/[^\p{L}\p{N}._ -]+/gu, '_').replace(/\s+/g, ' ').trim().slice(0,180);

export const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

export function proposedPbcFilename({pbcId, componentId, documentNature, period, originalName}) {
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(String(originalName || ''))?.[0] || '';
  const base = [pbcId,componentId,documentNature,period].filter(Boolean).map(safeName).join('_');
  return (base || safeName(originalName) || 'PBC_DOCUMENT') + ext;
}

export async function fileInboundPbcDocument({
  tenantId, engagementId, pbcId, sourceType, sourceId,
  messageId = null, threadId = null, attachment, classification,
  expectedComponents = null, alreadyReceivedComponentIds = [],
  populationConfirmed = false
}, deps) {
  if (!tenantId) throw new Error('TENANT_ID_REQUIRED');
  if (!engagementId) throw new Error('ENGAGEMENT_ID_REQUIRED');
  if (!pbcId) throw new Error('PBC_ID_REQUIRED');
  if (!attachment?.buffer) throw new Error('ATTACHMENT_BUFFER_REQUIRED');
  if (!classification?.documentNature) throw new Error('DOCUMENT_CLASSIFICATION_REQUIRED');

  const digest = sha256(attachment.buffer);
  const duplicate = deps.findDuplicate
    ? await deps.findDuplicate({engagementId, sha256:digest, originalSourceId:sourceId})
    : null;

  if (duplicate) return {
    status:'ALREADY_FILED', document:duplicate,
    checklist:evaluatePbcCompleteness({
      expectedComponents,
      receivedComponentIds:[...alreadyReceivedComponentIds, classification.componentId].filter(Boolean),
      populationConfirmed
    })
  };

  const destination = await deps.resolveDestination({tenantId,engagementId,pbcId,classification});
  if (!destination?.folderId) return {
    status:'DESTINATION_REVIEW_REQUIRED',
    reason:'No approved engagement documentation destination could be resolved',
    suggested:{pbc_id:pbcId,component_id:classification.componentId || null,document_nature:classification.documentNature}
  };

  const finalName = proposedPbcFilename({
    pbcId, componentId:classification.componentId,
    documentNature:classification.documentNature, period:classification.period,
    originalName:attachment.name
  });

  const stored = await deps.createFile({
    name:finalName, parentId:destination.folderId, buffer:attachment.buffer,
    mimeType:attachment.mimeType || 'application/octet-stream'
  });

  const documentRef = {
    provider:destination.provider || 'drive', file_id:stored.id,
    web_url:stored.webViewLink || null, name:stored.name || finalName,
    folder_id:destination.folderId,
    folder_role:destination.folderRole || 'ENGAGEMENT_DOCUMENTATION',
    modified_time:stored.modifiedTime || null, sha256:digest,
    source_type:sourceType, source_id:sourceId,
    gmail_message_id:messageId, gmail_thread_id:threadId,
    pbc_id:pbcId, component_id:classification.componentId || null
  };

  const checklist = evaluatePbcCompleteness({
    expectedComponents,
    receivedComponentIds:[...alreadyReceivedComponentIds, classification.componentId].filter(Boolean),
    populationConfirmed
  });

  const event = makeOfficeEvent({
    type:'PBC_DOCUMENT_RECEIVED', tenantId, engagementId,
    agentId:sourceType === 'EMAIL' ? 'mission-controller' : 'orpailleur',
    objectType:'pbc_document', objectId:stored.id,
    sourceReference:`${sourceType}:${sourceId}`,
    payload:{
      pbc_id:pbcId, component_id:classification.componentId || null,
      document_ref:{file_id:documentRef.file_id,web_url:documentRef.web_url,sha256:documentRef.sha256},
      pbc_state:checklist.state
    }
  });

  return {status:'FILED', document:documentRef, checklist, event};
}
