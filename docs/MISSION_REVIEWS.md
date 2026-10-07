# Étape 3 — validation de l’équipe et du programme

Branche de référence : fix/map-register-bridge-write. Cet incrément reste local jusqu'au chargement et à la recette de la preview.

## Parcours pour le responsable

Depuis le dossier ou le programme de mission, ouvrir « Valider l’équipe et le programme ».

1. Choisir les collaborateurs dans l'annuaire interne actif, donner un rôle par personne, dates et pourcentage de charge, puis enregistrer une proposition.
2. Relire la section « Équipe enregistrée ». Vérifier la capacité dans le planning et cocher la déclaration correspondante. Valider, reporter ou refuser cette version exacte.
3. Relire la totalité du programme enregistré. Chaque tâche doit avoir une échéance et un rôle correspondant à au moins un membre de l'équipe présent à cette date. Le plan doit être approuvé et l'équipe actuelle validée. Valider séparément le programme.
4. Ouvrir le budget. Il utilise uniquement cette équipe et le programme approuvés. Les heures et taux restent à fournir explicitement et à revoir.

Le commentaire est obligatoire au refus. Une décision ne lance aucun travail ni message. L'historique conserve les versions et décisions, avec les limites d'affichage indiquées. Une nouvelle version d'équipe ou de programme exige une nouvelle revue ; changer d'équipe invalide l'approbation opérationnelle du programme liée à l'ancienne équipe.

## Garanties et limites

- Deux nouvelles tables, en ajout seul : `office_mission_team_versions`, `office_mission_review_decisions`. Écriture uniquement via RPC restreints ; backend SELECT, pas d'INSERT/UPDATE/DELETE direct ; RLS et aucun droit public.
- Verrou par cabinet et mission, partagé avec la sauvegarde des plans et programmes. Les décisions portent sur le dernier contenu exact ; concurrence et reprise après réponse perdue sont contrôlées par identifiant de demande et dernière décision attendue.
- Organisation imposée au serveur. Membres actifs du même cabinet, pas de noms fournis par l'IA. Aucun profil RH ni questionnaire dans les propositions ou fichiers du dépôt.
- Revue par credential propriétaire/associé existant. Le journal atteste `owner_credential_holder` ; il ne prétend pas identifier personnellement le décideur. La reprise des sessions individuelles de Claude est un travail séparé.
- **La capacité est vérifiée manuellement par le responsable**, puis sa déclaration est conservée. Aucun calcul global de disponibilité ou approbation automatique RH n'est introduit.
- **Les affectations de `office_mission_assignments` ne sont pas modifiées.** L'équipe approuvée sert à cette préparation et au budget ; le planning global et ses KPI continuent à lire leurs sources existantes. Une activation explicite des affectations avec contrôles de capacité reste à construire avant de déclarer toute l'étape 3 opérationnelle.
- Budgets historiques : les nouveaux budgets doivent désormais être préparés avec une équipe et un programme approuvés. Un ancien budget sans ces références ne peut pas être publié comme s'il bénéficiait de ces approbations.
- Le relais Drive revérifie versions, décisions, mission et collaborateurs avant la création. Une réservation après échec reste soumise à la récupération manuelle déjà documentée pour les budgets.

## Mise en service restante

Appliquer `db/mission-reviews.sql` après les schémas mission-plans, mission-plan-decisions et mission-programmes. Mettre à jour le relais `taty-google-bridge` avec tous ses modules, puis déployer une preview de notre branche. Ne pas promouvoir la production de Claude. La migration n'a pas été appliquée pendant cette construction.

Recette synthétique : enregistrer une équipe, vérifier la déclaration de capacité, valider équipe puis programme, préparer un budget, refuser l'équipe ou enregistrer une nouvelle version et vérifier que la publication est bloquée. Contrôler l'historique et l'absence de mutations dans le planning, la queue et le Drive lors des validations.

Tests : `node --test tests/*.test.js` et `node tests/verify-mission-reviews-sql.mjs`, avec les vérifications SQL existantes du programme et du budget. Ces tests locaux ne remplacent pas la recette de l'application déployée.
