# Office Manager AI — à lire avant toute modification

**Corrections Codex du 12 octobre 2026** : lire [le message pour Claude](docs/NOTE_POUR_CLAUDE_CORRECTIONS_2026-10-12.md) avant de poursuivre. Les corrections sont sur des branches dédiées ; les parcours métier sont conservés.

Projet de Paul KOMENAN (cabinet TATY & Associés, premier cabinet utilisateur). **Le produit est pour tous les cabinets
(Paul, 2026-10-11)** : rien de propre à TATY dans le code ; ce qui varie se règle dans Paramètres. Ce fichier est la mémoire de projet de Claude :
il est lu au début de chaque session. La pensée générale du produit est dans `docs/architecture/` et
**ne doit jamais être modifiée par du code** : on consolide l'existant, on ne reconstruit pas.

- `docs/architecture/01_SPECIFICATION_PRODUIT.md` — vision, agents, rôles, workflow de bout en bout.
- `docs/architecture/02_ARCHITECTURE_TECHNIQUE.md` — plans de données, connecteurs, événements, mémoire, sécurité.
- `docs/architecture/03_ORPAILLEUR_METIER.md` — l'Orpailleur décrit par lui-même (production ChatGPT).

## Les principes qui ne bougent pas

1. **Evidence before assumption.** Un nom de fichier ou de dossier n'est pas une preuve : on lit le contenu.
2. **L'humain garde le jugement professionnel.** L'IA propose ; acceptation client, indépendance,
   matérialité, conclusions, sign-off, opinion, émission du rapport, staffing et RH restent humains.
   Une recommandation de l'IA n'est jamais une approbation (« AI does not equal authority »).
3. **Une seule vérité opérationnelle.** Pas de mémoires ni de registres parallèles et contradictoires.
4. **Pas de travail invisible.** Toute action importante est tracée (audit log) : pourquoi, qui, quand, sur quelle preuve.
5. **Reference first — content on demand.** Les documents, emails, CV restent chez le cabinet (Drive, Gmail).
   Office Manager garde identifiants, liens, statuts, relations, événements, versions/hash, décisions,
   petites mémoires. Le contenu est lu au moment où l'IA en a besoin, puis le buffer est jeté.
6. **On ne rescane pas tout.** On travaille sur les changements depuis le dernier passage (curseur / heure).
7. **Idempotence.** Rien n'est créé deux fois (missions, dossiers, PBC, emails). Doublon possible →
   `POSSIBLE DUPLICATE — REVIEW REQUIRED`, jamais une création silencieuse.
8. **« Je ne peux pas encore le prouver »** plutôt que transformer une incertitude en fait. Un statut
   `SENT` / « vérifié » / « terminé » n'existe que si l'action a réellement réussi et a été contrôlée.
9. **Rien n'est supprimé ni écrasé** : pas de suppression de fichiers métier, deux versions gardées si même nom.
10. **Aucun agent n'élève ses propres droits** ; aucun secret dans le frontend ni dans les tables métier.

## Comment les briques s'emboîtent (et où elles sont dans le code)

```
Supabase cron (office-manager-unified-scheduler, */5)
  → Edge Function office-manager-scheduler-bridge (secret x-scheduler-secret)
  → Vercel  /api/app?route=scheduler-tick  → lib/agent-passes.js tick()
  → passages dus seulement (clé org+agent+créneau, une seule fois) → agents du tenant DEFAULT_ORG_ID
```

| Plan / brique | Rôle | Code actuel |
|---|---|---|
| Customer data plane | Drive, Gmail, Excel, PDF, scans : là où vivent les preuves | Drive du cabinet (`00_TATY_AI_MANAGER`, `01_CLIENTS_ET_MISSIONS`…) |
| Document connector | lire, lister les changements, déplacer, renommer | `lib/drive-adapter.js`, `lib/google-drive.js`, `lib/tidy-drive.js` |
| Mail connector | fils, envoi réel, Message ID | `lib/agent-mail.js` (client = brouillon validé dans « À valider ») |
| Control plane (petite mémoire) | statuts, liens, décisions, audit | Supabase `office_*` (`db/*.sql`), `lib/audit-log.js` |
| Workflow authority | l'IA propose, l'humain valide, puis exécution | `office_action_queue` + `lib/action-decisions.js` + `lib/action-executor.js` (« À valider ») |
| Firm Manager (Firm Intelligence) | portefeuille, personnes, capacité, KPI, staffing proposé, **opportunités (TDR/AMI → Phase 0)** | `agents/index.js`, `lib/people-*.js`, `lib/capabilities.js`, `lib/firm-members.js`, `lib/cockpit.js`, `lib/opportunities.js` + `opportunites.html` |
| Classeur d'acceptation du cabinet | LA trace des Phases 0-1 (fiche, Phase 0, KYC, indépendance, conclusion) : structure lue dans le modèle lui-même, écriture cellule par cellule | `lib/acceptance-workbook.js` |
| Mission Controller (Mission Intelligence) | cycle de vie d'une mission, PBC, échéances, gates | `lib/mission-*.js`, `lib/engagement-prep.js` |
| Enhanced Auditor (Audit Intelligence) | risques, WP, preuves, revue — ne signe jamais | `lib/enhanced-auditor.js`, `lib/auditor-plus.js` |
| Orpailleur (Document Intelligence) | Detect → Read → Understand → Attach → Name → File → Verify → Remember | `lib/tidy-plan.js` (le cerveau), `lib/orpailleur-ask.js`, `lib/orpailleur-journal.js`, `lib/mapping-scan.js` |
| Sika | honoraires, factures, encaissements (annoncé ≠ vérifié) | passages `sika` dans `lib/agent-passes.js` |
| « Mon IA » | chaque personne peut connecter sa propre IA (clé chiffrée, avertissement versionné accepté) ; ses demandes l'essaient d'abord, l'IA du cabinet prend le relais ; les associés peuvent l'interdire | `lib/personal-ai.js` (crochet en tête de `firstAvailable`), `mon-ia.html`, `db/personal-ai.sql` |
| Veille des appels d'offres (Firm Manager) | reprise du Tender Desk EYNOWA : passage quotidien (recherche web, date limite vérifiée, équipe tirée des CV réels, Bid / No Bid sur 100, entreprises à approcher, pipeline Excel vérifié, rapport en 5 sections aux associés et BDM) ; un associé décide de suivre ; le BDM obtient le TDR, crée l'opportunité (liée), enregistre dépôt et résultat ; indicateurs et charge de travail à partir des dates ; offre perdue → revue de Shadow validée par un associé | `lib/tender-watch.js`, `veille.html`, route `tenders` / `tender-step`, mémoire `OFFICE_MANAGER_TENDERS.json`, réglages `office_firm_settings.settings.tender_watch` |
| Droits (permissions) | postes types d'un cabinet, niveaux (aucun → administrer), matrice écrans × rôles réglable par les associés, actions sensibles, règles automatiques (`can()`), plafond de l'IA = préparer | `lib/permissions.js`, Paramètres → Droits, route `permissions`, `office_firm_settings.settings.permissions` |
| Shadow | labo d'apprentissage, leçons validées par un humain ; **propose du code** pour tous les agents et lui-même (branche + PR en brouillon, jamais fusionnée ni déployée par lui ; garde-fous intouchables) | `lib/shadow.js`, `lib/shadow-code.js`, `lib/shadow-guard.js` (vu par les associés et le responsable informatique — 2026-10-11 ; les associés décident ; onglet « Code » d'Entraînement ; connexion `SHADOW_GITHUB_TOKEN`) ; questionnaire hebdomadaire à tous (agents + préférences de travail) ; **objectif final de chaque agent, Shadow compris** (`lib/agent-goals.js`) ; observation du vrai travail et enquêtes sur les causes, bonnes pratiques web, lecture du code, PR (`lib/shadow-investigate.js`, route `shadow-investigate-step`) ; examen de rangement de l'Orpailleur sur son vrai cerveau, notation sans IA (`lib/shadow-filing-exam.js`, aussi utilisé par la campagne de 5 jours et par les expériences) |

**Mémoires** — petite mémoire structurée dans Office Manager, grande mémoire documentaire chez le cabinet :
- Orpailleur : mémoire complète `OFFICE_MANAGER_TIDY_STATE.json` dans `00_TATY_AI_MANAGER/MEMORY`
  (heure du dernier passage, vu, étape de chaque fichier, questions/réponses, passages), journal unique
  `ORPAILLEUR_JOURNAL.xlsx` réécrit à chaque passage, et une seule ligne dans Supabase
  (`office_agent_checkpoints`) en secours. Mise à jour en place, jamais un nouveau fichier par passage.
- Autres agents : `MEMORY/AGENTS` (`lib/agent-memory.js`), mémoire client/mission `MEMORY/CLIENTS`.
- **Une mémoire par Drive** : la mémoire de l'Orpailleur appartient au Drive choisi dans Paramètres (`drive_id` dans TIDY_STATE et
  dans le checkpoint). Un nouveau Drive = nouvelle mémoire : carte, puis premier rangement complet. Jamais la mémoire,
  ni l'inventaire Supabase (`orpailleur_inventory`, lectures filtrées par `drive_id`), d'un autre Drive. Pas de repli
  silencieux sur un Drive du serveur (`FIRM_DRIVE_NOT_CHOSEN`).
- **Les agents ne sont pas des « Drive managers »** : seul l'Orpailleur range des documents ; les autres agents
  travaillent sur leur intelligence (cabinet, mission, audit, facturation) et consomment ses événements.

**Ancien cerveau à ne pas remettre au centre** : `supabase/functions/orpailleur-durable-worker` et `index.ts`
(ancien tenant `cd95cc4f…`, ancien Drive). Un scanner peut alimenter le moteur, jamais décider à sa place.
Depuis le 2026-10-09, un passage sans Drive du cabinet échoue honnêtement (`FIRM_DRIVE_NOT_LOADED`) au lieu de
relancer l'ancien moteur ; celui-ci n'est réactivable qu'explicitement (`ORPAILLEUR_LEGACY_PASS=true`).
Le pont `taty-google-bridge` garde un tenant par défaut ancien si `DEFAULT_ORG_ID` manque côté Supabase : à vérifier
dans les secrets de la fonction avant tout redéploiement (non modifié dans le dépôt, le déployé peut différer).

## Conformité à l'architecture (état au 2026-10-09) — on avance brique par brique

