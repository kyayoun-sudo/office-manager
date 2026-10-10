import { STRUCTURED_MIMES } from './structured-reading.js';

export function readerRoute(file) {
  const mime = file.mimeType || file.mime_type || '';
  if (Number(file.size) > 8000000) return { eligibility: 'TOO_LARGE', reader: null };
  if (mime === 'application/vnd.google-apps.folder' || mime === 'application/vnd.google-apps.shortcut' || /^(video|audio)\//.test(mime) || /(?:\.tmp$|\.part$|^~\$)/i.test(file.name || '') || ['application/zip', 'application/x-msdownload', 'application/x-iso9660-image'].includes(mime)) return { eligibility: 'SKIP', reader: null };
  const readers = { [STRUCTURED_MIMES[0]]: 'DOCX_READER', [STRUCTURED_MIMES[1]]: 'XLSX_READER', [STRUCTURED_MIMES[2]]: 'PPTX_READER', 'application/pdf': 'PDF_READER', 'application/vnd.google-apps.document': 'GOOGLE_DOC_READER', 'application/vnd.google-apps.spreadsheet': 'GOOGLE_SHEET_READER', 'application/vnd.google-apps.presentation': 'GOOGLE_SLIDE_READER', 'text/csv': 'CSV_READER', 'application/csv': 'CSV_READER', 'application/json': 'TEXT_READER' };
  const reader = readers[mime] || (mime.startsWith('text/') ? 'TEXT_READER' : /^image\/(png|jpe?g|webp|gif)$/.test(mime) ? 'IMAGE_READER' : null);
  return { eligibility: reader ? 'SUPPORTED' : /msword|ms-excel|ms-powerpoint|octet-stream/.test(mime) ? 'NEEDS_SPECIAL_READER' : 'UNSUPPORTED', reader };
}
