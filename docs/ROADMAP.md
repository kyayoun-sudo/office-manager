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
