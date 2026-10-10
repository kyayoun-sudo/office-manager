import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PDFDocument as PDFLib } from 'pdf-lib';
import { extractStructuredOffice, STRUCTURED_MIMES } from '../lib/structured-reading.js';
import { extractCsv, decodeDocumentText } from '../lib/tabular-text-reading.js';
import { normalizeInspection, inspectDocument } from '../lib/document-inspector.js';
import { ReaderCache, beginInspectionTask, completeInspectionTask, acquireOfflineReaderLease, acquireReaderLease } from '../lib/inspection-runtime.js';
import { isolatedPdfPage } from '../lib/pdf-page-reader.js';
import { readStructuredGoogleSheet } from '../lib/google-sheet-reader.js';
import { readerRoute } from '../lib/reader-router.js';
import { boundedResponseBytes, assertReaderFileScope } from '../lib/bounded-content.js';
import { readForTidy, tidyPlanStep } from '../lib/tidy-plan.js';
import { passReport } from '../lib/orpailleur-journal.js';

const scope = { organization_id: 'org', memory_folder_id: 'memory', connection_id: 'connection', user_id: 'owner' };
const zipBuffer = async files => { const zip = new JSZip(); for (const [part, text] of Object.entries(files)) zip.file(part, text); return zip.generateAsync({ type: 'nodebuffer' }); };
const w = '<w:document xmlns:w="urn:w" xmlns:r="urn:r"><w:body>', end = '</w:body></w:document>';
const paragraph = text => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

