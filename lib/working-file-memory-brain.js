// Memory-first adapter for the Living Working File.
//
// Mission documents may already have a versioned `audit_read` receipt produced by
// Enhanced Auditor. When that receipt still matches the current Drive revision, the
// Working File must reuse it instead of forcing the same document through another AI
// reading loop. A cached receipt is enough to SELECT a document for document-review.
// Spreadsheet/calculation operations still require an actual sheet/range read.

import { directStep as domainDirectStep, STEP_BRAIN_KIND } from './step-brain.js';
import { revisionOf } from './audit-evidence-brain.js';

const MEMORY_SHEET = '__mission_memory__';
const REUSABLE_STATUSES = new Set(['EXCERPTS_READ', 'VISUAL_READ_REVIEW_REQUIRED']);

function reusableReceipt(doc) {
  const receipt = doc?.audit_read;
  return receipt && receipt.revision && REUSABLE_STATUSES.has(receipt.status) ? receipt : null;
}

function targetJob(view, body, step) {
  const jobs = view?.work?.walkthrough || [];
  if (body?.brain_job) return jobs.find(x => x?.kind === STEP_BRAIN_KIND && x.id === body.brain_job) || null;
  return [...jobs].reverse().find(x => x?.kind === STEP_BRAIN_KIND && x.step_n === step?.n && !x.plan && !x.error) || null;
}

/**
 * Reuse mission-memory readings after a lightweight Drive revision check.
 *
 * This intentionally does not pretend that a cached summary equals an exhaustive raw
 * spreadsheet read. The sentinel sheet prevents cached knowledge from satisfying a
 * source_sheet requirement. Once step-brain reads a real sheet, its normal recordRead()
 * adds that real sheet and the calculation/reconciliation guard can pass.
 */
export async function directStepWithMissionMemory(args, d = {}) {
  const { orgId, missionId, view, step, sources = [], body = {} } = args;
  const original = targetJob(view, body, step);
  if (!original) return domainDirectStep(args, d);

  const drive = d.drive || (await import('./drive-adapter.js')).driveAdapter;
  const docs = await (d.missionDocuments || (await import('./mission-files.js')).missionDocuments)(missionId, { ...d, orgId }).catch(() => []);
  const sourceIds = new Set(sources.map(x => x?.file_id).filter(Boolean));
  const memoryDocs = (docs || []).filter(doc => sourceIds.has(doc?.id) && reusableReceipt(doc));
  if (!memoryDocs.length) return domainDirectStep(args, d);

  const nextView = structuredClone(view);
  const job = targetJob(nextView, body, step);
  if (!job) return domainDirectStep(args, d);
  job.reads = Array.isArray(job.reads) ? job.reads : [];

  let reused = 0;
  for (const doc of memoryDocs) {
    const receipt = reusableReceipt(doc);
    let meta;
    try { meta = await drive.getMeta(doc.id); } catch { continue; }
    const currentRevision = revisionOf(meta);
    if (!meta || meta.trashed || !currentRevision || currentRevision !== receipt.revision) continue;

    const existing = job.reads.find(r => r.file_id === doc.id);
    // Keep a genuine current-job read when it already exists.
    if (existing?.revision === currentRevision && (existing.sheets || []).some(s => s !== MEMORY_SHEET)) continue;

    job.reads = [
      ...job.reads.filter(r => r.file_id !== doc.id),
      {
        file_id: doc.id,
        revision: currentRevision,
        sheets: [MEMORY_SHEET],
        cached: true,
        source: 'mission_memory',
        memory_status: receipt.status
      }
    ];
    reused += 1;
  }

  if (reused) {
    const log = d.brainLog || ((event, fields) => console.info('[step-brain]', event, JSON.stringify(fields)));
    log('reuse-mission-memory', { job: job.id, step: step?.n, documents: reused });
  }

  return domainDirectStep({ ...args, view: nextView }, d);
}

export { MEMORY_SHEET };
