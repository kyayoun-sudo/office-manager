# Étape 4 — préparation du programme de mission

7 octobre 2026. Branche de référence : **fix/map-register-bridge-write**.
Codex intègre les contributions utiles de Claude ; notre feuille de route reste
la référence. Cet incrément avance sur l'étape 4 sans déclarer terminées les
validations de l'étape 3.

## Parcours

Dossier mission → Préparer le programme détaillé. Le texte et les phases du plan
source sont consultables. Une phase contient des tâches avec titre, rôle proposé,
procédure, pièces attendues, livrable et échéance facultative. Plusieurs tâches
peuvent être ajoutées par phase, retirées du brouillon avant enregistrement.

Modèle proposé : **conseil — parcours client**, adapté aux cinq phases de Nova :
cadrage, cartographie, diagnostic, conception cible, mise en œuvre/restitution.
Le modèle exige ces phases dans cet ordre, il ne les invente pas pour une mission
d'un autre type. C'est un modèle déterministe éditable, aucun appel IA. Les
autres missions utilisent des tâches à compléter. Les indicateurs, constats et
pièces reçues ne sont pas inventés ; les échéances sont choisies par le pilote.
Les rôles proposés ne sont pas des affectations de collaborateurs.

Chaque contenu distinct est enregistré en proposition dans
office_mission_programme_versions, avec l'identifiant du plan source immuable.
Une soumission identique retourne la même version. Un contenu historique déjà
enregistré ne remplace pas silencieusement la dernière version ; l'interface
signale sa version. L'historique reste consultable avec les phases de son propre
plan source, même lorsque le plan a changé. 20 versions affichées, limite signalée.

Un programme peut être préparé avant approbation du plan, avec avertissement
visible. **Il ne peut pas être exécuté** : aucune approbation du programme ni
écriture de contrôle, queue, affectation, mail ou routine n'est implémentée ici.
Le moteur d'exécution existant ne consomme pas ces propositions. L'approbation
exacte du programme et les validations d'équipe restent un travail séparé.

## Garde-fous

Nouvelle route GET/POST api/app?route=mission-programme, code pilote obligatoire,
organisation définie au serveur. Le stockage a RLS, aucun accès anon/authenticated,
backend SELECT/RPC uniquement, aucun INSERT/UPDATE/DELETE direct. Le RPC restreint
SECURITY DEFINER a search_path fixe et vérifie tenant, empreinte, dernier plan,
phase index, schéma des tâches et limites. Les échéances saisies doivent être des
dates réelles et rester dans la période prévue de la mission lorsqu'elle est définie.
Un programme devenu obsolète pendant l'édition provoque un conflit, pas un écrasement.
Les enregistrements du programme et du plan partagent le verrou par mission.

20 phases, 20 tâches par phase, 100 tâches au total, 100000 caractères JSON maximum.
Les brouillons restent en mémoire du navigateur : enregistrer avant de changer
de mission. Une fermeture de page peut perdre les modifications non enregistrées.
Les champs obligatoires sont tâche, rôle, procédure et livrable. Les dates et
pièces manquantes devront être confirmées avant toute future approbation opérationnelle.

## Vérification et déploiement

- 174/174 tests Node réussis, dont 5 nouveaux tests de programme.
- PGlite : migration rejouée, immutabilité, doublons, dates, source, tenant,
  écritures obsolètes, droits et absence d'effets sur queue/affectations vérifiés.
- Migration add_internal_mission_programme_versions appliquée dans Supabase.
- Test RPC live annulé par rollback : idempotence et conflit vérifiés.
  Zéro programme permanent créé, aucun changement du plan Nova.
- Advisor : INFO RLS sans policy pour ce stockage exclusivement backend,
  volontaire avec droits publics révoqués. Aucune nouvelle alerte WARN/ERROR
  concernant le programme. Référence :
  https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Interface : modèle, enregistrement et historique testés localement avec
  données synthétiques ; recette Vercel encore à faire après publication.
- Toujours 10 fonctions API. Aucun fichier du moteur d'origine modifié,
  aucune Edge Function, tâche planifiée, dépense ou souscription ajoutée.

Le nouveau lot de notre branche comprend l'intégration de Claude et cet incrément.
La publication GitHub est toujours manuelle ; aucune promotion en production.
Le réglage du secret propriétaire dans les previews reste en attente de l'accord
explicite de Paul. Préparer un programme utilise le code pilote ; ce travail ne
change pas le périmètre du secret propriétaire.

## Prochain jalon de notre feuille de route

Recette Nova : préparer le modèle, adapter les tâches, préciser les échéances,
enregistrer, rouvrir et vérifier la version. Puis compléter l'étape 3 : validation
du plan, propositions d'équipe/allocations, validation exacte du programme.
L'étape 5 de rangement/mapping et l'étape 6 de mails restent soumises à leurs
garde-fous avant exécution. Les horaires et le PC de Claude sont des contributions
futures à intégrer lorsqu'elles deviennent utiles, sans remplacer ce parcours.
