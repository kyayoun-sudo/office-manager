import { createHash } from 'node:crypto';
// Only professional content, not audit timestamps or synchronisation metadata.
export function workContentHash(work) {
  return createHash('sha256').update(JSON.stringify({ population: work.population || {}, sample: work.sample || {}, items: work.items || [], conclusion: work.conclusion || null, walkthrough: (work.walkthrough || []).filter(r=>r.kind!=='sop-reading-job') })).digest('hex');
}
export function requireEditableWork(work) {
  if (['submitted', 'reviewed'].includes(work.status)) throw Object.assign(new Error('IN_REVIEW_OR_REVIEWED'), { statusCode: 409 });
}
