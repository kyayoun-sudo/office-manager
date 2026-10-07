# Test d'Office Manager sur le vrai Drive de TATY — 7 octobre 2026

Test réalisé par Claude (Anthropic) à la demande de Paul KOMENAN, **en lecture seule** :
rien n'a été modifié, déplacé ni supprimé sur le Drive.
Périmètre : `G:\Shared drives\TATY ET ASSOCIES PERSONNEL` (Drive partagé), le code de
ChatGPT (branches `fix/office-manager-architecture-phase1` → `fix/map-register-bridge-write`),
l'application en ligne (`office-manager-personal-pilot.vercel.app`).

## Résumé

| Domaine | Verdict |
|---|---|
| Code de ChatGPT — tests automatiques | ✅ 113 / 114 (l'échec est un test devenu trop rigide, pas l'application) |
| Code de ChatGPT présent dans `feature/white-label-desktop` | ✅ intégralement, rien de perdu |
| Application en ligne — santé | ✅ en ligne ; Supabase, OpenAI, Claude, Orpailleur, Google Drive configurés |
| Application en ligne — protection | ✅ `/api/status` refuse sans code (401) |
| **Mémoire de l'Orpailleur (MAP / REGISTER)** | 🔴 **ne couvre qu'environ 20 % du Drive, 0 dossier de mission** |
| **Passage différentiel du 7/10 à 00:45** | 🔴 **n'a rien vu (tous les compteurs à 0), sans alerte** |
| Rangement automatique | 🔴 bloqué tant que la cartographie n'est pas complète et validée |
| Renommage de l'Orpailleur sur les vrais noms | 🟠 ne casse rien, mais ne voit pas les noms faux « par le sens » |
| Version en production | 🟠 la version de ChatGPT ; l'application de bureau (accueil, rangement, équipe, entraînement…) n'est qu'en aperçu |

## 1. Ce que contient le Drive

- 10 espaces racine (`00_A_REVOIR_AGENT` … `99_ARCHIVES_CABINET`) + `OFFICE_MANAGER_MAP.xlsx`
  et `OFFICE_MANAGER_REGISTER.xlsx`.
- Lecture jusqu'à 5 niveaux : 98 fichiers, 365 dossiers (au-delà, l'audit a été lu à part).
- Missions d'audit : `2025/BLE_TRANSIT_AUDIT_2025` (vraie mission, ~90 pièces PBC),
  `2026/ZZ_TEST_AGENT_PILOT_AUDIT_2026` (test), `2026/00_MODELE_AUDIT_VALIDE_A_DUPLIQUER`.

## 2. Problèmes trouvés

### 🔴 P1 — La mémoire de l'Orpailleur est incomplète (bug du code)
- `OFFICE_MANAGER_REGISTER.xlsx` : **100 lignes** pour plus de 460 objets lus (et davantage
  au-delà de 5 niveaux). Profondeur maximale : 3 niveaux. Dans `01_CLIENTS_ET_MISSIONS`,
  seuls les 7 dossiers de premier niveau sont connus : **aucune mission** (BLE TRANSIT absente),
  `client` et `mission` vides sur les 100 lignes. 9 fichiers lus, 4 objets compris.
- `OFFICE_MANAGER_MAP.xlsx` → STATE : `mapping_state = FIRST_MAPPING`,
  `last_scan_complete = false`, `scan_count = 2`.
- **Passage du 2026-10-07 00:45** : `last_pass_summary` = 0 partout (pas même « inchangé ») :
  la liste lue était vide.
- **Cause** (`lib/agent-tools.js`, `inventoryListing`) : le passage prend le **dernier** scan
  `COMPLETE` **ou `PARTIAL`** de `orpailleur_scan_runs`, et ne lit que les lignes de ce scan
  (`last_scan_id = run.id`). Un scan partiel ou à peine commencé ne contient que quelques
  objets (100 au premier passage, 0 au second). `runMappingPass` enregistre alors
  « 0 changement » sans signaler que la liste était vide.
- **Correctif proposé** : (a) prendre le dernier scan **COMPLETE** ; à défaut, refuser avec
  `INVENTORY_INCOMPLETE` au lieu de passer ; (b) si la liste est vide alors que le REGISTER
  ne l'est pas, ne rien écrire et alerter ; (c) ou utiliser `DRIVE_WALK` (limite 20 000 objets).

### 🔴 P2 — Conséquence : rien ne peut être rangé
`mappingGate()` (`lib/memory-runtime.js`) n'autorise les écritures documentaires qu'après
`MAPPING_REVIEWED`. Tant que la cartographie n'est jamais complète, elle reste en
`FIRST_MAPPING` : le Rangement (Orpailleur) et les écritures métier restent bloqués.
**Ordre de déblocage** : corriger P1 → passage complet → revue par le propriétaire.

