# Logique de remplissage — audit de projets financés (working file NL-T01 et équivalents)

Décidée par Paul KOMENAN le 25 octobre 2026 : « c'est la logique qu'il faudra garder ».
Elle vaut pour tout cabinet qui audite des projets financés par un bailleur. Les pièces portent des noms différents d'une mission à l'autre :
l'agent les reconnaît par leur CONTENU, jamais par leur nom.

## Comment l'application l'applique (2026-10-26)

Cette logique n'est PAS écrite dans le code. C'est une consigne du cabinet donnée à l'IA, qui l'applique en lisant les **fiches** des pièces :
- au dépôt, chaque pièce reçoit sa fiche : le code mesure toute la pièce (colonnes, lignes, classes de comptes, comptes et intitulés,
  catégories prouvées par leurs sommes), l'IA dit ce qu'elle est (grand livre général / auxiliaire, PTBA, TEB, relevé…), ce qu'est une ligne
  et le sens de chaque colonne ; une correction d'un auditeur est retenue pour tout le cabinet ;
- au remplissage, l'IA choisit à partir des fiches ; elle trouve le compte de chaque catégorie par le sens, parmi les comptes du grand livre ;
  le code vérifie (pièce de la mission, numéro qui existe dans le GL, jamais la même colonne des deux côtés d'un recalcul, jamais un texte dans
  une colonne de montants) et signale un doute, sans décider ;
- une fois le remplissage validé (« Oui, remplis »), la façon de remplir la feuille devient sa **recette** pour ce modèle de working file,
  en sortes de pièces et en sens de colonnes : à la mission suivante, l'IA retrouve les pièces de même sorte, quels que soient leurs noms.

## Les pièces et ce qu'elles disent

- **PTBA** (Plan de Travail et Budget Annuel) : la prévision des dépenses, faite en début d'année. Chaque dépense a un numéro et une
  provision budgétaire (la dépense d'origine). Des sous-numéros par catégorie ; la catégorie = le **sous-total** du PTBA.
  Le PTBA initial approuvé donne le budget initial ; le PTBA révisé / final approuvé, le budget final.
- **TEB** (Tableau d'Exécution Budgétaire) : l'exécution par ligne. Sert à voir les **dépassements budgétaires** et le pourcentage
  de sous-exécution ou de dépassement. Donne aussi le budget révisé et les engagements au 31/12.
- **Grand livre GÉNÉRAL** : chaque écriture est rattachée à un **numéro de compte**, sur plusieurs classes de comptes (charges, banque,
  immobilisations…). Dans un grand livre présenté par comptes, le numéro est dans la ligne d'en-tête de chaque section
  (« 605300 Fournitures… ») : il faut le reporter sur chaque écriture. Les lignes de report, de « à nouveau », de total et de solde ne sont
  pas des écritures : elles ne sont jamais copiées comme des lignes.
- **Grand livre AUXILIAIRE** (tiers : fournisseurs 40x, clients 41x) : ce n'est pas le grand livre général ; il ne remplace pas le général
  pour D1 ni pour trouver les comptes.
- **Relevé bancaire** : un seul compte en banque, débit / crédit, solde.
- Le grand livre sert aussi de **table de correspondance** : on retrouve le numéro de compte de chaque ligne budgétaire (par le sens de son
  libellé) quand le PTBA n'en donne pas.

## D2 — Budget (Paul, 2026-10-25 : « reconnaître la catégorie budgétaire avec les noms, chercher dans le grand livre, trouver les comptes ;
## [le montant du PTBA] dans budget initial ; ensuite prendre le TEB, mettre les montants d'engagement correspondant à ses comptes »)

1. Lire les catégories (sous-totaux) du PTBA, par leur nom.
2. Chercher dans le grand livre général le compte qui correspond à ce nom, par le sens ; en déduire le **numéro de compte**.
3. **Catégorie budgétaire** = ce numéro de compte, pour que le grand livre et le budget parlent la même langue. Pas de compte trouvé :
   le nom de la catégorie est gardé, et c'est signalé.
4. **Budget initial** = le montant de la catégorie dans le PTBA.
5. Prendre le TEB : ses lignes sont rapprochées par **numéro de compte** (plusieurs lignes du même compte sont additionnées).
6. **Engagements au 31/12** = les engagements du TEB pour ce compte.
7. **Budget final approuvé (document)** = le budget (révisé) du TEB pour ce compte, ou le PTBA révisé / final approuvé.
8. **Amendements / réallocations (net)** = budget final approuvé − budget initial.
   Le test PRJ-03 vérifie ensuite que chaque réallocation au-delà du seuil a son approbation.

| Champ | Source principale | Ce qu'il faut prendre |
|---|---|---|
| Catégorie budgétaire | PTBA + grand livre général | le numéro de compte trouvé par le nom de la catégorie |
| Budget initial | PTBA | le montant de la catégorie |
| Amendements / réallocations (net) | calcul | budget final approuvé − budget initial |
| Budget final approuvé (document) | TEB (budget révisé) ou PTBA révisé | le dernier budget officiellement approuvé |
| Engagements au 31/12 | TEB | les engagements du compte (lignes additionnées) |

## D1 — Grand livre analytique

Le grand livre GÉNÉRAL (pas l'auxiliaire). Une ligne par écriture, avec son numéro de compte (repris de l'en-tête de section si besoin) ;
reports, à-nouveaux, totaux et soldes écartés ; montant = débit − crédit ; catégorie = le numéro de compte, écrit comme dans D2.

## D3 — Fonds reçus

Chercher dans les **relevés bancaires** les montants au **crédit** ; l'IA cherche aussi dans les **avis de crédit**. Pas le grand livre.
Le montant attendu vient de la convention / de la demande de fonds.

## D4 — Avances de fonds

Chercher les financements **avancés par l'entité** dans le grand livre et dans les relevés bancaires.

## PRJ-01 — Compréhension de la convention

Prendre l'accord de prêt (ou la convention), le **lire** et en tirer les informations nécessaires (bailleur, période, catégories,
plafonds, taxes, cofinancement, procurement, reporting). Ce n'est pas une extraction de tableau.

## Toutes les pièces

L'application et tous les agents ouvrent les archives **.zip** : chaque fichier de l'archive est lu comme une pièce.
