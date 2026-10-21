# Tool Gateway laboratory adapters

Disabled by default: enable only with `EYNOWA_TOOL_GATEWAY_ENABLED=true`.
No existing agent imports these adapters. Node.js 20+ is required.

## Configuration

`CHROMA_BASE_URL`, `MEILISEARCH_BASE_URL`, `N8N_BASE_URL` accept service base
URLs (including a reverse-proxy prefix). Local defaults are respectively
`http://127.0.0.1:8000`, `http://127.0.0.1:7700`, `http://127.0.0.1:5678`.
On Vercel there are no localhost defaults: explicitly configure reachable URLs.
Use HTTPS for remote services and keep credentials in server environment variables.

Optional authentication:
- `CHROMA_API_KEY`: sent as `X-Chroma-Token`.
- `MEILISEARCH_API_KEY`: sent as `Authorization: Bearer ...`.
- `N8N_API_KEY`: sent as `Authorization: Bearer ...` for a webhook configured
  with matching authentication; it is not an n8n management API key.
- `CHROMA_HEADERS_JSON`, `MEILISEARCH_HEADERS_JSON`, `N8N_HEADERS_JSON`:
  JSON objects of string header values, e.g. for proxy authentication or a custom
  webhook auth header. API key variables take precedence over conflicting headers.
  For Chroma Bearer auth, leave CHROMA_API_KEY unset and configure Authorization
  in CHROMA_HEADERS_JSON instead.

Credentials are not exposed by toolGatewayConfig(). The existing health probes
remain unauthenticated; a protected heartbeat may fail even if adapter calls work.

## Calls

```js
import { memoryStore, memorySearch, searchIndex, searchQuery, workflowRun }
  from './lib/tool-gateway.js';

await memoryStore({
  collectionId: 'existing-collection-uuid',
  ids: ['document-1'], embeddings: [[0.1, 0.2, 0.3]],
  documents: ['Document text'], metadatas: [{ mission: 'demo' }]
});
const memories = await memorySearch({
  collectionId: 'existing-collection-uuid', queryEmbeddings: [[0.1, 0.2, 0.3]],
  nResults: 5, where: { mission: 'demo' }
});
const task = await searchIndex({
  index: 'documents', primaryKey: 'id',
  documents: [{ id: 'document-1', text: 'Document text' }]
});
// Wait for task.taskUid to succeed in Meilisearch before expecting search visibility.
const hits = await searchQuery({
  index: 'documents', query: 'Document', options: { limit: 5 }
});
const result = await workflowRun({
  webhookPath: 'office/document-arrived', payload: { id: 'document-1' }
});
```

Chroma uses REST API v2 and existing collections, with optional `CHROMA_TENANT`
and `CHROMA_DATABASE` (defaults: `default_tenant`, `default_database`). It requires
caller-supplied embeddings from the same model and dimensions for storage and
query. No implicit embedding model, collection creation or migration occurs.
`whereDocument` and `include` are also accepted by memorySearch.

Meilisearch returns its task receipt for indexing and its native search response
for querying. Workflow execution uses POST `/webhook/<webhookPath>`: activate
or publish the n8n workflow and configure a POST Webhook node at that path.
A workflow ID is not a webhook path. A response confirms only what the workflow's
Webhook response mode guarantees, not necessarily completion of all its nodes.
JSON responses are parsed, text responses returned as strings, empty responses
as null. Every new adapter accepts `timeoutMs` (default 15000). HTTP errors expose
only the service and status. Requests do not retry or follow redirects.

## Verification

Run `node --test tests/tool-gateway.test.js` for isolated, mocked HTTP contract
tests. They require no credentials, running services or installed dependencies.
They cover disabled mode, Vercel configuration, new adapter payloads and auth,
validation, HTTP errors, timeouts, and existing Ollama/docTR/Gotenberg contracts.
These tests do not replace an integration test against your running services.
