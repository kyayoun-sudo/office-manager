# Rangement : lecture réelle et progression

Correctif sur fix/map-register-bridge-write, 7 octobre 2026.

L'ancien planificateur parcourait l'inventaire et réutilisait les rares extraits
de la file d'inspection. Il ne lisait pas lui-même les documents. L'écran nommait
le total inventorié « Fichiers lus » et pouvait annoncer une fin avec des fichiers
non lus. Les tables db/tidy.sql ont été appliquées dans le projet Supabase autorisé
avec RLS et accès uniquement par le backend ; aucun document n'a été déplacé par
cette migration.

Le planificateur lit désormais trois documents par étape avec readDriveFileText,
maximum 6 000 caractères par extrait. Une lecture vide, non supportée ou refusée
reste needs_reading, sans destination automatique. Les extraits ne sont pas stockés
dans office_tidy_items et ne sont pas exportés dans le dépôt. Les compteurs séparent
les fichiers repérés des extraits effectivement lus. Un extrait n'est pas une lecture
intégrale, et les formats non supportés demandent une autre méthode de lecture.

Les règles/préférences existantes restent utilisables après lecture. Une règle client
ne remonte pas les fichiers déjà dans un sous-dossier du client. Les suggestions IA
demandent toujours validation. OFFICE_MANAGER_TIDY_PAID_AI_ENABLED est désactivé par
défaut : aucun appel modèle de ce flux sans activation explicite après accord sur
les coûts et la confidentialité. Sans IA ni règle/préférence applicable, un fichier
lu reste incertain. Aucun classement sémantique gratuit universel n'est annoncé.

Les cas non lus/incertains empêchent le statut terminé ; CONTENT_REVIEW_REQUIRED
explique les cas restants. Arrêter une demande pendant une lecture ne doit pas la
relancer ; l'écriture de progression exclut les demandes arrêtées. Les contrôles de
carte validée et d'accès Google en écriture restent obligatoires.

Validation : 186 tests Node passent, dont lecture refusée malgré les métadonnées,
aucun appel IA par défaut, aucune persistance d'extrait, conservation des sous-dossiers,
arrêt pendant lecture, et état restant incomplet. La lecture Google en déploiement
doit encore être vérifiée ; les tests simulés ne prouvent pas cet accès.

## Complément : documents absents de l'inventaire et relais Google

Une demande globale découvre désormais les documents à la racine directement dans
Google Drive, puis traite ce petit instantané avant l'inventaire. Le curseur racine
est distinct du curseur d'inventaire ; les documents racine sont exclus de la seconde
phase pour ne pas être comptés deux fois. Le périmètre `/` traite uniquement la racine.
Cet instantané appartient à la demande interne et ne réécrit pas MAP/REGISTER.

Une règle étroite fondée sur le contenu propose les budgets d'audit explicitement
d'exemple vers un dossier unique de modèles de feuilles de travail existant. Sans
ces marqueurs ou avec plusieurs dossiers candidats, elle ne décide rien. La confiance
reste sous le seuil automatique : un humain valide la proposition.

Le relais Google existant supporte maintenant tidy_move, avec JWT et secret métier
conservés. Il résout fichier/destination depuis un item approuvé et revendiqué en base,
contrôle l'organisation, la demande en exécution, le Drive, les types, les parents et
la relecture après déplacement. Il refuse les fichiers mémoire et les dossiers ; pas
de renommage, suppression, permission ou déplacement arbitraire. L'annulation revient
au parent précédent du même item, y compris la racine. Les actions historiques du
relais restent inchangées. Source distante v3 comparée aux quatre fichiers locaux
avant modification : identique hors fins de lignes et espaces finaux.

La continuation utilise waitUntil de la bibliothèque officielle @vercel/functions,
en conservant la requête HTTP réelle. Les refus de continuation sont enregistrés.
Cela reste limité à la durée de la fonction et à la protection du déploiement ; ce
n'est pas un scheduler durable ni une preuve d'autonomie quotidienne. La page peut
reprendre une demande inactive, et ne promet plus un traitement autonome vérifié.

Suite complète : 191 tests passent. Le déplacement réel par l'application reste
à recetter après déploiement, connexion et validation de la proposition.
