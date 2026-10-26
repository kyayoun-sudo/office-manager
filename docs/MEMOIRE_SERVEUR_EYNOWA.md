# La mémoire des leçons sur le serveur EYNOWA — ce que Christian doit faire

Demande de Paul (26 octobre 2026) : les agents apprennent des anciens audits complets de TATY. Les documents sont déposés dans
l'outil d'entraînement, lus par les agents, puis effacés. Seules les **leçons** restent, et elles sont gardées sur le serveur EYNOWA.

## Ce qui part sur le serveur
- Uniquement des **leçons** : des règles sur la façon de travailler du cabinet (méthode, structure d'un dossier, façon de conclure,
  de nommer et de ranger), chacune pour un agent (Firm Manager, Mission Controller, Enhanced Auditor, Orpailleur, Sika).
- Jamais un document ni une donnée de client. Avant tout envoi, le code retire les montants, les dates, les courriels, les téléphones,
  les numéros de compte et les noms propres que l'IA a repérés.
- Une leçon n'est envoyée qu'après deux accords : l'entraîneur la garde, puis un associé la valide (Entraînement → Tests spécialisés).
- La liste des leçons reste aussi dans la base de l'application : si le serveur est éteint, rien n'est perdu, et les leçons partent
  quand il répond de nouveau.

## Le chemin (rien de nouveau à ouvrir sur Internet)
Vercel → broker Cloudflare (`EYNOWA_BROKER_URL` / `EYNOWA_BROKER_KEY`, déjà réglés) → file d'attente → worker EYNOWA → passerelle
locale (`lab-gateway-server.js`) → Ollama (calcul des vecteurs) + Chroma (stockage). C'est le même chemin que `ai.local_chat` aujourd'hui.

## À faire par Christian, sur la machine du worker EYNOWA
1. **Chroma** (la base de la mémoire), avec un disque persistant, accessible seulement depuis la machine :
   `docker run -d --name chroma --restart unless-stopped -p 127.0.0.1:8000:8000 -v /data/chroma:/data chromadb/chroma`
   (dossier `/data` pour Chroma 1.x ; `/chroma/chroma` pour les versions 0.5 et avant.)
2. **Le modèle des vecteurs** dans Ollama : `ollama pull nomic-embed-text-v2-moe`
3. **La passerelle** (`lab-gateway-server.js` du dépôt, branche `feature/entrainement-agents`) avec ces variables :
   - `EYNOWA_TOOL_GATEWAY_ENABLED=true`
   - `CHROMA_BASE_URL=http://127.0.0.1:8000`
   - `OLLAMA_BASE_URL=http://127.0.0.1:11434`
   - `OLLAMA_EMBEDDING_MODEL=nomic-embed-text-v2-moe`
   - `EYNOWA_LAB_API_KEY=<la clé qu'il utilise déjà>`
4. **Le broker et le worker** acceptent deux nouveaux types de travaux, traités exactement comme `ai.local_chat` :
   | Type de travail | Le worker appelle sur la passerelle | Il renvoie |
   | --- | --- | --- |
   | `memory.semantic_store` | `POST /memory/semantic-store` avec le `request` reçu | la réponse JSON de la passerelle (`{ stored: true, id, … }`) |
   | `memory.semantic_search` | `POST /memory/semantic-search` avec le `request` reçu | la réponse JSON de la passerelle (`{ result: { documents, metadatas, distances } }`) |
   Le `request` contient `collection` (`office_manager_lessons`), `text` + `id` + `metadata` (enregistrement), ou `query` + `nResults` +
   `where` (recherche). Aucune autre opération de la passerelle ne doit être ouverte au broker.
5. **Sauvegarde** : une copie quotidienne de `/data/chroma`, gardée au moins 30 jours. C'est la mémoire apprise : la perdre, c'est
   refaire l'entraînement.
6. **Vérifier** : dans l'application, Entraînement → Tests spécialisés → « Vérifier la mémoire du serveur EYNOWA » doit afficher
   « La mémoire répond ». Tant que ce n'est pas le cas, le message dit pourquoi (par exemple `EYNOWA_BROKER_JOB_FAILED: unknown type`).

## À faire par Paul
- Rien dans Vercel : aucune nouvelle clé d'API n'est nécessaire.
- Envoyer ce document à Christian.
- Déposer les anciens audits dans l'outil d'entraînement (une mission d'entraînement par audit), puis valider les leçons gardées.

## Code de l'application (fait)
- `lib/eynowa-lab.js` → `labMemory('store' | 'search', …)` : passe par le broker (types ci-dessus), sinon par l'ancienne passerelle directe.
- `lib/lesson-memory.js` → nettoyage des leçons (`redact`), envoi (`pushLesson`), recherche (`searchLessons`, 8 s maximum ; un serveur
  qui ne répond pas n'est plus interrogé pendant 10 minutes, le travail n'attend jamais), état et renvoi (`memoryStatus`, `syncPending`).
- `lib/agent-gym.js` → étude d'un ancien audit (`archive-read`, un fichier par appel, les .zip ouverts), leçons gardées / corrigées /
  retirées (`archive-judge`), fichiers effacés (`archive-forget`, `EFFACER`) ; `lessonsFor` donne à chaque agent les leçons des anciens
  audits qui le concernent (le serveur d'abord, la base sinon).
- Non essayé : le vrai serveur EYNOWA, la vraie IA, un vrai dossier d'audit.