### 🟠 P3 — Mission BLE TRANSIT : conflit de validation
`03_PLANIFICATION_AUDIT/01_WORD_PLANIFICATION_VALIDE/BLE_TRANSIT_AUDIT_2025_PROGRAMME_TRAVAIL_GENERAL_A_VALIDER.docx` :
rangé dans « validé », nommé « à valider ». C'est exactement le cas `VALIDATION_CONFLICT`
prévu dans les consignes du Mission Controller. À faire trancher par l'associé.

### 🟠 P4 — Relevés et rapprochements bancaires mal nommés (par le sens)
`04_PBC_DOCUMENTS_CLIENT/03_TRESORERIE` : les relevés d'**août, avril, juin…** s'appellent
« PBC-03-02_Relevés bancaires de **décembre N et janvier N+1** (tous comptes)_AOUT_2025 » ;
de même « PBC-03-03_États de rapprochement **au 31-12**…_AOUT_2025 ». Le libellé de la ligne
PBC a été recopié dans le nom. Ce renommage ne vient **pas** du code du dépôt (ancien
outil / autre agent).
**Test du renommage de l'Orpailleur sur les 96 vrais noms** : aucun renommage proposé.
Bon point (il ne casse pas les noms corrects), mais sa règle ne vise que les noms vides de
sens (`scan_0042`, `IMG_…`) : elle ne voit pas un nom **faux** comme ceux-ci. À ajouter :
comparer le nom à ce qui est lu dans le document (mois, période).

### 🟠 P5 — Appel d'offres IMPLUS : copies vides du modèle d'acceptation
`03_APPELS_OFFRES_ET_PROPOSITIONS/EXPERTISE_FRANCE_IMPLUS_SERA_20260929/01_APPEL_OFFRES_TDR_ET_DOCUMENTS_RECUS` :
des **dossiers** portent un nom de fichier (`…_TDR_20260929.docx`, `…REGLEMENT_CONSULTATION_20260929.pdf`)
et contiennent chacun `OPP_A_IDENTIFIER_ACCEPTATION.xlsx`, **vide** (« à renseigner ») ;
6 copies au total. Pas créé par le code du dépôt. À nettoyer à la main ; une seule fiche
d'acceptation remplie suffit.

### 🟡 P6 — Petites anomalies
- Dossiers en double « (1) » : modèle d'audit 2026 (`01_LEAD_SCHEDULE (1)`,
  `02_ANALYTICAL_REVIEW (1)`) et cycle COMP de BLE TRANSIT. Le code vérifie l'existence
  avant de créer : origine probable = copie manuelle ou synchronisation du PC.
- Fichiers temporaires Word/Excel `~$…` (SOP 19, revue analytique BLE) : à ignorer par
  l'Orpailleur et à supprimer à la main.
- Base de connaissance `00_OFFICE_MANAGER_KNOWLEDGE_BASE` : copies des SOP et modèles de
  `06_METHODES…` (`KB_TATY_…`). Voulu ? Sinon, deux versions à maintenir.

### 🟡 P7 — Test automatique `tests/browser-response.test.js`
Il découpe `index.html` entre `async function readApiResponse(` et
`document.getElementById('runs-read')` ; du code des missions a été ajouté entre les deux,
le morceau extrait n'est plus une fonction seule. La page fonctionne ; le test est à
réécrire (s'arrêter à la fin de la fonction).

## 3. Application en ligne

- `office-manager-personal-pilot.vercel.app/api/health` : `status: ok`, release
  `v2.2-operational-tools`, Supabase / OpenAI / Claude / Orpailleur / Google : **tous configurés**.
- `/api/status` : 401 sans code ✅. `/` : console pilote d'origine.
- `/accueil.html` : **404 en production** : l'application de bureau (branche
  `feature/white-label-desktop`) n'est déployée qu'en aperçu.
- Autre projet `taty-office-manager.vercel.app` : ancienne version 0.2.0 (`authenticated_pilot`) —
  à archiver pour éviter la confusion.
- Non testé : les journaux et erreurs Vercel (connecteur Vercel refusé sur l'espace
  `paul-bc10` : à reconnecter) et les routes protégées (il faut une connexion).

## 4. Ordre de correction recommandé

1. **P1** — corriger `inventoryListing` / `runMappingPass` (scan complet obligatoire,
   alerte sur liste vide), relancer une cartographie **complète**.
2. **P2** — revue de la cartographie par le propriétaire → `MAPPING_REVIEWED` → le Rangement
   peut travailler.
3. **P3** — l'associé tranche le programme BLE TRANSIT.
4. **P4** — renommer les relevés et rapprochements 2025 avec le bon mois ; ajouter à
   l'Orpailleur la détection « nom contredit par le contenu ».
5. **P5 / P6** — nettoyage manuel (copies vides, doublons « (1) », fichiers `~$`).
6. **P7** — réécrire le test.
7. Mettre `feature/white-label-desktop` en production quand les étapes de mise en route sont
   faites (SQL, variables, planificateur).
