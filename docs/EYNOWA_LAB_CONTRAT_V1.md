# EYNOWA Lab — contrat `eynowa-lab/1.0` (4 novembre 2026)

Un seul Lab, plusieurs applications (Office Manager, Accounting AI, autres). Le code reste dans ce dépôt ; le
service est indépendant : `lab-gateway-server.js` n'importe que `lib/tool-gateway.js` et `lib/lab-v1.js`
(builtins Node seulement — vérifié par `tests/lab-gateway-boundary.test.js`). L'image `Dockerfile.lab-gateway`
ne copie que ces fichiers.

## Démarrer / arrêter sans Office Manager

```
docker build -f Dockerfile.lab-gateway -t eynowa-lab-gateway:1.0 .
docker run -d --name eynowa-lab-gateway --restart unless-stopped -p 127.0.0.1:8787:8787 \
  --env-file lab-gateway.env -v eynowa-lab-config:/config:ro -v eynowa-lab-data:/data eynowa-lab-gateway:1.0
docker stop eynowa-lab-gateway   # arrêt
docker start eynowa-lab-gateway  # redémarrage ; les données sont dans Chroma / Meilisearch, pas dans le gateway
```

Hors Docker : `node lab-gateway-server.js` avec les mêmes variables.

| Variable | Rôle |
| --- | --- |
| `EYNOWA_TOOL_GATEWAY_ENABLED=true` | active les moteurs |
| `OLLAMA_BASE_URL`, `CHROMA_BASE_URL`, `MEILISEARCH_BASE_URL`, `DOCTR_BASE_URL`, `GOTENBERG_BASE_URL`, `N8N_BASE_URL` | moteurs locaux existants |
| `EYNOWA_LAB_MODEL` | modèle de réponse (doit exister dans `ollama list`) |
| `OLLAMA_EMBEDDING_MODEL` | modèle d'embedding (défaut `nomic-embed-text-v2-moe`) — **le même que celui qui a indexé la base existante** |
| `EYNOWA_LAB_API_KEY` | clé historique (routes anciennes d'Office Manager) |
| `EYNOWA_LAB_CLIENTS_FILE` | clés d'application v1, stockées en SHA-256 (voir ci-dessous) |
| `EYNOWA_LAB_KNOWLEDGE_FILE` | description des bases déjà indexées (SYSCOHADA…), sans les recréer |
| `EYNOWA_LAB_DATA_DIR` | journal des traces (`traces/AAAA-MM-JJ.jsonl`, sans contenu de pièce) |
| `EYNOWA_LAB_LEGACY_ROUTES=false` | coupe les routes anciennes une fois tous les consommateurs passés en v1 |

### Clés d'application (`EYNOWA_LAB_CLIENTS_FILE`)

```json
[{ "id": "accounting-ai", "key_sha256": "<sha256 de la clé>", "tenants": ["<installation>"],
   "knowledge": ["syscohada"], "can_remember": true },
 { "id": "office-manager", "key_sha256": "…", "tenants": ["<cabinet>"], "knowledge": ["syscohada", "isa"] }]
```

Empreinte : `printf %s "$CLE" | sha256sum`. La clé en clair n'est jamais écrite dans le fichier.

### Bases de connaissances existantes (`EYNOWA_LAB_KNOWLEDGE_FILE`)

```json
[{ "id": "syscohada", "kind": "chroma", "name": "<nom réel de la collection>", "authority": "normative",
   "domain": "syscohada", "version": "<version réelle>", "effective_from": "AAAA-MM-JJ",
   "text_field": "text", "ref_fields": ["document", "page", "section"] }]
```

`kind: "meilisearch"` pour un index Meilisearch (`name` = index). Le fichier **décrit** la base déjà ingérée ;
aucun appel ne la recrée ni ne la modifie.

## Routes v1 (clé d'application obligatoire ; la clé historique est refusée)

| Route | Entrée | Sortie |
| --- | --- | --- |
| `GET /livez` (sans clé) | — | `{ok, contract}` pour les healthchecks |
| `GET /v1/capabilities` | — | composants mesurés, modèles présents dans Ollama, bases autorisées pour la clé |
| `POST /v1/chat` | `{prompt, system?, model?}` | `{response, model, done}` |
| `POST /v1/knowledge/search` | `{query, sources?, as_of?, limit?}` | `{passages:[{passage_id, source_id, authority, version, document_id, text, reference, score}], sources_missing, sources_errors}` |
| `POST /v1/memory/search` | `{query, scope:{tenant, user?}, limit?}` | éléments de la mémoire **de ce tenant pour cette application** |
| `POST /v1/memory/remember` | `{text, scope, validation:{validated_by, validated_at}, idempotency_key, kind?, metadata?}` | `{stored, memory_id}` ; refusé sans validation humaine |
| `POST /v1/task` | `{task, input?, scope, knowledge?:{query, sources?, as_of?}, memory?:{query}, output_schema?, model?}` | `{trace_id, output, citations, rejected_citations, memory_used, has_authoritative_support, retrieval, warnings}` |

Règles appliquées par le code, quoi que demande l'appelant :
- la collection de mémoire est choisie par le Lab (`mem_<application>_<tenant>`), jamais par l'appelant ; filtre `tenant` imposé et revérifié ;
- un tenant ou une base non déclarés pour la clé = `403` ;
- une citation n'est gardée que si son `passage_id` a été récupéré **dans cet appel** ; les autres vont dans `rejected_citations` ;
- `has_authoritative_support` n'est vrai que pour un passage d'une base `authority: "normative"` ; la mémoire client n'est jamais une autorité ;
- écrire en mémoire exige `validated_by` et `validated_at` ; la même `idempotency_key` donne le même `memory_id`.

## Routes historiques (inchangées)

`GET /health`, `POST /ai/local-chat`, `/document/ocr`, `/document/convert-to-pdf`, `/memory/store`, `/memory/search`,
`/memory/semantic-store`, `/memory/semantic-search`, `/search/index`, `/search/query`, `/workflow/run` — clé historique.
Attention : elles donnent accès à toute collection. À couper (`EYNOWA_LAB_LEGACY_ROUTES=false`) quand Office Manager
aura sa propre clé v1. Le Broker Cloudflare (`/job` → `/result/:id`, type `ai.local_chat`) n'est pas dans ce dépôt ;
il ne transporte que le chat.

## Ce qui a été vérifié, et comment

- `tests/lab-v1.test.js` : périmètres, citations, mémoire, idempotence (moteurs remplacés par des doublures).
- `tests/lab-gateway-process.test.js` : vrai processus du gateway, Office Manager non lancé, Ollama **simulé**.
- Recette isolée du 4/11/2026 : vrai processus du gateway + **vrai Chroma** (persistant sur disque) + Ollama **simulé**,
  appelé par le client Python d'Accounting AI ; redémarrage du gateway et de Chroma : mémoire retrouvée.
- **Non vérifié** : le conteneur réel du Lab, ses modèles, sa base SYSCOHADA, ses mémoires (accès au PC non obtenu).
  Un résultat obtenu avec l'Ollama simulé prouve la tuyauterie, jamais la qualité d'une réponse.
