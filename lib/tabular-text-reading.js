import { boundedStructuredResult } from './office-structured-reader.js';

export function decodeDocumentText(buffer, encoding) {
  const bytes = Buffer.from(buffer); if (bytes.length > 8000000) throw new Error('READER_TOO_LARGE');
  const detected = encoding || (bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8');
  if (!encoding && detected === 'utf-8' && bytes.includes(0)) throw new Error('READER_ENCODING_UNSUPPORTED');
  try { return { text: new TextDecoder(detected, { fatal: true }).decode(bytes), encoding: detected, encoding_basis: encoding ? 'explicit' : detected.startsWith('utf-16') ? 'bom' : 'validated_utf8' }; }
  catch { throw new Error('READER_ENCODING_UNSUPPORTED'); }
}
function parseRows(text, delimiter, sampleLimit = 21, startRow = 1) {
  const sample = []; let field = '', row = [], quoted = false, afterQuote = false, rowCount = 0, columns = 0, truncated = false;
  const endField = () => { row.push(field); field = ''; afterQuote = false; if (row.length > 1000) throw new Error('READER_TOO_LARGE'); };
  const endRow = () => { endField(); rowCount++; columns = Math.max(columns, row.length); if (rowCount >= startRow && sample.length < sampleLimit) sample.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; afterQuote = true; } }
      else if (field.length < 10000) field += char; else truncated = true;
    } else if (char === '"' && !field && !afterQuote) quoted = true;
    else if (char === delimiter) endField();
    else if (char === '\r' || char === '\n') { if (char === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else { if (afterQuote && !/\s/.test(char)) throw new Error('READER_CORRUPTED_CSV'); if (field.length < 10000) field += char; else truncated = true; }
  }
  if (quoted) throw new Error('READER_CORRUPTED_CSV');
  if (field || row.length || afterQuote) endRow();
  return { sample, rowCount, columns, truncated };
}
export function extractCsv(buffer, limit = 30000, options = {}) {
  const decoded = decodeDocumentText(buffer, options.encoding), text = decoded.text;
  const scores = [',', ';', '\t', '|'].map(delimiter => {
    try { const parsed = parseRows(text, delimiter, 5), widths = parsed.sample.map(r => r.length); return { delimiter, score: widths.length ? widths[0] * (0.5 + 0.5 * widths.filter(w => w === widths[0]).length / widths.length) : 0 }; }
    catch { return { delimiter, score: -1 }; }
  }).sort((a, b) => b.score - a.score);
  const delimiter = options.delimiter || scores[0].delimiter;
  if (![',', ';', '\t', '|'].includes(delimiter)) throw new Error('READER_DELIMITER_UNSUPPORTED');
  const startRow = Math.max(1, Number(options.startRow) || 1), rowLimit = Math.min(100, Math.max(1, Number(options.rowLimit) || 21));
  const parsed = parseRows(text, delimiter, rowLimit, startRow), table_id = 'csv:1';
  const ambiguous = !options.delimiter && scores[0].score === scores[1].score;
  return boundedStructuredResult({ extractor: 'csv-structured', partial: ambiguous || parsed.truncated || startRow > 1 || parsed.rowCount > parsed.sample.length, metadata: { encoding: decoded.encoding, encoding_basis: decoded.encoding_basis, delimiter, delimiter_ambiguous: ambiguous, total_rows: parsed.rowCount, total_columns: parsed.columns },
    sections: parsed.sample.map((row, index) => ({ table_id, text: row.join('\t'), source: { kind: 'csv_row', row: startRow + index } })),
    tables: [{ table_id, rows: parsed.sample, header_candidate: startRow === 1 ? parsed.sample[0] || [] : [], header_confirmed: false, first_row: startRow, total_rows: parsed.rowCount, total_columns: parsed.columns }] }, limit);
}
