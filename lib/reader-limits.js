export const PDF_READER_MAX_BYTES = 100 * 1024 * 1024;
export const DEFAULT_READER_MAX_BYTES = 8000000;
export const readerByteLimit = file => /application\/pdf/i.test(file?.mimeType || file?.mime_type || '') ? PDF_READER_MAX_BYTES : DEFAULT_READER_MAX_BYTES;
