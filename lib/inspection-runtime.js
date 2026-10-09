import { createHash, randomUUID } from 'node:crypto';
import { rest } from './supabase.js';
import { inspectionReceipt, READER_VERSION } from './document-inspector.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class ReaderCache {
  constructor({ maxBytes = 4000000, ttl = 60000, now = Date.now } = {}) { this.entries = new Map(); this.maxBytes = maxBytes; this.ttl = ttl; this.now = now; this.bytes = 0; }
  key(file, scope, options = {}) {
    if (!scope?.organization_id || !scope?.memory_folder_id || (!file.modifiedTime && !file.version)) return null;
    return hash([scope.organization_id, scope.memory_folder_id, scope.drive_id, scope.connection_id, scope.user_id, file.id, file.modifiedTime, file.version, file.md5Checksum, file.size, READER_VERSION, options]);
  }
  get(key) { const entry = this.entries.get(key); if (!entry) return null; if (entry.expires <= this.now()) { this.remove(key); return null; } return structuredClone(entry.result); }
  remove(key) { const entry = this.entries.get(key); if (entry) this.bytes -= entry.bytes; this.entries.delete(key); }
  put(key, result) {
    if (!key || result.status !== 'READ_SUCCESS') return;
    const bytes = Buffer.byteLength(JSON.stringify(result)); if (bytes > this.maxBytes) return;
    this.remove(key); while (this.bytes + bytes > this.maxBytes || this.entries.size >= 20) this.remove(this.entries.keys().next().value);
    this.entries.set(key, { bytes, expires: this.now() + this.ttl, result: structuredClone(result) }); this.bytes += bytes;
  }
}
export const transientReaderCache = new ReaderCache();
export function inspectionNeedsRefresh(receipt, file, { force = false } = {}) {
  if (force || !receipt || receipt.reader_version !== READER_VERSION) return true;
  if (file.modifiedTime && receipt.source_revision?.modified_time !== file.modifiedTime) return true;
  if (file.version && receipt.source_revision?.provider_version !== file.version) return true;
  return ['PARTIAL', 'ERROR_RETRYABLE', 'ERROR_FINAL', 'UNREADABLE'].includes(receipt.status);
}

export function beginInspectionTask(state, file, { now = Date.now(), force = false } = {}) {
  state.inspection_queue ||= {};
  const token = hash([file.modifiedTime || null, file.version || null, file.md5Checksum || null, READER_VERSION]);
  const previous = state.inspection_queue[file.id];
  if (!force && previous?.version_token === token && previous.retry_at && Date.parse(previous.retry_at) > now) return { ready: false, task: previous };
  const attempts = previous?.version_token === token ? (previous.attempts || 0) + 1 : 1;
  const task = { file_id: file.id, version_token: token, reader_version: READER_VERSION, status: 'PROCESSING', attempts, reinspection_required: inspectionNeedsRefresh(state.inspections?.[file.id], file, { force }), priority: file.priority || 'normal', started_at: new Date(now).toISOString() };
  state.inspection_queue[file.id] = task; return { ready: true, task };
}
export function completeInspectionTask(state, result, now = Date.now()) {
  const task = state.inspection_queue?.[result.file_id]; if (!task) throw new Error('INSPECTION_TASK_MISSING');
  task.status = result.status; task.completed_at = new Date(now).toISOString(); task.error_code = result.error_code;
  // Retry temporary errors and budget-deferred OCR with bounded backoff. Partial content is kept as partial.
  if (result.status === 'ERROR_RETRYABLE' || result.quality.pending_ocr_pages?.length || (['PARTIAL', 'UNREADABLE'].includes(result.status) && task.attempts < 3)) task.retry_at = new Date(now + Math.min(3600000, 30000 * 2 ** Math.min(task.attempts, 6))).toISOString();
  else delete task.retry_at;
  state.inspections ||= {}; state.inspections[result.file_id] = inspectionReceipt(result);
  state.understanding_queue ||= {};
  if (['READ_SUCCESS', 'PARTIAL'].includes(result.status)) state.understanding_queue[result.file_id] = { file_id: result.file_id, status: 'PENDING', reader_version: READER_VERSION, extraction_fingerprint: result.extraction_fingerprint };
  else delete state.understanding_queue[result.file_id];
  return task;
}

// One atomic lease per Drive memory serializes the existing orchestration and its read queue.
export async function acquireReaderLease(orgId, scope, { fetchRows = rest, ttl = 600 } = {}) {
  const p_scope = hash(scope), p_token = randomUUID(), body = { p_org_id: orgId, p_scope, p_token, p_ttl: ttl };
  const call = name => fetchRows('rpc/' + name, { method: 'POST', body: JSON.stringify(body) });
  if (await call('office_claim_reader_lease') !== true) return null;
  return { async assertOwner() { if (await call('office_renew_reader_lease') !== true) throw new Error('READER_LEASE_LOST'); }, async release() { await call('office_release_reader_lease'); } };
}
// Dependency-injected offline adapters only; production uses the database lease above.
const localLeases = new Set();
export function acquireOfflineReaderLease(scope) { const key = hash(scope), owner = randomUUID(); if (localLeases.has(key)) return null; localLeases.add(key); let active = true; return { owner, assertOwner: async () => { if (!active || !localLeases.has(key)) throw new Error('READER_LEASE_LOST'); }, release: async () => { if (active) { active = false; localLeases.delete(key); } } }; }
