# Préparation d’étape pilotée par l’IA

Le panneau « Travail de l’agent » appelle `step-plan`. Ce parcours utilise désormais le cerveau commun `think`, via `lib/step-brain.js`, au lieu de demander immédiatement une opération sur la seule liste des fichiers. Le repérage structurel du classeur reste un outil de code ; l’interprétation et le choix du travail sont confiés à l’IA.

## Parcours

1. Le serveur vérifie les droits, le SOP courant, le working file et le catalogue réel de la mission. Il enregistre un point de reprise dans `office_procedure_work.walkthrough`.
2. Une requête exécute une décision IA **ou** la lecture demandée, puis enregistre son résultat. L’IA reçoit ce résultat au passage suivant. Aucun traitement n’est lancé en arrière-plan après la réponse HTTP.
3. L’IA dispose de lectures de plages du working file, de pièces/pages et de feuilles Excel. Le catalogue est paginé par 30, avec possibilité de revenir à une page. Le code n’écarte pas les pièces après la quinzième et ne les limite pas aux noms de fichiers tabulaires pour ce parcours.
4. Le choix d’un plan nécessite une lecture du working file et des pièces sélectionnées. Pour une source Excel lue par feuille, la feuille retenue doit correspondre à une feuille lue. Les opérations existantes restent les outils disponibles : lecture documentaire, extraction, rapprochement, anomalies et cut-off. Une capacité absente doit être signalée.
5. Pour la lecture documentaire, les identifiants sélectionnés sont transmis au lecteur exhaustif existant, qui conserve son propre point de reprise. Il ne relance pas une sélection indépendante de toutes les pièces de la mission.
6. L’interface poursuit les passages successifs, avec pause et reprise. Après 20 passages automatiques, elle propose de continuer. Un autre test n’est plus déclenché automatiquement en parallèle ; le formulaire de test explicite reste disponible.

## Contrôles conservés et renforcés

- Aucun accès à une pièce extérieure au catalogue de la mission.
- Révision SOP et version du classeur contrôlées ; les pièces lues sont vérifiées à la reprise. Une version inconnue de pièce est signalée, sans prétendre la lecture réutilisable.
- Conflits de mémoire contrôlés avant la sauvegarde. Une reprise sur une nouvelle version peut être demandée explicitement.
- Les calculs préparés par ce cerveau utilisent le plan enregistré côté serveur et vérifient les versions des sources au lancement, au lieu de reprendre des paramètres modifiés par le navigateur.
- Les cellules occupées, les formules et les décisions de l’auditeur restent protégées. Les différences de formulation SOP/Excel et la ligne trouvée par égalité de texte deviennent des indices d’alignement pour l’IA ; elles ne retirent plus toutes les cellules proposées par simple comparaison de chaînes.
- Une panne réseau/IA apparaît comme une préparation interrompue ou un incident technique. Elle ne déclenche pas une demande de pièces manquantes.
- Les journaux de ce parcours indiquent le job, l’étape et la phase, sans contenu des pièces ni identifiants d’accès.

## Limites et vérification

Les lectures exploratoires sont bornées et annoncées comme telles (pages, plages, caractères). Les dernières fenêtres et la compréhension de l’IA sont conservées pour la reprise, pas une copie exhaustive de chaque pièce. La lecture exhaustive des sources retenues reste le rôle du lecteur documentaire. Le budget réseau des inférences est borné à 105 secondes pour ce passage, avec 45 secondes maximum par tentative fournisseur ; cela ne prouve pas que toute dépendance Drive/Supabase est exempte de lenteur.

Les autres parcours (remplissage de feuille, tâches de fond, chat explicite) ne sont pas tous remplacés par ce module. Le but de cette correction est d’unifier la préparation automatique de l’écran montré, en conservant les outils et validations existants.

Les tests utilisent des modèles et des connecteurs simulés, de vrais classeurs ExcelJS et le script réel du panneau dans un DOM de test. Ils couvrent sélection après lecture, catalogue au-delà de 30 pièces, panne IA, erreur de lecture, versions modifiées, conflit de mémoire, pause/reprise, choix de feuille et sélection documentaire conservée. Ils ne constituent pas un essai sur une mission réelle avec une IA facturée.

Le lien des captures pointe vers `feature/entrainement-agents` (commit `e12c8e4c`). Cette correction est préparée sur la base `feature/white-label-desktop` (arbre `7d42092a`). Fusionner cette correction sur cette base ne change pas automatiquement l’ancien lien d’entraînement.
