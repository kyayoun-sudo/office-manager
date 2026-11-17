# Refonte « admin panel premium » — spécification de design

Date : 2026-11-17 · Statut : à relire par Paul · Branche : `feature/design-shadcn-lot-1`

## 1. Objectif
Donner à Office Manager un rendu d'admin panel premium, ergonomique et jovial, fidèle à `template/` (Nuxt + shadcn-vue, projet de référence uniquement).
Succès : les fonctionnalités, `id` / `name` / `data-*`, tests et textes français restent intacts ; les pages refaites sont visuellement cohérentes, accessibles (WCAG 2.2 AA) et utilisables au téléphone.

## 2. Décisions déjà prises
- Approche 1 : bibliothèque de classes CSS + comportements JS vanilla, page par page. Pas de migration Nuxt/Vue.
- Direction visuelle : fidèle au template, avec tous les composants shadcn du template portés.
- Français conservé ; `--brand` réglable par cabinet conservée (white-label inchangé).
- Ordre : coquille globale → accueil/cockpit → mission et Ma procédure → listes et tables → pages restantes.
- Hypothèse à confirmer : « tous les composants » = chaque composant de `template/app/components/ui/*` a un équivalent dans le kit ; toutes les pages ne les utilisent pas.

## 3. Hors périmètre
Aucun changement de logique métier, d'API, de SQL, de droits ni de l'architecture `api/app.js`. Aucune dépendance de framework (pas de Vue/React). `template/` n'est jamais exécuté ni livré.

## 4. Design
### 4.1 Fondations (tokens)
Tokens shadcn actuels + `--brand` conservés. Ajouts : échelle d'ombres douces, rayons cohérents, chiffres tabulaires (IBM Plex Sans), palette sémantique (succès / alerte / danger / info, clair et sombre), tokens de mouvement (150-200 ms, un easing, `prefers-reduced-motion` respecté). « Jovial » = coins généreux, micro-animations, pastilles colorées, états vides avec icônes Lucide et ton chaleureux (pas d'émojis).

### 4.2 Bibliothèque de composants
`assets/ui.src.css` est découpé en `assets/ui/*.css` (un fichier par famille), compilé en `assets/ui.css` (`npm run build:css`, test d'actualité conservé). Familles : accordion, alert, avatar, badge, breadcrumb, button, calendar, card, chart, checkbox, collapsible, combobox, command, data-table, dialog, dropdown-menu, filters, form, input, pagination, pin-input, popover, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton, toast, switch, table, tabs, textarea, tooltip + états vides et indicateurs d'attente. Les anciennes classes (`.card`, `.btn`, `.kpi`, `.chip`, `.table-box`) restent en alias.

### 4.3 Comportements
`assets/ui-kit.js` (vanilla, sans dépendance), activé par `data-ui-*` : dialog, sheet, popover, dropdown, tabs, accordion, collapsible, tooltip, toasts, palette Ctrl+K, combobox, pagination, tri/filtre de tables. Accessibilité : focus piégé dans les dialogs, clavier complet, `aria-*`. CSP inchangée.

### 4.4 Coquille globale
Sidebar repliable à groupes, topbar (fil d'Ariane, recherche Ctrl+K, cloche, menu utilisateur, clair/sombre), injectées par `ui-workspace.js`. Connexion et `demarrer.html` : mise en page « auth ».

### 4.5 Lots d'écrans
1. Coquille + kit. 2. `accueil.html` (KPI avec tendances, graphiques SVG, Mon travail, À valider). 3. `mission.html`, `procedure.html`, `programme.html` (logique et panneaux deux colonnes inchangés). 4. Listes en data-table (opportunités, missions, validations, équipe). 5. Pages restantes, par lots.

## 5. Garde-fous et vérification
- `tests/ui-pilot-hooks.test.js` protège les `id` / `name` / `data-*` ; empreintes ajoutées pour chaque page refaite.
- `npm test` vert avant chaque commit ; CI verte après envoi.
- Captures Playwright (clair/sombre, téléphone/ordinateur) ; contrôles `accessibility-scan` / `-inspect`.
- Rapport honnête : ce qui est vu en navigateur vs non essayé (connexion réelle, vrais cabinets).
- Les modifications non liées au design présentes dans l'arbre de travail (`lib/fill-orders.js`, etc.) ne sont jamais incluses dans ces commits.

## 6. Risques
CSS global qui change l'aspect de pages non revues → déploiement par lot avec captures avant/après. Scripts de page qui lisent des classes → alias conservés et recherche des usages avant tout renommage. Poids CSS → découpage et minification.
