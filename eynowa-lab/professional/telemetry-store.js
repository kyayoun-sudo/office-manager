import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_HOME = process.env.EYNOWA_LAB_HOME || path.join(os.homedir(), '.eynowa-lab');
const TELEMETRY_FILE = process.env.EYNOWA_LAB_TELEMETRY_FILE || path.join(DEFAULT_HOME, 'professional-telemetry.jsonl');

async function ensureHome() {
  await fs.mkdir(path.dirname(TELEMETRY_FILE), { recursive: true });
}

async function append(row) {
  await ensureHome();
  await fs.appendFile(TELEMETRY_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`, 'utf8');
}

async function readAll() {
  try {
    const text = await fs.readFile(TELEMETRY_FILE, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function recordProfessionalTelemetry({ request = {}, result = {}, source = 'query' } = {}) {
  const row = {
    type: 'query',
    source,
    application: String(request.application || result.application || ''),
    domains: Array.isArray(result.domains) ? result.domains : (Array.isArray(request.domains) ? request.domains : []),
    topics: Array.isArray(result.topics) ? result.topics : [],
    frameworks: Array.isArray(result.frameworks) ? result.frameworks : [],
    requires_validation: Boolean(result.requires_validation),
    high_judgment: Boolean(result.high_judgment),
    knowledge_hits: Number(result.knowledge_hits || 0),
    memory_hits: Number(result.memory_hits || 0),
    generation_model: String(result.generation_model || ''),
    generation_fallback: Boolean(result.generation_fallback),
    deterministic_fallback: Boolean(result.generation_deterministic_fallback),
    json_repaired: Boolean(result.generation_json_repaired),
    generation_error: String(result.generation_error || '').slice(0, 500),
    timings_ms: result.timings_ms || {},
  };
  await append(row);
  return row;
}

export async function recordProfessionalFeedback(body = {}) {
  const rating = String(body.rating || '').toLowerCase();
  if (!['accepted', 'corrected', 'rejected', 'helpful', 'not_helpful'].includes(rating)) {
    throw new Error('INVALID_PROFESSIONAL_FEEDBACK_RATING');
  }
  const row = {
    type: 'feedback',
    validation_id: String(body.validation_id || ''),
    application: String(body.application || ''),
    domain: String(body.domain || ''),
    topic: String(body.topic || ''),
    rating,
    note: String(body.note || '').slice(0, 4000),
    corrected_decision: String(body.corrected_decision || '').slice(0, 12000),
  };
  await append(row);
  return { ok: true, ...row };
}

export async function professionalMetrics({ limit = 5000 } = {}) {
  const rows = (await readAll()).slice(-Math.max(1, Math.min(Number(limit) || 5000, 20000)));
  const queries = rows.filter((row) => row.type === 'query');
  const feedback = rows.filter((row) => row.type === 'feedback');
  const total = queries.length;
  const avg = (field) => total ? Math.round(queries.reduce((sum, row) => sum + Number(row?.timings_ms?.[field] || 0), 0) / total) : 0;
  const count = (fn) => queries.filter(fn).length;

  return {
    total_queries: total,
    validation_rate: total ? count((row) => row.requires_validation) / total : 0,
    fallback_rate: total ? count((row) => row.generation_fallback || row.deterministic_fallback) / total : 0,
    deterministic_fallback_rate: total ? count((row) => row.deterministic_fallback) / total : 0,
    json_repair_rate: total ? count((row) => row.json_repaired) / total : 0,
    average_timings_ms: {
      retrieval: avg('retrieval'),
      generation: avg('generation'),
      total: avg('total'),
    },
    average_knowledge_hits: total ? queries.reduce((sum, row) => sum + Number(row.knowledge_hits || 0), 0) / total : 0,
    feedback: {
      total: feedback.length,
      accepted: feedback.filter((row) => row.rating === 'accepted').length,
      corrected: feedback.filter((row) => row.rating === 'corrected').length,
      rejected: feedback.filter((row) => row.rating === 'rejected').length,
      helpful: feedback.filter((row) => row.rating === 'helpful').length,
      not_helpful: feedback.filter((row) => row.rating === 'not_helpful').length,
    },
    by_application: Object.fromEntries([...new Set(queries.map((row) => row.application).filter(Boolean))].map((app) => [app, queries.filter((row) => row.application === app).length])),
  };
}

export function professionalTelemetryPath() {
  return TELEMETRY_FILE;
}
