import { existsSync } from 'node:fs';
import { ChromaClient } from 'chromadb';
import { collectionForDomain, validateKnowledgeChunk } from './knowledge-contract.js';

const RUNNING_IN_DOCKER = existsSync('/.dockerenv');

function defaultChromaHost() {
  return RUNNING_IN_DOCKER ? 'host.docker.internal' : '127.0.0.1';
}

function defaultOllamaUrl() {
  return RUNNING_IN_DOCKER ? 'http://host.docker.internal:11434' : 'http://127.0.0.1:11434';
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function chromaClient() {
  return new ChromaClient({
    host: process.env.CHROMA_HOST || defaultChromaHost(),
    port: number(process.env.CHROMA_PORT, 8000),
    ssl: String(process.env.CHROMA_SSL || '').toLowerCase() === 'true',
  });
}

async function withTimeout(promise, timeoutMs, code) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${code} after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function embedTexts(texts, { timeoutMs = number(process.env.OLLAMA_EMBED_TIMEOUT_MS, 45000) } = {}) {
  const base = (process.env.OLLAMA_HOST || process.env.OLLAMA_URL || defaultOllamaUrl()).replace(/\/$/, '');
  const model = process.env.OLLAMA_EMBED_MODEL || 'embeddinggemma';
  const input = Array.isArray(texts) ? texts : [texts];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${base}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`OLLAMA_EMBED_${response.status}: ${data?.error || response.statusText}`);
    if (!Array.isArray(data?.embeddings) || data.embeddings.length !== input.length) {
      throw new Error('OLLAMA_EMBED_INVALID_RESPONSE');
    }
    return data.embeddings;
  } catch (error) {
    if (error?.name === 'AbortError' || Number(error?.code) === 20) {
      throw new Error(`OLLAMA_EMBED_TIMEOUT after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function primitiveMetadata(chunk) {
  const meta = chunk.metadata || {};
  return {
    source_id: chunk.sourceId,
    domain: chunk.domain,
    framework: chunk.framework || '',
    authority: chunk.authority || '',
    title: chunk.title || '',
    reference: chunk.reference || '',
    version: chunk.version || '',
    effective_from: chunk.effectiveFrom || '',
    effective_to: chunk.effectiveTo || '',
    jurisdiction: chunk.jurisdiction || '',
    country: chunk.country || '',
    language: chunk.language || '',
    source_url: chunk.sourceUrl || '',
    license_basis: chunk.licenceBasis || '',
    topic: String(meta.topic || ''),
    subtopic: String(meta.subtopic || ''),
    source_kind: String(meta.source_kind || ''),
    normative_text: Boolean(meta.normative_text),
    requires_normative_followup: Boolean(meta.requires_normative_followup),
    extra_json: JSON.stringify(meta),
  };
}

function stableId(chunk) {
  if (chunk.id) return chunk.id;
  const seed = [chunk.sourceId, chunk.domain, chunk.framework, chunk.reference, chunk.version, chunk.content.slice(0, 200)].join('|');
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${chunk.sourceId}-${(hash >>> 0).toString(16)}`;
}

async function getCollection(domain) {
  const client = chromaClient();
  return withTimeout(client.getOrCreateCollection({
    name: collectionForDomain(domain),
    embeddingFunction: null,
    metadata: { purpose: 'EYNOWA Lab professional knowledge', domain },
  }), number(process.env.CHROMA_COLLECTION_TIMEOUT_MS, 15000), `CHROMA_COLLECTION_TIMEOUT_${domain}`);
}

function resultRows(result, domain) {
  const ids = result?.ids?.[0] || [];
  const docs = result?.documents?.[0] || [];
  const metas = result?.metadatas?.[0] || [];
  const distances = result?.distances?.[0] || [];
  return ids.map((id, index) => {
    const metadata = metas[index] || {};
    return {
      id,
      domain,
      content: docs[index] || '',
      distance: typeof distances[index] === 'number' ? distances[index] : null,
      sourceId: metadata.source_id || '',
      authority: metadata.authority || '',
      framework: metadata.framework || '',
      reference: metadata.reference || '',
      version: metadata.version || '',
      effectiveFrom: metadata.effective_from || '',
      effectiveTo: metadata.effective_to || '',
      jurisdiction: metadata.jurisdiction || '',
      country: metadata.country || '',
      language: metadata.language || '',
      sourceUrl: metadata.source_url || '',
      licenseBasis: metadata.license_basis || '',
      topic: metadata.topic || '',
      subtopic: metadata.subtopic || '',
      sourceKind: metadata.source_kind || '',
      normativeText: Boolean(metadata.normative_text),
      requiresNormativeFollowup: Boolean(metadata.requires_normative_followup),
    };
  });
}

function frameworkMatches(row, frameworks) {
  if (!Array.isArray(frameworks) || !frameworks.length) return true;
  const value = String(row.framework || '').toLowerCase();
  return frameworks.some((framework) => {
    const wanted = String(framework || '').toLowerCase();
    return wanted && (value === wanted || value.includes(wanted) || wanted.includes(value));
  });
}

function countryMatches(row, country) {
  if (!country) return true;
  const value = String(row.country || '').trim().toUpperCase();
  const jurisdiction = String(row.jurisdiction || '').trim().toUpperCase();
  const wanted = String(country).trim().toUpperCase();
  return !value || value === wanted || value === 'INTL' || value === 'INTERNATIONAL' || jurisdiction === 'INTERNATIONAL' || jurisdiction === 'OHADA';
}

function topicRank(row, topics) {
  if (!Array.isArray(topics) || !topics.length) return 1;
  if (row.domain !== 'accounting') return 1;
  const topic = String(row.topic || '').trim();
  if (!topic) return 2;
  return topics.includes(topic) ? 0 : 3;
}

function rankRows(rows, topics) {
  return [...rows].sort((a, b) =>
    topicRank(a, topics) - topicRank(b, topics) ||
    (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY)
  );
}

function balancedRows(rows, domains, topics, limit) {
  const requested = Array.isArray(domains) ? domains.filter(Boolean) : [];
  const target = Math.max(1, Number(limit) || 8);
  if (requested.length <= 1) return rankRows(rows, topics).slice(0, target);

  const quota = Math.max(2, Math.floor(target / requested.length));
  const selected = [];
  const selectedIds = new Set();

  for (const domain of requested) {
    const domainRows = rankRows(rows.filter((row) => row.domain === domain), topics).slice(0, quota);
    for (const row of domainRows) {
      if (selectedIds.has(row.id)) continue;
      selected.push(row);
      selectedIds.add(row.id);
    }
  }

  if (selected.length < target) {
    for (const row of rankRows(rows, topics)) {
      if (selected.length >= target) break;
      if (selectedIds.has(row.id)) continue;
      selected.push(row);
      selectedIds.add(row.id);
    }
  }

  return selected.slice(0, target);
}

export async function upsertKnowledgeChunks(inputs = []) {
  const chunks = inputs.map(validateKnowledgeChunk);
  const groups = new Map();
  for (const chunk of chunks) {
    const rows = groups.get(chunk.domain) || [];
    rows.push(chunk);
    groups.set(chunk.domain, rows);
  }

  const summary = [];
  for (const [domain, rows] of groups) {
    const collection = await getCollection(domain);
    const embeddings = await embedTexts(rows.map((row) => row.content));
    const ids = rows.map(stableId);
    await withTimeout(collection.upsert({
      ids,
      embeddings,
      documents: rows.map((row) => row.content),
      metadatas: rows.map(primitiveMetadata),
    }), number(process.env.CHROMA_UPSERT_TIMEOUT_MS, 30000), `CHROMA_UPSERT_TIMEOUT_${domain}`);
    summary.push({ domain, collection: collectionForDomain(domain), count: rows.length, ids });
  }
  return summary;
}

export async function searchChromaKnowledge({
  domain,
  domains,
  framework = '',
  frameworks = [],
  topics = [],
  country = '',
  query = '',
  limit = 8,
} = {}) {
  if (!String(query || '').trim()) return [];
  const requestedDomains = Array.isArray(domains) && domains.length ? domains : (domain ? [domain] : ['accounting', 'audit', 'advisory']);
  const requestedFrameworks = Array.isArray(frameworks) && frameworks.length ? frameworks : (framework ? [framework] : []);

  const collectionStates = await Promise.all(requestedDomains.map(async (currentDomain) => {
    const collection = await getCollection(currentDomain);
    let count = 0;
    try {
      count = Number(await withTimeout(collection.count(), number(process.env.CHROMA_COUNT_TIMEOUT_MS, 10000), `CHROMA_COUNT_TIMEOUT_${currentDomain}`)) || 0;
    } catch (error) {
      throw new Error(`${error.message}; domain=${currentDomain}`);
    }
    return { domain: currentDomain, collection, count };
  }));
  const searchable = collectionStates.filter((item) => item.count > 0);
  if (!searchable.length) return [];

  const queryEmbedding = (await embedTexts([String(query)]))[0];
  const perDomainLimit = Math.max(4, Math.ceil((Number(limit) || 8) / searchable.length) * 3);
  const queryTimeoutMs = number(process.env.CHROMA_QUERY_TIMEOUT_MS, 20000);

  const queryResults = await Promise.all(searchable.map(async (item) => {
    const result = await withTimeout(item.collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: Math.max(1, Math.min(perDomainLimit, item.count)),
      include: ['documents', 'metadatas', 'distances'],
    }), queryTimeoutMs, `CHROMA_QUERY_TIMEOUT_${item.domain}`);
    return resultRows(result, item.domain);
  }));

  const rows = queryResults.flat();
  const filtered = rows
    .filter((row) => frameworkMatches(row, requestedFrameworks))
    .filter((row) => countryMatches(row, country));

  return balancedRows(filtered, requestedDomains, topics, limit);
}

export async function chromaHealth() {
  const host = process.env.CHROMA_HOST || defaultChromaHost();
  const client = chromaClient();
  const heartbeat = await withTimeout(client.heartbeat(), number(process.env.CHROMA_HEALTH_TIMEOUT_MS, 10000), 'CHROMA_HEALTH_TIMEOUT');
  return {
    ok: true,
    heartbeat,
    host,
    port: number(process.env.CHROMA_PORT, 8000),
    collections: ['eynowa_accounting', 'eynowa_audit', 'eynowa_advisory'],
    embeddingModel: process.env.OLLAMA_EMBED_MODEL || 'embeddinggemma',
  };
}
