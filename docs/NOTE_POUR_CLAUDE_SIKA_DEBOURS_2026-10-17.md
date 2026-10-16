# SIKA — débours de mission, 17 octobre 2026

Ajout progressif sur `feature/white-label-desktop`. Aucune fonctionnalité supprimée, aucun changement de `main`, aucun document réel modifié pendant les essais.

## Parcours livré

Le bloc « SIKA · Débours de mission » apparaît dans la mission, l’accueil Finance/Manager et le secrétariat. Le raccordement est dans les Paramètres existants : aucune nouvelle page.

1. Un membre affecté saisit description, date, montant/devise, personne ayant payé et justificatif PDF/JPEG/PNG (2 Mo maximum).
2. Le connecteur existant sauvegarde le justificatif original sous un nom déterministe dans le dossier documentaire déjà enregistré de la mission. Parent et empreinte SHA-256 sont relus. Sans dossier connu, sans pièce ou si le dépôt échoue, aucune réussite n’est annoncée.
3. Un autre humain habilité (Partner/Owner ou Manager de la mission avec droit d’approbation mission et accès Finance) décide et explique. Refacturable = oui/non/à déterminer ; oui exige la référence de la clause ou de l’accord client. Le code ne vérifie pas juridiquement cet accord.
4. Si le validateur possède le droit de préparation Finance, SIKA tente immédiatement le remplissage comptable. Sans configuration ou en cas d’erreur, la décision reste enregistrée et le transfert est annoncé en attente. La comptabilité peut le relancer. Un Manager avec seulement consultation Finance valide la dépense mais laisse le transfert à la comptabilité.
5. La comptable enregistre séparément la référence et le justificatif du remboursement, puis éventuellement la référence d’une facture existante. Ces opérations portent `human_recorded` : ni exécution bancaire, ni facture officiellement émise, ni encaissement client vérifié.
6. L’auteur peut corriger une dépense soumise/refusée, avec motif et conservation de la version précédente. Une dépense approuvée ne peut pas être réécrite par ce parcours.

## Intégration technique

- `lib/sika-expenses.js` : service déterministe, aucune requête LLM ; montants en unités centésimales entières, sans mélange de devises ni moteur de tarification concurrent.
- `api/app.js?route=sika-expenses` : GET/POST avec session personnelle obligatoire. Aucun appel agent autonome ne peut fabriquer une approbation humaine dans cette route.
- `assets/sika-expenses.js/css` : bloc commun chargé depuis `brand-theme.js`, tableaux sombres/ambre, formulaires clairs et utilisation mobile.
- Petite mémoire unique `OFFICE_MANAGER_SIKA_EXPENSES_<org_id>.json` à l’emplacement MEMORY existant ; métadonnées, références, décisions et historique, pas de contenu/base64 des pièces. Lecture stricte : erreurs, mémoire illisible ou doublons refusés au lieu de repartir d’un registre vide.
- Verrou distribué existant `acquireReaderLease` + contrôle de version Drive. Les identifiants de requête rendent les reprises idempotentes ; une même empreinte de pièce dans une mission demande revue. Un fichier déposé avant un échec d’écriture peut rester dans le dossier ; la reprise avec le même identifiant le réutilise. Pas de suppression automatique.
- Le cabinet vient du serveur ; vérification de la mission en base filtrée par cabinet, affectations actuelles et matrice de permissions existante. Accès Finance étendu uniquement si niveau >= préparer et sans restriction « mes missions ». Les auditeurs voient leurs propres dépenses, pas celles de leurs collègues. La comptable utilise un rôle existant avec les droits Finance configurés ; aucun nouveau rôle n’est créé.
- Les événements importants utilisent le journal d’audit existant. L’historique métier est conservé même si ce journal technique est temporairement indisponible ; le document de mémoire reste soumis aux droits du Drive, pas un archivage inviolable.

## Raccordement au document comptable

