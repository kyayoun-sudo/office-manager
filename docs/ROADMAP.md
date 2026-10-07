# Feuille de route TATY Office Manager

Le Grand Contrôleur pilote Mission Controller, Orpailleur et Sika.
L'interface permet de consulter ce pilotage et valider ses propositions.

1. Socle : accès, réponse du Grand Contrôleur et suivi des demandes.
2. Pilotage central : tableau de bord, dossier mission et plan proposé.
3. Validations persistantes : équipe, rôles, allocations et approbations.
4. Programme mission : phases, tâches, procédures, documents et livrables.
5. Orpailleur : mapping validé, provenance, versions et stockage fiable.
6. Échanges autorisés : mail, pièces jointes, relances et suivi d'exécution.
7. Sika : factures, échéances, règlements et preuves.
8. Recette complète et préparation de mise en service.

## État au 6 octobre

Étape 1 : utilisateur a reçu la réponse du Grand Contrôleur et retrouvé son
résumé dans le suivi (run 55a22e5b). L'ancienne demande interrompue est
signalée comme fin inconnue. Lecture Google Sheets échouée : API désactivée
sur le projet Google utilisé par le bridge. Ce point reste ouvert pour Drive.

Étape 2 en construction : liste protégée des missions, dossier Supabase
avec cadrage et équipe cible, affectations, actions et inventaire documentaire.
Le Grand Contrôleur et Mission Controller disposent d'une lecture du dossier
à jour. La demande de plan est préparée dans la page sans être envoyée.
Les prochaines étapes affichées sont un parcours générique non approuvé.
Le dossier Nova Services et sa lecture par le Grand Contrôleur ont été vérifiés
par l'utilisateur. Le cadrage manuel est protégé dans le déclencheur en ligne.
L'enregistrement versionné du plan est maintenant construit : texte exact et
phases relus puis soumis par le pilote, sans approbation. La publication de
l'interface et sa recette restent à faire. Les approbations restent étape 3.

120 tests locaux passent. Le stockage office_mission_plan_versions et son
RPC réservé au backend ont été appliqués dans Supabase. Les tests locaux et
un test en ligne annulé vérifient versions, doublons et droits d'accès.
Aucun scan, appel IA réel ou export de profil RH effectué pour cette livraison.

## Point de reprise vérifié — 7 octobre, après le budget

Notre branche reste `fix/map-register-bridge-write`. Voir `docs/COMPARAISON_CLAUDE_2026-10-07.md` pour les nouvelles contributions et les écarts de publication.

Le budget de mission est construit et testé localement (201 tests). Le paquet budget a bien été chargé sur GitHub à `6b369e6d`, mais la branche distante manque encore de dépendances des écrans et du programme issus de notre intégration précédente. Restaurer la base complète avant déploiement.

Le prochain jalon produit est de **compléter l'étape 3**, puis recetter l'étape 4 : valider séparément le programme et l'équipe avant le parcours budget → classement. Les étapes 3, 5 et 6 ne sont pas déclarées terminées. Les nouveautés de Claude restent des contributions à intégrer sélectivement, sans changer de branche.

Horaires convenus : Grand Contrôleur 07:00 GMT ; Orpailleur 08:00 / 12:00 / 20:00 GMT ; Sika lundi, heure à préciser. Conserver le scheduler désactivé tant que ses passages ne sont pas recettés.

### Incrément suivant de l'étape 3 : construit localement

Propositions et approbations distinctes d'équipe et de programme ajoutées ; le budget consomme la version d'équipe validée. La capacité est relue manuellement. La publication de cet incrément, sa migration et sa recette restent à faire. Les affectations du planning global ne sont pas activées par ces décisions : ne pas déclarer toute l'étape 3 terminée. Voir docs/MISSION_REVIEWS.md.
