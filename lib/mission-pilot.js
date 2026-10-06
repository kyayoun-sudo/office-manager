import { createHash } from 'node:crypto';
import { planPbcFromSops } from './pbc-sop-plan.js';
import { planMailEvidence, prepareMailEvidenceFiles } from './pbc-mail-evidence.js';
import { decidePbcEvaluation } from './mission-engine.js';

export function emailApprovalFingerprint(email) {
  return createHash('sha256').update(JSON.stringify(email)).digest('hex');
}

// Offline pilot only. Real sending/storage must use separately authorised connectors.
export async function runMissionPilot(input, sandbox) {
  if (sandbox.simulation !== true) throw new Error('SIMULATION_ONLY');
  if (!input.programmeValidated || !input.mappingReviewed) throw new Error('APPROVAL_REQUIRED');
  const plan = planPbcFromSops(input.pbcInput);
  if (plan.review.length) return { status:'REVIEW_REQUIRED', plan, remoteWrites:0 };
  const initial = plan.requests.filter(r => r.timing === 'INITIAL');
  const referenceMap = new Map(initial.map(r => [r.document, input.references[r.document]]));
  if ([...referenceMap.values()].some(r => !r) || new Set(referenceMap.values()).size !== initial.length) throw new Error('PBC_REFERENCE_REVIEW_REQUIRED');
  await sandbox.initializeMissionOnce(input.missionId);
  const workProducts = await sandbox.prepareWorkingPapers();
  if (workProducts.status !== 'COMPLETED' || !workProducts.work_products?.length || workProducts.work_products.some(w => !['CREATED','ALREADY_EXISTS'].includes(w.status))) return { status:'WORK_PRODUCTS_BLOCKED', workProducts, remoteWrites:0 };
  for (const request of initial) await sandbox.upsertPbc(referenceMap.get(request.document), request);
  const email = { to:input.clientContact, cc:input.cycleOwners, subject:`${input.missionId} - PBC`,
    body: initial.map(r=>`- ${r.document}`).join('\n') };
  if (!email.to || !input.manager || !email.cc.length) throw new Error('CONFIRMED_RECIPIENTS_REQUIRED');
  const fingerprint = emailApprovalFingerprint(email);
  if (input.managerApproval?.approvedBy !== input.manager || input.managerApproval?.fingerprint !== fingerprint) {
    return { status:'MANAGER_APPROVAL_REQUIRED', proposedEmail:email, fingerprint, workProducts, remoteWrites:0 };
  }
  await sandbox.sendEmailOnce(fingerprint, email);
  const processed = [];
  for (const reply of input.replies) {
    const mailPlan = planMailEvidence({ ...reply.analysis, message:reply.message, missionId:input.missionId, knownReferences:[...referenceMap.values()] });
    const files = await prepareMailEvidenceFiles(reply.message, mailPlan, id=>sandbox.getAttachmentBytes(reply.message.messageId,id));
    await sandbox.storeEvidenceOnce(mailPlan.idempotencyKey,files);
    for (const extraction of mailPlan.extractions) {
      const evidence = await sandbox.readSavedEvidence(reply.message.messageId,extraction.attachmentId);
      const proposed = reply.evaluations[extraction.reference];
      const evaluation = decidePbcEvaluation({ ...proposed, evidenceMeta:evidence.meta, read:evidence.read });
      await sandbox.updatePbcStatus(extraction.reference,evaluation);
      processed.push({reference:extraction.reference,...evaluation});
    }
  }
  return {status:'SIMULATION_COMPLETED', workProducts, processed, dashboard:await sandbox.dashboard(), remoteWrites:0,
    limitations:['No live mailbox or Drive writes','Document interpretation supplied as reviewed test inputs','Does not certify all controls of a mission']};
}