| Section | État | Ce qui existe / ce qui manque |
|---|---|---|
| §1-3 Données chez le cabinet, référence d'abord | ✅ | Drive/Gmail restent la source ; base = ids, liens, statuts, décisions. |
| §5-7 Changements, curseur, fallback | 🟡 | Par date (`changedSince`), pas encore curseur `changes.list` ni webhook Drive. |
| §8-10 Connecteurs abstraits | 🟡 | `drive-adapter` + `agent-mail` ; certains modules appellent encore Google directement ; pas de connecteur agenda. |
| §11-14 Event bus + idempotence | 🟡 brique 1 posée | `office_events` + `lib/event-bus.js`. Événements actifs : `DOCUMENT_CLASSIFIED`, `NEEDS_HUMAN_CLASSIFICATION`, `POSSIBLE_DUPLICATE` (Orpailleur → Mission Controller, `lib/mission-events.js`), `OPPORTUNITY_WON` (Firm Manager → Mission Controller, 2026-10-10). Les autres agents restent à brancher. |
| §15-16 Workflow engine, gates | ❌ | « À valider » sépare déjà proposition et autorité ; pas encore d'étapes/gates de mission. |
| §17-23 Petites mémoires d'agents | 🟡 | Existent (MEMORY/AGENTS, TIDY_STATE, checkpoint Supabase), champs pas encore alignés sur la spec. |
| §24 Zone `_OFFICE_MANAGER` par mission | 🟡 | Mémoire client/mission existe ; pas encore MISSION_STATE / DECISION_LOG / ARCHIVE_MANIFEST par mission. |
| §26-27 PBC Service unique | ❌ prochaine brique | Le Mission Controller reçoit les pièces avec `pbc_status` (RECEIVED_REVIEW_REQUIRED / PARTIAL / UNMATCHED) dans `OFFICE_MANAGER_MISSION_FILES.json` ; la checklist Excel n'est pas encore mise à jour (ni population attendue 1/5, ni `DRIVE_SYNC = PENDING`). |
| §28-32 Gmail push, thread mapping PBC | ❌ | Lecture des mails étiquetés par passage ; pas de watch Gmail ni de mapping fil → PBC. |
| §34-35 Orpailleur, incertitude | ✅ | Lecture réelle (PDF, scans), question ciblée, 00_A_REVOIR_AGENT, vérification Drive, doublons. |
| §38-41 Sign-off | 🟡 | Lié à la version (date de modification) et à l'ouverture du fichier ; pas de révision/hash ni détection auto de modification après signature. |
| §51-52 Isolement des cabinets | ✅ essai | Un cabinet = un projet Supabase + un projet Vercel, même code (`DEFAULT_ORG_ID`) ; RLS sans politique (service_role seul), sauf l'autorisation des agents (propriétaire / associé du cabinet). Recette : `docs/INSTALLER_UN_CABINET.md`, `scripts/new-firm.mjs`. |
| §53-54 Secrets | ✅ | Jetons chiffrés AES-GCM ; rien dans le navigateur. |
| §55-56 Permissions par appel d'outil, outils par agent | ❌ | Interrupteur global « autoriser les agents » seulement. |
| §5 / §58 Rôles | 🟡 branche `amelioration` | `lib/roles.js` (source unique) : propriétaire, associé, revue qualité, **Business Development Manager (`bdm`, 2026-10-11)**, manager, superviseur, senior, auditeur, secrétariat, responsable informatique (+ ancien « collaborateur ») ; position (grade) et « rend compte à » dans `office_app_users` (`db/roles.sql`) ; comptes gérés par propriétaire, associés et responsable informatique ; le Firm Manager propose rôles et positions d'après le tableau de l'équipe (`lib/team-roles.js`) ; menu et « Mon espace » de l'accueil par rôle ; un manager ne voit les indicateurs que de ses rapports directs, si le cabinet l'autorise. Droits (2026-10-11) : `lib/permissions.js` — matrice écrans × rôles (menu filtré, réglable dans Paramètres → Droits), actions sensibles et règles automatiques via `can()` (utilisé par la veille et les droits ; les anciennes routes gardent leurs familles de rôles, à migrer route par route). Manquent : rôles cabinet ISQM 1 et fonctions de mission enregistrés sur les personnes (définis dans `lib/permissions.js`, pas encore stockés), espaces de travail complets (Mes revues, revue qualité…). |
| §66-70 Archivage | ❌ | `MISSION_READY_FOR_ARCHIVE` est routé vers l'Orpailleur dans le bus, mais l'archive pass n'existe pas. |
| §57-61 Tool Gateway / MCP ChatGPT | ❌ reporté | « Mon IA », plus tard. |

## Workflow validé par Paul (2026-10-10) — de l'opportunité au lancement de la mission

Décision de Paul : elle précise la spec (§10 phases 1-5) pour le partage des rôles. Code : `lib/opportunities.js`.
1. **Trois entrées** pour un TDR / AMI : déposé sur la page « Opportunités », reçu par mail (connexion à faire),
   ou déposé dans le Drive (la ronde du Firm Manager le signale sur la page ; une personne crée l'opportunité).
2. **Firm Manager** : lit le document (contenu, pas le nom) ; ouvre le dossier de l'opportunité sous le dossier que le
   modèle désigne (`03_APPELS_OFFRES_ET_PROPOSITIONS`) ; y range le TDR (vérifié, jamais écrasé) ; y copie le classeur
   d'acceptation sous le nom que le modèle donne (`TATY_WP_PH0-1_[CLIENT]_[REFERENCE].xlsx`) ; remplit la fiche
   (onglet 01) ; prépare la Phase 0 (propositions sourcées, questions pour l'équipe). Décision « poursuivre » : l'Associé seul
   (jamais le préparateur ni le réviseur). Paul a demandé explicitement que le Firm Manager range le TDR et crée ce dossier.
2b. **Équipe (spec phase 2, avant le KYC)** : après « poursuivre », le Firm Manager propose l'équipe (personnes du cabinet
   seulement, choix expliqués, manques signalés) ; un manager ou l'Associé la valide ; chaque membre fait ensuite sa propre
   déclaration d'indépendance (menaces de la section indépendance du classeur).
3. **Lettre de confirmation du client** → rangée dans le dossier → événement `OPPORTUNITY_WON` → **Mission Controller** :
   « faire le KYC et l'indépendance » (onglet 03), vérifications publiques sourcées, l'indépendance est répondue par les
   personnes elles-mêmes, réponses écrites dans le même classeur ; rempli à la main → relu.
4. **KYC et indépendance avant la lettre de mission** ; puis le Firm Manager prépare et envoie la lettre (bloc 8, à construire).
5. À la fin, le dossier d'acceptation va au **dossier permanent du client** (à construire).
**Homme + machine (Paul, 2026-10-11)** : les agents écrivent directement dans le classeur tout ce qu'ils peuvent sourcer (TDR, Internet, missions et équipe du cabinet), dans les cases vides seulement, ligne signée « Préparé par : Firm Manager (IA) » / « Mission Controller (IA) » ; sans source = proposition ; ce que seule une personne sait = question ; un Manager relit une section en un clic (« J'ai relu », son nom dans « Revu par »). Jamais écrit par un agent : décisions, cotations du Manager, indépendance, « revu par ». Ce qu'Office Manager sait lui-même (registre des prospects = la page Opportunités, date et origine, recherche de conflits, fiche remplie, transmission à l'Associé) est écrit sans IA. Écran : une question courte à la fois (« À faire maintenant ») ; le classeur complet est replié, avec un seul « Enregistrer » en bas ; chaque personne reçoit ses questions en pop-up sur n'importe quelle page (déclaration d'indépendance une question à la fois, questions des agents, décision de l'Associé), répondues dans la fenêtre ; « Plus tard » = 1 h ; la cloche garde la liste.
**Qui décide (Paul, 2026-10-11)** : la décision « poursuivre » de Phase 0 → seul l'Associé responsable du développement commercial désigné dans Paramètres (`office_firm_settings.settings.business_partner`) ; recommandation et cotation (Phase 1) → le Manager de l'équipe validée ; décision d'acceptation (onglet 04) → le Partner de l'équipe validée. Sans personne désignée, toute personne de ce rang. Les rôles et écrans par rôle restent à définir avec la liste que Paul enverra.
Un seul fichier par opportunité ; chaque agent remplit sa partie ; les cellules de décision ne reçoivent que la décision
d'une personne identifiée. L'interface dépend du rôle (Associé : décisions ; Manager : recommandation, cotation ; équipe :
questions et propositions des agents).

## Fiabilité de l'Orpailleur (2026-10-11, diagnostic demandé par Paul)
- « Vu » ≠ « traité » : un fichier sans décision de l'IA est redemandé une fois, puis gardé (`undecided`, 3 essais) ; jamais « vu ».
  Un passage avec des fichiers non lus ou non décidés finit `outcome: partial`, jamais `complete`.
- Une proposition identique existante est expliquée (en attente / bloquée / refusée par une personne = jamais refaite) ;
  une proposition exécutée puis le fichier remis ailleurs → nouvelle proposition (nouvelle génération de clé).
- Fichier à la corbeille ou disparu → ses propositions ouvertes sont fermées (`FILE_TRASHED`).
- « Lancer / reprendre » après le premier scan = passage des changements (jamais un rescan complet, mémoire gardée) ;
  rescan complet seulement sur demande explicite (`full`).
