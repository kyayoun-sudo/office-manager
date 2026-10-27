# PTBA sans code : l’IA décide, le code exécute

Le moteur `fill-orders` reçoit maintenant explicitement la méthode d’audit de projets déjà définie par le cabinet, en complément du SOP et du working file réels. Cette méthode précise que le PTBA et le budget peuvent être sans codes. L’IA doit rapprocher les postes avec les intitulés et écritures du GL par le sens, justifier ses propositions et signaler les ambiguïtés. Le code ne choisit aucun compte par similarité.

Le contenu transmis à l’IA comprend la structure mesurée des tableaux et le catalogue des comptes du GL. Un GL par sections possède une vue dérivée explicitement nommée « écritures normalisées » : le compte d’en-tête est reporté sur les écritures, les totaux/reports sont écartés par le lecteur existant, les numéros de ligne d’origine sont conservés. L’IA peut donner ses ordres sur cette vue sans perdre la provenance.

## Ordres supplémentaires

`align.source_map` contient les correspondances proposées par l’IA entre valeurs différentes : `{from, to, why}`. `from` est une valeur de clé de la pièce source et `to` une valeur déjà présente dans la feuille cible. Les deux sont contrôlées avant exécution. Plusieurs comptes peuvent pointer vers un poste ; avec `sum_duplicates:true`, leurs écritures sont totalisées sur la ligne unique du poste. Le budget initial du poste reste unique : il n’est pas recopié une fois par compte.

Une clé source pointant vers plusieurs postes est refusée comme ambiguë. Une clé ou cible absente, une justification vide ou un poste cible répété est signalé et le regroupement concerné n’est pas appliqué. La vérification d’existence n’est pas une validation du sens : la proposition et sa justification sont montrées à l’auditeur.

Les `lookups` existants permettent toujours de proposer un compte pour un poste, contrôlé dans le GL. `verify_in.account_catalog:true` autorise la vérification dans le catalogue mesuré des comptes, y compris pour un GL par sections. Si un poste correspond à plusieurs comptes et que le working file exige un compte unique, l’IA doit demander comment représenter le regroupement ; aucun code de regroupement n’est inventé.

Le budget initial vient du PTBA initial, le final d’un budget révisé justifié et les amendements sont calculés final moins initial, sur les colonnes que l’IA indique conformément au SOP et au working file. Le GL n’est pas une source de budget final. Les engagements proviennent de la pièce d’exécution qui les justifie.

Les ordres et leurs correspondances sont gardés côté serveur et réexécutés à la confirmation existante « Oui, remplis ». Les protections des formules, champs occupés, sources et décisions humaines restent appliquées. Les rapprochements sémantiques sont mémorisés avec les ordres validés par les mécanismes existants.

Les tests couvrent un PTBA sans code et un TEB aux libellés différents (initial/final/amendements/engagements), les comptes justifiés dans le GL, plusieurs comptes pour un seul poste sans duplication du budget, les liens ambigus/inventés et les lignes d’origine d’un GL par sections. L’IA est simulée dans ces tests ; une mission réelle et ses documents n’ont pas encore été exécutés ici.
