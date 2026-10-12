# Office Manager AI — à lire avant toute modification

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
  Suivant : revues requises par la mission (Senior → Manager → Superviseur → Associé) signées sur la version du WP, renvoi au
  préparateur (statut `returned`), conclusion Senior du cycle (checklist 6 points), IA de revue par rôle.
  dans le WP), conclusion Senior, revues requises signées sur la version.
- **Déjà dans le code, à étendre (pas à refaire)** : `lib/pbc-sop-plan.js` (programme + SOP → PBC, extraits vérifiés),
  `lib/mission-plans.js` + `db/mission-plans.sql` (versions du plan), `lib/plan-integration.js`, `lib/workfiles.js` + panneau Excel
  (`excel/taskpane.html` : revue de l'Enhanced Auditor écrite dans le fichier).

## Règles de travail

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
