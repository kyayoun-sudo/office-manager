import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const DEFAULT_HOME = process.env.EYNOWA_LAB_HOME || path.join(os.homedir(), '.eynowa-lab');
const MEMORY_FILE = process.env.EYNOWA_LAB_MEMORY_FILE || path.join(DEFAULT_HOME, 'professional-memory.jsonl');

function normalise(value) {
  return String(value || '').trim().toLowerCase();
}

function tokens(value) {
  return new Set(normalise(value).split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 3));
}

function score(query, memory) {
  const q = tokens(query);
  if (!q.size) return 0;
  const haystack = tokens(`${memory.topic || ''} ${memory.decision || ''} ${memory.reason || ''} ${memory.client || ''}`);
  let hits = 0;
  for (const token of q) if (haystack.has(token)) hits += 1;
  return hits / q.size;
}

async function ensureHome() {
  await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true });
}

async function readAll() {
  try {
    const text = await fs.readFile(MEMORY_FILE, 'utf8');
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function rememberProfessionalMemory(entry = {}) {
  const record = {
    id: entry.id || randomUUID(),
    professionalId: String(entry.professionalId || entry.professional_id || 'default'),
    domain: String(entry.domain || '').toLowerCase(),
    client: String(entry.client || ''),
    topic: String(entry.topic || ''),
    decision: String(entry.decision || ''),
    reason: String(entry.reason || ''),
    source: String(entry.source || 'HUMAN_VALIDATED'),
    framework: String(entry.framework || ''),
    validatedAt: entry.validatedAt || new Date().toISOString(),
    metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
  };

  if (!['accounting', 'audit', 'advisory'].includes(record.domain)) throw new Error('INVALID_MEMORY_DOMAIN');
  if (!record.decision) throw new Error('MEMORY_DECISION_REQUIRED');
  if (record.source !== 'HUMAN_VALIDATED') throw new Error('ONLY_HUMAN_VALIDATED_MEMORY_IS_PERSISTED');

  await ensureHome();
  await fs.appendFile(MEMORY_FILE, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export async function searchProfessionalMemory({
  professionalId = 'default',
  domain,
  client = '',
  query = '',
  limit = 12,
} = {}) {
  const rows = await readAll();
  const wantedProfessional = String(professionalId);
  const wantedDomain = normalise(domain);
  const wantedClient = normalise(client);

  return rows
    .filter((row) => String(row.professionalId) === wantedProfessional)
    .filter((row) => !wantedDomain || normalise(row.domain) === wantedDomain)
    .filter((row) => !wantedClient || !row.client || normalise(row.client) === wantedClient)
    .map((row) => ({ ...row, _score: score(query, row) }))
    .filter((row) => row._score > 0 || !query)
    .sort((a, b) => b._score - a._score || String(b.validatedAt).localeCompare(String(a.validatedAt)))
    .slice(0, Math.max(1, Math.min(Number(limit) || 12, 50)))
    .map(({ _score, ...row }) => row);
}

export function professionalMemoryPath() {
  return MEMORY_FILE;
}
