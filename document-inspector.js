import { createHash } from 'node:crypto';

export const READER_VERSION = '1.0.0';
export const MAX_READER_BYTES = 8000000;
const clean = value => String(value || '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();

// Content is returned to the caller, never stored here. Names and paths are hints, not evidence.
export function normalizeInspection(file, extracted, { maxChars = 30000, scope = {} } = {}) {
  const raw = typeof extracted === 'string' ? { supported: true, text: extracted } : extracted || {};
  const original = clean(raw.text);
  const text = original.slice(0, maxChars);
  const partial = Boolean(raw.truncated || raw.scanned || raw.partial || original.length > maxChars);
  const status = raw.error_status || (raw.supported === false ? 'UNSUPPORTED' : !text ? 'UNREADABLE' : partial ? 'PARTIAL' : 'READ_SUCCESS');
  const sections = (raw.sections || []).map(s => ({ ...s, text: clean(s.text) }));
  const chunks = [];
  const sources = sections.length ? sections : [{ text, source: { kind: 'extracted_text' } }];
  let remaining = text.length;
  for (const section of sources) {
    const sourceText = section.text.slice(0, remaining);
    remaining -= sourceText.length;
    for (let offset = 0; offset < sourceText.length; offset += 1200) {
      chunks.push({ sequence: chunks.length + 1, text: sourceText.slice(offset, offset + 1200), source: section.source || { kind: 'extracted_text' }, start_character: offset, end_character: Math.min(offset + 1200, sourceText.length) });
    }
    if (!remaining) break;
  }
  const fingerprint = text ? createHash('sha256').update(text).digest('hex') : null;
  return {
    file_id: file.id, scope: { ...scope }, reader_version: READER_VERSION, status,
    extractor: raw.extractor || 'text', error_code: raw.error_code || null,
    context: { name: file.name || null, path: file.path || null, evidence: false },
    content: { text, sections, tables: raw.tables || [], metadata: raw.metadata || {} }, chunks,
    quality: { readable_characters: text.length, estimated_tokens: Math.ceil(text.length / 4), readability_score: null, language: null, truncated: partial, total_pages: raw.total_pages ?? null, pages_read: raw.pages_read || [], missing_pages: raw.missing_pages || [], limitations: raw.limitations || [] },
    content_fingerprint: status === 'READ_SUCCESS' ? fingerprint : null,
    extraction_fingerprint: fingerprint,
    fingerprint_scope: status === 'READ_SUCCESS' ? 'complete_extracted_text' : 'partial_extraction'
  };
}

export async function inspectDocument(file, read, options = {}) {
  if (Number(file.size) > MAX_READER_BYTES) return normalizeInspection(file, { supported: false, error_code: 'TOO_LARGE' }, options);
  if (/^(application\/(zip|x-.*compressed|x-msdownload)|video\/|audio\/)/i.test(file.mimeType || '')) return normalizeInspection(file, { supported: false, error_code: 'SKIPPED_FORMAT' }, options);
  try {
    return normalizeInspection(file, await read(file.id, { maxChars: options.maxChars || 30000, structured: true, maxBytes: MAX_READER_BYTES }), options);
  } catch (error) {
    const message = String(error?.message || '');
    const retryable = /429|50[0234]|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(message);
    return normalizeInspection(file, { error_status: retryable ? 'ERROR_RETRYABLE' : 'ERROR_FINAL', error_code: /TOO_LARGE/.test(message) ? 'TOO_LARGE' : /password|encrypt/i.test(message) ? 'PASSWORD_PROTECTED' : retryable ? 'READ_TEMPORARY_FAILURE' : 'READ_FAILED' }, options);
  }
}

// Safe to persist in the existing per-Drive state: no extracted text or document tables.
export function inspectionReceipt(result) {
  const { file_id, scope, reader_version, status, extractor, error_code, quality, content_fingerprint, extraction_fingerprint, fingerprint_scope } = result;
  return { file_id, scope, reader_version, status, extractor, error_code, quality, content_fingerprint, extraction_fingerprint, fingerprint_scope };
}