Le Partner/Owner indique le lien/identifiant de son XLSX existant, la feuille exacte, une plage d’au plus 500 lignes et 10 colonnes distinctes : identifiant du débours, mission, date, description, montant, devise, payé par, pièce, validateur, refacturable.

SIKA écrit uniquement dans une ligne dont toutes les entrées mappées sont vides, non fusionnées et sans formule. Une feuille protégée est refusée. L’identifiant unique permet de retrouver une ligne déjà écrite ; un contenu divergent déclenche un conflit au lieu d’être écrasé. Le classeur est réécrit via le patch XML existant, avec contrôle de version et relecture des valeurs. Les formules restent présentes ; leurs caches sont invalidés et Excel doit recalculer à l’ouverture. Aucun moteur Excel de calcul n’a été exécuté ici.

La plage doit correspondre aux véritables entrées du tableau, à l’intérieur des plages couvertes par ses calculs. Le code n’insère ni lignes de tableau ni nouvelles formules. Configurer le fichier de suivi, pas le modèle maître de cotation. Aucun fichier du cabinet n’a été raccordé à distance pendant cette livraison.

## Vérification

- 12 tests métier nouveaux : circuit complet, scopes cabinet/mission, session humaine, revue indépendante, motif/accord client, version périmée, doublons/reprises, protection des formules, correction historisée, pièce modifiée, transfert automatique, mémoire stricte et sauvegarde réelle via l’adaptateur en mémoire.
- Test Chromium : vrai composant → service réel → adaptateur documentaire simulé, dépôt → Partner/configuration → validation et écriture XLSX vérifiée → comptabilité/remboursement/facture ; écran mobile sans débordement, aucune erreur JS. Capture `/workspace/output/sika/debours-processus.png` (données fictives).
- Routeur : refus GET/POST sans session personnelle, nombre de fonctions Vercel inchangé.
- Deux anciennes fixtures `document-location.test.js` attendaient un démarrage alors que les prérequis étaient manquants. Elles vérifient désormais le blocage, puis simulent les prérequis complétés avant de tester la transition ou sa reprise en attente. Aucune modification des règles de production de ce workflow.
- `npm test` : **686 tests, 686 réussites, aucun échec**. Contrôles syntaxiques et `git diff --check` réussis. Statut Vercel à consulter dans le compte rendu de livraison.

## Non livré / à configurer

- Fournir et raccorder le véritable XLSX de suivi de la comptable. Google Sheets natif, XLSM et documents Word non pris en charge par ce raccordement.
- Les RPC de `db/inspection-reader-leases.sql` (déjà dans l’installation complète) doivent exister. Pas de nouveau SQL. Si le verrou manque, sauvegarde bloquée avec explication ; aucune migration distante exécutée ici.
- Les reçus passent par le connecteur documentaire existant, y compris ses références locales ; serveur physique et session réelle du cabinet non testés dans cette recette simulée.
- Les demandes d’avance ne sont pas exposées dans l’interface ; ce flux traite les dépenses réellement justifiées. L’API conserve une distinction et interdit de transférer une avance comme dépense réelle.
- Pas encore de rapprochement automatique avec la cotation prévisionnelle, de notification proactive propre aux débours, ni d’appel à Mission Controller/Orpailleur lors de ce dépôt : le lien mission et l’emplacement font foi dans le registre. Les passages planifiés et outils conversationnels SIKA ne consultent pas encore ce nouveau registre. Ne pas présenter le simple remplissage déterministe comme une capacité LLM autonome.
- Pas de génération/envoi de facture selon modèle officiel, de TVA/retenues, paiements partiels, annulation d’affectation de facture/remboursement ou relevé bancaire connecté. Les références déclarées ne sont pas des confirmations bancaires ou des preuves d’envoi.
- Les dépenses approuvées restent figées. Pour corriger une dépense déjà approuvée/facturée, un parcours d’ajustement/avoir reste à construire, sans écraser l’historique.
- Traitement fiscal/comptable des frais/débours, conditions de refacturation, conservation et droits Finance à valider pour le cabinet et son pays. Aucune certification ou garantie de conformité annoncée.
