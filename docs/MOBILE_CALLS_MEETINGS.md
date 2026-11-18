# Firm Manager — appels audio et réunions vidéo dans la messagerie

**Statut : spécification fonctionnelle et technique, non implémentée.**
**Principe : le même Firm Manager pour ordinateur et Firm Manager Lite, mêmes comptes, rôles, missions, permissions, messagerie et backend métier.** Ne jamais créer un autre système de connexion, cabinet, chat ou mission pour les réunions.

## Objectif

Depuis une conversation individuelle, un groupe ou la conversation d'une mission, afficher :
- bouton **Appeler** (audio Internet) et **Visio** ;
- pour groupe/mission, **Démarrer une réunion**, **Rejoindre** et **Quitter** ;
- invitations, participants et statuts (invité, sonne, accepté, refusé, manqué, terminé) liés au fil de conversation ;
- mise en sourdine, caméra on/off, choisir micro/caméra si supporté ; affichage du réseau dégradé ;
- possibilité de passer du téléphone à l'ordinateur avec le même compte via une nouvelle connexion, sans casser les droits.

Ce sont des appels par Internet entre membres autorisés de Firm Manager, **pas** des appels ordinaires aux numéros PSTN/GSM. Ne pas promettre une sonnerie système ou le maintien du micro en arrière-plan iOS/Android identique à une application native. Un appel entrant lorsque l'app est fermée peut être signalé par notification push, dans les limites de la PWA ; rejoindre demande d'ouvrir l'app.

## Proposition d'expérience, en étapes

### C1 — Appel audio 1:1 depuis un DM (MVP)

