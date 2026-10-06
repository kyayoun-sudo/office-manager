# TATY People Intelligence — moteur actuel

La branche fix/map-register-bridge-write a été publiée par upload manuel (commit 8a5cd0e). Le Grand Contrôleur conserve ses trois spécialistes : Mission Controller, Orpailleur et Sika. Aucun scheduler ni Edge Function n’est redéployé par cette correction.

L’endpoint interne api/people.js appelle office_mission_staffing_advice avec l’organisation imposée par le serveur. Le moteur Supabase récent consulte les compétences, les affectations, les allocations et les indisponibilités approuvées. La vue filtre les personnes techniquement éligibles, sans indisponibilité enregistrée, dont la charge est inférieure à 100 %. Les rôles, la charge et les lacunes de données sont affichés pour validation du responsable. Aucun score de questionnaire ne trie les candidats ; les personnes sans questionnaire restent admissibles. La liste constitue un vivier, pas une équipe affectée automatiquement.

Le moteur actuel interprète les compétences demandées comme des alternatives (au moins une correspondance), et utilise un repli selon le type de mission si elles ne sont pas renseignées. La charge est le maximum des deux sources opérationnelles pour éviter de sommer des données potentiellement dupliquées. Sans dates ou données complètes, la disponibilité reste à confirmer. Même avec des données, le responsable confirme capacité, expérience et composition de l’équipe.

R009 : vérifier les compétences, la disponibilité et la charge. R010 : adapter le briefing et le management après présélection. R011 : aucune décision RH sensible ni diagnostic fondés uniquement sur le questionnaire. R012 : révision des profils sur observations post-mission documentées et validées.

Le script db/people-intelligence.sql reprend le moteur safe staffing et le déclencheur d’enrichissement de l’action. Il conserve le RPC de scoring historique pour compatibilité. Les exigences manuelles et les actions approuvées, exécutées, vérifiées ou annulées sont protégées ; les changements de dates déclenchent une actualisation. Le script ne rétrotraite pas les missions et n’a pas été appliqué au projet actif.

Les profils nominatifs et réponses individuelles restent dans Supabase. Aucun export RH n’est inclus. Les recommandations sensibles sont exclues des contextes et outils génériques envoyés à l’IA. Le token pilote protège la vue interne ; il doit rester réservé aux responsables autorisés. Cette consultation ne lance aucun appel IA.
