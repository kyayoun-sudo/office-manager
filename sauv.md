# sauv.md — Ce que j'ai compris d'Office Manager AI (lecture du 2026-10-30)

Branche lue : `feature/white-label-desktop` (à jour avec `origin`). Dernier commit : `6215663 ci: verify SQL schema with full release gate`.
Ce fichier résume la lecture du code et des documents. Il complète `CLAUDE.md` (mémoire du projet) sans le remplacer.

## 1. Le produit en une phrase
Un « Office Manager » à base d'agents IA pour cabinets d'audit et d'expertise (premier cabinet : TATY & Associés, de Paul KOMENAN).
Il lit le Drive et le Gmail du cabinet, range les documents, suit les opportunités, les missions, les pièces (PBC), les working files
Excel et les revues. **L'IA interprète, le code lit, mesure, vérifie et garde les règles ; l'humain décide et signe.**
Le produit doit servir **tout cabinet**, sans rien de propre à TATY dans le code.

## 2. Taille et technologie
- Node ≥ 20, modules ES (`"type": "module"`), aucun framework web : fonctions serverless Vercel + pages HTML statiques.
- `lib/` : 258 modules (~49 000 lignes) ; `api/` : 11 points d'accès (plafond Vercel Hobby = 12 → tout le nouveau passe par
  `api/app.js`, ~180 routes `?route=`) ; `agents/index.js` (agents OpenAI Agents SDK) ; ~40 pages `*.html` + `assets/*.js`.
- Base : Supabase (PostgREST appelé en REST, clé service_role côté serveur seulement) ; SQL dans `db/*.sql`, tout regroupé dans
  `db/INSTALL_TOUT.sql` ; `tests/schema-coverage.test.js` installe la base vide (PGlite) et vérifie les colonnes lues par le code.
- Dépendances : `@openai/agents`, `exceljs`, `xlsx` (SheetJS depuis le CDN), `jszip`, `mammoth` (Word), `unpdf`, `pdf-lib`, `pdfkit`, `zod`.
- IA : plusieurs fournisseurs (`lib/ai.js`, `lib/ai-plus.js`, `lib/ai-pool.js`) — ChatGPT, Claude, Gemini, OpenRouter (part réglable
  `OPENROUTER_SHARE`, défaut 45 %), Grok, Mistral, Groq, Ollama… ; « Mon IA » (`lib/personal-ai.js`) = la clé d'IA propre à une personne.
- Application bureau : `desktop/` (Tauri) ; complément Excel : `excel/taskpane.html`.
- Tests : `node --test tests/*.test.js` (225 fichiers, 1 283 tests, ~3 min) ; `npm run check` = `node --check` sur les fichiers clés ;
  `npm run test:sql`. CI dans `.github/workflows`.

## 3. Comment une requête est traitée (`api/app.js` → `handleApp`)
1. Route inconnue / méthode absente → 404 / 405.
2. Sauf route publique (`open`) : **jeton pilote partagé** `x-office-manager-token` = `OFFICE_MANAGER_ACCESS_TOKEN`
   (`lib/auth.js`). Ce jeton est remis au navigateur à la connexion (`pilot_token` dans `lib/accounts.js`).
3. Cabinet de la requête : `resolveRequestOrg` (`lib/firm-context.js`). Sans `OFFICE_MANAGER_MULTI_CABINET=on` → `DEFAULT_ORG_ID`
   sans contrôle d'appartenance. Avec l'interrupteur : en-tête `x-office-manager-org` + membre actif (session Supabase) ou appel interne
   signé HMAC (`x-office-manager-internal`). Le cabinet est gardé dans un `AsyncLocalStorage` (`runInFirm`, `currentOrgId`).
4. Routes « propriétaire » (`owner(...)`) : code propriétaire `x-office-manager-owner-token` (cabinet pilote seulement) ou session
   personnelle d'un associé / propriétaire.
5. Routes `users(ROLES, ...)` : session personnelle (`Authorization: Bearer <jeton Supabase>`) + rôle (`lib/user-auth.js`, cache 15 s).
6. Routes liées à un écran (`ROUTE_SCREENS`) : matrice écrans × rôles (`lib/permissions.js`) + accès à la mission (`lib/mission-access.js`).
7. Connexion Google du cabinet chargée, puis exécution dans le contexte du cabinet, de l'acteur (`lib/operation-context.js`) et
   éventuellement de « Mon IA ».
8. Erreurs : codes 4xx affichés tels quels ; 5xx → code `unavailable` de la route + `detail` (raccourci, « secrets masqués »).

Routes `*-step` = travail en arrière-plan enchaîné : la fonction se rappelle elle-même (`fireInternal` dans
`lib/agent-passes-legacy.js`, `continueInBackground` dans `api/app.js`) avec le jeton pilote.