- Appuyer sur téléphone → invitation destinée au seul destinataire du DM.
- L'appareil cible, s'il est connecté, propose **Accepter**/**Refuser** ; sinon notification push avec lien sécurisé selon consentement et compatibilité.
- Accepter demande la permission microphone à la personne, puis connecte l'appel. Sonneries et états pilotés par le serveur, avec expiration de l'invitation.
- Suspendre microphone, raccrocher, erreur/réseau, durée, trace de l'appel dans la conversation sans enregistrer le contenu audio.
- Interdire l'invitation si l'utilisateur n'a pas l'accès à la conversation/cabinet.
- Commencer audio uniquement pour préserver batterie et bande passante.

### C2 — Vidéo 1:1

- Bouton caméra, caméra désactivée par défaut, seulement après accord.
- Choix caméra frontale/arrière, résolution adaptable.
- Sur mobile, la vidéo s'arrête ou diminue lorsque l'utilisateur la désactive, passe à faible bande passante, ou quitte la conférence.

### C3 — Réunion de groupe / mission

- Démarrer une réunion dans une conversation de groupe ou mission ; tous les invités doivent appartenir au périmètre autorisé, accès revérifié à chaque arrivée.
- Liste des participants, statut de présence, contrôle micro/vidéo, invitation à rejoindre, sortie et fermeture.
- Éventuellement **planifier une réunion** plus tard avec invitations et rappels.
- Le partage d'écran peut être disponible principalement sur ordinateur, selon compatibilité du navigateur.
- Ne pas créer automatiquement des enregistrements ou transcriptions de discussions clients. Autorisation explicite et politique de rétention seront une tâche séparée si demandée.

### C4 — Notifications et qualité de service

- Notifications navigateur/Web Push conditionnelles aux permissions ; pas de promesse de comportement d'appel natif en arrière-plan.
- Mode réseau lent : audio prioritaire, caméra désactivée, retry et reconnexion, retour contrôlé sur rupture.
- Mesurer latence de connexion, pertes, mémoire, batterie, interruptions audio, compatibilité Safari iOS / Chrome Android / desktop.

## Technologie — décision à valider par Christian

**Recommandation pour un produit extensible : WebRTC via LiveKit** (Cloud pour démarrer, auto-hébergement ultérieur si coût, confidentialité, hébergement et capacité réseau le justifient). Il gère le transport audio/vidéo (SFU pour groupe), les SDK navigateur, et la connexion à une salle avec un jeton signé. Comparer **Jitsi Meet intégré** pour une preuve de concept rapide et **Daily Prebuilt** pour un service géré, mais ne pas dépendre d'une réunion publique non maîtrisée pour des données de mission sensibles.

Couche applicative Firm Manager : 
- `conversations` existantes et contrôle `org_id` / rôle / membership mission-groupe-DM ; ne pas changer `lib/chat.js` sans régression.
- nouvelles entités de **signal d'appel**, invitation, durée, participants et état, liées à la clé de conversation et au cabinet ; route `/api/app?route=calls` seulement après contrôle de sécurité.
- émissions des jetons de salle **uniquement côté backend** après vérification des droits, courte validité, room names non devinables, expulsion si accès retiré, journal d'audit.
- infrastructure voix/vidéo séparée du moteur métier (WebRTC/SFU + ICE/STUN/TURN + TLS/WSS et réseau UDP/TCP selon fournisseur). Le backend Firm Manager demeure unique ; aucun deuxième scheduler ni DB.
- client mobile charge le SDK audio/vidéo **uniquement lorsqu'un appel est démarré ou rejoint**, pour préserver poids initial et batterie.
- prise en charge audio comme premier lot ; vidéo optionnelle et adaptative (adaptive stream/dynacast si supporté).
- les deux versions Web et Lite rejoignent le même appel au moyen du même serveur de réunion.

## Obstacle technique identifié dans le dépôt — ne pas manquer

Dans `vercel.json`, la politique commune actuellement envoyée contient :
- `Permissions-Policy: camera=(), microphone=(), ...` ce qui bloque l'accès caméra/micro au navigateur ;
- `Content-Security-Policy` : `connect-src 'self' https://www.googleapis.com` et `frame-src https://drive.google.com/file/d/` ; si un fournisseur externe est utilisé, adapter précisément les domaines WebSocket/HTTPS autorisés et éventuellement les iframes.
- le serveur Node VPS réutilise les règles des headers de `vercel.json`.

**Ne pas simplement enlever toute la sécurité.** Modifier les politiques pour des routes d'appel précises et les origines approuvées, puis tester. Les URLs WebRTC et les permissions navigateur doivent fonctionner en HTTPS, y compris sur iPhone.

## Contrôles de sécurité et de métier

- Un invité ne peut pas entrer dans une réunion d'une autre organisation ni d'une mission interdite en collant une URL.
- Un DM privé ne devient pas public lorsque l'utilisateur appelle ; le propriétaire ne peut pas écouter les appels privés d'autrui par privilège global.
- Un participant externe éventuel demandera une invitation temporaire explicite, avec accès limité à la réunion **sans** accès aux documents du cabinet.
- Ni la vidéo ni l'audio ne sont stockés par défaut ; les métadonnées d'appel ont une politique de rétention définie.
- Aucun outil IA ne « rejoint » ni n'enregistre une réunion sans consentement explicite des participants et droits nécessaires.
- L'appel se termine côté serveur à l'expiration et le système ne laisse pas de ressources facturables orphelines.

## Tests d'acceptation

1. Appel audio entre deux comptes sur mobile et ordinateur, acceptation/refus/absence, micro coupé, raccrochage.
2. Test avec une PWA iPhone installée, Safari, Chrome Android, bureau ; vraie permission micro/caméra (y compris refus).
3. Changement de cabinet, compte désactivé, mission retirée : accès à la salle refusé et connexion active révoquée.
4. Groupe : 3–5 participants, arrivée/départ, micro/caméra, réseau 3G/4G faible, rétablissement.
5. Test de confidentialité et de non-régression de la messagerie, API, droits, notifications et desktop.
6. Pas de téléchargement du SDK d'appel à l'ouverture normale du mobile.
7. Test de coût/bande passante du SFU et TURN avant auto-hébergement sur VPS ; sauvegarde et rollback.

## Livraison

Ce document est une **spécification ajoutée à la feuille de route**, pas une fonction déjà codée. Christian décide ensuite du fournisseur et des ressources, après estimation des appels concurrents, de la disponibilité nécessaire et des exigences de confidentialité.
