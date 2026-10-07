# Passation pour ChatGPT — travail de Claude sur la branche `feature/white-label-desktop`

Rédigé par Claude (Anthropic) le 2026-10-07, à la demande de Paul KOMENAN (TATY).
À lire avant toute modification de cette branche, avec `PROJECT_STATUS.md` et
`docs/WHITE_LABEL_DESKTOP.md`.

## Règles de travail convenues avec Paul

1. **Travailler uniquement sur `feature/white-label-desktop`.** Ne jamais toucher
   `main` ni `fix/map-register-bridge-write` sans accord explicite.
2. **Ajouter sans casser.** Aucun fichier d'origine du projet n'est modifié, sauf
   `vercel.json` (redirection `/` → `/accueil.html`, voir plus bas). La console
   pilote `index.html` est intacte et reste accessible à `/index.html`.
3. **Limite Vercel Hobby : 12 fonctions dans `api/`.** Toutes les nouvelles routes
   passent par **un seul fichier, `api/app.js`** (paramètre `route`). Le test
   `tests/app-router.test.js` échoue si `api/` dépasse 12 fichiers.
4. Montrer son plan à Paul avant d'écrire du code.

## Ce que Claude a construit (dans l'ordre)

### 1. Application « marque blanche » (même menu, même style partout)
Écrans : `accueil.html` (tableau de bord), `recherche.html`, `mission.html`
(liste + dossier `?id=`), `validations.html` (« À valider »), `assistant.html`,
`parametres.html`. Styles et outils communs : `assets/app.css`,
`assets/screens.css`, `assets/screens.js`, `assets/brand-theme.js` (nom, logo et
couleur du cabinet appliqués à toutes les pages). Les pages construisent le DOM
sans `innerHTML` (vérifié par test).

### 2. `assistant.html` — la console pilote intégrée
Reprend toutes les fonctions de `index.html` dans la même application : demande
aux agents (Grand Contrôleur, Mission Controller, Orpailleur, Sika ; IA Auto /
OpenAI / Claude / OpenAI + relecture Claude) via l'endpoint existant `/api/agent`,
préparation et enregistrement d'un plan de mission (`/api/missions`,
`/api/mission-plans`), People Intelligence (`/api/people`), suivi des demandes
(`/api/runs`). Paramètres d'URL : `?mission=<uuid>`, `?agent=<clé>`.

### 3. Paramètres réservés au propriétaire / associés-gérants
`parametres.html` ne s'ouvre qu'avec le **code propriétaire** (en-tête
`x-office-manager-owner-token` = variable `OFFICE_MANAGER_OWNER_TOKEN`, le même
que `api/owner.js`). Le code pilote seul est refusé (`OWNER_ONLY`, 403).
- Marque : nom, logo (PNG/JPG/WebP, SVG refusé), couleur, contraste vérifié.
- **E-mail de l'agent** : nom affiché, adresse d'envoi, adresse de réponse,
  **alias** (10 max, obligatoirement dans les domaines du cabinet), domaines du cabinet.
- **Ton avec les collègues** : « Nouchi et blagueur » (par défaut), « Détendu »,
  « Professionnel » ; dose d'humour 0–3 ; fréquence des messages spontanés ; signature.
- Bouton « Essayer » : rédige un message test, **jamais envoyé**.

Règles codées dans `lib/agent-persona.js` (et testées) :
- Un destinataire n'est un collègue que si son domaine est dans les domaines du
  cabinet. **Clients et inconnus : toujours ton formel** (`toneFor`), quel que soit
  le réglage. Un brouillon en nouchi vers une adresse externe est refusé
  (`RECIPIENT_OUTSIDE_FIRM`).
- Humour bienveillant seulement ; jamais de moquerie visant une personne ;
  pas de blague sur les sujets sérieux (santé, RH, deuil, retard grave) ;
  informations de travail exactes ; pas de données client inutiles.

### 4. Recherche, missions, décisions
- `lib/global-search.js` — recherche en lecture seule (inventaire Drive,
  missions, annuaire ; jamais les profils RH).
- `lib/mission-view.js` — dossier de mission + nom/fonction de l'équipe uniquement.
- `lib/action-decisions.js` — « À valider » : la décision (valider / reporter /
  refuser, commentaire obligatoire pour refuser) est **journalisée** avec
  l'empreinte du contenu exact. **Elle ne modifie pas `office_action_queue` et
  ne déclenche rien.**

### 5. Application de bureau
`desktop/` : coquille Tauri v2 qui ouvre `/accueil.html` dans une fenêtre native,
sans permission locale. Non compilée (voir `docs/WHITE_LABEL_DESKTOP.md`).

## Routes de `api/app.js`

| Route | Méthodes | Accès |
|---|---|---|
| `branding` | GET (tous) / POST | POST : **propriétaire** |
| `search` | GET | code pilote |
| `actions` | GET / POST | code pilote |
| `mission-view` | GET | code pilote |
| `agent-persona` | GET / POST | **propriétaire** |
| `agent-message` | POST (brouillon interne, jamais envoyé) | code pilote |

## Tables Supabase ajoutées (à appliquer, rien n'est appliqué)
`db/org-branding.sql`, `db/action-decisions.sql`, `db/agent-persona.sql`.
Toutes : RLS activé, aucun accès anon/authenticated, pas de DELETE.
Vérifications PGlite : `tests/verify-branding-sql.mjs`,
`tests/verify-action-decisions-sql.mjs`, `tests/verify-agent-persona-sql.mjs`.

## État des tests
139 tests : 138 OK. Le seul échec, `tests/browser-response.test.js`, **existait
avant ces ajouts** (SyntaxError dans le script extrait de `index.html`).

## Ce qui n'est PAS fait — prochaines étapes
1. **Envoi réel des e-mails de l'agent.** Il faut une boîte d'envoi (par ex. Gmail
   API avec délégation sur l'adresse de l'agent, ou un fournisseur SMTP/transactionnel)
   et ses secrets dans Vercel. À brancher sur `agent-persona` + `toneFor`, avec
   validation humaine pour tout message externe.
2. **Messages spontanés à l'équipe** (« souvent ») : planificateur (Vercel Cron ou
   Supabase) qui lit `internal_frequency`, rédige avec `draftInternalMessage` et
   envoie aux adresses internes uniquement. Prévoir une désinscription par personne.
3. Exécuter les décisions validées (« À valider ») action par action.
4. Vrais comptes utilisateurs et rôles (aujourd'hui : code pilote + code propriétaire).
5. Appliquer les 3 fichiers SQL, activer l'API Google Sheets, corriger
   `browser-response.test.js`, compiler l'app de bureau, brancher `taty.info`.
