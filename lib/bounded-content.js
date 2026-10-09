export async function boundedResponseBytes(response, maxBytes = 8000000) {
  if (Number(response.headers?.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('READER_TOO_LARGE'); }
  const chunks = []; let size = 0;
  if (!response.body) { const bytes = Buffer.from(await response.text()); if (bytes.length > maxBytes) throw new Error('READER_TOO_LARGE'); return bytes; }
  for await (const chunk of response.body) { size += chunk.length; if (size > maxBytes) throw new Error('READER_TOO_LARGE'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}

export async function assertReaderFileScope(file, { rootId, kind, getMeta }) {
  if (!rootId || !kind) throw new Error('READER_SCOPE_UNAVAILABLE');
  if (file.trashed) throw new Error('SOURCE_UNAVAILABLE');
  if (kind === 'all') return; // Already authorized by this connection's metadata request.
  if (kind === 'drive') { if (file.driveId !== rootId) throw new Error('READER_OUTSIDE_SELECTED_DRIVE'); return; }
  if (kind !== 'folder') throw new Error('READER_SCOPE_UNAVAILABLE');
  const queue = [file], seen = new Set();
  while (queue.length && seen.size < 60) {
    const current = queue.shift();
    if (current.id === rootId || current.parents?.includes(rootId)) return;
    if (seen.has(current.id)) continue; seen.add(current.id);
    for (const parent of current.parents || []) { const meta = await getMeta(parent); if (meta && !meta.trashed) queue.push(meta); }
  }
  throw new Error('READER_OUTSIDE_SELECTED_DRIVE');
}
