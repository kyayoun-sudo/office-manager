// La méthode de remplissage du cabinet, donnée à chaque IA qui comprend ou remplit un working file (Paul, 2026-10-25 : « c'est la logique
// qu'il faudra garder »). Méthode métier d'audit de projets financés par un bailleur : elle vaut pour tout cabinet, rien de propre à un
// client. Le texte complet et lisible est dans claude/LOGIQUE_REMPLISSAGE_PROJETS.md (document du projet) ; ceci en est la version donnée
// à l'IA. Les pièces sont reconnues par leur CONTENU, jamais par leur nom.
export const PROJECT_AUDIT_METHOD = `Méthode du cabinet — audit de projets financés (à suivre) :
- PTBA = prévision des dépenses faite en début d'année ; il peut ne contenir AUCUN code, seulement des postes et des montants initiaux,
  avec des sous-numéros par catégorie ; la CATÉGORIE est le SOUS-TOTAL du PTBA. PTBA initial approuvé = budget initial ; PTBA révisé /
  final approuvé = budget final.
- TEB = exécution budgétaire par ligne : sert à voir les dépassements budgétaires et le % de sous-exécution ou de dépassement ; donne aussi
  le budget révisé et les engagements au 31/12.
- Grand livre : chaque écriture a un NUMÉRO DE COMPTE ; dans un grand livre présenté par comptes, il est dans la ligne d'en-tête de chaque
  section et doit être reporté sur chaque écriture ; les lignes de report, à nouveau, total, solde ne sont JAMAIS des écritures.
  Le grand livre sert aussi de table de correspondance : en rapprochant les libellés du PTBA de ceux du GL, on retrouve le numéro de compte.
- Grand livre analytique (D1) : une ligne par ÉCRITURE du grand livre de la période (les deux exercices si la mission en couvre deux) ;
  numéro de compte sur chaque ligne ; reports, à nouveau, totaux et soldes écartés ; Montant = débit − crédit ; Catégorie budgétaire =
  le numéro de compte, écrit exactement comme dans la feuille budget (D2), pour que les tests rapprochent les deux.
- Si le PTBA, le budget ou le TEB n'ont pas de code commun, c'est TOI, l'IA, qui rapproches le SENS des postes, les intitulés et les écritures du GL.
  Le code ne choisit pas le compte à ta place. Justifie chaque correspondance avec les pièces et leurs lignes. Un poste peut couvrir plusieurs
  comptes : représente le regroupement, conserve UNE seule fois le montant du budget du poste ; ne le duplique jamais sur chaque compte.
  Si le modèle impose un compte unique et que le poste en couvre plusieurs, demande comment représenter le regroupement plutôt qu'inventer un code.
  Une ambiguïté reste une question ; une absence reste une donnée manquante. Un intitulé proche n'est pas à lui seul une correspondance prouvée.
- Feuille budget (D2) : 1) lire les libellés des lignes / sous-totaux du PTBA ; 2) les faire correspondre aux libellés du GL pour trouver le
  numéro de compte ; 3) Catégorie budgétaire = ce numéro de compte (avec le libellé) ; 4) Budget initial = la ligne correspondante du PTBA
  initial approuvé ; 5) Budget final approuvé (document) = le dernier budget officiellement approuvé (PTBA révisé / final, ou colonne budget
  révisé du TEB) ; 6) Amendements / réallocations (net) = budget final approuvé − budget initial ; 7) Engagements au 31/12 = le TEB.
- Fonds reçus (D3) : les montants au CRÉDIT des relevés bancaires, et les avis de crédit ; montant attendu = convention / demande de fonds.
- Avances de fonds (D4) : les financements avancés par l'entité, cherchés dans le grand livre et les relevés bancaires.
- Compréhension de la convention (PRJ-01) : LIRE l'accord de prêt / la convention et en tirer bailleur, période, catégories, plafonds,
  taxes, cofinancement, procurement, reporting — ce n'est pas une extraction de tableau.
- Les archives .zip sont ouvertes : chaque fichier est une pièce.`;
