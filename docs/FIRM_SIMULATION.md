# Cabinet virtuel — première version

Le module ajoute un moteur isolé de 15 personnages, huit clients et deux années (2027–2028), soit 16 opportunités/missions et 13 étapes par mission gagnée. Les faux humains ont des identités persistantes ; leurs réponses sont pilotées par des règles. Les spécialistes existants sont appelés via leurs instructions en mode IA. Firm Manager utilise GRAND_CONTROLEUR_INSTRUCTIONS ; Shadow utilise une consigne de laboratoire.

## Utilisation

Dans Entraînement, section « Cabinet virtuel — 15 personnes, 24 mois » :

1. Choisir le parcours Référence ou Agents IA ; leurs campagnes sont séparées.
2. Créer le cabinet. Le plafond d'appels est défini à la création (24 par défaut).
3. Référence : avancer par 100 événements ; trois clics suffisent pour atteindre la fin.
4. IA : démarrer, exécuter une étape ou un lot maximal de dix. Une étape appelle le fournisseur configuré. Aucun appel n'est déclenché à la simple ouverture de page.
5. En cas de réponse incomplète, l'étape conserve les erreurs pour la tentative suivante. Après trois échecs : corriger la tentative, puis reprendre.
6. Télécharger les résultats. Le JSON contient équipe, missions, productions, échanges, contrôles et leçons proposées.

La persistance réutilise SHADOW_LAB.json avec des clés par organisation ET parcours. Le stockage durable et l'authentification existants doivent être configurés. Le fichier reste dans l'Atelier mémoire existant. Les mutations nécessitent owner/partner. Les appels IA sont plafonnés séparément du quota quotidien Shadow ; tentatives échouées incluses. Aucun achat, abonnement, retrait de quota existant ni nouvelle variable secrète.

## Résultats reproductibles sans appels payants

```
node --test tests/firm-simulation.test.js tests/firm-simulation-service.test.js tests/audit-sandbox.test.js tests/app-router.test.js
node scripts/run-firm-simulation.mjs docs/firm-simulation-results
node scripts/render-firm-results.mjs
```

La page cabinet-simulation-resultats.html présente les résultats de référence exportés, même sans session. Elle ne divulgue que des données fictives. Le corrigé des contrôles est interne au module serveur ; il ne figure pas dans le contexte modèle.

## Limites explicites

- Aucun entraînement des poids, aucune amélioration automatique de production.
- Aucun score de qualité substantielle : la note mesure la présence d'actions et de sources. Un modèle peut cocher une action sans réellement maîtriser la procédure ; cette limite est affichée.
- Les personnages suivent des règles et ne sont pas encore quinze agents conversationnels autonomes.
- Les services métier de production, les congés RH réels et les permissions par mission de production ne sont pas exercés ; le laboratoire possède ses propres contrôles isolés.
- Les grands livres du nouveau module sont miniatures ; le laboratoire précédent de 60000 lignes est conservé séparément. Pas de revendication d'analyse exhaustive d'un vrai grand livre.
- Les productions sont des objets JSON et des messages fictifs, pas des Excel ni des emails réels.
- Deux campagnes persistantes (référence et IA) par cabinet, sans suppression ni remplacement automatique. Pas encore de création de variantes depuis l'interface.
- Pas de tâche de fond : le lot de dix continue tant que la page reste ouverte ; chaque résultat est enregistré séparément.
- Le budget est en nombre d'appels, pas en dollars. Le comptage de jetons est une estimation. Les replis internes d'un fournisseur peuvent générer plus d'une tentative réseau par étape.
- La connexion réelle au fournisseur et au stockage Drive doit être vérifiée en session propriétaire. Les tests de service utilisent des doublures ; ils ne sont pas des résultats IA réels.

L'étape suivante est l'intégration des vrais outils métier dans le périmètre isolé, l'évaluation des preuves et des jugements, puis une campagne réelle avec budget contrôlé. Ne pas présenter cette première version comme l'intégralité de la simulation métier spécifiée.