- Réconciliation des métadonnées bornée (fichiers déjà traités d'abord, puis une tranche tournante ; 25 s max).
- Plusieurs lots par appel sous le même verrou (moins d'appels en chaîne : cause des HTTP 508) ; verrou de lecture 4 min.
- Statut de `office_action_queue` : jamais `cancelled` (c'est un `work_state`) — cause du PostgreSQL 23514.
- **Premier scan = tout le Drive** (Paul, 2026-10-11 : « à quel moment le scan du cabinet finit ? ») : une tranche lit au plus
  `MAX_FILES` (1 500) fichiers, les plus probables d'abord ; il ne se déclare fini (`first_scan_done`) que quand `firstScanLeft`
  est vide ; sinon `first_scan_remaining` et le passage suivant (planifié ou « Reprendre ») continue le premier scan
  (`FIRST_SCAN_CONTINUES`, `first_scan_round`) au lieu de ne regarder que les changements. Affiché dans Mise en service.
- **Bouton « Arrêter »** (Paul, 2026-10-11) : Paramètres (à côté de « Orpailleur ») et Mise en service ; `stopTidy` (action
  `tidy-stop` de `firm-knowledge`, tracé `TIDY_STOPPED`) → statut `stopped` ; le lot en cours finit ses fichiers (un pas en cours
  n'écrase jamais l'arrêt), rien d'autre ne démarre ; les passages planifiés ne relancent pas (`STOPPED_BY_PERSON`) ; « Reprendre »
  continue là où il s'est arrêté, mémoire gardée.
- **Heures de l'Orpailleur réglables** (2026-10-11, produit pour tous les cabinets) : Paramètres → Horaires des agents, champ
  « Orpailleur — heures de passage » (`orpailleur_times`, 1 à 6 heures, défaut 08:00 / 12:00 / 20:00). Rien ne part tant que
  « Activer les passages automatiques » n'est pas coché, et sans le planificateur Supabase (`db/scheduler-cron.sql`).
- L'humain peut choisir de mettre un doublon à la corbeille (confirmation explicite, Paul 2026-10-11).

- **Ses propres fichiers ne sont jamais à ranger** (Paul, 2026-10-11 : « arrêter, après chaque passage, de demander s'il doit mettre
  l'audit log et la mémoire ») : `lib/agent-files.js` (`isAgentOwnFile` : nom — mémoire, journal, `AUDIT_LOG`, Shadow —, chemin dans
  la maison des agents, ou parent = maison / mémoire, jamais la racine du Drive ; `A_RANGER` reste à ranger). Utilisé par
  `tidyCandidates`, le passage des changements et la purge. **Aussi « Comprendre le cabinet »** (`lib/firm-learning.js`, cause réelle de la
  question répétée : l'IA voyait `AUDIT LOGS` / `MEMORY` dans l'arborescence et posait une question au propriétaire, reposée tant
  qu'elle était ouverte) : dossiers des agents retirés de l'arborescence et des lectures, consigne explicite, questions sur leur
  espace (`isAgentTopic`) jamais posées ni affichées ; `askMissing` ne questionne ni ne déplace jamais un fichier des agents.
- **Mémoire absente = créée** (Paul, 2026-10-11) : sur un Drive choisi dans Paramètres, `OFFICE_MANAGER_REQUIRE_EXISTING_MEMORY` ne
  bloque plus (`existingMemoryRequired()` : seulement le dossier réglé côté serveur du pilote) ; sans dossier « … AI MANAGER », la
  maison `00_OFFICE_MANAGER_AI/MEMORY` est créée une fois (`findAtelier(…, { create: true })` dans `ensureMemoryHome`).

## Accueil par rôle (Paul, 2026-10-11 : « tout le monde a la même présentation de l'accueil, ce n'est pas normal »)
- `accueil.html` : propriétaire / associé = cockpit du cabinet complet (indicateurs, e-mails, missions, demandes aux agents,
  passages, mise en service) ; manager / superviseur / revue qualité = cockpit, e-mails, missions, « À valider » (sans journal des
  agents) ; senior, auditeur, BDM, secrétariat = « Mon travail » (leurs missions, leurs tâches ouvertes et leurs échéances, leur
  charge) au lieu du cockpit et de toutes les missions ; responsable informatique = comptes et mise en service. Texte d'en-tête et
  raccourcis selon le rôle. `myKpis` renvoie `missions` et `open_actions` de la personne. Reste à faire : `/api/missions` renvoie
  encore toutes les missions à tout compte connecté (à filtrer par fonction sur la mission, spec §58).

## Décisions du 2026-10-11 — postes, droits, veille des appels d'offres
Document de conception : « Office Manager AI — Postes, rôles et droits d'accès » (Claude Docs).
- **Trois couches** : rôle (poste), rôles cabinet (ISQM 1, cumulables), fonction sur la mission ; les règles automatiques
  retirent un droit (préparateur ≠ approbateur, indépendance d'abord, EQR hors équipe et 2 ans de délai, ordre des étapes,
  signature = qualification, personne n'élève ses propres droits). Les agents IA ne dépassent jamais « préparer ».
- **BDM** (`bdm`) : reçoit les appels d'offres, prépare les propositions, réalise aussi des missions (ses droits sur une mission
  viennent de sa fonction sur elle).
- **Veille des appels d'offres** (reprise du Tender Desk EYNOWA, généralisé à tous les cabinets) : l'agent envoie les avis au BDM
  et aux associés ; un associé décide (réglable : tout associé / associé du développement commercial / personnes nommées) ;
  le BDM cherche le TDR et crée l'opportunité ; on mesure date de l'avis, de décision, du TDR, du dépôt, du résultat ; combien
  reçus, suivis, déposés, gagnés ; la charge de travail s'en sert. Jamais de candidature ni de contact sans validation humaine ;
  le rapport ne part qu'aux personnes du cabinet, `SENT` seulement avec l'id Gmail ; Excel non vérifié = non joint.
- **Shadow** : vu seulement par les associés et le responsable informatique ; revue des offres perdues (causes, améliorations) =
  proposition, validée par un associé (devient une leçon du Firm Manager), transmise au BDM seulement si l'associé le choisit ;
  Shadow pose à tous des questions sur les agents et les préférences de travail (questionnaire hebdomadaire).

## Shadow entraîne vers l'objectif final (Paul, 2026-10-11)
- Constat : Shadow ne connaissait pas le but des agents, ne voyait pas les corrections faites à l'Orpailleur (réponses aux
  questions, destinations / noms changés, fichiers non décidés, passages partiels), testait l'Orpailleur avec le prompt de
  l'agent de discussion au lieu de son cerveau de rangement, et la campagne fictive le notait sur un exercice d'audit générique.
- Désormais : `lib/agent-goals.js` = l'objectif final, les résultats mesurables, les interdits, les pratiques de référence et le
  code de chaque agent (à tenir aligné sur la spécification) ; Shadow juge chaque problème comme un écart à cet objectif ;
  observe le vrai travail ; fait chaque jour l'examen de rangement de l'Orpailleur (cerveau réel `TIDY_INSTRUCTIONS`, Drive
  fictif, notation déterministe) et une enquête (agent le plus loin de son objectif, chacun au moins une fois par semaine,
  Shadow compris) : preuves + bonnes pratiques (web, sources) + code → causes, leçons (en attente d'une personne), tests,
  et une pull request en brouillon quand la cause est dans le code. On peut lui poser une question (« pourquoi l'Orpailleur
  ne fait pas X ? ») dans Entraînement → Objectifs et enquêtes. Il ne fusionne ni ne déploie jamais.

## Simple pour tout cabinet : se connecter, connecter le Drive (Paul, 2026-10-11)
- Le Drive est celui choisi dans Paramètres, aperçu compris : plus de repli silencieux sur `TATY_SHARED_DRIVE_ID` (seulement si
  `OFFICE_MANAGER_ALLOW_ENV_DRIVE=true`). En aperçu, `TATY_SHARED_DRIVE_ID` / `TEST_SOURCE_DRIVE_ID` ne servent plus que de garde-fou
  d'écriture (jamais dans le vrai Drive).
- **Fermer = effacer (Paul, 2026-10-11 : « quand je ferme mon compte, toutes les données du cabinet partent ; quand je recrée
  un compte, je remplis ce qu'il y a à remplir »)**. Le dernier propriétaire coche « fermer et effacer » et tape `EFFACER` :
  `lib/firm-purge.js` → essai à blanc (sans `db/purge.sql` installé, RIEN n'est effacé : `PURGE_SQL_NOT_INSTALLED`), mémoire des
  agents dans le Drive à la corbeille (seulement les fichiers des agents : `OFFICE_MANAGER_*`, `SHADOW_LAB.json`, journal,
  `MEMORY` / `AGENTS` / `CLIENTS`, jamais la racine), Google déconnecté, toutes les lignes `office_*` / `orpailleur_*` / `taty_*`
  du cabinet (fonction SQL `office_purge_firm`, confirmation `EFFACER <org_id>`, service_role seulement ; `office_organizations`
  gardée), comptes de connexion supprimés sauf s'ils appartiennent à un autre cabinet. **Les documents du cabinet dans son Drive
  ne sont jamais touchés** (exception assumée au principe 9 : ce sont les données d'Office Manager, effacées à la demande
  explicite du propriétaire). Ensuite, la première personne qui crée un compte est propriétaire d'un espace vierge → « Démarrer ».
- Un espace fermé avant cette règle (comptes inactifs) : connexion → `FIRM_CLOSED` → la page de connexion demande `EFFACER` →
  route `firm-restart` (`restartFirm` : identité revérifiée, ancien propriétaire ou `FIRST_OWNER_EMAILS`, son compte de connexion
  gardé) → effacement → propriétaire d'un espace vierge → « Démarrer ». Un nouveau venu ne peut jamais prendre l'espace.
- **Vendable à d'autres cabinets (Paul, 2026-10-11)** : Paramètres → « Repartir de zéro » (propriétaire, `EFFACER`, route
  `firm-reset`, `resetFirm` : même effacement, le propriétaire reste propriétaire d'un espace vierge). Plus de « code propriétaire »
  à taper : les routes propriétaire acceptent la session personnelle du propriétaire (ou d'un associé). Les vues d'équipe
  (`lib/kpi.js`) ignorent les missions archivées / annulées ; les compétences (`OFFICE_MANAGER_CAPABILITIES.json`) portent le
  `drive_id` et ne s'affichent pas pour un autre Drive. Nom de la fonction pont configurable : `GOOGLE_BRIDGE_FUNCTION`
  (par défaut `taty-google-bridge`, le nom déployé ; un nouveau cabinet peut la déployer sous un nom neutre).
- « Fichiers de travail » (Équipe) = temps réellement passé dans les fichiers Excel des missions, mesuré par le panneau Excel.

## Essai avec 4 cabinets (Paul, 2026-10-11 : « est-ce qu'on peut régler définitivement ? »)
- **Un cabinet = une installation** (spec §52 « Private Tenant ») : projet Supabase + projet Vercel propres, même dépôt / branche.
  Recette unique : `docs/INSTALLER_UN_CABINET.md` ; `node scripts/new-firm.mjs --name … --url … --owner …` donne l'identifiant,
  des secrets neufs propres au cabinet et le SQL du planificateur rempli (`FIRST_OWNER_EMAILS` obligatoire).
- **Socle de la base** : les tables de base (cabinet, adhésions, autorisation des agents, agents, missions, équipe, affectations,
  « À valider », inventaire du Drive…) n'existaient que dans la base du pilote. `db/base.sql` (1re partie de `db/INSTALL_TOUT.sql`,
  21 parties dont memory, mission-plans, workfiles, people-intelligence, inspection-reader-leases) les crée sur un Supabase vide.
  Relançable sur une base existante : rien n'est remplacé (vue, fonction `private.office_role`, politiques et déclencheur créés
  seulement s'ils manquent). **Toute nouvelle colonne lue par le code doit être ajoutée au SQL** : `tests/schema-coverage.test.js`
  installe la base vide et échoue sinon.
- Pont Google `taty-google-bridge` : repli seulement si `GOOGLE_BRIDGE_FALLBACK=true` (ou `OFFICE_MANAGER_PILOT_LEGACY_IDS=true`).
- Mise en service (`lib/readiness.js`) vérifie aussi les tables de base.
- Fournisseurs (vérifié le 2026-10-11) : Vercel Hobby = non commercial → Pro ; Supabase gratuit = 2 projets, pause après 1 semaine
  → Pro ; client OAuth Google « En production » (en test, autorisation de 7 jours ; non vérifié = avertissement + 100 utilisateurs à vie).

## Installable par n'importe quel cabinet (Paul, 2026-10-11 : « ce n'est pas une application pour TATY »)
- Aucun nom, Drive, fichier ni cabinet de TATY n'est utilisé par défaut. Les identifiants de fichiers réels du premier cabinet
  pilote (fichier maître, liste PBC, registre) ne servent que si son propre déploiement le dit (`OFFICE_MANAGER_PILOT_LEGACY_IDS=true`) ;
  sinon l'outil dit ce qui manque (`FIRM_FILE_NOT_CONFIGURED`, `MASTER_SHEET_NOT_CONFIGURED`). Variables génériques d'abord
  (`MASTER_SHEET_ID`, `PBC_MASTER_FILE_ID`…), `TATY_*` = anciens alias.
- Le pont Supabase `taty-google-bridge` (nom historique) n'a plus de Drive ni de cabinet par défaut : secrets `OFFICE_MANAGER_DRIVE_ID`
  (ou l'alias `TATY_SHARED_DRIVE_ID`) et `DEFAULT_ORG_ID` obligatoires, sinon `DRIVE_NOT_CONFIGURED`. **Avant de le redéployer pour
  TATY, vérifier que ces deux secrets sont réglés dans Supabase.**
- Ce qui s'affiche vient des données : nom du compte connecté, Drive partagés du compte Google connecté, nom de l'application réglé
  dans la marque du cabinet. Nouvel outil de l'IA : `read_master_sheet` (ex-`read_taty_master_sheet`).

## Audit par cycle avec l'Enhanced Auditor (en conception, PAS DE CODE avant validation de Paul — 2026-10-12)
- La méthodologie du cabinet pilote est dans les documents du projet claude.ai « Firm Manager » : manuel TATY (phases 0-20, RACI,
  5 portes), `01_SOP_AUDIT_MASTER/01_AUDIT_FINANCIER_GENERAL` (20 SOP), `02_AUDIT_ENTITES_NON_LUCRATIVES_SYCEBNL` (C01-C06, T01, T02),
  `15_DUE_DILIGENCE…` (SOP-01 à 15 sur un workfile Excel). Vision de Paul : `claude/VISION_AUDIT_PAR_CYCLE.md` ; carte proposée
  (rôles × écrans × familles de tests code / IA / jugement / confirmation, trous, pilote C02_ACH + PRJ-05) :
  `claude/CARTE_METHODOLOGIE_AUDIT_PAR_CYCLE.md`.
- Constat clé : toutes les procédures ont la même fiche (objectif, risque, assertion, type CORE / RISK-DEPENDENT / OPTIONAL, niveau,
  PBC, 5 modes d'échantillon, 10 colonnes de WP, PASS/EXCEPTION) → un seul écran « procédure », SOP chargés comme données du cabinet
  (jamais codés pour TATY).
- **Décisions de Paul (2026-10-12)** : le Manager fixe la matérialité dans un Excel ; les working files vivent dans le Drive, sous
  le dossier de la mission ; niveaux de revue (Senior, Manager, Associé…) appliqués **seulement si la mission le requiert** (réglé
  par mission) ; Superviseur gardé en option ; **un Working Paper Excel par cycle** (modèle du cabinet) ; rôle « spécialiste »
  (juriste, fiscaliste, évaluateur) à ajouter pour la due diligence ; pilote validé : C02_ACH SYCEBNL + PRJ-05 éligibilité.
- **Déroulé (Paul, 2026-10-12, 10:07)** : revue analytique → le Manager choisit les cycles → il fait le **programme de travail**
  (cycles + contrôles) : il l'**importe** (upload) ou le **remplit dans le Mission Controller**, qui lui propose les tests des SOP avec
  leurs codes → ce programme est ce que l'Enhanced Auditor voit et aide à exécuter. Les WP vont dans le dossier de la mission, sous-dossier
  des working papers (chez TATY : `01_CLIENTS_ET_MISSIONS/01_AUDIT/<année>/<MISSION>/05_WORKING_PAPERS_CYCLES_SELECTIONNES` — exemple, à
  trouver dans la carte du Drive / à régler, jamais écrit en dur). Le cabinet n'a pas encore de modèle de WP par cycle.
- **Construit le 2026-10-12 (Paul : « super »)** :
  1. Bibliothèque : `lib/methodology.js` (lecture des SOP Word par CODE, deux mises en page — SYCEBNL et audit général ;
     copies suspectes signalées ; mémoire `OFFICE_MANAGER_METHODOLOGY.json` par Drive), page `methodologie.html` (menu ⚙),
     route `methodology`. Le SOP n'est jamais copié dans la base.
  2. Programme : `db/work-programme.sql` (`office_work_programmes`, versions brouillon → validé figé → superseded),
     `lib/work-programme.js` (cycle proposé depuis le SOP, obligatoires cochées ; raison exigée pour une RISK-DEPENDENT activée
     ou une obligatoire retirée ; taille d'échantillon ; matérialité ; revues requises par la mission ; import par codes),
     page `programme.html` (lien « Programme de travail » dans la mission), route `work-programme`, événement
     `WORK_PROGRAMME_VALIDATED`. Modifier = manager/superviseur de la mission ou associé ; valider = manager/associé.
  3. WP par cycle : `lib/cycle-workpapers.js` (Excel de base dans le dossier des working papers trouvé sous la mission ou collé ;
     jamais écrasé ; vérifié dans le Drive ; AUDIT_META masqué).
  **Règle (Paul, 2026-10-12 : « si l'IA ne passe pas, l'application fonctionne-t-elle ? »)** : l'audit par cycle marche SANS IA —
  tout ce qui est contrôle (population, tirage, doublons, cut-off, recalculs, conclusion à trous, écriture du WP, revues) est du code ;
  l'IA (Enhanced Auditor) ne fait que pré-remplir et proposer ; sans réponse de l'IA l'écran le dit et la personne saisit elle-même.
  4. « Ma procédure » : `db/procedure-work.sql` (`office_procedure_work`), `lib/procedure-work.js`, `procedure.html`, route `procedure`
     (+ « Mes procédures » dans Mon travail, pop-up via `my-questions`). Population lue et rapprochée par le code ; tirage
     reproductible (graine) ; critères de risque par le code ; pièce rangée `PIECES_<CYCLE>/<CODE>/<CODE>_<S01>_…` sous le dossier
     des WP ; l'Enhanced Auditor lit la pièce et PROPOSE (autorisation « Autoriser les agents » exigée) ; PASS = preuve,
     EXCEPTION = explication ; résultats écrits dans le WP sans écraser une case remplie par quelqu'un ; soumission.
  **Shadow améliore l'Enhanced Auditor (Paul, 2026-10-12)** : objectif de l'Enhanced Auditor = « permettre à l'auditeur d'aller plus vite,
  d'être meilleur et de faire de meilleurs audits » (`lib/agent-goals.js` : speed, agreement, first_time_right, coverage, evidence, method) ;
  Shadow observe son vrai travail (`enhancedAuditorSignals` : propositions contredites, temps pièce → décision, procédures renvoyées,
  populations non rapprochées, cases du WP remplies à la main) ; ses enquêtes peuvent proposer une meilleure méthode ou un meilleur modèle
  de fiche Excel (correction `method`, inspirée des bonnes pratiques web) = leçon en attente d'un associé / manager, jamais appliquée seule,
  jamais un changement des SOP.
  5. Revues : `lib/procedure-review.js` (colonnes `reviews`, `review_points` de `office_procedure_work`), section « Revues » de
     `procedure.html`, « Mes revues » à l'accueil, pop-up. Seulement les niveaux requis par le programme, dans l'ordre Senior → Manager →
     Superviseur → Associé ; jamais sa propre procédure ; points de revue (renvoi → réponse du préparateur → levé) ; signature liée au
     contenu exact de l'onglet (hash, la ligne « Revu par » exclue), écrite dans le WP ; modifié après signature = signalé, et la
     signature tombe à la suivante ; l'Enhanced Auditor propose une revue écrite pour le rôle du réviseur (propositions seulement).
  Suivant : conclusion du cycle par le Senior (checklist 6 points du SOP, calculée), signature du cycle par les niveaux requis,
  puis la synthèse pour l'Associé.
  dans le WP), conclusion Senior, revues requises signées sur la version.
- **Déjà dans le code, à étendre (pas à refaire)** : `lib/pbc-sop-plan.js` (programme + SOP → PBC, extraits vérifiés),
  `lib/mission-plans.js` + `db/mission-plans.sql` (versions du plan), `lib/plan-integration.js`, `lib/workfiles.js` + panneau Excel
  (`excel/taskpane.html` : revue de l'Enhanced Auditor écrite dans le fichier).

## Secrétariat, modèles, CV (Paul, 2026-10-12)
- **Ce que Paul a dit** : les modèles (MI, lettre de mission, rapport…) sont mis dans l'application, en mémoire, et l'IA les remplit
  selon la mission avec les CV des personnes choisies ; la secrétaire envoie MI, lettres de mission et rapports depuis le mail du
  secrétariat ou sur la plateforme du bailleur (elle reçoit un mail) ; le Firm Manager / Mission Controller doivent connaître la date
  d'envoi (avant / après la date limite) ; les factures partent de la comptabilité ; demandes de pièces et confirmations = manager et
  auditeurs ; CV dans le Drive RH, mis à jour automatiquement, un CV adapté à la mission avant envoi, MI envoyées en PDF ; le CV d'un
  spécialiste retenu est déposé dans la plateforme.
- **Construit** : `lib/doc-templates.js` (modèles Word déposés, gardés dans `MODELES` de la maison des agents, chaque version gardée,
  index `OFFICE_MANAGER_TEMPLATES.json` ; champs `{{CHAMP}}` / `[CHAMP]` ; le code remplit ce que l'application sait, l'IA propose le
  reste avec sa source, sans IA = « [À COMPLÉTER] » ; Word + PDF dans le dossier de l'opportunité / de la mission, jamais écrasé) ;
  `lib/cv-bank.js` (CV de spécialiste déposé → `CV_SPECIALISTES_EXTERNES` du Drive RH + compétences « consultant externe » ; CV adapté
  au TDR = CV d'origine + missions faites au cabinet, rien d'inventé, modèle de CV du cabinet sinon PDF propre ; MI + CV en un PDF) ;
  `lib/secretariat.js` (approbation par la bonne personne — associé pour lettre de mission et rapport, jamais celui qui l'a préparé ;
  envoi enregistré avec preuve : message trouvé dans la boîte du secrétariat (`office_firm_settings.settings.secretariat_email`) ou
  accusé de la plateforme rangé à côté ; sans preuve = « déclaré », jamais « envoyé » ; date comparée à la date limite ; opportunité,
  veille et événement `DOCUMENT_SENT`) ; page `secretariat.html` (menu ⚙ « Secrétariat et modèles », raccourci de l'accueil secrétariat),
  route `secretariat`. `exportAsPdf` (Google : Word → PDF, copie temporaire dans l'espace des agents mise à la corbeille).

## Lancement de la mission : documents déplacés, tous les agents prévenus (Paul, 2026-10-17)
- Quand le Mission Controller crée la mission, les documents de l'opportunité (ceux du Firm Manager : TDR, classeur d'acceptation, lettre ; et ceux déjà liés à la mission) sont **déplacés** dans le dossier de la mission (`handoffOpportunityDocuments`, `mode: 'move'`) : même id de fichier (liens et registres valables), rien de supprimé ni écrasé, un fichier de même nom déjà présent = `review_required`, intention écrite avant le déplacement et vérifiée après (reprise après plantage). Réglage `office_firm_settings.settings.mission_handoff_mode` : `'copy'` revient à l'ancien comportement (copies, originaux gardés) ; défaut `'move'`. La fonction elle-même reste en `copy` par défaut.
- Seuls les documents du dossier de l'opportunité bougent ; les dossiers propres aux agents (MEMORY/AGENTS, AUDIT LOGS…) restent chez eux.
- `lib/mission-start.js` : événement `MISSION_STARTED`, un par agent (Firm Manager `grand-controleur`, Enhanced Auditor, Orpailleur, Sika), clé d'idempotence par mission et par agent ; chaque agent écrit SEULEMENT sa propre mémoire (règle d'écrivain unique). Traité dans le tick (`handleMissionStartEvents`). Shadow non prévenu (son labo est à part).
- Mémoire commune : le fichier partagé (`lib/file-index.js`) garde `placed_by` et `protected` ; `agentPlacedIds` → l'Orpailleur (`tidy-plan.js`) ne reclasse jamais un fichier placé par un agent dans sa mission (renommage seul possible).

- **Garder ce que Shadow a appris (Paul, 2026-10-18)** : « Repartir de zéro » efface `SHADOW_LAB.json` (leçons, tests). Entraînement → « Garder ce que Shadow a appris » : exporter / importer (`lib/shadow-transfer.js`, actions `lab-export` / `lab-import` de la route `shadow`, associés seulement). L'export ne contient que leçons, tests, historique des agents et bonnes pratiques (ni problèmes bruts, ni réponses au questionnaire, ni sources) ; somme de contrôle ; import : jamais d'écrasement (même id ignoré), garde « zone protégée » sur chaque leçon, statut conservé (une leçon en attente reste en attente), tracé `SHADOW_LAB_IMPORTED`.

- **Les leçons et tests de Shadow ne disparaissent plus (Paul, 2026-10-19 : « tous les tests de Shadow ont disparu, pourtant j'ai tout
  importé »)** : `SHADOW_LAB.json` vit dans le dossier mémoire des agents, qui peut changer (mémoire recréée dans le Drive choisi,
  démarrage à froid qui lit la racine du Drive avant les réglages : `memoryFolderId()` = `firmMemoryId() || firmDriveId()`). Si le
  laboratoire courant est absent ou vide, `loadLab` / `changeLab` (`lib/shadow.js`) cherchent les autres `SHADOW_LAB.json` du Drive
  (hors corbeille : un « Repartir de zéro » reste un départ à zéro) et les FUSIONNENT (`mergeLabs` : union par id, rien remplacé, rien
  supprimé), puis l'écrivent dans la mémoire actuelle. Test : `tests/shadow-lab-recovery.test.js`. À faire : même filet pour les autres
  fichiers mémoire (pointeur ou recherche) — cause commune avec la méthodologie.

- **La mémoire ne perd plus rien quand elle déménage (Paul, 2026-10-19 : « je pense qu'il y a un problème avec la mémoire »)** — causes
  trouvées dans `lib/memory-home.js` : 1) deux copies d'un même fichier mémoire → la plus récente gardée, l'autre MISE À LA CORBEILLE :
  une copie presque vide créée après une perte du pointeur battait la vraie (méthodologie, leçons de Shadow) ; 2) l'ancien dossier
  mémoire n'était repris que s'il s'appelait `00_OFFICE_MANAGER` (un « Atelier mémoire » / « MEMORY » restait derrière, avec
  `SHADOW_LAB.json`) ; 3) une erreur passagère de la base était retenue 1 min comme « aucun Drive choisi » (`loadFirmDrive`) → les
  agents écrivaient ailleurs. Désormais : rien n'est mis à la corbeille (`keepBoth` : copie active = la plus récente, sauf si elle fait
  < 30 % de l'autre ; l'autre est gardée, renommée `…_ANCIENNE_COPIE_<date>`), l'ancien dossier mémoire est fusionné quel que soit son
  nom (jamais la racine du Drive), `SHADOW_LAB.json` suit la mémoire, et une erreur de la base garde le Drive connu. Tests :
  `tests/memory-home-one-drive.test.js`, `tests/memory.test.js`.

- **« Tout disparaît d'un coup » (Paul, 2026-10-19)** : `consolidateMemory` (`lib/google-connection.js`, appelé quand on choisit le Drive)
  gardait TOUJOURS la copie du dossier mémoire et mettait les autres à la corbeille (carte, état de l'Orpailleur, connaissances du
  cabinet) ; un fichier vide tout juste recréé effaçait donc la vraie mémoire. Désormais `pickActive` (la plus riche récente) et les
  autres gardées renommées, jamais à la corbeille. `setFirmDrive` garde la mémoire connue du même Drive si la recherche de l'atelier
  échoue (avant : mémoire = racine du Drive). `gatherInto` ne fusionne un ancien dossier que s'il s'appelle comme une mémoire.
  **Récupération** : Paramètres → « Mémoire des agents » (propriétaire) → liste des fichiers des agents dans la corbeille du Drive
  (`binnedMemoryFiles`, nom / taille / date), la personne coche ceux à restaurer (`restoreMemoryFiles`, jamais un document du
  cabinet, puis rassemblement, `MEMORY_FILES_RESTORED`) ; un « Repartir de zéro » met aussi ces fichiers à la corbeille, d'où le choix
  humain. Route `memory`, actions `binned` / `restore` / `home`.

- **CAUSE GÉNÉRALE des pertes de mémoire (Paul, 2026-10-19 : « il recrée de nouveaux documents pour sa mémoire au lieu de mettre à
  jour les anciens ; même la cartographie se refait quand elle est valide »)** : chaque fichier mémoire était retrouvé par une RECHERCHE
  Drive par nom ; cette recherche peut rater un fichier existant (cohérence à terme de Drive, ou erreur lue comme « aucun fichier »,
  `loadJsonFile` : `.catch(() => [])`) → l'agent repartait d'un état vide et CRÉAIT un second fichier du même nom ; ensuite la recherche
  rendait les copies dans n'importe quel ordre (`found[0]`) → la mémoire basculait entre la pleine et la vide. Corrigé une fois pour
  tous les agents dans l'adaptateur Drive (`lib/memory-files.js`, `guardMemory` autour de `driveAdapter`) : 1) un fichier mémoire créé
  est retenu PAR SON ID (`office_firm_settings.settings.memory_files[drive][parent|nom]`) et relu par id quand la recherche ne le voit
  pas ; 2) créer un fichier mémoire qui existe déjà est REFUSÉ (`MEMORY_FILE_EXISTS`), et rien n'est créé si la recherche échoue
  (`MEMORY_LOOKUP_FAILED`) ; 3) plusieurs copies → la plus riche récente d'abord, toujours la même (`orderCopies`). Noms concernés :
  `OFFICE_MANAGER_*`, `SHADOW_LAB.json`, `ORPAILLEUR_JOURNAL.xlsx`, `*_MEMORY.json`, mémoires clients. Rien n'est supprimé. Test :
  `tests/memory-files-guard.test.js`.

## Liste PBC reconnue quel que soit son nom (Paul, 2026-10-18)
- `lib/pbc-lists.js` (code, sans IA) : 1) signature des modèles du cabinet (feuille masquée AUDIT_META `Document_Type =
  PBC_MASTER_CHECKLIST`, ou mots-clés du fichier) → certitude 100 % ; avec `Mission_Code` = liste de la mission, sans = référentiel
  du cabinet ; un autre `Document_Type` (Working File…) = PAS une liste, même s'il a une feuille PBC. 2) Autre format (client, ancien
  modèle, Word, PDF, CSV) : ligne d'en-tête « document demandé » + référence / statut / reçu / échéance / date de demande, lignes =
  pièces d'audit → certitude < 100 %, statut `to_confirm`. 3) Retenue par son ID Drive dans `OFFICE_MANAGER_FILE_INDEX.json`
  (`pbc_lists`, `pbc_not_lists` par version) : renommée ou déplacée, elle est retrouvée sans relecture. Le nom et le dossier ne
  servent qu'à l'ordre de lecture, jamais de preuve. Modèles renommés ailleurs : recherche plein texte Drive de la signature, une
  fois par jour tant qu'aucun référentiel n'est connu (piste seulement, le contenu prouve).
- Coût : les fichiers du lot déjà lus par l'Orpailleur sont jugés sur ce texte (`pbcKnownTexts`) ; au plus 3 lectures en plus par lot.
- `pbcContext` (`lib/tidy-plan.js`) n'utilise plus aucune expression sur le nom. Confirmation une fois : pop-up `pbc_list`
  (`my-questions`, personnes de la mission), action `pbc-list-decide` de la route `secretariat` → `confirmed` / `rejected` (jamais
  reproposé), événements `PBC_LIST_CONFIRMED` / `PBC_LIST_REJECTED`, audit log.
- Reste : `lib/mission-engine.js` et `lib/agent-tools.js` lisent encore une feuille nommée `PBC_MASTER` (en-tête ligne 4) ;
  à faire lire par les colonnes que la reconnaissance a trouvées (`columns`, `header_row`).

## Une mémoire par Drive, créée par l'application (Paul, 2026-10-19 : « si je donne à une personne, c'est comme ça qu'il va se comporter ? »)
- Bug corrigé : pour un Drive « dossier de Mon Drive », `findAtelier` cherchait « … AI MANAGER » dans TOUS les Drive du compte
  Google et pouvait adopter celui d'un autre Drive (ex. le vrai Drive TATY pendant un essai) → écritures refusées en aperçu
  (`TEST_MODE_WRITE_OUTSIDE_TEST_DRIVE_REFUSED`) ; `gatherInto` et `setFirmDrive` (`consolidateMemory`) pouvaient aussi ramener
  des fichiers d'un autre Drive.
- Désormais (`lib/memory-home.js`, `belongsToDrive`) : seul un dossier / fichier DANS le Drive choisi (même `driveId`, ou sous le
  dossier choisi) est adopté ou rassemblé ; sinon la maison `00_OFFICE_MANAGER_AI/MEMORY` est créée dans le Drive choisi. La
  mémoire d'un autre Drive n'est jamais déplacée (`left_in_other_drive`). `ensureMemoryHome` ne garde la mémoire connue que si
  elle est dans le Drive choisi.
- Premier scan : `startTidyPlan` appelle `ensureMemoryHome(orgId, { verify: true })` avant de démarrer (trace `MEMORY_HOME_CREATED`).
- Test : `tests/memory-home-one-drive.test.js`.

## Le Working Paper sait toujours où il est (Paul, 2026-10-19 : « la fiche de travail d'un Enhanced Auditor ne sait pas où elle se trouve »)
- Avant : le WP d'un cycle n'existait que si quelqu'un cliquait « Créer les Working Papers », et seulement si un dossier dont le NOM
  ressemblait à « Working Papers » existait sous la mission (ou un lien collé) → `NO_WORKPAPER_FOR_CYCLE` / `WORKPAPERS_FOLDER_NOT_FOUND`.
- Désormais : `findWorkpapersFolder` crée `05_WORKING_PAPERS` sous le dossier de la mission s'il n'en trouve pas (lien collé > trouvé >
  créé) ; `ensureCycleWorkpaper` (`lib/cycle-workpapers.js`) prépare le WP manquant du cycle à l'ouverture de la procédure
  (`procedureView`, même code que le bouton, jamais d'écrasement, vérifié dans le Drive) ; seule une mission sans dossier Drive
  connu s'arrête (`MISSION_FOLDER_NOT_KNOWN`, dit à l'écran). Test : `tests/workpaper-location.test.js`.

## Plusieurs personnes sur le même Working File (Paul, 2026-10-19)
- Chaque test = sa feuille + sa ligne `office_procedure_work` : le travail dans l'application est déjà séparé. Seule collision : deux
  écritures du fichier au même instant → `MEMORY_CONFLICT` (rien d'écrit). `writeWorkpaper` refait alors l'écriture (jusqu'à 5 fois,
  délai croissant) sur le fichier relu, qui contient déjà le travail de l'autre ; seule la feuille du test est touchée. Test ajouté
  dans `tests/procedure-work.test.js`. Limite : deux personnes qui ouvrent le .xlsx dans Excel en même temps ne co-éditent pas (Drive).
- **Working Files du cabinet, quelle que soit leur forme (Paul, 2026-10-19 : « il doit me demander où se trouve le dossier » ;
  « n'importe quelle compagnie, sans reconfiguration, c'est l'IA qui comprend le fichier »)** — jamais de forme de fichier codée.
  FAIT : `lib/workfile-templates.js` — l'Enhanced Auditor DEMANDE une fois le dossier des modèles (question « document location » du
  pop-up, `document_type: workfile_templates`, dossier accepté par `confirmDocumentReference`) ; « le cabinet n'en a pas » = réponse
  valable (`CONFIRMED_NOT_AVAILABLE` → fichier de base) ; le modèle d'un cycle est choisi par son CONTENU (codes des tests actifs du
  programme trouvés dans le fichier, par code) ; égalité ou rien = aucun choix (`AMBIGUOUS` / `NO_MODEL_FOR_CYCLE`, fichier de base,
  raison affichée) ; le modèle est COPIÉ dans le dossier des WP de la mission (`CREATED_FROM_MODEL`) ; question posée et sans
  réponse = `WAITING_MODELS_FOLDER` (pas de fichier de base à la place). Test : `tests/workfile-templates.test.js`.
  RESTE : 1) compréhension par l'IA de chaque partie d'un modèle quelconque (cases de l'auditeur / de l'agent, feuille de chaque
  test, carte retenue par version du modèle) — `writeWorkpaper` attend encore la forme du fichier de base ; 2) entrée par cycle
  dans la mission (ses tests d'abord) ; 3) remplir ce qui est sourcé et DEMANDER à l'auditeur le reste, partie par partie.

## La méthodologie ne disparaît plus (Paul, 2026-10-19 : « j'ai mis le lien, il a tout lu ; je reviens, elle a disparu » — 3 fois)
- Causes possibles : la bibliothèque vit dans le dossier mémoire des agents, qui peut changer (déménagement de la mémoire, Drive
  re-choisi, cache du Drive pas encore chargé) ; et `methodologyState` CACHAIT une bibliothèque trouvée si son `drive_id` différait.
- Désormais (`lib/methodology.js`) : pointeur dans `office_firm_settings.settings.methodology` (`file_id`, `source_folder_id`, dates —
  un ID, jamais le SOP) ; lecture : 1) fichier dans la mémoire actuelle → affiché (plus de contrôle `drive_id`) ; 2) sinon le fichier
  pointé, où qu'il soit (pas à la corbeille) → affiché (`recovered`) et COPIÉ dans la mémoire actuelle (original jamais supprimé) ;
  3) sinon dossier des SOP connu → `reload` : la page relit seule (associé / manager), rien à recoller. Tous les lecteurs reçoivent
  `orgId`. Test : `tests/methodology-persistence.test.js`.

