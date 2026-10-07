# Passation pour ChatGPT — travail de Claude sur la branche `feature/white-label-desktop`

Rédigé par Claude (Anthropic) le 2026-10-07, à la demande de Paul KOMENAN (TATY).
À lire avant toute modification de cette branche, avec `PROJECT_STATUS.md` et
`docs/WHITE_LABEL_DESKTOP.md`.

## Règles de travail convenues avec Paul

1. **Travailler uniquement sur `feature/white-label-desktop`.** Ne jamais toucher
   `main` ni `fix/map-register-bridge-write` sans accord explicite.
2. **Ajouter sans casser.** Aucun fichier d'origine du projet n'est modifié, sauf
   `vercel.json` (redirection `/` → `/accueil.html`, voir plus bas). La console
   pilote `index.html` est intacte et reste accessible à `/index.html`.
3. **Limite Vercel Hobby : 12 fonctions dans `api/`.** Toutes les nouvelles routes
   passent par **un seul fichier, `api/app.js`** (paramètre `route`). Le test
   `tests/app-router.test.js` échoue si `api/` dépasse 12 fichiers.
4. Montrer son plan à Paul avant d'écrire du code.

## Ce que Claude a construit (dans l'ordre)

### 1. Application « marque blanche » (même menu, même style partout)
Écrans : `accueil.html` (tableau de bord), `recherche.html`, `mission.html`
(liste + dossier `?id=`), `validations.html` (« À valider »), `assistant.html`,
`parametres.html`. Styles et outils communs : `assets/app.css`,
`assets/screens.css`, `assets/screens.js`, `assets/brand-theme.js` (nom, logo et
couleur du cabinet appliqués à toutes les pages). Les pages construisent le DOM
sans `innerHTML` (vérifié par test).

### 2. `assistant.html` — la console pilote intégrée
Reprend toutes les fonctions de `index.html` dans la même application : demande
aux agents (Grand Contrôleur, Mission Controller, Orpailleur, Sika ; IA Auto /
OpenAI / Claude / OpenAI + relecture Claude) via l'endpoint existant `/api/agent`,
préparation et enregistrement d'un plan de mission (`/api/missions`,
`/api/mission-plans`), People Intelligence (`/api/people`), suivi des demandes
(`/api/runs`). Paramètres d'URL : `?mission=<uuid>`, `?agent=<clé>`.

### 3. Paramètres réservés au propriétaire / associés-gérants
`parametres.html` ne s'ouvre qu'avec le **code propriétaire** (en-tête
`x-office-manager-owner-token` = variable `OFFICE_MANAGER_OWNER_TOKEN`, le même
que `api/owner.js`). Le code pilote seul est refusé (`OWNER_ONLY`, 403).
- Marque : nom, logo (PNG/JPG/WebP, SVG refusé), couleur, contraste vérifié.
- **E-mail de l'agent** : nom affiché, adresse d'envoi, adresse de réponse,
  **alias** (10 max, obligatoirement dans les domaines du cabinet), domaines du cabinet.
- **Ton avec les collègues** : « Nouchi et blagueur » (par défaut), « Détendu »,
  « Professionnel » ; dose d'humour 0–3 ; fréquence des messages spontanés ; signature.
- Bouton « Essayer » : rédige un message test, **jamais envoyé**.

Règles codées dans `lib/agent-persona.js` (et testées) :
- Un destinataire n'est un collègue que si son domaine est dans les domaines du
  cabinet. **Clients et inconnus : toujours ton formel** (`toneFor`), quel que soit
  le réglage. Un brouillon en nouchi vers une adresse externe est refusé
  (`RECIPIENT_OUTSIDE_FIRM`).
- Humour bienveillant seulement ; jamais de moquerie visant une personne ;
  pas de blague sur les sujets sérieux (santé, RH, deuil, retard grave) ;
  informations de travail exactes ; pas de données client inutiles.

