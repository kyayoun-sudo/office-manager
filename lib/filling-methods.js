// La méthode de remplissage du cabinet, donnée à chaque IA qui comprend ou remplit un working file (Paul, 2026-10-25 : « c'est la logique
// qu'il faudra garder »). Méthode métier d'audit de projets financés par un bailleur : elle vaut pour tout cabinet, rien de propre à un
// client. Le texte complet et lisible est dans claude/LOGIQUE_REMPLISSAGE_PROJETS.md (document du projet) ; ceci en est la version donnée
// à l'IA. Les pièces sont reconnues par leur CONTENU, jamais par leur nom.
export const PROJECT_AUDIT_METHOD = `Méthode du cabinet — audit de projets financés (à suivre) :
- PTBA = prévision des dépenses faite en début d'année ; chaque dépense a un numéro et une provision budgétaire (dépense d'origine),
  avec des sous-numéros par catégorie ; la CATÉGORIE est le SOUS-TOTAL du PTBA. PTBA initial approuvé = budget initial ; PTBA révisé /
  final approuvé = budget final.
- TEB = exécution budgétaire par ligne : sert à voir les dépassements budgétaires et le % de sous-exécution ou de dépassement ; donne aussi
  le budget révisé et les engagements au 31/12.
- Grand livre : chaque écriture a un NUMÉRO DE COMPTE ; dans un grand livre présenté par comptes, il est dans la ligne d'en-tête de chaque
  section et doit être reporté sur chaque écriture ; les lignes de report, à nouveau, total, solde ne sont JAMAIS des écritures.
  Le grand livre sert aussi de table de correspondance : en rapprochant les libellés du PTBA de ceux du GL, on retrouve le numéro de compte.
- Feuille budget (D2) : 1) lire les libellés des lignes / sous-totaux du PTBA ; 2) les faire correspondre aux libellés du GL pour trouver le
  numéro de compte ; 3) Catégorie budgétaire = ce numéro de compte (avec le libellé) ; 4) Budget initial = la ligne correspondante du PTBA
  initial approuvé ; 5) Budget final approuvé (document) = le dernier budget officiellement approuvé (PTBA révisé / final, ou colonne budget
  révisé du TEB) ; 6) Amendements / réallocations (net) = budget final approuvé − budget initial ; 7) Engagements au 31/12 = le TEB.
- Fonds reçus (D3) : les montants au CRÉDIT des relevés bancaires, et les avis de crédit ; montant attendu = convention / demande de fonds.
- Avances de fonds (D4) : les financements avancés par l'entité, cherchés dans le grand livre et les relevés bancaires.
- Compréhension de la convention (PRJ-01) : LIRE l'accord de prêt / la convention et en tirer bailleur, période, catégories, plafonds,
  taxes, cofinancement, procurement, reporting — ce n'est pas une extraction de tableau.
- Les archives .zip sont ouvertes : chaque fichier est une pièce.`;