## Programme modifiable même sans bibliothèque (Paul, 2026-10-19 : « ici je n'arrive pas à modifier ça »)
- Cause : `cleanProgramme` reconstruisait chaque cycle depuis la bibliothèque des SOP ; bibliothèque absente (« Aucun SOP lu ») →
  `SOP_NOT_IN_LIBRARY` à chaque enregistrement. Désormais un cycle déjà enregistré dans une version sert de base (seul un cycle jamais
  enregistré ET absent de la bibliothèque est refusé). Le Manager peut changer la méthode de sélection d'un test pour la mission
  (`SAMPLING_MODES`, liste dans `programme.html`) ; la méthode du SOP reste gardée (`sop_sampling_mode`, affichée si différente).
  Test dans `tests/programme-planning.test.js`.
- **« Préparé par » modifiable et enregistrable (Paul, 2026-10-19)** : la liste propose l'équipe de la mission puis toutes les autres
  personnes du cabinet (`firmPeople`, `office_staff_profiles`) ; changer le préparateur du cycle fait suivre les tests qui suivaient
  l'ancien (vidés = « comme le cycle », un test confié à quelqu'un d'autre garde sa personne) ; toute modification affiche une barre
  « Enregistrer » qui reste à l'écran (erreur d'enregistrement affichée dedans). Test : `tests/programme-preparer.test.js`.

