import { makeOfficeEvent } from './office-events.js';

export const ARCHIVE_REQUIRED_CHECKS = Object.freeze([
  'reportIssued',
  'finalIssuedReportCopyPresent',
  'requiredWpSignoffsComplete',
  'requiredCycleSignoffsComplete',
  'reviewPointsResolvedOrDocumented',
  'pbcFinalized',
  'qualityReviewCompleteWhenRequired',
  'officialArchiveDocumentCompleted',
  'officialArchiveDocumentApproved'
]);

export function archiveReadiness(input = {}) {
  const missing = ARCHIVE_REQUIRED_CHECKS.filter(key => input[key] !== true);
  const blockers = [...(input.blockers || [])].filter(Boolean);

  if (blockers.length) return {
    ready:false, state:'ARCHIVE_BLOCKED', missing, blockers,
    reason:'Documentary or professional blockers remain'
  };

  if (missing.length) return {
    ready:false, state:'CLOSING_INCOMPLETE', missing, blockers:[],
    reason:'Required closing checks are not complete'
  };

  return {
    ready:true, state:'READY_FOR_ARCHIVE', missing:[], blockers:[],
    reason:'Closing controls and official archive document are complete'
  };
}

export function makeReadyForArchiveEvent({
  tenantId, engagementId, actorId, officialArchiveDocumentRef
}) {
  if (!officialArchiveDocumentRef?.file_id) throw new Error('OFFICIAL_ARCHIVE_DOCUMENT_REQUIRED');
  return makeOfficeEvent({
    type:'MISSION_READY_FOR_ARCHIVE', tenantId, engagementId, actorId,
    agentId:'mission-controller', objectType:'engagement', objectId:engagementId,
    sourceReference:officialArchiveDocumentRef.file_id,
    payload:{official_archive_document:{
      file_id:officialArchiveDocumentRef.file_id,
      web_url:officialArchiveDocumentRef.web_url || null,
      version:officialArchiveDocumentRef.version || null,
      hash:officialArchiveDocumentRef.hash || null
    }}
  });
}

export function evaluateArchivePass({
  unclassifiedFiles = 0, orphanFiles = 0, missingFinalVersions = 0,
  signoffProblems = 0, issuedReportMismatch = false, archiveManifestRef = null
} = {}) {
  const blockers = [];
  if (unclassifiedFiles) blockers.push(`${unclassifiedFiles} unclassified file(s)`);
  if (orphanFiles) blockers.push(`${orphanFiles} orphan file(s)`);
  if (missingFinalVersions) blockers.push(`${missingFinalVersions} missing final version(s)`);
  if (signoffProblems) blockers.push(`${signoffProblems} sign-off problem(s)`);
  if (issuedReportMismatch) blockers.push('Issued report does not match the final stored report');

  if (blockers.length) return {state:'ARCHIVE_BLOCKED',blockers,archive_manifest:archiveManifestRef};
  if (!archiveManifestRef?.file_id) return {state:'ARCHIVE_MANIFEST_REQUIRED',blockers:[],archive_manifest:null};
  return {state:'ARCHIVE_PASS_COMPLETE',blockers:[],archive_manifest:archiveManifestRef};
}
