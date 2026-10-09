// READING A PDF (2026-10-09 — architecture: « a filename is not evidence »; the Orpailleur « ouvre,
// regarde le contenu »). Content on demand: the buffer is read, the text is returned, nothing is kept.
//  - a PDF with a text layer: its text, extracted natively;
//  - a long PDF: the first pages and the last ones (where the client, the period, the signature
//    and the totals usually are), within the reading limit — never 80 pages sent to the AI;
//  - a scan (no text layer, or almost none): said plainly (`scanned: true`) so the caller can look
//    at it with a vision model instead of guessing from the name.

export const PDF_MIME = 'application/pdf';
const FIRST_PAGES = 6, LAST_PAGES = 2;
const MIN_CHARS_PER_PAGE = 40; // below this on average, the PDF is a picture (scan / photo)

export async function extractPdfText(buffer, { limit = 30000, extract } = {}) {
  const bytes = buffer instanceof Uint8Array ? new Uint8Array(buffer) : new Uint8Array(Buffer.from(buffer));
  const run = extract || (async b => {
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(b);
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    return { totalPages, pages: text };
  });
  const { totalPages, pages } = await run(bytes);
  const total = Number(totalPages) || (pages || []).length;
  const clean = (pages || []).map(p => String(p || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
  const chars = clean.reduce((n, p) => n + p.length, 0);
  const scanned = !total || chars < MIN_CHARS_PER_PAGE;
  // The pages read: all of them if short, else the first ones and the last ones.
  const idx = total <= FIRST_PAGES + LAST_PAGES ? clean.map((_, i) => i)
    : [...Array(FIRST_PAGES).keys(), ...Array.from({ length: LAST_PAGES }, (_, k) => total - LAST_PAGES + k)];
  let text = '';
  const read = [], sections = [];
  for (const i of idx) {
    if (!clean[i]) continue;
    const block = '--- PAGE ' + (i + 1) + '/' + total + ' ---\n' + clean[i] + '\n';
    if (text.length + block.length > limit) { const available = Math.max(0, limit - text.length); text += block.slice(0, available); sections.push({ text: clean[i].slice(0, Math.max(0, available - (block.length - clean[i].length))), source: { kind: 'page', page: i + 1 } }); read.push(i + 1); break; }
    sections.push({ text: clean[i], source: { kind: 'page', page: i + 1 } });
    text += block; read.push(i + 1);
  }
  return { supported: true, extractor: scanned ? 'pdf-scan' : 'unpdf-text', text: scanned ? '' : text, scanned, total_pages: total, pages_read: read,
    sections: scanned ? [] : sections, missing_pages: Array.from({ length: total }, (_, i) => i + 1).filter(p => !read.includes(p)),
    truncated: read.length < total || sections.reduce((n, s) => n + s.text.length, 0) < chars };
}