## Veille open source de Shadow (Paul, 2026-10-19 : « Shadow part sur des forums où il peut avoir des codes pour agents d'audit et de comptabilité … pour améliorer les agents, et en s'auditant. Je tiens à cela. »)
- `lib/shadow-code-watch.js` : un agent par jour (rotation `nextToWatch`, chacun au moins tous les 7 jours, Shadow compris), ou à la
  demande (Entraînement → Objectifs et enquêtes → « Lancer la veille maintenant », action `code-watch` de la route `shadow`, associés).
  1) recherche GitHub (API publique, lecture seule ; `SHADOW_GITHUB_TOKEN` seulement pour les limites) sur des sujets PUBLICS par agent
  (`WATCH_TOPICS`, jamais un nom de cabinet ou de client) : récents (~18 mois), ni archivés ni forks, ≥ 15 étoiles ; 2) lecture du README
  et de 3 petits fichiers « qui enseignent » (prompts, agent, eval…) à un commit figé, en TEXTE, jamais téléchargés pour être exécutés ;
  3) forums et communautés via la recherche web de l'IA (lecture seule, sources) ; 4) comparaison à l'objectif et au code de notre agent
  (`COMPARE` : contenu externe = donnée non fiable, injections signalées dans `suspicious`) ; 5) idées → leçons `hypothesis` EN ATTENTE
  d'une personne (catégorie `veille_open_source`, source dans `evidence`), tests de référence, et au plus UNE PR en brouillon pour les
  idées de code de confiance haute. La LICENCE décide par code (`reuseOf`) : MIT/Apache/BSD/ISC… = adaptation avec attribution, sinon
  idée seulement, quoi que dise l'IA. Mémoire : `SHADOW_LAB.json` → `code_watch` (40 dernières), scores de l'agent gardés (`scores_before`).
