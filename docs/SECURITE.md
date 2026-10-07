# Sécurité — Office Manager (branche `feature/white-label-desktop`)

Rédigé par Claude (Anthropic) le 2026-10-07. À tenir à jour à chaque évolution.

## 1. Qui peut faire quoi

| Rôle | Accès |
|---|---|
| **Propriétaire** (`owner`) | tout : paramètres du cabinet, comptes, horaires, e-mail de l'agent, coordination, indicateurs de l'équipe |
| **Associé-gérant** (`partner`) | identique au propriétaire |
| **Manager** (`manager`) | coordination et indicateurs de l'équipe ; **pas** les paramètres du cabinet |
| **Collaborateur** (`collaborator`) | son travail et **ses propres** indicateurs |

Les rôles sont vérifiés **côté serveur**, jamais seulement dans l'écran.

## 2. Comment l'identité est vérifiée

- **Connexion** : e-mail + mot de passe vérifiés par **Supabase Auth** (mots de
  passe jamais stockés par l'application ; 10 caractères minimum, lettres et chiffres).
- **Session** : gardée sur l'ordinateur jusqu'à « Se déconnecter » ; revérifiée à
  chaque page (jeton de rafraîchissement). Compte désactivé ⇒ déconnexion.
- **Routes sensibles** (`coordination`, `team-kpi`, `my-kpi`) : le navigateur envoie
  son **jeton personnel** (`Authorization: Bearer`, durée courte, renouvelé
  automatiquement). Le serveur demande à Supabase à qui il appartient, puis lit le
  rôle dans `office_app_users` (`lib/user-auth.js`). **Le code d'accès commun ne
  suffit pas** pour ces routes.
- **Paramètres du cabinet** : code propriétaire (`OFFICE_MANAGER_OWNER_TOKEN`),
  transmis automatiquement aux sessions propriétaire / associé-gérant.
- **Planificateur** : secret dédié (`OFFICE_MANAGER_SCHEDULER_SECRET`).

## 3. Traçabilité

- `office_access_log` : chaque consultation de la coordination ou des indicateurs
  de l'équipe (qui, rôle, quand). Ajout seul : ni modification ni suppression.
- `office_action_decisions` : chaque décision « À valider », avec l'empreinte du
  contenu décidé. Ajout seul.
- `office_tidy_items` : chaque déplacement / renommage, avec dossier et nom
  d'origine ⇒ annulation possible. Rien n'est jamais supprimé.
- `office_agent_passes` : chaque passage d'agent planifié ou manuel.

## 4. Protections techniques

- Toutes les nouvelles tables : **RLS activé**, aucun accès `anon` / `authenticated`,
  serveur seulement (`service_role`), **pas de DELETE**.
- En-têtes HTTP (`vercel.json`) : `Content-Security-Policy` (scripts et connexions
  limités au site, pas d'intégration dans un cadre, pas d'objet), `X-Frame-Options:
  DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`
  (caméra, micro, position, paiement désactivés), `Strict-Transport-Security`.
- Pages construites sans injection HTML (`innerHTML` interdit, vérifié par test).
- Logo : PNG/JPG/WebP seulement (SVG refusé : il peut contenir du code).
- Recherche : caractères de filtre neutralisés ; jamais de profil RH ni de questionnaire.
- Agent e-mail : ton familier **uniquement** vers les adresses du cabinet ; toujours
  formel ailleurs ; aucun envoi sans boîte connectée et validation.
- Bouton « Vérifier mon code » : dit quel code a été tapé sans jamais renvoyer de secret.

## 5. Indicateurs des personnes — règles d'usage

- Calculés **uniquement à partir de faits de travail** : affectations aux missions,
  actions assignées (demande, échéance, exécution, vérification). Jamais à partir
  des questionnaires, des profils RH ou d'un jugement de l'IA.
- **Pas de note globale, pas de classement** : ordre alphabétique, plusieurs
  repères séparés, chacun avec ses limites (« couverture des données »).
- **Transparence** : chacun voit ses propres indicateurs.
- Ce sont des **repères pour un échange**, jamais une décision RH automatique
  (règle R011 existante du projet).
- Données personnelles : vérifier la conformité avec la loi applicable au cabinet
  (en Côte d'Ivoire, loi n° 2013-450 relative à la protection des données à
  caractère personnel ; RGPD pour des personnes dans l'UE) et informer l'équipe.
  Ceci n'est pas un avis juridique.

## 6. Risques restants (à traiter)

Plan complet pour le lancement : **`docs/SECURITE_LANCEMENT.md`**.

1. **Code d'accès commun** : les anciennes routes (`/api/agent`, `/api/missions`…)
   acceptent encore le code pilote partagé, remis aux sessions connectées. Étape
   suivante : faire accepter le jeton personnel par `lib/auth.js` (fichier
   d'origine : à valider avec Paul), puis ne plus transmettre le code pilote.
   En attendant : changer `OFFICE_MANAGER_ACCESS_TOKEN` quand quelqu'un quitte le cabinet.
2. **Connexion de secours par code** : à désactiver une fois les comptes créés.
3. **Jetons dans le navigateur** (`localStorage`) : protégés par la CSP et l'absence
   d'injection HTML ; à réévaluer si des scripts tiers sont ajoutés.
4. **Données envoyées à OpenAI / Anthropic** : prévoir les accords de traitement et
   l'information des clients (secret professionnel).
5. **Dépôt GitHub public** : à passer en privé.
6. Double authentification (2FA) et réinitialisation de mot de passe par e-mail : à ajouter.
