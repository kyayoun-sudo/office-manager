# Marque blanche, recherche globale et application de bureau

Ajout du 2026-10-07, branche `feature/white-label-desktop`, créée depuis
`fix/map-register-bridge-write` (3e567eb).

**Règle suivie : ajout seulement.** Aucun fichier existant n'est modifié,
renommé ou supprimé. Aucune table, fonction SQL ou règle RLS existante n'est
touchée. `index.html`, les agents, les outils et les endpoints existants sont
inchangés.

## Ce qui est ajouté

| Fichier | Rôle |
|---|---|
| `db/org-branding.sql` | Nouvelle table `office_org_branding` : nom du cabinet, couleur principale, couleur secondaire, logo. RLS activé, aucun accès public, pas de suppression. |
| `lib/branding.js` | Validation (couleurs `#RRGGBB`, logo PNG/JPG/WebP ≤ 400 000 caractères, SVG refusé), contraste WCAG, lecture et enregistrement. |
| `api/branding.js` | `GET /api/branding` (lire) · `POST /api/branding` (enregistrer). Protégé par le token pilote. |
| `lib/global-search.js` | Recherche en lecture seule : inventaire Drive (Orpailleur), missions, annuaire. Aucun profil RH ni questionnaire. |
| `api/search.js` | `GET /api/search?q=…&scope=all|documents|missions|people`. Aucune écriture, aucun appel IA. |
| `parametres.html` | Écran « Paramètres du cabinet » : nom, nom d'utilisateur, logo, couleur, aperçu en direct. |
| `recherche.html` | Écran « Recherche » : barre de recherche, filtres, Ctrl+K. |
| `assets/brand-theme.js`, `assets/app.css` | Thème partagé : applique nom, logo et couleur du cabinet sur les nouvelles pages. Même clé de session que `index.html` (`officeManagerToken`). |
| `desktop/` | Coquille Tauri v2 : ouvre l'application hébergée dans une fenêtre native, sans aucune permission locale. |
| `tests/branding.test.js`, `tests/global-search.test.js`, `tests/verify-branding-sql.mjs` | 10 tests Node + vérification SQL (PGlite). |

## Vérifications faites

- Nouveaux tests : 10/10.
- SQL : `node tests/verify-branding-sql.mjs` réussi (idempotent, une ligne par
  organisation, contraintes, RLS, pas d'accès anon/authenticated, pas de DELETE).
- Suite complète : 123/124. Le seul échec, `tests/browser-response.test.js`,
  **existait déjà avant cet ajout** (SyntaxError dans le script extrait de
  `index.html`) ; il n'est pas lié à ces fichiers.
- `npm run test:sql` et `tests/verify-plan-sql.mjs` existants : toujours OK.

## Non fait / à faire

- **Rien n'est déployé.** Ni Vercel, ni Supabase, ni Edge Function.
- **Appliquer `db/org-branding.sql`** dans Supabase après relecture, sinon
  `/api/branding` répond `BRANDING_UNAVAILABLE`.
- **Nom d'utilisateur** : enregistré sur l'ordinateur (localStorage), car
  l'application n'a pas encore de comptes utilisateurs. À brancher sur de vrais
  comptes plus tard.
- **Écrire les réglages** demande le token pilote, comme le reste de l'application.
  Avec de vrais comptes, réserver `POST /api/branding` à l'administrateur.
- **Réponse rédigée par l'assistant** en tête de la recherche : non branchée
  (la recherche reste déterministe). Peut appeler `/api/agent` ensuite.
- **Écran « À valider »** de la maquette : non construit ici.
- **Lien depuis `index.html`** vers les nouvelles pages : volontairement absent
  pour ne pas modifier l'existant. Accès direct : `/recherche.html`,
  `/parametres.html`.
- **Application de bureau** : non compilée ici.
  1. Remplacer `frontendDist` dans `desktop/src-tauri/tauri.conf.json` par
     l'adresse Vercel réelle.
  2. Placer le logo du cabinet en `desktop/logo-cabinet.png` (carré, 1024 px).
  3. `cd desktop && npm install && npm run icons && npm run build`
     (Rust et les prérequis Tauri de la plateforme sont nécessaires).
  Pour vendre à un autre cabinet : changer `productName`, `identifier`, le logo,
  puis reconstruire.