- Shadow s'audite : `watchSelfSignals` (idées refusées, idées adoptées suivies d'une baisse de score, contenu suspect) entre dans ses
  propres enquêtes ; les enquêtes d'un agent voient les idées de veille des 30 derniers jours ; résultat `open_watch` dans ses objectifs.
- Coût : 1 appel IA de Shadow par veille (compté dans `SHADOW_MAX_DAILY_RUNS` / `_COST`) + une recherche web. Test : `tests/shadow-code-watch.test.js`.

## OpenRouter en soutien (Paul, 2026-10-19 : « j'ai mis une nouvelle IA en soutien dans Vercel mais je ne la vois pas »)
- Variables Vercel : `OPENROUTER_API_KEY` (obligatoire), `OPENROUTER_MODEL` (facultatif, défaut `openrouter/auto`).
- `lib/ai-plus.js` : fournisseur `openrouter` (texte, images, PDF, recherche web `plugins: [{ id: 'web' }]`, sources) ;
  `firstAvailable` l'ajoute EN DERNIER à tout ordre qui ne le nomme pas (soutien, jamais à la place d'une IA qui répond) ;
  `multiModel` inchangé (pas de coût en double). `lib/ai.js` `runAI` : en mode `auto`, si ChatGPT / Claude manquent ou
  échouent → OpenRouter (`fallback_from` gardé) ; un fournisseur explicite n'est jamais remplacé.
