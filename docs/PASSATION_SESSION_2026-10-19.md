# Passation — cahier des 11 points de Paul (session du 19 octobre 2026)

Prompt prêt à coller pour démarrer la nouvelle session : [docs/PROMPT_REPRISE_SESSION.md](PROMPT_REPRISE_SESSION.md).

À lire **en entier** par la prochaine session IA avant de toucher au code. Ce fichier complète `CLAUDE.md` (mémoire du projet,
toujours à lire d'abord) et ne le remplace pas. Tout ce qui est écrit ici a été vérifié dans le code au moment de la passation.

---

## 1. Le contexte en 30 secondes

- Projet : **Office Manager AI**, produit pour **tous les cabinets d'audit** (TATY & Associés = premier cabinet pilote, rien de
  propre à TATY dans le code). Propriétaire : Paul KOMENAN. Il écrit en **français** : répondre en français, simplement.
- Branche de travail : **`feature/white-label-desktop`** (jamais `main`, jamais `fix/map-register-bridge-write`). Tout est poussé.
  État à la passation : copie locale identique à `origin/feature/white-label-desktop`, dernier commit `bef4ce0`, **836 tests verts**.
- **Production : c'est Paul qui promeut.** Ne jamais déployer en production, ne jamais définir `OFFICE_MANAGER_TEST_RUN` en production.
- Paul a demandé (19 octobre) que **tout ce qu'il doit faire lui-même** aille dans `docs/A_FAIRE_DE_VOTRE_COTE.txt`, avec le « comment
  faire » pas à pas (vrais noms des écrans, vérifiés dans le HTML). Le tenir à jour à chaque changement qui demande une action de sa part.
- Paul veut des **commits poussés régulièrement** (« fais le commit push de ce qui passe avant de continuer ») : `npm test` vert,
  commit, push, après chaque étape.

## 2. Le cahier de Paul (les 11 points) et où on en est

Le texte d'origine de Paul décrit 11 points ; pour chaque point il veut : *existant démontré → défaut → composant réutilisé →
modification → test et preuve*. Ordre décidé avec lui : **10 → 2 → 6 → 1 → 7** (fait), puis le reste.

| Point | État | Où regarder |
|---|---|---|
| 10. Validations du Drive | ✅ fait | `lib/mapping-scan.js` (`excludeBlockedFolders`, `includeFolder`), `mise-en-service.html` (`explainMapping`), `validations.html` (`emptyReason`) |
| 2. Rôles variables selon la mission | ✅ fait | `lib/mission-function.js`, `db/mission-functions.sql`, `lib/procedure-review.js`, `lib/work-programme.js`, carte Équipe de `mission.html` |
| 6. Assistant pendant la mission | 🟡 règle faite, reste ouvert | `agents/index.js` (« ONE CONTROLLED WRITE »), `lib/procedure-workspace.js` |
| 1. Workflow du cabinet | ✅ fait | `lib/firm-workflow.js`, `db/firm-workflow.sql`, `workflow.html`, `lib/dossier-service.js`, `assets/dossiers.js`, accueil, cloche |
| 7. Boucle des pièces manquantes | ✅ fait (reste la recette réelle et les relances) | `lib/pbc-loop.js`, `db/pbc-requests.sql`, carte « Documents et PBC » de `mission.html` |
| 3. Drive et serveur de fichiers | ❌ à faire | voir § 5 |
| 5. Working files avant les travaux | ❌ à faire (en partie existant) | voir § 5 |
| 4. Responsabilités des agents | ❌ à faire | voir § 5 |
| 8. Mémoires | ❌ à faire | voir § 5 |
| 9. Traçabilité, arrière-plan, bilan du matin | ❌ à faire | voir § 5 |
| 11. Recette complète | ❌ partiellement en tests | voir § 5 |

## 3. Les décisions de Paul (ne pas les rediscuter)

1. **Rôles** : la **fonction sur la mission** décide QUI revoit / valide ; le **grade du compte** décide si la personne est
   QUALIFIÉE pour signer. Personne nommé pour un niveau = le grade décide (comme avant).
2. **Superviseur** : sa place (au-dessus ou en dessous du manager) est un **réglage par cabinet** (`office_firm_settings.settings.supervisor_position`,
   `above_manager` par défaut = la spécification §29). Chaque grade signe son niveau et ceux en dessous.
