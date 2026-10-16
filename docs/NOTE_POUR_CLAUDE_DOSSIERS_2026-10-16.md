# Transmission à Claude — dossier commun et coordination

16 octobre 2026. Paul a explicitement demandé de **coder**, puis de rédiger cette note. Cette instruction remplace le « proposition d’abord » de la pièce jointe pour le travail de cette session.

## Base et statut de livraison

- Dépôt : `kyayoun-sudo/office-manager`.
- Cible : `feature/white-label-desktop`, branche identifiée auparavant comme source Vercel de `office-manager-personal-pilot`.
- Snapshot utilisé et HEAD distant revérifié : `7875db9633bf21d3b0048276d494e0409b875397`.
- Les fichiers `assets/app.css` et `assets/brand-theme.js` préparés dans la session précédente figurent dans cette base après upload manuel par Paul.
- Source récupérée via le connecteur GitHub ; dépendances npm installées localement pour vérifier le code. Pas de secret du cabinet récupéré.
- Livraison : fichiers modifiés, archive ZIP et patch ; **aucun push, aucune PR, aucune fusion, aucun déploiement de cette intervention**. Le précédent essai d’écriture du connecteur avait été refusé par GitHub (403, Resource not accessible by integration). La promotion de production reste à Paul.

## Ce qui est codé

### Dossier commun, sans remplacer les écrans existants

`dossiers.html`, `assets/dossiers.js`, `assets/dossiers.css`, `lib/dossier-model.js`, `lib/dossier-service.js`.

- « Mes dossiers » liste les opportunités et missions accessibles à la personne.
- Navigation commune, accès depuis l’accueil et les pages portant un identifiant de mission/opportunité.
- Rubriques Synthèse, Parcours et relais, Travaux et revue, Documents, Équipe et spécialistes, Cotation, Historique, selon les droits et les données disponibles.
- Parcours de 17 étapes qui montre **étape → personne → agent → action → résultat attendu → personne suivante → agent suivant**.
- Les étapes commerciales non reliées ne sont pas affichées pour une mission seule. Une opportunité reliée à une mission peut ouvrir les deux dans le même dossier.
- Le modèle est dérivé des enregistrements existants ; aucun nouveau statut de workflow autoritaire n’est persisté.
- Le statut « enregistré » est volontairement distinct d’une validation. Les signatures affichées ne certifient pas un contrôle frais du hash Excel : ouvrir la vraie revue pour cela.
- Synthèse des procédures : préparateur, éléments documentés, exceptions, pièces manquantes, points ouverts et signatures enregistrées. Les auditeurs voient leurs procédures ; les superviseurs voient la synthèse autorisée.
- Accès direct aux vrais working files et aux écrans existants pour éditer, valider et signer. Pas de copie supplémentaire de WP, de modèle ni de dossier.
- Les grilles et contrôles des anciens écrans restent en place ; le dossier est une entrée supplémentaire.

### Accès côté serveur

Deux routes dans **`api/app.js`**, pas de nouvelle fonction serverless : `dossier` (GET) et `dossier-followup` (POST).

- Session personnelle requise.
- Mission vérifiée contre les affectations via `requireMissionAccess` ; propriétaire/associé conservent la règle globale existante.
- Index des missions filtré dans la requête, pas simplement masqué dans le navigateur.
- Opportunités : propriétaire, associé, BDM et secrétariat selon leur permission écran ; autres utilisateurs seulement s’ils sont dans l’équipe nominative du dossier.
- Vérification indépendante des droits de chaque rubrique. Pas de cotation, équipe, documents ou travaux renvoyés dans une rubrique interdite.
- Aucun payload d’événement brut dans l’historique humain.
- Un échec d’accès vide la vue chargée. Une indisponibilité partielle de source est signalée au lieu de devenir un faux zéro métier.
- Ces contrôles concernent **les nouvelles routes** ; ils n’achèvent pas la migration de toutes les anciennes routes/outils vers la matrice complète de la spécification.