- Visible : `auditeur.html` (« OpenRouter (soutien) »), texte de `pilotage.html`, `api/health.js`. Test : `tests/openrouter-support.test.js`.
- **OpenRouter est le principal (Paul, 2026-10-19 : « c'est lui le majeur, il fait 45 %, les autres moins »)** : `OPENROUTER_SHARE`
  (0-100, défaut 45) = part des demandes envoyées d'abord à OpenRouter (`openRouterFirst`, dans `firstAvailable` et `runAI` auto) ;
  les autres le soutiennent, et lui les soutient pour le reste. Les pastilles de Pilotage → Modèles d'IA montrent OpenRouter et sa part.

## Deux chemins pour créer une mission (Paul, 2026-10-19 : « je veux créer une mission et y aller directement »)
- Constat : une mission ne naissait que d'une opportunité (TDR / AMI → Phase 0 → … → `ownerWorkflowOverride`) ou de la détection
  des agents. Un petit cabinet qui reçoit les états financiers et part demain, ou un auditeur avec sa propre mission, était bloqué.
- **Source ≠ acceptation.** Chemin 1 : Opportunités (inchangé). Chemin 2 : « + Nouvelle mission » (`mission.html?new=1`, aussi dans
  Mes dossiers et l'accueil de chaque rôle) → `lib/mission-quick.js`, route `mission-quick` (`create` / `followup` / `folder` / `dates`).
  Nom + client suffisent ; statut `fieldwork` ; le créateur est affecté (sa fiche Équipe créée s'il n'en a pas, `needs_review`) ;
  `MISSION_STARTED` à tous les agents ; audit `MISSION_CREATED_DIRECT`. Origine gardée (`origin` : client direct, existant,
  récurrente, recommandation, nomination, appel d'offres, autre) — jamais de faux TDR ni de fausse opportunité.
- Acceptation / KYC, indépendance, lettre de mission = **points ouverts non bloquants** (`office_missions.followups`, carte « À compléter
  plus tard ») ; acceptation réglée par un associé, indépendance et lettre par manager / associé ; « sans objet » exige une raison ;
  historique gardé. Dates et dossier Drive (vérifié comme dossier dans le Drive, sinon « à vérifier ») complétables après.
- Doublon même client + même nom → `POSSIBLE_DUPLICATE` avec la liste ; créer quand même = choix explicite. Double clic = même id.
- SQL : `db/mission-quick.sql` (dans `INSTALL_TOUT.sql`) ; sans lui, la mission est créée quand même (sans origine ni points ouverts).
- **Comme les autres, le Mission Controller crée la mission (Paul, 2026-10-19)** : à la création directe, `prepareDirectMission` →
  `createMissionFolder` (même racine que les opportunités : référence `mission_root` / `firm_reference`, trouvé ou créé, jamais le
  dossier d'une autre mission ; sans racine = `configuration_required` + lien de configuration, rien d'inventé ; un lien Drive vérifié
  donné à la création est gardé) puis structure du modèle en arrière-plan (`requestDirectWorkspace` → route interne
  `mission-quick-step` → `directWorkspaceStep`, mêmes outils que `lib/mission-workspace.js`, sans TDR ; une seule fois ; agents non
  autorisés = attente dite). État dans `followups.mission_folder` / `followups.workspace`.
- **Pièces reçues** (carte de `mission.html`, toute mission ayant un dossier) : directement dans `<dossier mission>/PIECES_RECUES`, sans
  « À ranger » ni « À valider » (`piece` ≤ 3 Mo, `piece-start` = envoi direct à Google), même nom = nom daté (jamais écrasé), vérifié
  dans le Drive ; `pieces-done` : seuls les fichiers réellement dans ce dossier, rôle `piece_recue` dans les documents de la mission,
  index partagé `placed_by: mission-controller, protected` (l'Orpailleur ne fait que renommer), puis lecture par les agents
  (`startDepositAnalysis` purpose `pieces` + `mission_id` → mission mise à jour ; un TDR / contrat / lettre de mission reconnu par
  son CONTENU part au Mission Controller = `startEngagementPrep` : briefing, risques du secteur, équipe, plan ; suivi en direct sur la carte).
- Sans `db/mission-quick.sql` installé, la structure du modèle est quand même lancée (`no_record`, seulement si la colonne manque) et
  l'étape lit les colonnes de base (cause probable de « le Mission Controller n'a rien fait », 2026-10-19).
- **Aller directement aux tests (Paul, 2026-10-19)** : carte « Mes tests » de `mission.html` → `quickStartTests` / `testsView`
  (`lib/mission-quick.js`, actions `tests-start` et GET `view=tests`) = raccourci sur le programme existant (`saveProgramme` +
  `validateProgramme`, mêmes manques) : cycles choisis dans les SOP, CORE retenus, la personne prépare ; seuil, taille d'échantillon et
  niveau de revue saisis par elle (jamais inventés) ; puis liens vers `procedure.html`. **Décision à confirmer par Paul** : le créateur
  d'une mission directe, s'il est sur l'équipe, prépare ET valide son programme même auditeur (`isDirectMissionLead`,
  `lib/work-programme.js`, lu dans la mission : `created_by` + `origin` + affectation).

- **Corriger une mission, et le programme validé déclenche la suite (Paul, 2026-10-19 : « j'ai mis audit, c'était un audit de projet ;
  je ne peux pas changer le nom ; j'ai mis le programme de travail, rien n'a été fait »)** : bouton « Corriger la mission »
  (`mission.html`, action `details` de `mission-quick`, `setMissionDetails`) = nom, client, type, période ; manager / associé ou
  créateur ; avant → après dans l'audit log (`MISSION_DETAILS_CORRECTED`) ; même client + même nom = `POSSIBLE_DUPLICATE` sauf
  confirmation ; dossier Drive jamais renommé. `WORK_PROGRAMME_VALIDATED` n'avait AUCUN traitement (événement « ignoré ») : le Mission
  Controller (`lib/mission-events.js`) prépare maintenant les Working Papers lui-même au passage suivant (même code que le bouton,
  jamais d'écrasement) et note qui prépare quoi ; le bouton « Créer les Working Papers » accepte aussi le responsable d'une mission
  directe (`mayPrepareWorkpapers`). Test : `tests/mission-correct-and-programme-followup.test.js`.

- **Pièces reçues renommées, « Préparer une mission » sans TDR (Paul, 2026-10-19 : « il a mis dans pièces reçues, il devrait renommer et
  créer le fichier d'audit ; préparer une mission ne me met aucun TDR »)** : après lecture, chaque pièce est renommée d'après son CONTENU
  (`renamePieces` / `pieceName`, `lib/deposit-analysis.js` : `TYPE_CLIENT_PÉRIODE.ext`, même id, jamais d'écrasement → `_2`, non lue = nom
  gardé, `PIECES_RENAMED` dans l'audit log). Rôle `convention` (convention de financement d'un projet) ajouté ; `ENGAGEMENT_ROLES` =
  TDR, contrat, lettre, convention → lance la préparation. `tdrCandidates` propose TOUTES les pièces de la mission (recommandées cochées,
  sinon on coche les états financiers…) et ne tombe plus si la carte du Drive manque. Le fichier d'audit = les Working Papers par cycle,
  créés à la validation du programme. Test : `tests/pieces-rename-and-prep.test.js`.

- **Programme de travail repéré (Paul, 2026-10-19 : « il n'arrive pas à repérer les programmes de travail »)** : `codesInText` cherche
  chaque code de la bibliothèque avec un motif tolérant (« ach 01 », « ACH–1 », « C02_ACH-10 », « PRJ.5 » = le code ; toujours par code) ;
  la page du programme montre les programmes trouvés parmi les documents de la mission (rôle `programme_de_travail` lu dans le contenu,
  `foundProgrammes`) avec « Utiliser ce programme » ; un programme sans aucun code passe tout seul à la lecture par Mission Controller
  (rapprochement proposé, à examiner). Test : `tests/programme-recognition.test.js`.

- **Structure de la mission créée par le code, références qui ne se perdent plus (Paul, 2026-10-19 : « il me dit de renseigner le modèle,
  je le renseigne ; il ne crée toujours ni la mission ni le dossier ; tout reste dans pièces reçues »)** — causes : 1) la structure d'une
  mission directe n'était faite QUE par l'agent IA, via `initialize_mission_from_template`, qui exige une pièce « mission démarrée », la
  carte de l'Orpailleur et le registre maître du pilote → rien n'était jamais créé ; 2) une fois le modèle donné, rien ne relançait ;
  3) les références (racine des missions, modèle) vivaient seulement dans `OFFICE_MANAGER_FILE_INDEX.json` de la mémoire, perdues avec
  elle. Désormais : `structureFromModel` (`lib/mission-quick.js`) copie par CODE les dossiers du modèle confirmé (`mission_structure` /
  `template`, choisi par type de mission si plusieurs) dans le dossier de la mission (`syncFolderFromTemplate`, dossiers seulement,
  existants réutilisés, rien déplacé ni écrasé) ; sans modèle = `template_required` + lien ; `prepareDirectMission` l'appelle (l'agent IA
  n'est plus nécessaire) ; confirmer `mission_root` ou `mission_structure` relance les missions directes en attente
  (`resumeDirectMissions`, route `secretariat`) ; les références du cabinet sont aussi gardées dans
  `office_firm_settings.settings.references` (`documentReferences` fusionne). Tests : `tests/mission-quick.test.js`,
  `tests/references-durable.test.js`.

## Cahier des 11 points (Paul, 2026-10-19 : workflow, rôles par mission, Drive/serveur, pièces manquantes, recette)
- Ordre validé par Paul : **10 → 2 → 6 → 1 → 7**, puis la recette du point 11. Workflow (point 1) : le cabinet dépose son document,
  l'IA propose les étapes, un associé confirme, puis modifiable à l'écran et versionné. Recette avec un vrai serveur de fichiers.
- Diagnostic prouvé dans le code : 1) workflow = seulement un LIEN dans Paramètres (`firm_workflow`), rien ne pilote les étapes ;
  2) revues / programme / secrétariat décident sur le rôle DU COMPTE (`procedure-review.js` LEVEL_ROLES, `work-programme.js`
  EDITORS / VALIDATORS), `mission_role` n'est qu'un texte affiché ; `mission-function.js` range « superviseur » en « senior » ;
  3) cartographie et premier scan = Google Drive seulement (le connecteur local lit / écrit mais ne découvre pas) ;
  6) `agents/index.js:225` interdit de modifier un working file alors que l'assistant de procédure en écrit un ; 3 actions max ;
  7) scanner des mails = `has:attachment newer_than:30d`, aucun lien durable demande → fil → pièce → contrôle → WP.
- **Point 10 fait** : un dossier refusé par Drive (403/404 = `BLOCKED`) gardait le parcours `incomplete` pour toujours → passe de
  l'Orpailleur jamais lancée → état `FIRST_MAPPING` → jamais « Valider la cartographie ». Désormais Mise en service dit pourquoi
  (dossiers nommés, `ITEM_LIMIT`, échec, en cours) ; une PERSONNE peut « continuer sans ces dossiers » (`excludeBlockedFolders`,
  action `mapping-exclude-blocked` de `readiness`, audit `MAPPING_FOLDERS_EXCLUDED`), exclusion gardée aux scans suivants, affichée
  dans l'avertissement (`EXCLUDED_BY_PERSON`) et réversible (`mapping-include`). « À valider » distingue rien / filtré / erreur.