3. **Workflow** : **un par type de mission** (+ un commun `default`) ; le document du cabinet est lu par l'IA qui **propose** (brouillon),
   un **associé confirme** ; ensuite modifiable à l'écran, versionné. **Seules les « portes » bloquent** ; passer une porte sans la
   décision = raison + manager de la mission ou associé, tracé.
4. **Pièces** : une réponse dans la conversation d'une demande validée → **dépôt direct** dans `PIECES_RECUES` (si l'expéditeur est
   vérifié, voir § 4) ; une pièce jugée conforme par le contrôle → **une personne confirme** (jamais automatique).
5. **Serveur de fichiers** : un cabinet en a un → la recette du point 3 doit inclure un vrai serveur.
6. Rappels de `CLAUDE.md` toujours valables : l'IA propose, l'humain décide ; rien n'est supprimé ni écrasé ; idempotence ;
   « je ne peux pas encore le prouver » plutôt qu'un faux « terminé » ; rien de propre à TATY dans le code.

## 4. Ce qui a été construit (par point), avec ses garde-fous

### Point 10 — validations du Drive
Cause trouvée dans le code : un dossier refusé par Google (403/404 → `BLOCKED`) gardait le parcours `incomplete` pour toujours
→ passe de l'Orpailleur jamais lancée → état `FIRST_MAPPING` → jamais « Valider la cartographie ». Aussi : Drive > 50 000 éléments
= impasse (`ITEM_LIMIT`). Désormais Mise en service explique la raison, liste les dossiers bloqués ; une **personne** peut
« continuer sans ces dossiers » (tracé `MAPPING_FOLDERS_EXCLUDED`, gardé aux scans suivants, affiché `EXCLUDED_BY_PERSON`,
réversible). « À valider » distingue : rien / filtré / erreur de chargement.
**Non confirmé chez Paul** : on ne sait pas encore ce que sa carte Cartographie affiche (il doit le dire, cf. fichier à faire n° 3).

