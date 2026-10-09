import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveReadiness, evaluateArchivePass } from '../lib/archive-workflow.js';

test('official archive document is mandatory before archive handoff', () => {
  const r = archiveReadiness({
    reportIssued:true,finalIssuedReportCopyPresent:true,
    requiredWpSignoffsComplete:true,requiredCycleSignoffsComplete:true,
    reviewPointsResolvedOrDocumented:true,pbcFinalized:true,
    qualityReviewCompleteWhenRequired:true,
    officialArchiveDocumentCompleted:false,officialArchiveDocumentApproved:false
  });
  assert.equal(r.ready,false);
  assert.ok(r.missing.includes('officialArchiveDocumentCompleted'));
});

test('Orpailleur archive pass blocks on documentary anomalies', () => {
  const r = evaluateArchivePass({unclassifiedFiles:2,issuedReportMismatch:true});
  assert.equal(r.state,'ARCHIVE_BLOCKED');
  assert.equal(r.blockers.length,2);
});

test('archive pass needs a manifest when clean', () => {
  const r = evaluateArchivePass({});
  assert.equal(r.state,'ARCHIVE_MANIFEST_REQUIRED');
});