- **Point 2 fait** (choix de Paul : la fonction sur la mission décide QUI revoit, le grade du compte décide si la personne est QUALIFIÉE
  pour signer) : `lib/mission-function.js` (`reviewAuthority`, `programmeAuthority`, `SIGN_QUALIFIED`) ; une personne nommée Manager
  sur la mission signe la revue Manager, un autre manager de grade non (`LEVEL_HELD_BY_OTHER`) ; une fonction sans le grade = `NOT_QUALIFIED_FOR_LEVEL` ;
  personne nommée pour ce niveau = le grade, comme avant. Programme : modifié par le grade manager / superviseur (comme avant), validé
  par le manager ou l'associé nommé. Changer une fonction : carte Équipe de `mission.html`, action `function` de `mission-quick`
  (`setMissionFunction` : associé ou manager / associé de la mission, jamais la sienne, audit `MISSION_FUNCTION_CHANGED`) ; les revues en
  attente suivent tout de suite (calculées), les signatures données restent. « Superviseur » n'est plus lu comme « senior ».
  Ordre manager ↔ superviseur = RÉGLAGE DU CABINET (Paul, 2026-10-19 : la spécification §29 met le superviseur après le manager, le
  marché le met souvent en dessous) : `office_firm_settings.settings.supervisor_position` (`above_manager` par défaut / `below_manager`),
  Paramètres → Comptes, audit `REVIEW_ORDER_CHANGED` ; `reviewHierarchy` donne l'ordre des revues et les grades qualifiés (son niveau et
  ceux en dessous). Les anciennes routes (secrétariat, mails) restent sur le grade.
  **Sécurité (revue du 2026-10-19)** : les droits lisent SEULEMENT la colonne contrôlée `mission_function` (`db/mission-functions.sql`, liste
  fermée, écrite par `setMissionFunction` avec `mission_function_set_by/at`), jamais le libellé libre `mission_role` (tapé par la personne
  elle-même à la création d'une mission directe). La fonction ne donne aucun droit que le grade n'a pas : modifier le programme = grade
  manager / superviseur comme avant ; changer une fonction = associé du cabinet, ou grade manager tenant la fonction manager de la mission
  (jamais Associé / Manager : `PARTNER_SETS_LEAD_FUNCTIONS`). Sans le SQL : grades seuls, `MISSION_FUNCTION_SQL_NOT_INSTALLED` au changement.
- **Point 6 fait (règle)** : l'Enhanced Auditor a UNE règle des working files, la même dans `agents/index.js` et dans l'assistant de
  procédure (`lib/procedure-workspace.js`) : une seule écriture permise, `write-workpaper` de « Ma procédure » demandée par l'auditeur (feuille
  de la procédure, cases vides ou écrites par l'application, formules gardées, relu et vérifié, conflit signalé jamais forcé) ; aucun outil
  de la conversation générale n'écrit un working file (test). RESTE du point 6 : parcours Word, modèles Excel quelconques, 3 actions max.
- **Point 1 fait (workflow du cabinet)** — choix de Paul : un workflow PAR TYPE de mission (`default` = commun), seules les PORTES
  bloquent (passer outre = raison + manager de la mission ou associé, tracé). `lib/firm-workflow.js`, `db/firm-workflow.sql`
  (`office_firm_workflows` versions brouillon → confirmée → superseded ; `office_missions.workflow` = étape en cours + historique),
  page `workflow.html`, route `workflow`. Parcours intégré `DEFAULT_STEPS` = les `STEPS` de `dossier-model.js` (sans Shadow) + rapport +
  clôture ; chaque étape garde son « détecteur » = `dossierStates` (même calcul qu'avant). L'IA lit le document `firm_workflow` → BROUILLON
  (extrait de chaque étape vérifié mot pour mot, `unverified` sinon), jamais confirmé seul. Mes dossiers → « Parcours et relais » :
  étape en cours ▶, boutons des suites (`advanceMission`, `mayActOnStep` = fonction sur la mission, sinon grade). Suivi partout (2026-10-19) :
  `workflowOverview` (une lecture pour toutes les missions ouvertes : étape, qui attend, depuis quand, `stuck` après
  `settings.workflow_stuck_days`, défaut 7) → accueil « Mes étapes du workflow » (`isMyStep` = fonction sur la mission, sinon grade),
  cloche `workflow_step` / `workflow_stuck` (manager / associé de la mission et associés), page mission (étape sous le nom), outil
  `get_mission_workflow` du Mission Controller et du Grand Contrôleur (lecture seule : une personne enregistre la suite).
  Lien mission ← opportunité (2026-10-19) : `opportunityLinks` (`lib/opportunities.js`, registre `OFFICE_MANAGER_OPPORTUNITIES.json`, une
  opportunité par mission, deux = ambigu, jamais deviné) ; le dossier d'une mission retrouve son opportunité (états seulement, son contenu
  reste derrière les droits de la page Opportunités) ; mission lancée = étapes d'opportunité terminées (`passed` si non vues, jamais
  « en cours ») ; la vue d'ensemble montre aussi les opportunités sans mission (décision « poursuivre » = l'associé du développement
  commercial désigné) ; la cloche ne reprend que les étapes des missions (les opportunités ont déjà leurs tâches). Outil des agents :
  la personne qui demande est passée aux outils (`ctx.account`), une liste de missions demandée est croisée avec ses affectations.
- **Point 7 — étape 1 faite** (choix de Paul : réponse dans la conversation d'une demande validée = DÉPÔT DIRECT dans PIECES_RECUES ;
  pièce conforme = une PERSONNE confirme) : registre `office_pbc_requests` (`db/pbc-requests.sql`, une ligne par pièce attendue, clé
  d'idempotence, historique), `lib/pbc-loop.js` : besoins = « PBC principale » des SOP des cycles du programme VALIDÉ (`planNeeds`, période
  lue dans `period_label`), pièces déjà lues pour la mission = candidates « à confirmer » (`findExisting`, par contenu : type, période),
  demande des SEULES manquantes par le code (`draftRequest` → `mission-write.submit`, validée par un manager), « demandée » seulement avec
  l'id Gmail (`syncSending`), décisions d'une personne (`decide`). Route `pbc`, carte de `mission.html`. ÉTAPE 2 FAITE : `syncReplies` lit la
  conversation Gmail de la demande (lien durable = le fil, jamais l'objet ni l'expéditeur), toute réponse gardée avec ou sans pièce
  (`reply_without_piece` reste suivie), pièces déposées dans PIECES_RECUES sous un nom fixé par le message (`storeReceivedPiece`, rejouable
  sans doublon) puis lues par les agents (`piecesReceived`), rattachées par leur nom ou « à trier » ; passage planifié `pbcPass` ; le
  scanner par libellé ignore ces fils (`waitingThreads`). Dépôt direct SEULEMENT d'un expéditeur vérifié (destinataire de la demande ou
  d'un complément, contact client de la mission, et pas `dmarc/dkim/spf=fail`) ; sinon réponse « à vérifier », rien déposé ni lu,
  jusqu'à `trustReply` par une personne de la mission (revue de sécurité). ÉTAPE 3 FAITE : `controlPieces` — le code lit les dates
  (`periodCheck` : mauvaise période, incomplète si les mois s'arrêtent avant 12, sans date, période inconnue), l'IA (si autorisée) dit
  quel document et quelle demande il satisfait, avec un passage vérifié mot pour mot (sinon avis écarté) ; verdict PROPOSÉ (`conforme`,
  `partiel`, `mauvaise_periode`, `autre_document`, `a_verifier`, `illisible`), confirmer contre le contrôle exige une raison ;
  `requestComplement` = texte précis dans la MÊME conversation (`reply_to` passé par `mission-write.submit`), validé par un manager.
  RESTE : 4 (renommage, classement,
  working file, vérification), 5 (recette : complète / partielle / absente, GL du mauvais exercice puis le bon).

## Première connexion (Paul, 2026-10-17)
- `demarrer.html` étape 4 « Les agents se présentent » (`lib/agent-intro.js`, route `agent-intro`) : chaque agent se présente et demande où est son fichier ; l'humain donne le lien, l'agent vérifie dans le Drive (« trouvé » seulement après vérification, contenu non lu) ; étape à franchir : terminée (ne revient plus) ou passée (à revoir) ; case « personne informatique » = seulement les emplacements techniques. État : `office_firm_settings.settings.onboarding.intro`.
- Par personne : `bienvenue.html` (« Faire connaissance », rappelée par le pop-up `my-questions`, id `intro|…`) = questions des agents adaptées au poste (`PERSON_QUESTIONS`), la préférence de travail d'abord ; mini-présentation de chaque écran selon le poste (`SCREEN_INTROS`, bandeau dans `assets/brand-theme.js`, « Ne plus afficher »). État : `settings.onboarding.people[email]`. Limite : ces réponses ne s'écrivent pas encore dans la Management Card.

## Règles de travail

- **Tout ce que Paul doit faire lui-même** (SQL à exécuter, réglages Vercel / Supabase / Drive, vérifications, décisions) va dans
  `docs/A_FAIRE_DE_VOTRE_COTE.txt`, avec le « comment faire » pas à pas (Paul, 2026-10-19) ; le tenir à jour à chaque modification.

- Branche de travail de Claude : **`feature/white-label-desktop`** — tout le travail y est poussé (Paul, 2026-10-11 : « ta branche à
  toi »). `amelioration` a reçu le même travail le 2026-10-11 (rôles, droits, veille, Shadow) ; elle n'est plus la branche
  de construction. Ne pas toucher `main`, `fix/map-register-bridge-write` (environnement de test isolé) sans accord.
- « EXTEND, DO NOT REBUILD » : ajouter sans casser ce qui est fait ; montrer le plan pour les gros changements.
- Production : la promotion est faite par Paul. Ne jamais définir `OFFICE_MANAGER_TEST_RUN` en production.
- Ne jamais taper un mot de passe, lire ou déchiffrer un secret. Pas de contournement d'un blocage de sécurité.
- Le document « gestion des personnes » de TATY n'est jamais commité.
- Vercel Hobby : 12 fonctions max dans `api/` — toute nouvelle route passe par `api/app.js`.
- Fichiers en CRLF (agents/index.js, lib/orchestrator.js, lib/supabase.js, lib/mission-dossier.js,
  tests/architecture.test.js, index.html) : éditer en conservant les fins de ligne.
- `npm test` doit passer avant chaque commit.
