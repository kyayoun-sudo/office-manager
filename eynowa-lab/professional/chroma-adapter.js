import { ChromaClient } from 'chromadb';
import { collectionForDomain, validateKnowledgeChunk } from './knowledge-contract.js';

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function chromaClient() {
  return new ChromaClient({
    host: process.env.CHROMA_HOST || '127.0.0.1',
    port: number(process.env.CHROMA_PORT, 8000),
    ssl: String(process.env.CHROMA_SSL || '').toLowerCase() === 'true',
  });
}

async function embedTexts(texts) {
  const base = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_EMBED_MODEL || 'embeddinggemma';
  const input = Array.isArray(texts) ? texts : [texts];

  const response = await fetch(`${base}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OLLAMA_EMBED_${response.status}: ${data?.error || response.statusText}`);
  }
  if (!Array.isArray(data?.embeddings) || data.embeddings.length !== input.length) {
    throw new Error('OLLAMA_EMBED_INVALID_RESPONSE');
  }
  return data.embeddings;
}

function primitiveMetadata(chunk) {
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
    extra_json: JSON.stringify(chunk.metadata || {}),
  };
}

function stableId(chunk) {
  if (chunk.id) return chunk.id;
  const seed = [
    chunk.sourceId,
    chunk.domain,
    chunk.framework,
    chunk.reference,
    chunk.version,
    chunk.content.slice(0, 200),
  ].join('|');
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${chunk.sourceId}-${(hash >>> 0).toString(16)}`;
}

async function getCollection(domain) {
  const client = chromaClient();
  return client.getOrCreateCollection({
    name: collectionForDomain(domain),
    embeddingFunction: null,
    metadata: { purpose: 'EYNOWA Lab professional knowledge', domain },
  });
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
    };
  });
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
    await collection.upsert({
      ids,
      embeddings,
      documents: rows.map((row) => row.content),
      metadatas: rows.map(primitiveMetadata),
    });
    summary.push({ domain, collection: collectionForDomain(domain), count: rows.length, ids });
  }
  return summary;
}

export async function searchChromaKnowledge({
  domain,
  domains,
  framework = '',
  country = '',
  query = '',
  limit = 10,
} = {}) {
  if (!String(query || '').trim()) return [];
  const requestedDomains = Array.isArray(domains) && domains.length
    ? domains
    : (domain ? [domain] : ['accounting', 'audit', 'advisory']);
  const queryEmbedding = (await embedTexts([String(query)]))[0];
  const perDomainLimit = Math.max(2, Math.ceil((Number(limit) || 10) / requestedDomains.length));
  const rows = [];

  for (const currentDomain of requestedDomains) {
    const collection = await getCollection(currentDomain);
    const whereParts = [];
    if (framework) whereParts.push({ framework: { $eq: String(framework) } });
    if (country) whereParts.push({ country: { $eq: String(country).toUpperCase() } });
    const where = whereParts.length === 0 ? undefined : (whereParts.length === 1 ? whereParts[0] : { $and: whereParts });
    const result = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: perDomainLimit,
      where,
      include: ['documents', 'metadatas', 'distances'],
    });
    rows.push(...resultRows(result, currentDomain));
  }

  return rows
    .sort((a, b) => (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY))
    .slice(0, Math.max(1, Number(limit) || 10));
}

export async function chromaHealth() {
  const client = chromaClient();
  const heartbeat = await client.heartbeat();
  return {
    ok: true,
    heartbeat,
    host: process.env.CHROMA_HOST || '127.0.0.1',
    port: number(process.env.CHROMA_PORT, 8000),
    collections: ['eynowa_accounting', 'eynowa_audit', 'eynowa_advisory'],
    embeddingModel: process.env.OLLAMA_EMBED_MODEL || 'embeddinggemma',
  };
}