test('Word preserves headings, tables, referenced headers and footers in natural order', async () => {
  const buffer = await zipBuffer({
    'word/document.xml': w + '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>' + paragraph('Body') + '<w:tbl><w:tr><w:tc>' + paragraph('Date') + '</w:tc><w:tc>' + paragraph('Amount') + '</w:tc></w:tr></w:tbl><w:sectPr><w:headerReference r:id="h"/><w:footerReference r:id="f"/></w:sectPr>' + end,
    'word/_rels/document.xml.rels': '<Relationships><Relationship Id="h" Target="header1.xml"/><Relationship Id="f" Target="footer1.xml"/></Relationships>',
    'word/header1.xml': '<w:hdr xmlns:w="urn:w">' + paragraph('Header') + '</w:hdr>', 'word/footer1.xml': '<w:ftr xmlns:w="urn:w">' + paragraph('Footer') + '</w:ftr>'
  });
  const r = await extractStructuredOffice(buffer, STRUCTURED_MIMES[0]);
  assert.equal(r.sections[0].heading_level, 1); assert.equal(r.sections[1].heading, 'Introduction');
  assert.deepEqual(r.tables[0].rows, [['Date', 'Amount']]); assert.match(r.text, /Header/); assert.match(r.text, /Footer/); assert.equal(r.truncated, false);
  assert.equal(normalizeInspection({ id: 'word' }, r).status, 'READ_SUCCESS');
});
test('Word embedded visuals remain partial; XML entity declarations are refused', async () => {
  const r = await extractStructuredOffice(await zipBuffer({ 'word/document.xml': w + paragraph('text') + '<w:drawing/>' + end }), STRUCTURED_MIMES[0]);
  assert.equal(r.truncated, true);
  await assert.rejects(() => extractStructuredOffice(Buffer.from('bad'), STRUCTURED_MIMES[0]));
  const xml = await zipBuffer({ 'word/document.xml': '<!DOCTYPE x [<!ENTITY e "bad">]>' + w + paragraph('&e;') + end });
  await assert.rejects(() => extractStructuredOffice(xml, STRUCTURED_MIMES[0]), /DOCTYPE/);
});
test('PowerPoint uses presentation relationship order, includes titles, notes and tables', async () => {
  const slide = text => `<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const r = await extractStructuredOffice(await zipBuffer({
    'ppt/presentation.xml': '<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId id="256" r:id="second"/><p:sldId id="257" r:id="first"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide1.xml': slide('Shown second'), 'ppt/slides/slide2.xml': slide('Shown first').replace('</p:spTree>', '<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Table cell</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree>'),
    'ppt/slides/_rels/slide2.xml.rels': '<Relationships><Relationship Id="notes" Type="http://schemas/notesSlide" Target="../notesSlides/notesSlide9.xml"/></Relationships>',
    'ppt/notesSlides/notesSlide9.xml': '<p:notes xmlns:p="urn:p" xmlns:a="urn:a"><p:sp><p:txBody><a:p><a:r><a:t>Speaker note</a:t></a:r></a:p></p:txBody></p:sp></p:notes>'
  }), STRUCTURED_MIMES[2]);
  assert.equal(r.sections[0].text, 'Shown first'); assert.equal(r.sections[0].source.slide_number, 1);
  assert.equal(r.metadata.slides[0].title, 'Shown first'); assert.match(r.text, /Speaker note/); assert.deepEqual(r.tables[0].rows, [['Table cell']]); assert.equal(r.truncated, false);
});
test('CSV detects quoted semicolons, multiline cells, doubled quotes and logical row counts', () => {
  const r = extractCsv(Buffer.from('name;notes;amount\r\nAlpha;"line 1\nline 2; ""quoted""";12\r\nBeta;simple;5\r\n'));
  assert.equal(r.metadata.delimiter, ';'); assert.equal(r.metadata.total_rows, 3);
  assert.equal(r.tables[0].rows[1][1], 'line 1\nline 2; "quoted"'); assert.equal(r.truncated, false); assert.equal(r.sections[1].source.row, 2);
});
test('CSV BOM encodings and explicit legacy encoding are supported, bad encodings are explicit', () => {
  const bytes = Buffer.concat([Buffer.from([255, 254]), Buffer.from('nom;montant\nÉté;42', 'utf16le')]);
  const r = extractCsv(bytes); assert.equal(r.metadata.encoding, 'utf-16le'); assert.equal(r.tables[0].rows[1][0], 'Été');
  assert.equal(decodeDocumentText(Buffer.from([0xe9]), 'windows-1252').text, 'é');
  assert.throws(() => decodeDocumentText(Buffer.from([0xff])), /ENCODING_UNSUPPORTED/);
  assert.throws(() => extractCsv(Buffer.from('a,b\n"unclosed')), /CORRUPTED/);
});
test('CSV and spreadsheets support targeted samples without claiming full coverage', async () => {
  const r = extractCsv(Buffer.from('a,b\n1,2\n3,4\n5,6'), 500, { startRow: 3, rowLimit: 1 });
  assert.deepEqual(r.tables[0].rows, [['3', '4']]); assert.equal(r.sections[0].source.row, 3); assert.equal(r.truncated, true);
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('Later'); sheet.getCell('D10').value = 'Header'; sheet.getCell('D11').value = { formula: '1+2', result: 3 };
  const result = await extractStructuredOffice(Buffer.from(await book.xlsx.writeBuffer()), STRUCTURED_MIMES[1], 500, { sheetName: 'Later', startRow: 11, rowLimit: 1 });
  assert.equal(result.metadata.sheets[0].used_range, 'D10:D11'); assert.equal(result.metadata.sheets[0].non_empty_cells, 2); assert.equal(result.metadata.sheets[0].formulas[0].address, 'D11'); assert.equal(result.sections[0].source.first_row, 11); assert.equal(result.truncated, true);
});
test('Google Sheets requests bounded ranges and distinguishes grid dimensions from occupied cells', async () => {
  const calls = [];
  const r = await readStructuredGoogleSheet('id', async url => { calls.push(url); if (!url.includes('batchGet')) return { sheets: [{ properties: { sheetId: 1, title: "Owner's data", gridProperties: { rowCount: 200000, columnCount: 8 } } }] }; return { valueRanges: [{ values: url.includes('FORMULA') ? [['Heading'], ['=1+2']] : [['Heading'], [3]] }] }; });
  assert.equal(calls.length, 3); assert.ok(calls[1].includes('AD21')); assert.equal(r.metadata.sheets[0].used_range, null); assert.equal(r.metadata.sheets[0].formulas[0].cached_result, '3'); assert.equal(r.truncated, true);
});
test('native PDF text is retained while only missing pages get OCR; OCR remains unverified', async () => {
  const pages = [];
  const r = await inspectDocument({ id: 'pdf', mimeType: 'application/pdf' }, async () => ({ supported: true, text: 'Native readable text '.repeat(4), sections: [{ text: 'Native readable text '.repeat(4), source: { kind: 'page', page: 1 } }], total_pages: 2, pages_read: [1], missing_pages: [2], needs_ocr_pages: [2], truncated: true }), { scope, ocr: async (file, page) => { pages.push(page); return { text: 'Page two transcription '.repeat(3) }; } });
  assert.deepEqual(pages, [2]); assert.match(r.content.text, /Native/); assert.match(r.content.text, /Page two/); assert.deepEqual(r.quality.ocr_pages, [2]); assert.equal(r.status, 'PARTIAL'); assert.equal(r.content_fingerprint, null);
});
test('images use documentary transcription; deferred OCR is recorded for resumption', async () => {
  const r = await inspectDocument({ id: 'image', mimeType: 'image/png' }, async () => ({ supported: false }), { scope, ocr: async () => ({ text: 'Visible words and numbers '.repeat(3) }) });
  assert.equal(r.status, 'PARTIAL'); assert.equal(r.chunks[0].source.kind, 'image');
  const deferred = await inspectDocument({ id: 'pdf', mimeType: 'application/pdf' }, async () => ({ supported: true, scanned: true, selected_pages: [2], text: '' }), { scope, ocr: async () => ({ deferred: true }) });
  assert.deepEqual(deferred.quality.pending_ocr_pages, [2]); assert.equal(deferred.status, 'UNREADABLE');
});
test('PDF vision isolation sends exactly the requested original page', async () => {
  const doc = new PDFDocument(), chunks = []; doc.on('data', b => chunks.push(b));
  const done = new Promise(resolve => doc.on('end', resolve)); doc.text('First page'); doc.addPage().text('Second page'); doc.end(); await done;
  const isolated = await isolatedPdfPage(Buffer.concat(chunks), 2); assert.equal((await PDFLib.load(isolated)).getPageCount(), 1);
  await assert.rejects(() => isolatedPdfPage(Buffer.concat(chunks), 3), /RANGE_NOT_FOUND/);
});
test('fresh metadata is required for cache reuse, scope and versions invalidate it, partial never caches', async () => {
  const cache = new ReaderCache(); let calls = 0; let version = '1';
  const file = { id: 'file', mimeType: 'text/plain' }, getMeta = async () => ({ ...file, version, modifiedTime: '2026-10-09' });
  const read = async () => { calls++; return { supported: true, text: 'Text '.repeat(20) }; };
  const options = { scope, cache, getMeta };
  await inspectDocument(file, read, options); assert.equal((await inspectDocument(file, read, options)).cached, true); assert.equal(calls, 1);
  version = '2'; await inspectDocument(file, read, options); assert.equal(calls, 2);
  await inspectDocument(file, read, { ...options, scope: { ...scope, user_id: 'other' } }); assert.equal(calls, 3);
  const partial = async () => { calls++; return { supported: true, text: 'partial', truncated: true }; };
  version = '3'; await inspectDocument(file, partial, options); await inspectDocument(file, partial, options); assert.equal(calls, 5);
});
test('source changed while reading invalidates the extraction, and metadata failures are normalized', async () => {
  let metadataCalls = 0;
  const r = await inspectDocument({ id: 'file' }, async () => 'content', { getMeta: async () => ({ id: 'file', version: String(++metadataCalls) }) });
  assert.equal(r.status, 'ERROR_RETRYABLE'); assert.equal(r.error_code, 'SOURCE_CHANGED_DURING_READ');
  assert.equal((await inspectDocument({ id: 'file' }, async () => 'content', { getMeta: async () => { throw new Error('429'); } })).status, 'ERROR_RETRYABLE');
});
test('durable task metadata has backoff, restartable processing and a content-free handoff', () => {
  const state = {}, file = { id: 'f', modifiedTime: 'v1' };
  assert.equal(beginInspectionTask(state, file, { now: 1000 }).task.status, 'PROCESSING');
  assert.equal(beginInspectionTask(state, file, { now: 2000 }).task.attempts, 2);
  const result = normalizeInspection(file, { error_status: 'ERROR_RETRYABLE' }); completeInspectionTask(state, result, 3000);
  assert.equal(beginInspectionTask(state, file, { now: 4000 }).ready, false);
  const good = normalizeInspection(file, 'Confidential content', { scope }); completeInspectionTask(state, good, 5000);
  assert.equal(state.understanding_queue.f.status, 'PENDING'); assert.ok(!JSON.stringify(state).includes('Confidential'));
});
test('exclusive reader leases serialize concurrent work and fence an expired worker', async () => {
  const first = acquireOfflineReaderLease(scope); assert.equal(acquireOfflineReaderLease(scope), null); await first.release(); assert.ok(acquireOfflineReaderLease({ ...scope, memory_folder_id: 'other' }));
  let renew = true, released = false;
  const lease = await acquireReaderLease('org', scope, { fetchRows: async path => { if (path.includes('renew')) return renew; if (path.includes('release')) { released = true; return true; } return true; } });
  await lease.assertOwner(); renew = false; await assert.rejects(() => lease.assertOwner(), /LEASE_LOST/); await lease.release(); assert.equal(released, true);
});
test('router skips folders and temporary files and identifies legacy formats honestly', () => {
  assert.equal(readerRoute({ mimeType: 'application/vnd.google-apps.folder' }).eligibility, 'SKIP');
  assert.equal(readerRoute({ name: '~$notes.docx', mimeType: STRUCTURED_MIMES[0] }).eligibility, 'SKIP');
  assert.equal(readerRoute({ mimeType: 'application/msword' }).eligibility, 'NEEDS_SPECIAL_READER');
});
test('reader byte limits stop a streamed download even without content-length', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(500)); controller.enqueue(new Uint8Array(501)); }, cancel() { cancelled = true; } }));
  await assert.rejects(() => boundedResponseBytes(response, 1000), /TOO_LARGE/); assert.equal(cancelled, true);
});
test('scope guard verifies selected shared Drive and fresh folder ancestry before content access', async () => {
  await assert.rejects(() => assertReaderFileScope({ id: 'file', driveId: 'foreign' }, { rootId: 'selected', kind: 'drive' }), /OUTSIDE_SELECTED/);
  await assertReaderFileScope({ id: 'file', driveId: 'selected' }, { rootId: 'selected', kind: 'drive' });
  await assertReaderFileScope({ id: 'file', parents: ['child'] }, { rootId: 'root', kind: 'folder', getMeta: async id => ({ id, parents: ['root'] }) });
  await assert.rejects(() => assertReaderFileScope({ id: 'file', parents: ['foreign'] }, { rootId: 'root', kind: 'folder', getMeta: async id => ({ id, parents: [] }) }), /OUTSIDE_SELECTED/);
});
test('native readable content never uses vision and protected or corrupt documents are explicit', async () => {
  let calls = 0;
  const r = await inspectDocument({ id: 'pdf', mimeType: 'application/pdf' }, async () => ({ supported: true, text: 'Native text '.repeat(10) }), { ocr: async () => { calls++; } });
  assert.equal(r.status, 'READ_SUCCESS'); assert.equal(calls, 0);
  assert.equal((await inspectDocument({ id: 'pdf' }, async () => { throw new Error('PasswordException: encrypted'); })).error_code, 'PASSWORD_PROTECTED');
  assert.equal((await inspectDocument({ id: 'pdf' }, async () => { throw new Error('Invalid PDF structure'); })).error_code, 'CORRUPTED');
});
test('the production reading path isolates a missing PDF page and records its original source', async () => {
  const doc = await PDFLib.create(); doc.addPage(); doc.addPage(); const bytes = Buffer.from(await doc.save());
  const result = await readForTidy({ id: 'pdf', name: 'scan.pdf', mimeType: 'application/pdf' }, async () => ({ supported: true, text: '', scanned: true, total_pages: 2, selected_pages: [2], needs_ocr_pages: [2], missing_pages: [1, 2] }), {
    fileForAI: async () => ({ visual: true, mimeType: 'application/pdf', base64: bytes.toString('base64') }),
    ai: async (providers, options) => { assert.equal((await PDFLib.load(Buffer.from(options.files[0].base64, 'base64'))).getPageCount(), 1); return { text: 'Transcription of original page two with literal document content.' }; }
  }, { left: 1 });
  assert.equal(result.method, 'vision'); assert.equal(result.inspection.chunks[0].source.page, 2); assert.deepEqual(result.inspection.quality.missing_pages, [1]); assert.equal(result.inspection.status, 'PARTIAL');
});
test('the journal never turns partial inspections or read failures into a complete pass', () => {
  const report = passReport({ status: 'done', done: 2, total: 2, inspections: { one: { status: 'PARTIAL' }, two: { status: 'ERROR_RETRYABLE' } } });
  assert.equal(report.status, 'PASSAGE INCOMPLET'); assert.equal(report.counts.lectures_partielles, 1); assert.equal(report.counts.lectures_en_erreur, 1);
});
test('several batches keep the same lease and persistent queue resumes until all files are inspected', async () => {
  const items = Array.from({ length: 45 }, (_, i) => ({ id: 'file' + i, name: 'note' + i + '.txt', path: '/Notes/note' + i + '.txt', mimeType: 'text/plain', parents: ['notes'] }));
  const store = new Map([
    ['OFFICE_MANAGER_SCAN_STATE.json', { items }],
    ['OFFICE_MANAGER_TIDY_STATE.json', { status: 'planning', done: 0, started_at: '2026-10-09', moves: 0, renames: 0, questions: 0, ok: 0 }]
  ]);
  const drive = { findFilesByExactName: async name => store.has(name) ? [{ id: name }] : [], downloadBuffer: async id => Buffer.from(JSON.stringify(store.get(id))), getMeta: async id => ({ id }), updateBinary: async (id, { buffer }) => store.set(id, JSON.parse(buffer.toString())), createBinary: async ({ name, buffer }) => { store.set(name, JSON.parse(buffer.toString())); return { id: name }; } };
  let reads = 0, claims = 0, releases = 0;
  const result = await tidyPlanStep('org', {}, { drive, folder: 'memory-multibatch', budgetMs: 10000, readerLease: async () => { claims++; return { assertOwner: async () => {}, release: async () => { releases++; } }; },
    readText: async () => { reads++; assert.ok([...store.get('OFFICE_MANAGER_TIDY_STATE.json').inspection_queue ? Object.values(store.get('OFFICE_MANAGER_TIDY_STATE.json').inspection_queue) : []].some(t => t.status === 'PROCESSING')); return 'Literal native documentary text '.repeat(3); },
    runAI: async options => ({ text: JSON.stringify({ decisions: [...options.input.matchAll(/### (file\d+) \|/g)].map(m => ({ file_id: m[1], action: 'ok' })) }) }),
    fetchRows: async () => [], activeLessons: async () => [], agentSettings: async () => ({ auto_filing: false }), recordFiles: async () => {}, writeJournal: async () => {}, saveCheckpoint: async () => {}, fire: async () => {}
  });
  assert.equal(result.status, 'done'); assert.equal(result.done, 45); assert.equal(reads, 45); assert.equal(claims, 1); assert.equal(releases, 1);
  assert.equal(Object.values(store.get('OFFICE_MANAGER_TIDY_STATE.json').inspection_queue).filter(t => t.status === 'READ_SUCCESS').length, 45);
});
