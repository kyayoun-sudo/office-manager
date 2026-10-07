# Sécurité des données — plan pour le lancement commercial

Rédigé par Claude (Anthropic) le 2026-10-07, à la demande de Paul KOMENAN.
Objet : protéger les données des cabinets clients **une fois l'application lancée
et vendue**. Complète `docs/SECURITE.md` (état actuel du code).

> Les failles listées en § 0 ne sont pas liées aux tests : elles sont dans le code
> qui partira en production. Les corriger fait partie du lancement.
> Légende : ☐ à faire · ◐ en partie fait · ☑ fait.

---

## 0. Failles constatées dans le code actuel (à corriger avant tout lancement)

| # | Faille | Risque | Correctif prévu |
|---|---|---|---|
| F1 | Code d'accès commun (`OFFICE_MANAGER_ACCESS_TOKEN`) accepté par les routes d'origine et remis au navigateur des personnes connectées | un poste compromis ou un départ ⇒ accès à toutes les données | § 3 — jeton personnel partout (`lib/auth.js`), puis suppression du code |
| F2 | Clé maîtresse Supabase (`SUPABASE_SERVICE_ROLE_KEY`) dans Vercel | compte Vercel piraté ⇒ base entière | § 1, § 3, § 7 — base par cabinet, 2FA, membres limités, rotation |
| F3 | Dépôt GitHub public | carte de l'application offerte aux attaquants | § 7 — dépôt privé |
| F4 | Accès Google « Drive complet » (compte technique) | bien plus que le Drive du cabinet | § 1 — autorisation du cabinet, limitée à ses dossiers |
| F5 | Documents clients envoyés à l'IA sans cadre contractuel | sortie de données non maîtrisée | § 4 — zéro conservation, minimisation, contrats |
| F6 | Connexion de secours par code | contourne les comptes personnels | § 3 — à désactiver une fois les comptes créés |
| F7 | Jetons de session dans le stockage du navigateur | vol possible en cas d'injection de code | § 6 — coffre sécurisé du système (application de bureau) |

---

## 1. Chaque cabinet dans son coffre (isolation)

- ☐ **Une base de données (projet Supabase) par cabinet client**, pas de base
  partagée. Une erreur ou une attaque chez un cabinet ne touche jamais les autres.
  - ☐ Script de création d'un nouveau cabinet : nouveau projet, application des
    fichiers `db/*.sql`, variables d'environnement propres, premier propriétaire.
  - ◐ Toutes les tables ajoutées ont déjà RLS activé, aucun accès public, pas de DELETE.
- ☐ **Région d'hébergement connue**, choisie et indiquée au client (ex. Europe).
- ☐ **Drive du cabinet par autorisation du cabinet** (OAuth délégué, dossiers
  choisis, révocable), en remplacement du compte technique « Drive complet ».
- ☐ Contrôle automatique : aucune requête sans `org_id` du cabinet courant.

## 2. Des données illisibles si elles sont volées (chiffrement)

- ◐ **En transit** : HTTPS partout ; HSTS ajouté dans `vercel.json`.
- ◐ **Au repos** : chiffrement natif de Supabase et de Google Drive.
- ☐ **Chiffrement applicatif des données sensibles** (indicateurs individuels,
  montants, informations clients, journaux) avec **une clé propre à chaque
  cabinet** (chiffrement « en enveloppe » ; clé maîtresse dans un coffre à clés
  géré, jamais dans le code ni dans la base).
- ☐ **Sauvegardes chiffrées** quotidiennes (+ restauration à un instant donné),
  conservées hors du projet principal ; **restauration testée chaque mois**.

## 3. Seules les bonnes personnes entrent (identité et accès)

- ◐ Comptes personnels e-mail + mot de passe (Supabase Auth) — fait.
- ☐ **Connexion par le compte Google Workspace ou Microsoft du cabinet** (SSO).
- ☐ **Double authentification obligatoire** (code à 6 chiffres sur téléphone) :
  au minimum propriétaire, associés-gérants, managers ; idéalement tous.
- ☐ **Jeton personnel sur toutes les routes** (F1) : `lib/auth.js` accepte le
  jeton Supabase de la personne et vérifie son rôle ; période de transition avec
  le code commun, puis **suppression du code commun** et arrêt de sa
  transmission au navigateur.
  - ◐ Déjà fait pour les routes sensibles : `coordination`, `team-kpi`, `my-kpi`.
- ☐ **Sessions courtes et révocables** : bouton « déconnecter partout » ; un
  collaborateur désactivé perd l'accès immédiatement sur tous ses appareils.
  - ◐ Compte désactivé ⇒ déconnexion à la page suivante — fait.
