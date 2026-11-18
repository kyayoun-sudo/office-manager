# Simulation : Firm Manager en mode entraînement (étape 1)

Date : 2026-11-18 · Auteur : Claude, pour Paul KOMENAN · Statut : conception validée par Paul le 2026-11-18, en attente de relecture de ce texte.

## 1. Intention

Paul veut que la rubrique « Entraînement » offre un mode **Simulation** : la personne entre dans **le même Firm Manager**
(mêmes menus, écrans, agents, processus), mais dans un contexte d'entraînement **indépendant** : missions, données, rôles
et travaux isolés. Un junior peut y être propriétaire ou manager sans obtenir ces droits dans le vrai cabinet. À la sortie,
il retrouve son environnement habituel. Le but est double : former les collaborateurs et faire apprendre les agents IA.

Ce document couvre **l'étape 1 seulement**. Les étapes suivantes sont rappelées en section 9 pour situer le travail.

Principe directeur : « on ne recrée pas Firm Manager ». Aucun moteur parallèle, aucune copie d'écran.

## 2. Ce qui existe (vérifié dans le code le 2026-11-18)

- `lib/firm-context.js` : le cabinet d'une requête est fixé une fois (`resolveRequestOrg`, `runInFirm`, `currentOrgId`), tous
  les modules le lisent. Actif seulement si `OFFICE_MANAGER_MULTI_CABINET=on`.
- `db/cabinet-onboarding.sql` : `office_create_cabinet` (idempotente par personne + nom) crée cabinet, propriétaire, adhésion ;
  « Nothing copied from another firm ».
- `office_organizations` a déjà une colonne `account_kind` (texte, libre).
- `lib/firm-purge.js` / `office_purge_firm` : effacement complet des lignes d'un cabinet (service_role, confirmation `EFFACER <org_id>`).
- `lib/training-drive.js` : dossier d'entraînement dans le Drive, écritures bornées, jamais de suppression définitive.
- `lib/google-drive.js` `assertWritableTarget` : modèle de garde d'écriture existant (mode test).
- L'Entraînement actuel (`entrainement.html`, `lib/training*.js`, `lib/firm-simulation*.js`) est un cabinet fictif de 15 personnes joué par
  un moteur à part. **Il reste inchangé** : la Simulation est un nouvel onglet.

## 3. Décision d'architecture

Une simulation = **un cabinet d'entraînement, fils du cabinet réel** (`account_kind = 'simulation'`, `parent_org_id` = cabinet réel).
Isolation par `org_id`, déjà éprouvée. Rejeté : un drapeau « simulation » sur les missions du cabinet réel (une requête oubliée
mélangerait vraies et fausses données) ; une installation séparée (trop lourd).

## 4. Données

Un seul ajout SQL, additif, dans `db/INSTALL_TOUT.sql` (reconstruit par `scripts/build-install-sql.mjs`) :

- `office_organizations.parent_org_id uuid null references office_organizations(id)` et un index.
- `account_kind` valeur `'simulation'` ; toute autre valeur existante inchangée.
- Fonction `office_create_simulation(p_auth_user_id, p_parent_org, p_name, p_display_name)` : service_role seulement ; refuse si le
  parent est lui-même une simulation ou si la personne n'est pas membre actif du parent ; idempotente par (personne, parent, nom) ;
  crée le cabinet fils, la personne comme propriétaire **du fils**, rien d'autre (ni Drive, ni Google, ni autorisation d'agents copiés).
- `tests/schema-coverage.test.js` doit rester vert (toute colonne lue par le code figure dans le SQL).

## 5. Parcours

1. Entraînement → onglet **Simulation** → « Nouvelle simulation » : nom, ancienne mission d'origine (texte libre : nom, client, exercice).
2. Route `simulation` (via `api/app.js`, jamais un nouveau fichier `api/`) : crée le cabinet fils, le dossier Drive de la simulation sous
   « Entraînements » du Shared Drive (nom borné par `lib/path-budget.js`), fixe le Drive du fils sur ce dossier, trace `SIMULATION_CREATED`.
3. Le navigateur envoie `x-office-manager-org: <fils>` (mécanisme multi-cabinet existant) ; le serveur vérifie l'appartenance à CHAQUE requête.
4. Bandeau permanent « Mode Simulation — rien n'est réel » (`assets/brand-theme.js`, selon `account_kind` renvoyé par la session) et bouton
   « Quitter la simulation » qui rétablit le cabinet réel. Le sélecteur de cabinets montre les simulations à part, étiquetées.
5. La personne crée la mission d'entraînement (« + Nouvelle mission », `lib/mission-quick.js`) et dépose les documents (« Pièces reçues »,
   `lib/deposit-analysis.js`) : écrans et code existants, inchangés.

Une simulation s'archive (statut), ne se supprime pas. L'effacement complet passe par l'existant (`firm-purge`), sur demande explicite d'un associé.

## 6. Connexion Google empruntée au cabinet réel

