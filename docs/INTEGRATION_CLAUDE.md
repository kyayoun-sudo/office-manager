# Intégration des contributions de Claude — 7 octobre 2026

Consigne directe de Paul : Codex reste responsable de notre branche
**fix/map-register-bridge-write**, les contributions de Claude y sont intégrées.
Cette consigne remplace la précédente instruction de travailler sur sa branche.

Base locale préservée : c6c6b29. Contribution Claude : fcbccc86, puis notre
écran de décisions préparé dans 4e2f0d7. Import limité aux fichiers ajoutés depuis
la base de Claude 3e567eb. Aucun remplacement du moteur, des agents, des Edge
Functions, de la console originale index.html ou de nos tests d'origine.

Seule configuration d'origine modifiée : redirection temporaire `/` vers
accueil.html, reprise de Claude ; délais existants 300/60 secondes conservés.
La console originale reste accessible à /index.html.

Le dossier GitHub de la contribution contenait aussi des différences historiques
issues des chargements manuels : elles ne sont pas importées. Notre version locale
cohérente et ses corrections restent la référence, suivant docs/ROADMAP.md.

Les migrations du journal des plans, comptes, marque et décisions d'actions ont
déjà été appliquées dans Supabase. Zéro compte ou décision de plan permanente
créé par l'agent. Les migrations persona/tidy restent à préparer et leurs fonctions
ne sont pas déclarées opérationnelles. Aucun passage, rangement ou envoi lancé.

Le secret propriétaire est toujours limité à la production. La revue automatique
a refusé son extension à preview sans accord explicite ; ce point reste en attente.
La publication GitHub est manuelle, l'accès en écriture de l'agent reste bloqué.
Ne pas utiliser le précédent lot Étape3 destiné à la branche de Claude : publier
le nouveau lot intégré dans notre branche.

Vérification après intégration : **169/169 tests Node réussis**, tests SQL des
plans et décisions réussis, diff vérifié. L'échec browser-response de la branche
de Claude n'est pas reproduit, notre fichier correct étant préservé. Toujours
10 fonctions API. Aucune publication distante ou promotion en production.
