import { promises as fs } from 'node:fs';
import path from 'node:path';
import { upsertKnowledgeChunks, chromaHealth } from '../../chroma-adapter.js';

const ALLOWED_SOURCE_IDS = new Set([
  'OHADA_AUDCIF_SYSCOHADA',
  'OHADA_SYCEBNL',
]);

function parseInput(text, filename) {
  if (filename.toLowerCase().endsWith('.jsonl')) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        try { return JSON.parse(line); }
        catch (error) { throw new Error(`INVALID_JSONL_LINE_${index + 1}: ${error.message}`); }
      });
  }

  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.chunks)) return parsed.chunks;
  return [parsed];
}

function assertOhadaChunk(chunk, index) {
  const sourceId = String(chunk?.source_id || chunk?.sourceId || '').trim();
  if (!ALLOWED_SOURCE_IDS.has(sourceId)) {
    throw new Error(`OHADA_IMPORT_SOURCE_NOT_ALLOWED_${index + 1}: ${sourceId || 'missing source_id'}`);
  }

  const domain = String(chunk?.domain || '').trim().toLowerCase();
  if (domain !== 'accounting') {
    throw new Error(`OHADA_IMPORT_DOMAIN_MUST_BE_ACCOUNTING_${index + 1}`);
  }
}

async function main() {
  const filename = process.argv[2];
  if (!filename) {
    console.error('Usage: node eynowa-lab/professional/packs/ohada/import-ohada.js <authorised-ohada.json|jsonl>');
    process.exitCode = 2;
    return;
  }

  const absolute = path.resolve(filename);
  const text = await fs.readFile(absolute, 'utf8');
  const chunks = parseInput(text, absolute);
  chunks.forEach(assertOhadaChunk);

  const health = await chromaHealth();
  const imported = await upsertKnowledgeChunks(chunks);
  console.log(JSON.stringify({
    pack: 'ohada-accounting',
    health,
    file: absolute,
    chunks: chunks.length,
    imported,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