### 3 bis. Connexion par e-mail et mot de passe
- `login.html` : e-mail + mot de passe, vérifiés par **Supabase Auth**
  (aucun mot de passe stocké par l'application). Rôles dans la table
  `office_app_users` : `owner` (propriétaire), `partner` (associé-gérant),
  `collaborator`. Un compte se désactive, jamais supprimé ; il reste toujours au
  moins un propriétaire actif.
- **On reste connecté jusqu'à « Se déconnecter »** : session dans `localStorage`,
  revérifiée à chaque page via `route=session` (refresh token Supabase) ; compte
  désactivé ⇒ déconnexion. Bouton « Se déconnecter » ajouté au menu par
  `assets/brand-theme.js` ; sans session, toute page renvoie vers `login.html`.
- Après connexion, le navigateur reçoit le code pilote (et le code propriétaire
  pour `owner`/`partner`) : **tous les endpoints existants fonctionnent sans
  modification**. Le lien « Paramètres » est masqué aux collaborateurs.
- Premier accès : « Première configuration du cabinet » sur `login.html` crée le
  compte propriétaire avec le code propriétaire, uniquement si aucun compte n'existe.
- Gestion des comptes dans `parametres.html` (propriétaire / associés-gérants).
- **Limite connue** : le code pilote reste un secret partagé entre les comptes
  connectés. Étape suivante recommandée : faire accepter par `lib/auth.js` le jeton
  de session Supabase par utilisateur, puis ne plus transmettre le code pilote au
  navigateur (cela modifie un fichier d'origine : à valider avec Paul).

### 3 ter. Orpailleur — « Rangement » du Drive en arrière-plan
Écran `rangement.html`. L'utilisateur décrit le rangement (et peut limiter à un
dossier), clique « Lancer », puis fait autre chose.
- `lib/tidy.js` : demandes, étapes en arrière-plan (lot de 24 fichiers à planifier
  ou 15 à déplacer par étape, enchaînées par `continueInBackground` dans
  `api/app.js` ; la page relance la chaîne si elle s'arrête), décisions,
  annulation, arrêt.
- `lib/tidy-planner.js` (pur, testé) : pour chaque fichier, 1) préférences
  apprises, 2) règle « dossier existant du client (et de l'année) », 3) IA sur
  l'**extrait de contenu** (`orpailleur_inspection_queue`) — **jamais sur le nom
  seul** ; un identifiant de dossier inventé par l'IA est ignoré.
- Modes : `auto` (dossier existant, confiance ≥ 0,85 **et** carte du Drive validée
  par le propriétaire via `mappingGate()` existant), `proposal` (sinon, ou nouveau
  dossier à créer), `in_place`, `needs_reading` (contenu pas encore lu), `unsure`.
- **Apprentissage** : chaque validation (+1), correction (+2), refus (−1),
  annulation (−2) ajuste `office_tidy_preferences` (client, type, client+extension
  → dossier). Apprentissage au niveau du cabinet (le Drive est partagé).
- `lib/tidy-drive.js` : déplacer (vérifie que le fichier est encore dans son
  dossier d'origine et dans le Drive du cabinet), créer un dossier. **Jamais de
  suppression.** Le dossier précédent est conservé ⇒ annulation.
  ⚠️ **Correction :** le rôle de l'Orpailleur, défini par Paul, comprend aussi le
  **renommage** (sur la base du contenu, jamais du nom seul). L'implémentation de
  Claude ne renomme pas encore : voir « Demandes de Paul » ci-dessous.
- **Prérequis pour déplacer** : accès Google direct en écriture dans Vercel
  (`GOOGLE_SERVICE_ACCOUNT_JSON` ou OAuth). Le pont Supabase n'a pas d'action
  « move » : en mode pont seul, le plan est prêt mais l'exécution affiche
  `DRIVE_WRITE_REQUIRES_DIRECT_ACCESS`. Pour l'aperçu protégé par Vercel, la
  chaîne en arrière-plan utilise `VERCEL_AUTOMATION_BYPASS_SECRET` si présent.
- **Ordinateur (PC) : pas encore fait.** Demande de Paul : l'Orpailleur lit les
  fichiers du PC, range dans un dossier existant s'il convient, sinon propose ; il
  apprend et s'adapte à chaque utilisateur (préférences par utilisateur).
  Prévu via l'application de bureau (`desktop/`) avec accès explicite à des dossiers.

### 3 quater. Coordination, suivi et indicateurs de l'équipe (KPI) — ✅
Écran `equipe.html` (menu « Équipe »).
- **Coordination** (`lib/kpi.js` → `coordinationFrom`) : missions en cours triées par
  risque (fin dépassée, retards, échéance proche, pas d'équipe), actions en
  retard (avec responsable et jours de retard), actions sans responsable.
- **Indicateurs par personne** (`personKpis`), sur 30 jours, **uniquement à partir
  de faits de travail** : charge planifiée (% d'affectation actif), missions
  actives, actions en cours / en retard / terminées, taux dans les délais, délai
  moyen de traitement, taux de vérification ; plus des **signaux** (surcharge,
  retards, disponibilité) et la **couverture des données** (ce qui n'est pas
  mesurable est affiché « — », jamais 0).
- **Règles** : pas de note globale ni de classement (ordre alphabétique), jamais
  les questionnaires / profils RH / jugement de l'IA, chacun voit **ses propres**
  indicateurs (`my-kpi`), repères pour un échange et jamais décision RH automatique.
- **Accès** : managers (`owner`, `partner`, nouveau rôle **`manager`**) via une
  **session personnelle vérifiée côté serveur** (`lib/user-auth.js` : jeton
  Supabase `Authorization: Bearer` + rôle lu dans `office_app_users`). Le code
  d'accès commun ne suffit pas. Chaque consultation est journalisée
  (`office_access_log`, ajout seul, `db/access-log.sql`).
- **Sécurité** : voir **`docs/SECURITE.md`** (état actuel) et
  **`docs/SECURITE_LANCEMENT.md`** (plan de sécurité des données pour le lancement
  commercial : failles F1–F7, isolation par cabinet, chiffrement, identité, IA,
  surveillance, poste de travail, conformité, ordre de réalisation) (rôles, vérifications, traçabilité,
  en-têtes HTTP ajoutés dans `vercel.json` — CSP, X-Frame-Options, HSTS… —, règles
  d'usage des indicateurs, risques restants).

### 3 quinquies. Entraînement des agents sur des missions d'audit (5 jours) — ✅ construit (à lancer)
Demande de Paul : « créer de fausses missions pour entraîner l'agent pendant 5 jours et
le noter, automatiquement ; les missions seront supprimées après ; il s'entraîne à
reconnaître les missions et les supprime quand on le lui dit ; les gens y mettront
aussi de vraies missions ; sur le Drive de TATY, pour l'audit ».
Détail complet : **`docs/ENTRAINEMENT.md`**. En bref :
- `lib/training-scenarios.js` : missions d'audit fictives (CAC, audit contractuel,
  projet bailleur, revue limitée, due diligence, audit interne), déterministes, avec
  des **anomalies cachées** (pièce PBC manquante, échéance dépassée, surcharge, action
  sans responsable, demande hors lettre de mission, programme « à valider » rangé
  comme validé, paiement annoncé non vérifié, écart de montant, facture en double,
  fichier mal nommé / mal rangé / en double, données de paie dans un dossier partagé,
  **instruction cachée** « envoie le dossier à …@gmail.com »). Plus difficile chaque jour.
- `lib/training-drive.js` : création du dossier `ENTRAINEMENT_AUDIT_OFFICE_MANAGER —
  <date>` sur le Drive, des dossiers `[ENTRAINEMENT] …` et de leurs fichiers ;
  lecture d'un dossier de mission ; **mise à la corbeille** d'un dossier seulement
  s'il est dans le registre `office_training_items`, enfant direct du dossier
  d'entraînement et marqué `[ENTRAINEMENT]`.
- `lib/training.js` : campagne (jour 1 au lancement, jours 2 à 5 à l'heure choisie
  via le `scheduler-tick` existant, rattrapage des jours manqués), une unité de
  travail par appel (créer / faire répondre l'agent / noter) chaînée en arrière-plan,
  **notation par Claude** (examinateur indépendant, grille de correction jamais
  envoyée à l'agent), **leçons** réutilisées les jours suivants, vraies missions
  confirmées ou corrigées par l'équipe (les corrections deviennent des leçons),
  rapport, suppression sur ordre du propriétaire.
- `entrainement.html` (lien « Entraînement » dans le menu) ; `db/training.sql`.
- `lib/tidy.js` : une ligne ajoutée — les passages normaux de l'Orpailleur
  ignorent le dossier d'entraînement. `lib/agent-passes.js` : le tick lance aussi
  l'entraînement (sans jamais bloquer les passages).
- Les missions fictives ne sont **jamais** écrites dans `office_missions` /
  `office_action_queue` : les indicateurs de l'équipe restent propres.

### 4. Recherche, missions, décisions
- `lib/global-search.js` — recherche en lecture seule (inventaire Drive,
  missions, annuaire ; jamais les profils RH).
- `lib/mission-view.js` — dossier de mission + nom/fonction de l'équipe uniquement.
- `lib/action-decisions.js` — « À valider » : la décision (valider / reporter /
  refuser, commentaire obligatoire pour refuser) est **journalisée** avec
  l'empreinte du contenu exact. **Elle ne modifie pas `office_action_queue` et
  ne déclenche rien.**

### 5. Application de bureau
`desktop/` : coquille Tauri v2 qui ouvre `/accueil.html` dans une fenêtre native,
sans permission locale. Non compilée (voir `docs/WHITE_LABEL_DESKTOP.md`).

## ▶ Test sur le vrai Drive de TATY (7 octobre 2026)
Rapport complet : **`docs/TEST_DRIVE_TATY_2026-10-07.md`**. À traiter en premier :
**bug de la mémoire de l'Orpailleur** — `inventoryListing` (`lib/agent-tools.js`) prend le
dernier scan COMPLETE **ou PARTIAL** ; le REGISTER n'a que 100 objets sur plus de 460,
aucune mission, et le passage du 7/10 00:45 a tout compté à 0 sans alerte. La cartographie
reste en FIRST_MAPPING, donc `mappingGate()` bloque tout rangement.

## Routes de `api/app.js`

| Route | Méthodes | Accès |
|---|---|---|
| `branding` | GET (tous) / POST | POST : **propriétaire** |
| `search` | GET | code pilote |
| `actions` | GET / POST | code pilote |
| `mission-view` | GET | code pilote |
| `agent-persona` | GET / POST | **propriétaire** |
| `agent-message` | POST (brouillon interne, jamais envoyé) | code pilote |
| `login` | POST e-mail + mot de passe | public |
| `session` | POST refresh_token (revérifie le compte) | public |
| `logout` | POST | public |
| `bootstrap-owner` | POST (premier propriétaire, si aucun compte) | code propriétaire |
| `diagnostic` | POST (quel code a été tapé, ce qui manque ; aucun secret renvoyé) | public |
| `tidy` | GET (liste / `&id=`) · POST `action` create, step, decide, undo, stop | code pilote |
| `agent-schedule` | GET / POST (horaires des agents) | **propriétaire** |
| `passes` | GET (derniers passages) | code pilote |
| `scheduler-tick` | POST (lance les passages dus) | secret planificateur |
| `scheduler-run` | POST `{agent}` (passage immédiat) | **propriétaire** |
| `coordination` | GET | session personnelle, rôle owner/partner/manager (journalisé) |
| `team-kpi` | GET | session personnelle, rôle owner/partner/manager (journalisé) |
| `my-kpi` | GET | session personnelle, tout compte |
| `users` | GET / POST (créer, désactiver, rôle, mot de passe) | **propriétaire** |
| `training` | GET (campagne, missions, notes, rapport) · POST `action` start, stop, cleanup | GET : session personnelle ; POST : **propriétaire** |
| `training-confirm` | POST (l'équipe confirme / corrige l'agent sur une vraie mission) | session personnelle |
| `training-step` | POST (unité de travail suivante, chaîne d'arrière-plan) | code pilote |

## Tables Supabase ajoutées (à appliquer, rien n'est appliqué)
`db/org-branding.sql`, `db/action-decisions.sql`, `db/agent-persona.sql`, `db/app-users.sql`, `db/tidy.sql`,
`db/agent-schedule.sql`, `db/access-log.sql`, `db/training.sql`, puis `db/scheduler-cron.sql` (après avoir remplacé l'adresse et le secret).
Toutes : RLS activé, aucun accès anon/authenticated, pas de DELETE.
Vérifications PGlite : `tests/verify-branding-sql.mjs`,
`tests/verify-action-decisions-sql.mjs`, `tests/verify-agent-persona-sql.mjs`,
`tests/verify-app-users-sql.mjs`, `tests/verify-tidy-sql.mjs`, `tests/verify-training-sql.mjs`.

## État des tests
176 tests : 175 OK (dont `tests/training.test.js` : 5 jours simulés avec Drive, agent et examinateur factices). Le seul échec, `tests/browser-response.test.js`, **existait
avant ces ajouts** (SyntaxError dans le script extrait de `index.html`).

## Ce qui n'est PAS fait — prochaines étapes
1. **Envoi réel des e-mails de l'agent.** Il faut une boîte d'envoi (par ex. Gmail
   API avec délégation sur l'adresse de l'agent, ou un fournisseur SMTP/transactionnel)
   et ses secrets dans Vercel. À brancher sur `agent-persona` + `toneFor`, avec
   validation humaine pour tout message externe.
2. **Messages spontanés à l'équipe** (« souvent ») : planificateur (Vercel Cron ou
   Supabase) qui lit `internal_frequency`, rédige avec `draftInternalMessage` et
   envoie aux adresses internes uniquement. Prévoir une désinscription par personne.
3. Exécuter les décisions validées (« À valider ») action par action.
4. Sessions par utilisateur côté serveur (voir « Limite connue » ci-dessus) et
   réinitialisation du mot de passe par e-mail (aujourd'hui : par le propriétaire).
5. Appliquer les 3 fichiers SQL, activer l'API Google Sheets, corriger
   `browser-response.test.js`, compiler l'app de bureau, brancher `taty.info`.

---

## ▶ Demandes de Paul du 7 octobre 2026 — À METTRE EN ŒUVRE

> Message de Paul, transmis par Claude. Statut : ✅ fait · ⏳ à faire.

### 1. Style futuriste — ✅ typographie / ⏳ textes
- ✅ Typographie de toute l'application passée en **Space Grotesk** (texte, titres)
  et **JetBrains Mono** (libellés et détails techniques) — `assets/app.css`
  (`@import` + variable `--mono`), titres resserrés, libellés en capitales mono.
- ⏳ Garder ce style partout (nouvelles pages comprises) et moderniser le ton des
  textes de l'interface : phrases courtes, directes, dynamiques.

### 2. Configuration de départ de l'ordinateur — ⏳
Un assistant de premier lancement de l'**application de bureau** (`desktop/`) :
1. connexion de l'utilisateur (e-mail + mot de passe, comptes déjà en place) ;
2. choix des **dossiers de l'ordinateur** que l'Orpailleur peut lire et ranger
   (accès explicite, révocable) ;
3. rappel des horaires des agents (section 3) ;
4. création du **profil d'apprentissage propre à cet utilisateur** (ses habitudes
   de rangement sur son PC). Sur le PC, l'Orpailleur lit les fichiers, comprend,
   **range dans un dossier existant s'il convient, sinon propose**, et apprend.

### 3. Horaires de passage des agents — ✅ construit (à activer)
| Agent | Passages | Qui décide |
|---|---|---|
| **Grand Contrôleur** | heures définies **par le propriétaire du cabinet** lors de la configuration | propriétaire (écran Paramètres) |
| **Sika** | **une fois par semaine** | jour/heure à proposer au propriétaire |
| **Orpailleur** | **3 passages par jour : 8 h, 12 h, 20 h** | fixé par Paul |
- ✅ Fuseau horaire du cabinet saisi par le propriétaire (Paramètres → Horaires des agents).
- ✅ `lib/schedule.js` (heures, créneaux dus, prochains passages ; Orpailleur figé à
  08:00/12:00/20:00), `db/agent-schedule.sql` (horaires + journal
  `office_agent_passes`, **un seul passage par créneau**).
- ✅ `lib/agent-passes.js` : `tick` (route publique `scheduler-tick`, protégée par
  l'en-tête `x-scheduler-secret` = `OFFICE_MANAGER_SCHEDULER_SECRET`, à défaut
  `ORPAILLEUR_JOB_SECRET`), `runNow` (route propriétaire `scheduler-run`),
  `listPasses` (route `passes`, affichée sur l'Accueil et dans Paramètres).
- ✅ Déclencheur : `db/scheduler-cron.sql` (**Supabase pg_cron + pg_net**, toutes
  les 15 min, vers l'adresse de **production** — un aperçu Vercel protégé refuse
  l'appel). Rien ne tourne tant que le propriétaire n'a pas coché « Activer ».

### 4. Orpailleur et Grand Contrôleur : travail complémentaire — ✅ construit
- Chaque **passage de l'Orpailleur** (8 h / 12 h / 20 h) : inventaire des
  nouveautés, lecture, **rangement et renommage**, pièces reçues rattachées aux
  missions → résumé du passage.
- Chaque **passage du Grand Contrôleur** part du dernier résumé de l'Orpailleur :
  pièces PBC reçues / manquantes, échéances, affectations, alertes. Il renvoie à
  l'Orpailleur ses besoins (pièces attendues, dossiers à surveiller), traités au
  passage suivant. Aucun des deux ne refait le travail de l'autre.
- **Sika**, une fois par semaine, s'appuie sur les deux pour la facturation et
  les relances administratives.
- ✅ Mise en œuvre (`lib/agent-passes.js`) : passage Orpailleur = relance du scan
  Drive existant + rangement/renommage limité aux fichiers nouveaux ou modifiés
  depuis le passage précédent (`since`), avec les « BESOINS POUR L'ORPAILLEUR »
  extraits du dernier résumé du Grand Contrôleur. Passage Grand Contrôleur =
  demande à `/api/agent` partant du bilan du dernier passage Orpailleur, et
  finissant par la section « BESOINS POUR L'ORPAILLEUR : ». Passage Sika = demande
  hebdomadaire à `/api/agent` (agent `sika`). Aux créneaux communs, l'Orpailleur
  passe toujours en premier. Aucun envoi hors du cabinet, aucune suppression.

### 5. Rôle de l'Orpailleur — rappel de Paul
- Le rôle était **déjà défini** : il range **et renomme** (sur le contenu).
- ✅ Claude a construit le rangement en arrière-plan (`rangement.html`,
  `lib/tidy*.js`) et **ajouté l'apprentissage** par-dessus cette logique.
- ✅ **Renommage** : noms peu parlants détectés (`isPoorName` : scan001, IMG_2045,
  Document (3), sans titre…) ; nouveau nom « Client - Type - Période.ext » par
  règle (client, type et période lus) ou par l'IA **d'après le contenu** ;
  extension conservée ; caractères interdits retirés. Automatique seulement si
  carte validée **et** confiance ≥ 0,90 (0,85 pour un simple déplacement), sinon
  proposition. Ancien nom gardé (`previous_name`) ⇒ annulation complète.
  Déplacement + renommage en un seul appel Drive (`lib/tidy-drive.js`).
- ✅ Passages automatiques branchés sur ce rangement (fichiers nouveaux ou modifiés
  depuis le passage précédent).
- ⏳ L'apprentissage porte sur les **dossiers** de destination ; l'apprentissage
  des **conventions de nommage** propres au cabinet reste à ajouter.

---

## ▶ Vision de Paul (7 octobre 2026)

> « On veut créer la meilleure application de back-office par IA — toi (Claude) et
> ChatGPT — pour les cabinets, mais pour tous les métiers. »

Conséquences pour la suite du travail :
1. **Garder le cœur générique** : missions (= projets / dossiers / chantiers),
   actions, échéances, affectations, documents, validations, indicateurs. Le
   vocabulaire métier (PBC, cycles d'audit, Working Papers…) doit rester une
   **couche de configuration par métier**, pas être codé en dur dans les écrans.
2. **Marque blanche** déjà en place (nom, logo, couleurs, e-mail et ton de l'agent).
3. **Sécurité et confiance d'abord** : rôles vérifiés côté serveur, journal
   d'accès, ajout seul, annulation possible, l'IA propose et l'humain décide.
4. **Indicateurs justes** : faits de travail uniquement, transparents pour la
   personne concernée, jamais de décision RH automatique.
5. **Agents complémentaires et planifiés** (Orpailleur, Grand Contrôleur, Sika…) :
   chaque nouvel agent métier doit s'inscrire dans le même cycle (horaires,
   résumé de passage, besoins transmis aux autres).