### Spécialistes

`lib/dossier-actions.js`, extension de `lib/opportunities.js` et `lib/mission-events.js`.

- Réutilise les résultats de recherche existants dans `opportunity.team.specialists`.
- Enregistre les étapes : identifié, contact déclaré, réponse, réunion documentée, disponibilité, CV, honoraires, avis, retenu, non retenu.
- Note obligatoire, auteur, date, historique, version optimiste ; une modification concurrente exige un rechargement.
- Événement `SPECIALIST_FOLLOWUP_RECORDED` vers Mission Controller ; celui-ci conserve une référence dans ses points ouverts.
- **Ce suivi est déclaratif** : pas d’appel, mail, invitation agenda ou sélection automatique dans le staffing. La décision d’équipe reste dans le parcours existant.

### Cotation et SIKA

- Le classeur de cotation existant reste la source ; aucun moteur de tarifs ou modèle financier parallèle.
- Observation de sa version Drive après préparation et lors des passages existants sur les opportunités.
- Historique des versions observées ; auteur et motif humain lorsqu’ils sont fournis.
- Une raison inconnue est explicitement « à confirmer », jamais inventée.
- Déduplication par fichier + modifiedTime + version. Une explication humaine ultérieure n’invente pas une nouvelle révision du fichier et peut émettre un événement d’explication distinct.
- `QUOTATION_UPDATED` est routé vers SIKA. Les changements en attente sont injectés dans son contexte lors d’une réponse directe ou d’une consultation par Firm Manager.
- L’accusé de traitement n’est enregistré qu’après réponse réussie de SIKA ; il signifie **transmission au contexte**, ni lecture certifiée de toutes les cellules, ni validation financière.
- Un échec du bus reste visible et retentable. Aucune facture, relance ou écriture comptable n’est envoyée.

### Pièces et apprentissage partagé

- `addEvidence` conserve l’écriture existante de la procédure, refuse une seconde référence identique sur le même élément, puis émet `EVIDENCE_ATTACHED`.
- Mission Controller rattache cette référence au registre documentaire existant de la mission avec cycle, procédure, élément et état `RECEIVED_REVIEW_REQUIRED`. **Aucun déplacement et aucune PBC déclarée complète** par ce relais.
- Cela améliore la visibilité commune ; cela ne constitue pas une garantie générale de non-reclassement par tout ancien chemin Orpailleur.
- `confirmDocumentReference` garde son registre et son historique existants, puis émet `DOCUMENT_REFERENCE_CONFIRMED`.
- Shadow observe ces confirmations comme corrections factuelles à examiner ; ni méthodologie ni permissions changées automatiquement par ce nouveau code.
- Le comportement existant de Shadow pour l’activation/validation des leçons est conservé. Ce code ne transforme pas toutes les corrections en nouvelles règles approuvées.

### Organisation, configuration et apprentissage : présentation

- Bloc « Qui fait quoi ? » : rôles, responsabilités et questions de configuration.
- Liens vers les **références existantes** : cotation (`quotation_workbook`), modèle AMI, proposition technique, structure modèle de mission ; KYC/indépendance restent dans le classeur d’acceptation existant.
- Pas de nouvelle copie des liens de modèles ni de registre de configuration parallèle.
- Accueil : raccourcis vers le questionnaire existant pour retours personnels, préférences et collaboration ; laboratoire accessible aux rôles déjà autorisés.
- Ces raccourcis **ne sont pas trois nouveaux moteurs d’apprentissage personnel**. Les réponses vont au questionnaire Shadow existant ; les simulations et tests du laboratoire existant sont conservés.

## Vérifications