## 4. Les agents (et leur code)
| Agent | Rôle | Code principal |
|---|---|---|
| Firm Manager (« grand-controleur ») | portefeuille, personnes, opportunités TDR/AMI, acceptation, veille des appels d'offres | `agents/index.js`, `lib/opportunities.js`, `lib/tender-watch.js`, `lib/acceptance-workbook.js` |
| Mission Controller | cycle de vie d'une mission, PBC, échéances, création directe de mission | `lib/mission-*.js`, `lib/pbc-loop.js`, `lib/mission-quick.js` |
| Enhanced Auditor | programme de travail, « Ma procédure », working files, revues | `lib/enhanced-auditor*.js`, `lib/procedure-*.js`, `lib/workfile-*.js`, `lib/fill-orders.js`, `lib/sheet-understanding.js` |
| Orpailleur | lecture et rangement des documents du Drive | `lib/tidy-plan.js`, `lib/tidy-plan-domain.js`, `lib/orpailleur-*.js`, `lib/mapping-scan.js` |
| Sika | honoraires, factures, encaissements, dépenses | passages `sika`, `lib/sika-*.js` |
| Shadow | labo d'apprentissage : leçons validées, enquêtes, veille open source, PR en brouillon | `lib/shadow*.js` |

**Nouveau depuis le 2026-10-29 (absent de CLAUDE.md)** : un « noyau universel » des agents.
- `lib/agent-kernel.js` `runAgentKernel` : boucle OBSERVE → THINK/WORK → ACT → VERIFY → CHECKPOINT ; statuts `running`, `verified`,
  `awaiting_human`, `blocked`. Un agent n'est « vérifié » que par `verify()` qui relit le système réel.
- Noyaux par agent : `orpailleur-kernel.js`, `mission-controller-kernel.js`, `enhanced-auditor-kernel.js`, `working-file-kernel.js`,
  `office-manager-kernel.js`, `shadow-kernel.js`, `sika-kernel.js` ; actions communes `kernel-actions.js`.
- `lib/agent-passes.js` est devenu une façade : l'ancien planificateur est gardé tel quel dans `lib/agent-passes-legacy.js` et les
  noyaux y sont injectés.
- `lib/agent-brain.js` `think()` / `runApproved()` : l'IA rend des ordres parmi une liste FERMÉE d'actions ; le code vérifie,
  exécute et distingue maintenant `executed_unverified` de `verified`.
- Règle commune donnée à toutes les IA (« RÈGLE COMMUNE IA + CODE ») : `lib/agent-contract.js`.

## 5. Mémoires
- Petite mémoire structurée dans Supabase (`office_*`) ; grande mémoire chez le cabinet (fichiers JSON dans le Drive,
  `00_…AI_MANAGER/MEMORY`).
- Fichiers mémoire protégés par `lib/memory-files.js` (`guardMemory` : retenus par ID, jamais créés deux fois, copies jamais à la corbeille).
- Mémoire de mission unique : `OFFICE_MANAGER_MISSION_FILES.json` (index central) + `<mission>/_OFFICE_MANAGER/OFFICE_MANAGER_MISSION_MEMORY.json` ;
  notes partagées entre agents : `lib/mission-brief.js`.
- Une mémoire par Drive (`drive_id`) ; jamais celle d'un autre Drive.

## 6. Principes à ne pas casser (extraits de CLAUDE.md)
Preuve avant hypothèse (le contenu, pas le nom) ; l'humain garde le jugement ; une seule vérité ; tout est tracé (`lib/audit-log.js`) ;
référence d'abord, contenu à la demande ; idempotence (`POSSIBLE_DUPLICATE`) ; « je ne peux pas le prouver » plutôt qu'un faux « fait » ;
rien supprimé ni écrasé ; aucun agent n'élève ses droits ; aucun secret dans le navigateur.
Règles de travail : branche `feature/white-label-desktop` ; `npm test` vert avant chaque commit ; production promue par Paul seulement ;
fichiers CRLF à garder en CRLF ; tout ce que Paul doit faire va dans `docs/A_FAIRE_DE_VOTRE_COTE.txt`.

## 7. État constaté le 2026-10-30
- `npm run check` : OK.
- `npm test` au début : **1 278 réussis, 4 échecs, 1 ignoré** (sur 1 283) (détail dans `AUDIT_2026-10-30.md`).
  Après les corrections du même jour : **1 286 réussis, 0 échec, 1 ignoré** (sur 1 287).
- Fichier non suivi : `docs/BILAN_2026-10-25.txt`.
- L'affichage PowerShell montre des accents cassés (« Ã© ») : c'est la console (encodage ANSI), pas les fichiers — aucun
  caractère cassé trouvé dans `lib/`, `api/`, `agents/`, `assets/`.

## 8. Pièges repérés en lisant
- Le jeton pilote est un **secret fixe partagé**, remis à chaque personne connectée et gardé dans son navigateur.
- Plusieurs contrôles d'accès s'appliquent seulement si une session personnelle est présente (`if (account) requireMissionAccess…`).
- 537 `.catch(() => null | [] | {} | false)` dans `lib/` : beaucoup d'erreurs sont tues ; une panne peut ressembler à « rien trouvé ».
- CLAUDE.md ne décrit pas encore le noyau universel des agents (§4 ci-dessus).
