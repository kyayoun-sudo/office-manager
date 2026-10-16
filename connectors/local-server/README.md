# Connecteur serveur du cabinet — option supplémentaire à Drive

Ce service Node 20+ s’installe sur une machine du cabinet qui voit les dossiers autorisés. Il n’est pas lancé par Vercel. Drive reste le fournisseur par défaut ; les références `local:...` désignent explicitement le serveur. La mémoire commune et plusieurs processus existants restent sur Drive.

## Installation par l’administrateur du cabinet

1. Copier ce dossier sur le serveur, hors des répertoires documentaires. Aucun `npm install` nécessaire : dépendances Node standard uniquement.
2. Copier `config.example.json` dans un emplacement privé et adapter `org_id`, `state_file` et `roots`. Windows accepte les chemins absolus JSON tels que `D:\\Cabinet\\Audit`. Un partage réseau doit déjà être monté et autorisé pour le compte système du service.
3. Définir `OFFICE_LOCAL_CONNECTOR_SECRET` avec un secret aléatoire d’au moins 32 caractères, identique côté application et côté service. Ne pas le mettre dans Git, le navigateur ou le fichier exemple.
4. Lancer `node server.mjs --config /chemin/prive/config.json`, puis configurer la supervision du service et les sauvegardes.
5. Le service écoute uniquement sur `127.0.0.1:8788`. Installer un reverse proxy HTTPS et un accès réseau autorisé depuis l’hébergement de l’application ; aucun partage SMB ne doit être publié. Une application Vercel ne peut pas joindre directement une adresse LAN privée : ce chemin réseau doit être prévu par l’administrateur. Si le cabinet refuse tout accès HTTPS entrant, une passerelle sortante ou un hébergement privé reste à développer.
6. Côté backend de l’application, configurer `OFFICE_LOCAL_CONNECTOR_URL` (HTTPS), `OFFICE_LOCAL_CONNECTOR_SECRET`, `OFFICE_LOCAL_ORG_ID`. Aucun de ces secrets n’est envoyé au navigateur. `OFFICE_LOCAL_ALLOW_LOOPBACK_HTTP=true` est réservé aux tests locaux sur localhost.
Les appels au connecteur sont refusés dans le mode test existant de l’application, notamment sur les déploiements Vercel Preview, afin de ne pas toucher le serveur réel depuis une prévisualisation.

7. Tester avec deux comptes personnels, dont un en lecture seule, avant toute utilisation sur les vrais dossiers.

Chaque racine contient une liste explicite `readers` et `writers` d’adresses personnelles. Les droits de l’application ET ces listes s’appliquent. Ils ne sont pas une synchronisation automatique des ACL Active Directory/SMB. Un utilisateur autorisé sur une racine peut en consulter tous les documents : créer des racines distinctes par périmètre confidentiel. Le compte système doit disposer lui-même des droits nécessaires, et les racines ne doivent pas être manipulées par des utilisateurs hostiles. Les agents de fond n’héritent d’aucune identité implicite.

## Fonctions et conservation

La page `/fichiers.html`, accessible depuis Documents et Paramètres, liste les dossiers autorisés, permet le dépôt sans remplacement, la lecture des formats pris en charge, le téléchargement et la copie d’une référence stable. Ces références peuvent être confirmées dans le registre documentaire et servir de population Excel dans le parcours existant.

Le backend fournit aussi création de dossier, copie, renommage de fichiers et modification binaire avec version attendue. Pas de suppression. Un changement de contenu conserve l’ancienne version dans `.office-manager-versions/<identifiant>/<empreinte>` ; une version différente bloque l’écriture. Le renommage conserve l’identifiant et refuse d’écraser une destination existante. Les liens symboliques et traversées de chemin sont refusés. Ces garanties ne remplacent pas une sauvegarde du serveur.

`state_file` garde les identifiants ; son journal adjacent `.audit.jsonl` garde date, utilisateur, action et références sans contenu documentaire. Sauvegarder les deux. Un seul processus connecteur doit gérer ce registre. Ne pas renommer les fichiers à la main en attendant une réconciliation externe (non implémentée). Un renommage externe peut invalider une référence. Les écritures provenant d’autres applications restent possibles : le contrôle de version réduit les conflits, sans constituer un verrou transactionnel universel du système de fichiers.

## Limites explicites

- 3 Mo par fichier, pour rester sous la limite des requêtes/réponses Vercel encodées en base64 ; 500 éléments par dossier, sans troncature silencieuse.
- Lecture texte/CSV/JSON, DOCX/XLSX/PPTX et PDF textuel via les lecteurs existants. OCR et anciens formats Office non ajoutés.
- Pas d’exécution VBA, de macro, de coédition Excel desktop ou de calcul Excel natif. Modification des classeurs à macros refusée par l’adaptateur.
- Les API Google Sheets et l’export PDF Google ne sont pas simulés pour les fichiers locaux. Les fonctions qui les exigent restent explicitement indisponibles sur cette source.
- Pas de scan Orpailleur complet du serveur, de migration des mémoires Drive, de recherche globale locale, de conversion inter-fournisseurs, ni d’hébergement entièrement sur site.
- Aucun connecteur n’est installé sur le serveur du client par ce lot. Les tests utilisent des dossiers temporaires, un service HTTP local et des comptes fictifs.

Désactivation : retirer les trois variables backend du connecteur. Les documents Drive continuent d’utiliser le fournisseur initial ; les références locales deviennent indisponibles sans être supprimées.
