import crypto from 'node:crypto';
import { rest } from './supabase.js';
import { memoryFolderId } from './memory-runtime.js';
import { tidyDrive } from './tidy-drive.js';
import { appendSheetValues, createBinaryFile, findFilesByExactName } from './google-drive.js';

// Audit log of what the agents do (2026-10-08, extension « mémoire »). ADDED, nothing replaced:
//  - Supabase office_audit_events: the technical events (append-only table, db/memory.sql);
//  - Drive « 00_OFFICE_MANAGER/AUDIT LOGS/AUDIT_LOG_AAAA-MM »: the same lines, readable by people
//    (one Google Sheet per month, lines added at the end, never rewritten).
// References and hashes only: never the content of a client document, never the model's reasoning.
// Without the migration or without Drive, the agent's work goes on (the log says why it is missing).

export const AUDIT_COLUMNS = ['timestamp', 'agent', 'mission_id', 'action_type', 'source_ref', 'input_hash', 'decision', 'output_ref', 'status', 'error', 'reviewer', 'approved_by', 'approved_at', 'executed_at', 'verified_at'];
const STATUSES = new Set(['started', 'succeeded', 'failed', 'proposed', 'approved', 'rejected', 'executed', 'verified', 'retried', 'recovered', 'skipped']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cut = (s, n) => s == null || s === '' ? null : String(s).slice(0, n);

export function inputHash(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function auditRow(orgId, e = {}, now = new Date()) {
  const status = STATUSES.has(e.status) ? e.status : 'succeeded';
  return {
    org_id: orgId, at: e.at || now.toISOString(),
    agent: cut(e.agent || 'office-manager', 60), mission_id: UUID.test(String(e.mission_id || '')) ? e.mission_id : null,
    action_type: cut(e.action_type || 'EVENT', 80), source_ref: cut(e.source_ref, 500),
    input_hash: /^[0-9a-f]{64}$/.test(String(e.input_hash || '')) ? e.input_hash : (e.input !== undefined ? inputHash(e.input) : null),
    decision: cut(e.decision, 60), output_ref: cut(e.output_ref, 500), status, error: cut(e.error, 500),
    reviewer: cut(e.reviewer, 120), approved_by: cut(e.approved_by, 120), approved_at: e.approved_at || null,
    executed_at: e.executed_at || null, verified_at: e.verified_at || null, ref_id: cut(e.ref_id, 120)
  };
}

const sheetCache = new Map();
async function monthSheet(month, d) {
  const root = d.folder || memoryFolderId();
  if (!root) throw new Error('MEMORY_FOLDER_NOT_CONFIGURED');
  const key = root + '|' + month;
  if (sheetCache.has(key)) return sheetCache.get(key);
  const td = d.tidyDrive || tidyDrive;
  const folder = (await td.findOrCreateFolder(root, 'AUDIT LOGS')).id;
  const name = 'AUDIT_LOG'; // one sheet, lines added at the end (no new file each month)
  const find = d.findFiles || findFilesByExactName;
  let id = (await find(name, folder).catch(() => []))?.[0]?.id || null;
  if (!id) {
    const csv = Buffer.from(AUDIT_COLUMNS.join(',') + '\n');
    id = (await (d.createFile || createBinaryFile)({ name, parentId: folder, buffer: csv, mimeType: 'text/csv', targetMimeType: 'application/vnd.google-apps.spreadsheet' }))?.id || null;
  }
  if (id) sheetCache.set(key, id);
  return id;
}

// One event (or several). Returns where it was written; never throws.
export async function audit(orgId, events, d = {}) {
  const list = (Array.isArray(events) ? events : [events]).filter(Boolean);
  if (!orgId || !list.length) return { db: false, drive: false };
  const rows = list.map(e => auditRow(orgId, e, d.now ? d.now() : new Date()));
  const out = { db: false, drive: false };
  try {
    await (d.fetchRows || rest)('office_audit_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
    out.db = true;
  } catch (e) { out.db_error = /office_audit_events|PGRST|42P01|relation/i.test(String(e.message || e)) ? 'MIGRATION_MANQUANTE (db/memory.sql)' : cut(e.message || e, 160); }
  if (d.drive !== false) {
    try {
      const month = rows[0].at.slice(0, 7);
      const id = await monthSheet(month, d);
      if (id) {
        await (d.appendValues || appendSheetValues)(id, 'A1', rows.map(r => AUDIT_COLUMNS.map(c => String((c === 'timestamp' ? r.at : r[c]) ?? ''))));
        out.drive = true;
      }
    } catch (e) { out.drive_error = cut(e.message || e, 160); }
  }
  return out;
}

export async function listAuditEvents(orgId, { missionId, agent, limit = 100 } = {}, fetchRows = rest) {
  const q = encodeURIComponent;
  let path = 'office_audit_events?org_id=eq.' + q(orgId);
  if (missionId && UUID.test(missionId)) path += '&mission_id=eq.' + q(missionId);
  if (agent) path += '&agent=eq.' + q(String(agent).slice(0, 60));
  try {
    return { events: await fetchRows(path + '&select=at,agent,mission_id,action_type,source_ref,decision,output_ref,status,error,reviewer,approved_by,executed_at,verified_at&order=at.desc&limit=' + Math.min(500, Math.max(1, Number(limit) || 100))) || [] };
  } catch { return { events: [], migration_missing: true }; }
}
