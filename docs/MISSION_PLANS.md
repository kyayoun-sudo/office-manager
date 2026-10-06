# Plans de mission proposés

Le texte exact du plan et ses phases sont enregistrés en versions dans
office_mission_plan_versions. L'utilisateur peut modifier le brouillon avant
de l'enregistrer. La source pilot_submission signifie un contenu soumis par
le pilote : elle ne certifie ni son auteur humain ni son origine IA.

Le bouton de copie s'active après une réponse obtenue pour la mission choisie
via la demande préparée. Une réponse d'une autre mission ne doit pas être
copiée automatiquement. Les anciennes réponses peuvent être copiées
manuellement dans le texte du plan. Les phases sont saisies une par ligne.
Changer de mission vide l'éditeur ; relire les modifications avant navigation.

Une sauvegarde identique restitue la version déjà enregistrée. Une modification
du texte ou des phases crée une version supérieure et conserve les précédentes.
Le verrou transactionnel par organisation/mission sérialise les sauvegardes.
La lecture du dossier affiche les 20 versions les plus récentes avec un avis
de limite ; le tool IA reçoit uniquement le texte de la dernière version.

Le plan n'est ni approuvé ni exécuté. La sauvegarde ne crée aucune tâche,
affectation, action dans la queue, mail ou job scheduler. Les futures décisions
devront référencer la version exacte et son empreinte ; elles ne sont pas
encore implémentées.

Sécurité : organisation imposée côté serveur, RPC réservé au service_role,
table avec RLS et droits anon/authenticated révoqués. Le backend ne peut pas
modifier/supprimer directement les versions. Le signal INFO « RLS Enabled No
Policy » est attendu pour cette table réservée au backend :
https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy.

db/mission-plans.sql a déjà été appliqué dans Supabase ; ne pas le réexécuter
pour charger l'interface. Aucun profil RH nominatif n'est fourni par ce script.
