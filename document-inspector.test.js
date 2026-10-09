import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { inspectDocument, normalizeInspection, inspectionReceipt } from '../lib/document-inspector.js';
import { extractStructuredOffice, STRUCTURED_MIMES } from '../lib/structured-reading.js';
import { extractPdfText } from '../lib/pdf-reading.js';

test('partial extraction never claims a complete fingerprint and receipt contains no content', () => {
  const r = normalizeInspection({ id: 'a' }, { text: 'confidential document', truncated: true });
  assert.equal(r.status, 'PARTIAL'); assert.equal(r.content_fingerprint, null);
  assert.ok(r.extraction_fingerprint); assert.ok(!JSON.stringify(inspectionReceipt(r)).includes('confidential'));
  assert.equal(r.quality.readability_score, null);
});
test('oversize documents are rejected before downloading; transient errors remain retryable', async () => {
  let called = false;
  const r = await inspectDocument({ id: 'a', size: 9000000 }, () => { called = true; });
  assert.equal(called, false); assert.equal(r.error_code, 'TOO_LARGE');
  assert.equal((await inspectDocument({ id: 'a' }, () => { throw new Error('GOOGLE_CONTENT_READ_429'); })).status, 'ERROR_RETRYABLE');
});
test('chunks preserve known page provenance without inventing page numbers for text', () => {
  const r = normalizeInspection({ id: 'a' }, { text: 'a'.repeat(2401), sections: [{ text: 'a'.repeat(2401), source: { kind: 'page', page: 7 } }] });
  assert.equal(r.chunks.length, 3); assert.equal(r.chunks[2].source.page, 7); assert.equal(r.chunks[2].start_character, 2400);
  assert.equal(normalizeInspection({ id: 'b' }, 'hello').chunks[0].source.page, undefined);
});
test('DOCX paragraphs and headers retain actual source parts and remain partial', async () => {
  const zip = new JSZip(); zip.file('word/document.xml', '<w:document xmlns:w="urn:w"><w:p><w:r><w:t>Hello &amp; world</w:t></w:r></w:p></w:document>');
  zip.file('word/header1.xml', '<w:hdr xmlns:w="urn:w"><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:hdr>');
  const result = await extractStructuredOffice(await zip.generateAsync({ type: 'nodebuffer' }), STRUCTURED_MIMES[0]);
  assert.match(result.text, /Hello & world/); assert.match(result.text, /Header/); assert.equal(result.truncated, true); assert.equal(result.sections[0].source.part, 'word/document.xml');
});
test('spreadsheet samples stop at row 21 and retain cached formula values', async () => {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Budget');
  for (let i = 1; i <= 25; i++) sheet.addRow([i, `row ${i}`]);
  sheet.getCell('C1').value = { formula: '1+2', result: 3 };
  const r = await extractStructuredOffice(Buffer.from(await book.xlsx.writeBuffer()), STRUCTURED_MIMES[1]);
  assert.equal(r.tables[0].rows.length, 21); assert.equal(r.tables[0].rows[0][2], '3'); assert.equal(r.truncated, true); assert.equal(r.tables[0].total_rows, 25);
});
test('mixed PDF preserves readable pages and reports missing pages', async () => {
  const r = await extractPdfText(Buffer.from('fake'), { extract: async () => ({ totalPages: 4, pages: ['Readable native text '.repeat(4), '', '', ''] }) });
  assert.equal(r.scanned, false); assert.match(r.text, /Readable/); assert.deepEqual(r.missing_pages, [2, 3, 4]); assert.equal(r.truncated, true);
});