### Point 2 — rôles par mission
- `lib/mission-function.js` : `reviewAuthority`, `programmeAuthority`, `reviewHierarchy(position)`, `setMissionFunction`, `isMyStep`…
- **Sécurité** (revue automatique) : les droits lisent **uniquement** la colonne contrôlée `office_mission_assignments.mission_function`
  (liste fermée, écrite par `setMissionFunction` avec `mission_function_set_by/at`) — **jamais** le libellé libre `mission_role`
  (tapé par la personne elle-même à la création d'une mission directe). La fonction ne donne aucun droit que le grade n'a pas.
  Changer une fonction : associé du cabinet, ou grade manager tenant la fonction manager de la mission ; Associé/Manager seulement par
  un associé ; jamais sa propre fonction.
- « Superviseur » n'est plus lu comme « senior ». Missions existantes : aucune fonction contrôlée → les grades décident jusqu'à ce
  qu'un associé règle les fonctions (fichier à faire n° 4).

### Point 6 — règle de l'Enhanced Auditor
Contradiction supprimée : une seule règle dans `agents/index.js` ET `lib/procedure-workspace.js` — une seule écriture d'un working
file permise : `write-workpaper` de « Ma procédure », demandée par l'auditeur, feuille de la procédure, cases vides ou écrites par
l'application, formules gardées, relu et vérifié, conflit signalé jamais forcé. Aucun outil de la conversation générale n'écrit un
working file (test dans `tests/procedure-workspace.test.js`).

### Point 1 — workflow du cabinet
- Tables : `office_firm_workflows` (versions draft → confirmed → superseded, par `mission_type`), `office_missions.workflow`
  (étape en cours + historique). Page `workflow.html`, route `workflow` (`api/app.js`).
- Parcours intégré `DEFAULT_STEPS` = les `STEPS` de `lib/dossier-model.js` (sans Shadow) + rapport + clôture ; chaque étape garde
  un **détecteur** = `dossierStates` (le même calcul que l'écran dossier).
- `proposeFromDocument` : l'IA lit le document `firm_workflow` (Paramètres → Workflow et documents de gestion) → **brouillon** ;
  chaque étape garde la phrase source, vérifiée mot pour mot (`unverified` sinon).
- `advanceMission` (suites : poursuivre / complément / retour / refus ; refus = associé ; porte = raison + manager/associé).
- `workflowOverview` : une lecture de toutes les missions ouvertes → accueil « Mes étapes du workflow », cloche (`workflow_step`,
  `workflow_stuck` après `settings.workflow_stuck_days`, défaut 7), page mission, outil d'agent `get_mission_workflow`
  (Mission Controller + Grand Contrôleur, **lecture seule**).
- Lien mission ← opportunité (`opportunityLinks` dans `lib/opportunities.js`, une opportunité par mission, deux = ambigu).
- **Sécurité** : l'outil d'agent reçoit la personne qui demande (`ctx.account`, passé par `lib/orchestrator.js`) et ne lit que ses
  missions ; une opportunité n'est montrée qu'à qui peut ouvrir l'écran Opportunités (droit `opportunities` + rôle privilégié ou
  équipe) ; une opportunité liée invisible ne laisse **aucun** id/lien dans la réponse du dossier (test qui cherche l'id partout).

### Point 7 — pièces manquantes (`lib/pbc-loop.js`, `db/pbc-requests.sql`, table `office_pbc_requests`)
1. `planNeeds` : besoins = tableau « PBC principale » des SOP des cycles du programme **validé** ; période lue dans
   `office_missions.period_label` (`periodOf`) ; idempotent.
2. `findExisting` : documents déjà lus pour la mission (par contenu) → candidats « à confirmer », jamais redemandés.
3. `draftRequest` : e-mail écrit par le code des **seules manquantes** → `mission-write.submit` (validation manager) ;
   `syncSending` : « demandée » seulement avec l'id Gmail.
4. `syncReplies` : réponses lues dans la **conversation Gmail de la demande** (lien durable), avec ou sans pièce ; pièces déposées
   par `storeReceivedPiece` (`lib/mission-quick.js`, nom fixé par le message → rejouable sans doublon) puis `piecesReceived`.
   Le scanner par libellé (`lib/agent-mailbox.js`) ignore ces fils (`waitingThreads`). Passage planifié `pbcPass` (`lib/agent-passes.js`).
5. **Sécurité expéditeur** (`senderCheck`, `parseAuthResults`) : dépôt direct seulement si un seul expéditeur, `Sender` identique,
   adresse dans les destinataires de CETTE conversation ou les contacts client, et en-tête `Authentication-Results` du **haut**,
   signé `mx.google.com`, **lu strictement** (forme exacte, sinon refusé), DMARC pass pour le domaine **exact** (DMARC en échec bloque ;
   DKIM du domaine exact seulement sans DMARC). Sinon « à vérifier » : rien déposé ni lu, jusqu'à `trustReply` par une personne.
6. `controlPieces` : le code lit les dates (`periodCheck` : mauvaise période / incomplète / sans date / période inconnue) ; l'IA (si
   « Autoriser les agents ») identifie le document avec un passage vérifié ; verdict **proposé**. Le tri d'une pièce « à trier » par
   l'IA n'est qu'une **suggestion** (`assignPiece` = une personne rattache). Confirmer contre le contrôle exige une raison.
7. `requestComplement` : texte précis, envoyé **dans la même conversation** (`reply_to` passé par `mission-write.submit`), validé.
8. `fileAccepted` (à la confirmation) : déplacement (même id) dans `<WP>/PIECES_<CYCLE>/PBC`, nom `CYCLE_PBC_document_période`
   (suffixe si le nom existe), ligne dans la feuille **`PBC_RECUES`** du working paper du cycle (feuille de l'application, jamais
   une case d'une personne), les deux relus ; échec dit et rejouable.
Recette en tests : grand livre 2024 → complément → 2025 → confirmé (`tests/pbc-loop.test.js`).

## 5. Ce qui reste à faire (point par point), avec ce qui est déjà su

**Commencer par demander à Paul lequel il veut** (il choisit l'ordre). Pour chacun : chercher d'abord l'existant (EXTEND, DO NOT
REBUILD), présenter le plan pour un gros changement, puis construire par étapes avec un commit poussé à chaque étape.

### Point 7 — reste
- **Recette réelle** sur une mission (pièces complètes / une partielle / une absente) : à faire avec Paul, après le SQL n° 8.
- **Relances automatiques** d'une pièce sans réponse : aujourd'hui manuel. À construire sur `pbc-loop.js` (même conversation,
  validation manager, idempotent par ligne et par date). Il existe déjà `detectOverduePbcReminders` dans `lib/agent-tools.js`
  (ancien suivi PBC sur Excel) : vérifier avant de dupliquer.
- L'ancien suivi « PBC (ancien suivi) » de `mission.html` (`lib/mission-engine.js`, `lib/agent-tools.js` lisent une feuille
  `PBC_MASTER`) coexiste avec le nouveau registre : à rapprocher (une seule vérité opérationnelle, principe 3 de `CLAUDE.md`).

### Point 6 — reste
- Remplissage **Word** (aucun parcours aujourd'hui).
- **Modèles Excel quelconques** du cabinet : `writeWorkpaper` (`lib/procedure-work.js`) attend la forme du fichier de base
  (`lib/cycle-workpapers.js`). Cf. `CLAUDE.md` « Working Files du cabinet, quelle que soit leur forme » (RESTE 1-3).
- Limite de **3 actions** par demande dans `lib/procedure-workspace.js` (`slice(0, 3)`).
- Démontrer la gestion des modifications simultanées (il existe déjà la reprise sur `MEMORY_CONFLICT` dans `writeWorkpaper`).

### Point 3 — Drive et serveur de fichiers
- Existant : connecteur local `connectors/local-server/`, `lib/local-storage.js`, `lib/server-files.js`, branché sur `lib/drive-adapter.js`
  (lecture/écriture). **Mais** la cartographie (`lib/mapping-scan.js`) et le premier scan de l'Orpailleur ne parcourent que Google Drive.
- La recherche de modèles examinée ne regarde que la racine et un niveau (`lib/workfile-templates.js` / références).
- À faire : découverte du serveur par l'Orpailleur, confirmation des emplacements, liens qui survivent aux renommages/déplacements.

### Point 5 — working files avant les travaux
- Existant : WP par cycle créés à la validation du programme (`WORK_PROGRAMME_VALIDATED` → `lib/mission-events.js`),
  `lib/cycle-workpapers.js`, `lib/workfile-templates.js` (modèle choisi par le contenu).
- À faire : rattacher les pièces déjà reçues (le registre du point 7 a les pièces confirmées par cycle → s'en servir), pré-remplir ce
  qui est justifié, compatibilité avec les vrais modèles du cabinet, présenter ce qui reste à compléter.

### Point 4 — responsabilités des agents
- Chaque agent doit distinguer **proposé / exécuté / vérifié** et dire les accès/données manquants. Sika n'a surtout que des outils
  de lecture (`buildSpecialistTools` dans `lib/agent-tools.js`). Définitions : `agents/index.js`, `lib/agent-goals.js`.

### Point 8 — mémoires
- Commune (cabinet), partagée (client/mission), propre à chaque agent. Existant nombreux : `lib/memory-files.js`, `lib/memory-home.js`,
  `lib/agent-memory.js`, `lib/mission-memory.js`. Paul a demandé de **tester l'existant avant d'ajouter un système**, puis de définir
  qui écrit quoi et la gestion des conflits. Voir dans `CLAUDE.md` les nombreuses corrections de mémoire du 19 octobre.

### Point 9 — traçabilité, arrière-plan, bilan du matin
- Existant : `lib/audit-log.js`, `office_events` (`lib/event-bus.js`), bilan du soir de l'Enhanced Auditor (`startEveningRun` dans
  `lib/auditor-plus.js`), planificateur (`lib/agent-passes.js` `tick`). À faire : un bilan fondé sur les **actions réellement exécutées**
  (le journal d'audit), erreurs visibles, reprise sans doublon, liens directs.

### Point 11 — recette
Liste de Paul : deux organisations documentaires (dont un serveur) ; deux workflows et leur effet sur les écrans ; une personne avec
trois fonctions sur trois missions (✅ test `tests/mission-roles.test.js`) ; préparation des WP depuis un programme validé ; pièces
complètes / partielle / absente ; GL du mauvais exercice puis le bon (✅ test `tests/pbc-loop.test.js`) ; contrôle, renommage,
classement, rattachement (✅ en test) ; remplissage Word et Excel avec travail simultané ; informations disponibles aux autres agents ;
interruption, reprise sans doublon et compte rendu.

### Décision encore ouverte (d'avant cette session, notée dans `CLAUDE.md`)
Le créateur d'une mission directe peut-il préparer **et** valider son programme même s'il est auditeur (`isDirectMissionLead`,
`lib/work-programme.js`) ? Le code le permet ; Paul ne l'a pas confirmé.

## 6. Actions de Paul en attente (détail dans `docs/A_FAIRE_DE_VOTRE_COTE.txt`)
1. SQL `db/mission-functions.sql` · 6. SQL `db/firm-workflow.sql` · 8. SQL `db/pbc-requests.sql` (ou relancer `db/INSTALL_TOUT.sql`).
2. Tester l'aperçu Vercel de la branche, puis promouvoir (lui).
3. Dire ce qu'affiche la carte Cartographie de Mise en service.
4. Régler les fonctions des personnes sur les missions en cours.
5. Choisir la place du superviseur (Paramètres → Comptes, rôles et positions).
7. Donner son workflow au cabinet (Paramètres → Workflow et documents de gestion → `workflow.html`).

## 7. Pièges rencontrés (à éviter)

- **Fins de ligne CRLF** : la plupart des fichiers sont en CRLF. `sed -i` sous Git Bash les convertit en LF : ne pas l'utiliser sur
  ces fichiers. Méthode qui marche : un petit script Node (dans le dossier scratchpad) qui lit, remplace `\r\n` par `\n`, fait des
  remplacements exacts (et **échoue** si le texte n'est pas trouvé), puis réécrit en CRLF si le fichier l'était. Les nouveaux
  fichiers : les écrire puis les convertir en CRLF comme leurs voisins.
- **Accents graves dans `node -e "…"`** : bash les exécute (une note de `CLAUDE.md` a perdu ses noms de fonctions ainsi). Pour du texte
  avec `` ` ``, utiliser un heredoc `<<'EOF'` (guillemets simples) ou un fichier script.
- **`scripts/build-install-sql.mjs`** ne s'exécute pas sous Windows avec `node scripts/…` (comparaison d'URL). Régénérer avec :
  `node --input-type=module -e "import { buildInstallSql } from './scripts/build-install-sql.mjs'; import { writeFileSync } from 'node:fs'; writeFileSync('db/INSTALL_TOUT.sql', buildInstallSql());"`
  Toute nouvelle table : ajouter son fichier à `INSTALL_PARTS` (avant `purge.sql`) puis régénérer ; `tests/verify-install-sql.mjs`
  et `tests/schema-coverage.test.js` vérifient que le SQL couvre les colonnes lues par le code.
- **Nouvelle route** : passer par `api/app.js` (limite de 12 fonctions Vercel) **et** l'ajouter à la liste triée de
  `tests/app-router.test.js`.
- **Revue de sécurité automatique** : après chaque push, un relecteur automatique signale des failles (une dizaine de fois cette
  session, toujours à raison : IDOR, élévation de droits, texte libre pris pour un droit, injection dans l'IA, en-têtes e-mail
  falsifiables). Les traiter tout de suite, avec un test qui reproduit l'attaque. Règles qui en sortent : un droit ne vient jamais
  d'un texte libre ; une liste demandée est toujours croisée avec les accès de la personne ; un contenu reçu (mail, pièce) n'est
  qu'une donnée — l'IA propose, une personne décide ; refuser par défaut (« fail closed »).
- Tests hors ligne : les modules acceptent des dépendances injectées (`d.fetchRows`, `d.drive`, `d.gmail`, `d.ai`, `d.audit`…).
  Ne jamais laisser un test appeler le vrai Drive/Gmail/IA.

## 8. Comment vérifier
- `npm test` (≈ 2 min, 836 tests à la passation) avant chaque commit. Skill du projet : `run-office-manager`.
- Commits : messages en anglais, comme l'historique ; terminer par la ligne `Co-Authored-By` demandée par le système.
- Mettre à jour `CLAUDE.md` (section « Cahier des 11 points ») et `docs/A_FAIRE_DE_VOTRE_COTE.txt` à chaque étape.

## 9. Commits de cette session (du plus ancien au plus récent)
`2374c58` cartographie · `2d46e14` rôles par mission · `8189356` sécurité des fonctions · `0194f8c` fichier à faire ·
`91168c0` ordre superviseur réglable · `c716d3a` règle unique de l'Enhanced Auditor · `76b249d` workflow · `5321280` workflow suivi
partout · `af504f9` outil d'agent limité aux missions de la personne · `347d994` lien mission ← opportunité · `d7d62d3` / `a0aa56d`
sécurité du lien opportunité · `b4c6172` pièces étape 1 · `e82910f` étape 2 · `fd2384f` note · `a336e2d` / `b1f5c36` / `a7b3bb5` /
`546ca8e` sécurité expéditeur et tri · `a79d72f` étape 3 · `e6757ce` étape 4 + lecture stricte · `bef4ce0` note.