- `node --check` sur les modules JS modifiés ; `git diff --check`.
- **18 nouveaux tests ciblés** dans `tests/dossier.test.js` : périmètres d’accès, rubriques masquées, index filtré, versions de programme, compteurs, indisponibilités, suivi concurrent, cotation/version réelle, échecs du bus, confirmation documentaire et relais des pièces.
- Tests navigateur Chromium/Playwright **avec API et session fictives**, sur les vrais fichiers HTML/JS/CSS : index → dossier, onglets, procédures, formulaires spécialiste/cotation, liens dangereux refusés, refus d’accès visible, écran étroit sans débordement horizontal, pas d’erreur JS après correction.
- Suite complète : **622 tests exécutés, 619 passent, 3 échouent**.
- Les trois échecs sont dans `tests/document-location.test.js` et ont été reproduits sur un worktree **non modifié** du snapshot de départ :
  1. `owner exception is journaled before starting, keeps missing pieces open and never signs or completes KYC` (ligne 163) ;
  2. `failed mission transition stays pending; real TDR reception corrections keep a signed history` (ligne 173) ;
  3. `the named manager can start the opportunity mission without a letter; creation is linked and never duplicated` (ligne 197).
  Résultat existant : `blocked` au lieu de `applied`. Pas corrigé ni masqué par ce travail.
- Première exécution dans le sandbox : limitation `spawnSync /bin/sh EPERM` du test de couverture SQL. L’exécution avec les permissions sandbox réseau a permis la vraie suite, dont ce test passe. Ne pas confondre cette limitation initiale avec un défaut nouveau de schéma.

## Ce qui n’a PAS été réalisé

Ce travail est une intégration de présentation et de plusieurs relais réels, **pas la réalisation de tous les mécanismes futurs décrits dans les 35 sections du brief**.

- Pas de reconstruction de l’app, suppression de features, changement des tables, migration SQL ou déploiement Supabase.
- Pas de nouvelle famille de comptes Finance ou Spécialiste externe. Leurs périmètres doivent continuer à être réglés avec les rôles/fonctions et droits actuellement pris en charge ; l’interface ne crée pas ces droits.
- Pas de portail externe avec partage fin de pièces, ni nouvelle qualification de signataire/EQR.
- Pas de moteur complet de gates, transitions, délégations et remplacements. Les personnes du parcours sont des responsabilités de rôle ; l’exécuteur de routage nominatif reste à compléter.
- Pas de connecteur agenda, invitations ou collecte automatique des résultats des réunions.
- Pas de nouvelle résolution ou fusion automatique des deux études de risques ; pas de décision professionnelle automatisée.
- Pas de compilation automatique nouvelle des demandes de pièces du soir avec envoi Manager/client. Réutiliser les fonctions existantes avant de compléter ce besoin.
- Pas de relecture comptable des montants avant/après dans le classeur de cotation ; l’historique ajouté porte sur les versions observées et les motifs, pas sur un diff cellule par cellule.
- Pas de nouvelle technique d’audit appliquée au SOP, ni de changement des règles de signature.
- Pas de nouveaux parcours d’entraînement personnel notés, nouvelles management cards automatiques ou apprentissage autonome de toutes les interactions.
- Pas de benchmark produit exhaustif et documenté de Caseware/Karbon/Canopy/Deltek.
- Pas de vérification avec sessions réelles de plusieurs rôles, vrai Drive, Gmail ou fournisseur IA. Les données navigateur étaient des fixtures ; ne pas annoncer une recette de production.

## Reprise recommandée

1. Relire le diff et reproduire les trois échecs préexistants ; déterminer la bonne correction sans affaiblir le contrôle de démarrage.
2. Installer le lot complet sur la branche cible et tester en aperçu avec sessions réelles : auditeur affecté/non affecté, Manager, Associé, secrétariat et EQR.
3. Vérifier les relais du bus en environnement réel : pièce → registre, référence → Shadow, cotation modifiée → contexte SIKA → accusé distinct de validation.
4. Vérifier la vraie bibliothèque de modèles et les références du cabinet ; ne jamais inventer un modèle absent.
5. Poursuivre les points explicitement non réalisés ci-dessus, en gardant l’autorité humaine, les versions, les permissions et les sources existantes.