Le cabinet fils n'a pas sa connexion Google. Il **emprunte** celle du parent, limitée au dossier de la simulation :
- Résolution : si `account_kind = 'simulation'`, `connectedGoogle()` et `firmDriveId()` (`lib/google-connection.js`) lisent la connexion du parent
  mais le Drive du fils (dossier de simulation). Jamais le contraire.
- Garde d'écriture (`lib/simulation-guard.js`, nouveau, sur le modèle de `assertWritableTarget`) : toute création, déplacement ou renommage Drive
  est refusé s'il sort du dossier de simulation (`SIMULATION_WRITE_OUTSIDE_FOLDER`). Lecture : dossier de simulation seulement.
- Jamais de suppression définitive ; corbeille permise dans le dossier de simulation seulement.
- Si le parent n'a pas de connexion Google valide : la création s'arrête avec `GOOGLE_CONNECTION_REQUIRED`, dit à l'écran.

## 7. Garde-fous (tous testés)

| Risque | Règle |
|---|---|
| Envoi réel (e-mail, plateforme, facture) | `lib/agent-mail.js`, secrétariat et exécuteur d'actions refusent dans une simulation (`SIMULATION_NO_OUTBOUND`) ; aucun statut `SENT` possible |
| Planificateur | `scheduler-tick` saute les cabinets `simulation` (pas de passages automatiques) ; les agents ne travaillent que sur demande de la personne |
| Coût IA | plafond propre à la simulation (variable d'installation `OFFICE_MANAGER_SIMULATION_AI_DAILY_LIMIT`, défaut 200 appels/jour/simulation) via `lib/ai-usage.js` |
| Mémoire | mémoire des agents du fils dans son dossier de simulation (`ensureMemoryHome` sur le Drive du fils) ; jamais celle du cabinet réel |
| Droits | rôles choisis librement **dans le fils** seulement ; aucune écriture dans `office_app_users` / `office_memberships` du parent ; `can()` lit le rôle du cabinet courant |
| Données du parent | aucune lecture du parent depuis le fils, hors la connexion Google (section 6) |
| Fils d'un fils | refusé |
| Principes du CLAUDE.md | « SENT » sans preuve interdit, humain garde le jugement, rien supprimé, tout tracé (audit log du fils) |

## 8. Activation des cabinets multiples (fin de l'étape 1)

`OFFICE_MANAGER_MULTI_CABINET=on` se règle dans le `.env` du serveur : le déploiement automatique n'y touche jamais, et Claude ne lit ni ne
modifie ce fichier. Marche à suivre :
1. Avant de le demander, vérifier par les tests existants (`tests/firm-context.test.js`, `tests/cabinet-onboarding*.test.js`) que le cabinet
   pilote (`DEFAULT_ORG_ID`) garde exactement son comportement : ses identifiants serveur lui restent réservés, ses membres actuels restent membres.
2. Écrire dans `docs/A_FAIRE_DE_VOTRE_COTE.txt` les lignes exactes à ajouter, la commande de redémarrage et les trois contrôles
   (connexion d'un compte existant, `/api/health`, ouverture de « Mes cabinets »).
3. Paul (ou la personne qui administre le serveur) applique et confirme ; Claude vérifie ensuite sur l'adresse publique sans session
   ce qui est vérifiable, et dit ce qui ne l'est pas.
Retour arrière : retirer la ligne et redémarrer.

## 9. Hors périmètre de l'étape 1 (suite prévue)

2. Rôles libres à plusieurs collaborateurs (invitation dans le fils, changement de rôle en simulation).
3. Discussion avec les agents pendant le travail et journal des consignes, corrections et raisonnements.
4. Validation par un associé puis alimentation de la mémoire de Firm Manager (leçons génériques seulement).
5. EYNOWA Lab : vérifier d'abord la version du dépôt et l'installation sur le serveur ; ne jamais annoncer un transfert sans reçu
   (le courtier actuel n'expose pas le stockage sémantique) ; aucune pièce client transmise.

## 10. Tests de l'étape 1

- Un cabinet de simulation ne voit aucune ligne du cabinet réel, et inversement (requêtes `rest` sous deux `runInFirm`).
- Un rôle donné dans la simulation n'élève aucun droit dans le cabinet réel.
- `office_create_simulation` : idempotente, refuse parent simulation, refuse non-membre, ne copie ni Drive ni Google.
- Envoi e-mail / plateforme refusé en simulation ; écriture Drive hors dossier refusée ; lecture hors dossier refusée.
- Le planificateur saute les simulations.
- Google emprunté au parent ; sans connexion parente : erreur claire.
- Schéma : `tests/schema-coverage.test.js` vert ; `INSTALL_TOUT.sql` reconstruit.
- Interface : bandeau, bouton « Quitter », onglet Simulation (empreinte `tests/ui-pilot-hooks.test.js` mise à jour seulement si de nouveaux `id` sont ajoutés, volontairement).

Limites annoncées : non essayé avec le vrai Google ni la vraie IA ni le vrai serveur tant que l'activation (section 8) n'est pas faite ;
le comportement d'un cabinet fils sur toutes les routes sera vérifié par tests, route par route, pas par une lecture globale.