- ☐ **Blocage** après plusieurs mauvais mots de passe + **CAPTCHA** (Supabase Auth).
- ☐ **Alerte de connexion inhabituelle** (nouveau pays, nouvel appareil, heure atypique).
- ☐ Désactiver la **connexion de secours par code** (F6).
- ☐ Principe du **moindre privilège** pour chaque rôle et chaque agent.

## 4. L'IA ne fait pas fuir les données

- ☐ **IA en mode « zéro conservation »** : données ni stockées ni utilisées pour
  l'entraînement, **par contrat écrit** avec l'éditeur (OpenAI, Anthropic…).
- ☐ **Minimisation** : seuls les extraits utiles sont envoyés, jamais des dossiers entiers.
- ☐ **Masquage** des données très sensibles avant envoi (identifiants, numéros
  de compte, données personnelles non nécessaires).
- ☐ **Option cabinet exigeant** : modèle hébergé dans une région ou chez un
  fournisseur imposé.
- ◐ Garde-fous existants : l'IA propose, l'humain décide ; aucun envoi externe
  sans validation ; ton familier de l'agent réservé aux adresses du cabinet.

## 5. Tout est surveillé et tracé

- ◐ **Journaux inaltérables** (ajout seul) : consultations sensibles
  (`office_access_log`), décisions (`office_action_decisions`), rangements
  (`office_tidy_items`), passages d'agents (`office_agent_passes`).
- ☐ Étendre le journal : connexions, exports, téléchargements, changements de rôle.
- ☐ **Alertes automatiques** : téléchargements massifs, consultations hors
  horaires, échecs de connexion répétés, changement de rôle.
- ☐ **Tableau de bord sécurité** pour le propriétaire du cabinet.
- ☐ **Plan de réaction aux incidents** écrit : qui fait quoi, comment couper un
  accès, comment prévenir le cabinet et l'autorité de protection des données
  dans les délais légaux.

## 6. Ordinateurs et application de bureau

- ☐ **Application signée** (Windows et Mac) et **mise à jour automatique**.
- ☐ **Jetons rangés dans le coffre sécurisé du système** (Trousseau macOS,
  Gestionnaire d'identification Windows), pas dans le navigateur (F7).
- ☐ Accès aux dossiers de l'ordinateur : **choisis explicitement**, révocables.
- ☐ Recommandations aux cabinets : disque chiffré, verrouillage automatique,
  système et antivirus à jour.

## 7. Avant le lancement

- ☐ **Dépôt GitHub privé** (F3), revue de chaque modification, branche principale protégée.
- ☐ **Double authentification** sur GitHub, Vercel, Supabase, Google Workspace
  admin, OpenAI ; **membres des équipes limités** au strict nécessaire (F2).
- ☐ **Rotation des secrets** (clés Supabase, codes, clés IA) et procédure écrite.
- ☐ **Surveillance automatique des composants** (failles connues des
  dépendances) et des secrets publiés par erreur.
- ◐ En-têtes de sécurité HTTP (CSP, X-Frame-Options, nosniff, HSTS…) — fait.
- ☐ **Test d'intrusion** par un prestataire indépendant, corrections, nouveau test.
- ☐ **Conformité** (à valider avec un juriste, ceci n'est pas un avis juridique) :
  - Côte d'Ivoire : loi n° 2013-450 — formalités auprès de l'**ARTCI** ;
  - RGPD si des personnes concernées sont dans l'UE ;
  - **contrat de traitement des données** avec chaque cabinet client, liste des
    sous-traitants (hébergeur, IA…), durée de conservation, droits des personnes.
- ☐ Viser ensuite une certification de type **ISO 27001** (ou SOC 2).

---

## Ordre de réalisation proposé (≈ 3 à 5 semaines)

1. **Semaine 1** — F1 (jeton personnel partout), double authentification,
   révocation immédiate, blocage et CAPTCHA, désactivation de la connexion par
   code, dépôt privé, 2FA sur les comptes d'administration.
2. **Semaine 2** — une base par cabinet + script de création ; Drive par
   autorisation du cabinet ; région d'hébergement.
3. **Semaine 3** — chiffrement applicatif par cabinet ; sauvegardes chiffrées et
   restauration testée ; IA zéro conservation, minimisation et masquage.
4. **Semaine 4** — journaux étendus, alertes, tableau de bord sécurité, plan
   d'incident ; application de bureau signée avec coffre sécurisé.
5. **Semaine 5** — test d'intrusion, corrections, conformité et contrats.
