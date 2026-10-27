# Disponibilité IA commune et méthodes de remplissage validées

## L'agent demande une capacité au service IA

Les parcours automatiques `firstAvailable`, `multiModel` et les inférences du SDK opérationnel utilisent `ai-pool.js`. L'identité, la mémoire, les outils et l'avancement restent ceux de l'agent. Le fournisseur est un choix technique du service ; la liste des fournisseurs réellement utilisés par le SDK est remontée pour les journaux.

Le service filtre d'abord les capacités prises en charge (texte, fichiers, recherche, outils). Il écarte les fournisseurs temporairement suspendus et privilégie les fournisseurs libres et récemment disponibles. Une clé configurée ne constitue jamais une preuve de crédit disponible.

Une première inférence part ; si elle n'a pas répondu après 700 ms, une seconde peut partir, avec deux inférences maximum en vol par demande. Une erreur libère immédiatement la place pour la relève. Le premier succès est retenu et les autres requêtes HTTP sont annulées au mieux par AbortSignal. Une annulation n'annule pas nécessairement la consommation déjà engagée chez le fournisseur.

Le SDK ne rejoue pas le `Runner` : seul un appel de modèle est remplacé. Le tour suivant reçoit les résultats des outils déjà exécutés. Le streaming de ce parcours est tamponné jusqu'à une réponse complète pour ne pas exposer une demi-instruction d'un fournisseur perdant. Une conversation explicitement détenue côté fournisseur (`previousResponseId` / `conversationId`) reste épinglée à son fournisseur : changer sans disposer de tout son historique serait incorrect.

Les crédits insuffisants suspendent la configuration 30 minutes ; clé refusée ou modèle indisponible : 10 minutes ; limitation de débit : au moins 1 minute (Retry-After pris en compte) ; incident réseau/serveur : 15 secondes. Une erreur de requête propre au contenu ne rend pas le fournisseur indisponible. L'expiration permet un nouvel essai ; le diagnostic manuel de connexion peut également tester une configuration et lever sa suspension après succès. Les demandes explicites de consensus restent explicites.

### Petite mémoire de disponibilité

Les statuts sont isolés par cabinet, fournisseur, empreinte de clé et modèle. Ils sont conservés dans la table existante `office_agent_checkpoints` (clé `ai-health-<empreinte>`), sans clé API, prompt ou pièce. Pas de migration. Un cache de 15 secondes réduit les lectures. Les opérations de santé sont bornées à 800 ms : si le stockage est indisponible, le cache local assure un fonctionnement dégradé ; une instance neuve pourra alors retenter un fournisseur suspendu ailleurs. La table et la connexion doivent donc être présentes pour le partage durable entre instances.

`GET ai-providers` distingue la configuration du fournisseur de son état de disponibilité observé. Un succès passé ne garantit pas qu'un appel futur réussira. Une clé changée a sa propre empreinte et ne reste pas bloquée par l'ancienne.

## Ne pas réexpliquer un working file inchangé

Après « Oui, remplis », écriture vérifiée et confirmation du reçu humain, les ordres sont mémorisés dans le fichier existant `OFFICE_MANAGER_FILL_RECIPES.json`. Une méthode garde son cabinet, sa mission, son valideur, la signature du SOP et de la structure utile du working file, le catalogue des pièces et les empreintes des sources utilisées. Jusqu'à 20 méthodes par modèle/feuille peuvent être retenues pour des missions différentes.

À la préparation suivante, si tout correspond et si les révisions et empreintes sont vérifiables, ces ordres sont exécutés de nouveau pour produire l'aperçu sans appel IA. Les calculs, contrôles et confirmations existants restent appliqués. L'écran indique qui avait validé la méthode. Les formules normalisées survivent à la relecture des ordres côté serveur.

Une source, une période, un SOP, une structure ou un catalogue différent revient à l'IA. Elle reçoit la méthode antérieure autorisée et les nouvelles pièces : elle adapte les ordres plutôt que présumer que les anciennes données sont valables. Une autre mission ne récupère jamais automatiquement les pièces ou données de la précédente. Les recettes sémantiques déjà existantes sont conservées.

Cette version réutilise automatiquement les instructions uniquement quand leur contexte et leurs sources sont inchangés. Elle ne prétend pas appliquer sans analyse une méthode à un nouvel exercice ou à des documents différents. Une précision de la personne ou `reanalyse: true` force une nouvelle analyse.

## Vérifications

Tests avec IA/HTTP/Drive simulés : pannes de crédit, relais, annulation, limitation de concurrence, isolation des clés/cabinets, reprise du SDK après un outil sans doublon, streaming, mémoire des méthodes et invalidation. Le stockage du statut a également été testé par une vraie requête dans PGlite avec la définition SQL existante du checkpoint.

Aucun débit payant de production, essai sur le Drive réel, déploiement Supabase ou promotion Vercel n'a été effectué. Le branchement des modèles est vérifié contre les interfaces et le code de la version du SDK installée dans le dépôt.
