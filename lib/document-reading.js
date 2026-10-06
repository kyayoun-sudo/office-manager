export const MISSION_DOCUMENT_MAX_CHARS = 200000;

export function documentReadLimit(maxChars) {
  return Math.min(Math.max(Number(maxChars) || 30000, 1000), MISSION_DOCUMENT_MAX_CHARS);
}

export function spreadsheetCellText(cell) {
  const value = cell.value;
  if (value && typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) {
      if (value.result === undefined || value.result === null) return '[FORMULA_RESULT_UNAVAILABLE]';
      if (typeof value.result === 'object') return value.result.error || '[FORMULA_RESULT_UNAVAILABLE]';
      return String(value.result);
    }
    if (value.richText) return value.richText.map(part => part.text).join('');
    if (value.text !== undefined) return String(value.text);
    if (value.error) return value.error;
    if (value instanceof Date) return value.toISOString();
  }
  return cell.text || (value === null || value === undefined ? '' : String(value));
}
