import { createHash } from 'node:crypto';
import { readerRoute } from './reader-router.js';

export const READER_VERSION = '2.0.0';
export const MAX_READER_BYTES = 8000000;
const clean = value => String(value || '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();

// Content is returned to the caller, never stored here. Names and paths are hints, not evidence.
export function normalizeInspection(file, extracted, { maxChars = 30000, scope = {}, context = {} } = {}) {
  maxChars = Math.min(200000, Math.max(1, Number(maxChars) || 30000));
  const raw = typeof extracted === 'string' ? { supported: true, text: extracted } : extracted || {};
  const original = clean(raw.text);
  const text = original.slice(0, maxChars);
  const fingerprint = text ? createHash('sha256').update(text).digest('hex') : null;
  const partial = Boolean(raw.truncated || raw.scanned || raw.partial || original.length > maxChars);
  const status = raw.error_status || (raw.supported === false ? 'UNSUPPORTED' : !text ? 'UNREADABLE' : partial ? 'PARTIAL' : 'READ_SUCCESS');
  let sectionBudget = maxChars;
  const sections = (raw.sections || []).filter(s => s && typeof s.text === 'string').map(s => { const text = clean(s.text).slice(0, Math.max(0, sectionBudget)); sectionBudget -= text.length; return { ...s, text }; }).filter(s => s.text);
  const chunks = [];
  const sources = sections.length ? sections : [{ text, source: { kind: 'extracted_text' } }];
  let remaining = text.length;
  for (const section of sources) {
    const sourceText = section.text.slice(0, remaining);
    remaining -= sourceText.length;
    for (let offset = 0; offset < sourceText.length;) {
      let end = Math.min(offset + 1200, sourceText.length);
      if (end < sourceText.length) { const boundary = sourceText.lastIndexOf('\n', end); if (boundary > offset + 600) end = boundary + 1; }
      const sequence = chunks.length + 1;
      chunks.push({ chunk_id: `${file.id}:${READER_VERSION}:${fingerprint?.slice(0, 16)}:${sequence}`, document_id: file.id, sequence, text: sourceText.slice(offset, end), source: section.source || { kind: 'extracted_text' }, start_character: offset, end_character: end });
      offset = end;
    }
    if (!remaining) break;
  }
  return {
    file_id: file.id, document_id: file.id, filename: file.name || null, current_path: file.path || null, mime_type: file.mimeType || null, scope: { ...scope }, reader_version: READER_VERSION, status,
    extractor: raw.extractor || 'text', reader: readerRoute(file).reader, eligibility: readerRoute(file).eligibility, error_code: raw.error_code || null,
    source_revision: { modified_time: file.modifiedTime || null, provider_version: file.version || null, checksum: file.md5Checksum || null, parents: file.parents || [] },
    context: { name: file.name || null, path: file.path || null, parent_folder: context.parent_folder || null, sibling_examples: (context.sibling_examples || []).slice(0, 5).map(n => String(n).slice(0, 250)), evidence: false },
    content: { text, sections, tables: raw.tables || [], metadata: raw.metadata || {} }, chunks,
    quality: { text_available: Boolean(text), readable_characters: text.length, estimated_tokens: Math.ceil(text.length / 4), readability_score: null, language: null, truncated: partial, content_availability: status === 'READ_SUCCESS' ? 'FULL_CONTENT_AVAILABLE' : 'PARTIAL_OR_UNAVAILABLE', total_pages: raw.total_pages ?? null, sheet_count: raw.metadata?.sheet_count ?? null, slide_count: raw.metadata?.slide_count ?? null, pages_read: raw.pages_read || [], partial_pages: raw.partial_pages || [], missing_pages: raw.missing_pages || [], ocr_pages: raw.ocr_pages || [], pending_ocr_pages: raw.pending_ocr_pages || [], unverified_pages: raw.unverified_pages || [], limitations: raw.limitations || [] },
    content_fingerprint: status === 'READ_SUCCESS' ? fingerprint : null,
    extraction_fingerprint: fingerprint,
    fingerprint_scope: status === 'READ_SUCCESS' ? 'complete_extracted_text' : 'partial_extraction'
  };
}

export async function inspectDocument(file, read, options = {}) {
  let cacheKey = null;
  try {
  if (options.getMeta) {
    const fresh = await options.getMeta(file.id);
    if (!fresh || (fresh.id && fresh.id !== file.id) || fresh.trashed) return normalizeInspection(file, { error_status: 'ERROR_FINAL', error_code: 'SOURCE_UNAVAILABLE' }, options);
    file = { ...file, ...fresh };
    if (options.assertScope) await options.assertScope(file);
    cacheKey = options.cache?.key(file, options.scope, { maxChars: options.maxChars || 30000, ...options.readerOptions });
    const cached = !options.force && cacheKey && options.cache?.get(cacheKey);
    if (cached) return { ...cached, cached: true, context: { ...cached.context, name: file.name, path: file.path } };
  }
  if (Number(file.size) > MAX_READER_BYTES) return normalizeInspection(file, { supported: false, error_code: 'TOO_LARGE' }, options);
  if (readerRoute(file).eligibility === 'SKIP') return normalizeInspection(file, { supported: false, error_code: 'SKIPPED_FORMAT' }, options);
    let raw = await read(file.id, { ...options.readerOptions, maxChars: options.maxChars || 30000, structured: true, maxBytes: MAX_READER_BYTES });
    if (options.ocr && raw && typeof raw === 'object' && (!raw.error_code && !raw.error_status)) {
      const pages = raw.needs_ocr_pages || (raw.scanned ? raw.selected_pages || [null] : []);
      const targets = file.mimeType?.startsWith('image/') ? [null] : pages;
      const sections = [...(raw.sections || [])], transcribed = [], deferred = []; let visualText = false;
      for (const page of targets) {
        let result;
        try { result = await options.ocr(file, page); } catch { result = { deferred: true }; }
        if (result?.deferred) deferred.push(page === null ? 'visual' : page);
        if (result?.text?.trim()) { visualText = true; if (page !== null) { const index = sections.findIndex(s => s.source?.page === page); if (index >= 0) sections.splice(index, 1); transcribed.push(page); } sections.push({ text: result.text, source: page === null ? { kind: file.mimeType?.startsWith('image/') ? 'image' : 'document_visual_excerpt', file_id: file.id } : { kind: 'page', page, method: 'ocr' } }); }
      }
      raw = { ...raw, pending_ocr_pages: deferred };
      if (visualText) {
        sections.sort((a, b) => (a.source.page || 0) - (b.source.page || 0));
        raw = { ...raw, supported: true, text: sections.map(s => s.text).join('\n\n'), sections, extractor: 'native-and-vision', partial: true, ocr_pages: transcribed, unverified_pages: transcribed, pages_read: [...new Set([...(raw.pages_read || []), ...transcribed])], missing_pages: (raw.missing_pages || []).filter(p => !transcribed.includes(p)), limitations: [...(raw.limitations || []), 'Vision transcription is not independently verified.'] };
      }
    }
    if (options.getMeta) {
      const after = await options.getMeta(file.id);
      if (!after || (after.modifiedTime || null) !== (file.modifiedTime || null) || (after.version || null) !== (file.version || null)) return normalizeInspection(file, { error_status: 'ERROR_RETRYABLE', error_code: 'SOURCE_CHANGED_DURING_READ' }, options);
    }
    const result = normalizeInspection(file, raw, options);
    if (cacheKey) options.cache?.put(cacheKey, result);
    return result;
  } catch (error) {
    const message = String(error?.message || '');
    const retryable = /429|50[0234]|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(message);
    return normalizeInspection(file, { error_status: retryable ? 'ERROR_RETRYABLE' : 'ERROR_FINAL', error_code: /TOO_LARGE/.test(message) ? 'TOO_LARGE' : /password|encrypt/i.test(message) ? 'PASSWORD_PROTECTED' : /corrupt|zip|invalid pdf|central directory/i.test(message) ? 'CORRUPTED' : /ENCODING/.test(message) ? 'ENCODING_UNSUPPORTED' : retryable ? 'READ_TEMPORARY_FAILURE' : 'READ_FAILED' }, options);
  }
}

// Safe to persist in the existing per-Drive state: no extracted text or document tables.
export function inspectionReceipt(result) {
  const { file_id, scope, reader_version, status, extractor, reader, eligibility, source_revision, error_code, quality, content_fingerprint, extraction_fingerprint, fingerprint_scope } = result;
  const ranges = []; for (const page of quality.missing_pages) { const last = ranges.at(-1); if (last && last.end + 1 === page) last.end = page; else ranges.push({ start: page, end: page }); }
  return { file_id, scope, reader_version, status, extractor, reader, eligibility, source_revision, error_code, quality: { ...quality, missing_pages: quality.missing_pages.slice(0, 100), missing_page_count: quality.missing_pages.length, missing_page_ranges: ranges }, content_fingerprint, extraction_fingerprint, fingerprint_scope };
}
