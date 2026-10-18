# Retour de préparation du budget — opportunité « Drive »

Paul signale un clic sans résultat compréhensible sur son opportunité Drive ; le bouton exact et l’état distant restent non confirmés. Aucun accès à sa session ni lecture du fichier client n’a été effectué.

Défauts reproduits dans le code : le formulaire affichait « Enregistré » indépendamment du résultat ; zéro écriture vérifiée sur zéro tentative pouvait donner le statut prepared ; le lien n’était pas affiché si Google ne retournait pas webViewLink ; une préparation échouée/interrompue pouvait laisser le bouton désactivé sans limite.

Corrections : zéro écriture => needs_review avec explication, sans écraser le modèle ni les entrées existantes. Affichage des nombres réellement écrits et relus, des questions, des problèmes de configuration et de l’attente ; liens vers le budget et son dossier à partir des IDs connus si URL absente. Relance proposée après cinq minutes ou pour une ancienne demande sans horodatage ; contrôle de préparation en cours conservé côté serveur. L’envoi automatique après validation d’équipe enregistre maintenant requested_at. Aucun tarif ni jour inventé ; aucune modification de formules, de signature ou de transfert de mission.

Vérifié : tests Excel du modèle et de la copie, nouveau test zéro écriture, scénarios de workflow, Chromium sur messages, liens et relance. Le cas réel Drive nécessite encore une vérification avec le compte connecté. Ces changements ne prouvent pas que le budget de Drive a été rempli ni que tous les problèmes de correspondance d’un modèle Excel sont résolus. Aucune migration SQL ni modification distante des documents.
