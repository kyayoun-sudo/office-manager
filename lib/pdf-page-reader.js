import { PDFDocument } from 'pdf-lib';

// Only the selected original page is sent to vision, with original page provenance.
export async function isolatedPdfPage(buffer, page) {
  if (buffer.length > 8000000) throw new Error('READER_TOO_LARGE');
  const source = await PDFDocument.load(buffer); // encrypted PDFs fail; no ignoreEncryption.
  if (!Number.isInteger(page) || page < 1 || page > source.getPageCount()) throw new Error('READER_RANGE_NOT_FOUND');
  const target = await PDFDocument.create();
  target.addPage((await target.copyPages(source, [page - 1]))[0]);
  return Buffer.from(await target.save());
}
