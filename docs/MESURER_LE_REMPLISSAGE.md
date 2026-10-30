# Mesurer le remplissage des working files sur une vraie mission

Pourquoi (audit du 30/10/2026) : le remplissage des working files par l'Enhanced Auditor est prouvé par des tests sur des pièces
**inventées**, avec une IA **simulée**. Personne ne l'a mesuré sur une vraie mission, avec la vraie IA. Ce protocole donne un
chiffre : la part des cases que l'agent remplit comme l'auditeur.

## Ce qui n'est pas encore prouvé

| Sujet | Ce qui est prouvé | Ce qui ne l'est pas |
|---|---|---|
| Remplissage d'un working file (D1 grand livre, D2 budget, D3 fonds reçus, D4 avances) | Banc `tests/corpus/` (formes réelles, données inventées), IA répondant et en panne ; garde-fous (montant retrouvé dans la pièce, rien sans « Oui, remplis », formules et jugements jamais écrits) | La vraie IA choisit-elle les bonnes pièces et les bonnes colonnes sur de vraies pièces ? |
| Fiche de chaque pièce au dépôt (famille, sens des colonnes) | Tests avec réponses d'IA simulées | Qualité des fiches de la vraie IA (GL général / auxiliaire, PTBA / TEB, relevés) |
| Recettes apprises d'une mission à l'autre | Mission A → mission B dans les tests | Deux vraies missions du même modèle |
| Lecture des PDF scannés (OCR) | Vrai PDF de 1 000 pages, reprise | Justesse du texte lu : toujours « à relire » |
| Rangement de l'Orpailleur | Examen de rangement de Shadow sur un Drive fictif | Taux de bons rangements sur le vrai Drive du cabinet |
| Plusieurs cabinets, sécurité du 30/10 | Tests | Rien n'a encore tourné sur Vercel (voir `docs/A_FAIRE_DE_VOTRE_COTE.txt`, point 000) |

## Le protocole (une mission terminée dont on connaît les bonnes réponses)

1. **Choisir une mission terminée**, de préférence un audit de projet (PTBA, TEB, GL, relevés), dont le working file a été rempli
   à la main et relu. C'est la **référence**.
2. **Mettre la référence de côté** (une copie hors du dossier de la mission), sans la montrer à l'agent.
3. Sur l'aperçu Vercel, **créer une mission d'essai** (« + Nouvelle mission ») et y déposer les **vraies pièces** de cette mission
   (Pièces reçues), telles que le client les a envoyées.
4. Ouvrir « Ma procédure » sur le **modèle vierge** du même working file ; laisser l'Enhanced Auditor proposer le remplissage de
   chaque feuille de données, puis cliquer « Oui, remplis » **sans rien corriger** (on mesure l'agent, pas la personne).
   Noter à part chaque fois que l'agent a posé une question ou dit qu'une pièce manquait.
5. Télécharger le working file rempli par l'agent : c'est le **candidat**.
6. Comparer :

   ```
   node scripts/compare-workfile.mjs reference.xlsx candidat.xlsx --sheets D1_GL,D2_BUDGET,D3_FONDS --out rapport.md
   ```

   Le rapport donne, par feuille : cases justes, différentes, oubliées par l'agent, ajoutées par l'agent, et la **justesse**
   (justes / cases remplies par l'auditeur), puis la liste des cases à regarder.
7. Recommencer sur une **deuxième** mission du même modèle : c'est là qu'on voit si les recettes apprises servent.

## Lire le résultat honnêtement

- Les **formules** du fichier ne sont pas comptées (c'est le travail du fichier, pas de l'agent).
- Comparaison **case par case à la même position** : si l'agent met les bonnes lignes dans un autre ordre que l'auditeur, elles
  comptent comme différentes. Regarder alors la liste des cases avant de conclure.
- Un montant écrit autrement (« 1 000 », 1000, « 1 000,00 ») compte comme juste ; écart toléré : 0,5.
- Une case « ajoutée par l'agent » n'est pas toujours une erreur (l'auditeur a pu oublier) : à trancher par une personne.
- Le chiffre vaut pour **cette** mission et **cette** IA ; il ne prouve rien pour un autre modèle de working file.

Code : `lib/workfile-compare.js`, `scripts/compare-workfile.mjs`, tests `tests/workfile-compare.test.js`.
