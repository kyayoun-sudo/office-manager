// Neutral observations: no client, mission, PBC or destination is inferred here.
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';

export function observeFile(file, node, previous, runId, now) {
  if (!file.id || !file.mimeType || typeof file.name !== 'string') throw new Error('INVALID_DRIVE_METADATA');
  const parents = file.parents?.length ? file.parents : [node.id];
  const item = {
    id: file.id, provider: 'GOOGLE_DRIVE', provider_file_id: file.id,
    name: file.name, mimeType: file.mimeType, parents,
    path: (node.path || '') + '/' + file.name,
    driveId: file.driveId ?? node.driveId ?? null,
    source_type: file.driveId || node.driveId ? 'SHARED_DRIVE' : 'MY_DRIVE',
    createdTime: file.createdTime || '', modifiedTime: file.modifiedTime || '',
    size: file.size ?? '', webViewLink: file.webViewLink || '',
    md5Checksum: file.md5Checksum || '', version: file.version || '',
    trashed: file.trashed === true, shortcutDetails: file.shortcutDetails || null,
    owners: file.owners || [],
    is_folder: file.mimeType === FOLDER_MIME, is_shortcut: file.mimeType === SHORTCUT_MIME,
    first_seen_at: previous?.first_seen_at || now, last_seen_at: now,
    run_id: runId, scan_status: 'DISCOVERED'
  };
  item.changes = changesBetween(previous, item);
  return item;
}

export function changesBetween(previous, item) {
  if (!previous) return ['NEW'];
  const changes = [];
  if (previous.name !== item.name) changes.push('RENAMED');
  if (JSON.stringify([...(previous.parents || [])].sort()) !== JSON.stringify([...(item.parents || [])].sort())) changes.push('MOVED');
  if (['modifiedTime', 'size', 'md5Checksum', 'version'].some(k => String(previous[k] ?? '') !== String(item[k] ?? ''))) changes.push('MODIFIED');
  return changes.length ? changes : ['UNCHANGED'];
}

export function scanFailure(error, attempts = 1, now = Date.now()) {
  const message = String(error.message || error).slice(0, 300);
  const statusCode = Number(error.statusCode || error.status || message.match(/GOOGLE_(?:API|AUTH_FAILURE)_(\d{3})/)?.[1] || 0);
  const retryable = statusCode === 429 || statusCode >= 500 && statusCode < 600 || /TIMEOUT|ETIMEDOUT|ECONNRESET|NETWORK|rateLimitExceeded|userRateLimitExceeded/i.test(message);
  return {
    status: retryable ? 'ERROR_RETRYABLE' : 'BLOCKED', attempts,
    last_error: message,
    next_retry_at: retryable ? new Date(now + Math.min(300000, 1000 * 2 ** Math.min(attempts, 8))).toISOString() : null
  };
}
