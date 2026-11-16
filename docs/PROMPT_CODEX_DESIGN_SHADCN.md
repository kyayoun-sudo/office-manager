# Prompt Codex — nouveau design shadcn (HTML + Tailwind) pour Office Manager

> À copier tel quel dans Codex. Rédigé le 16 novembre 2026 à partir des décisions de Paul.

---

## Mission

Refais **l'apparence** d'Office Manager avec les composants **shadcn/ui en version HTML + Tailwind**, en t'inspirant du
tableau de bord du dossier local `template/` (Nuxt 3 + shadcn-vue). **Aucune fonctionnalité ne doit changer, disparaître ou
régresser.** Tu changes le look, jamais ce que fait l'application.

## Contexte du dépôt (à lire avant de toucher quoi que ce soit)

- Dépôt `kyayoun-sudo/office-manager`. Lis d'abord `CLAUDE.md` à la racine : ce sont les règles du projet.
- Le front, ce sont **40 pages HTML statiques** à la racine (`accueil.html`, `mission.html`, `procedure.html`,
  `parametres.html`…). Chacune a son JavaScript (inline ou dans `assets/*.js`), et il n'y a **ni framework ni étape de build**.
- Les styles actuels sont dans `assets/app.css` (chargé par 38 pages), `assets/screens.css` (31 pages), `assets/workspace.css`,
  `assets/dossiers.css`, `assets/procedure-*.css`, `assets/personal-mail.css`, `assets/workfile-guide.css` et
  `assets/working-file-agent-panel.css`. La police actuelle est IBM Plex Sans (Google Fonts).
- `assets/brand-theme.js` est le cœur commun. Il gère :
  - la session ;
  - `OM.api` ;
  - le menu **filtré par rôle** (table des pages autorisées par rôle, vers la ligne 730) ;
  - le thème clair / sombre ;
  - la **marque blanche** : chaque cabinet règle sa couleur principale (`--brand`) et son logo (`logo_data_url`), vers la ligne 224.
- `assets/workspace-navigation.js` et `assets/settings-hub.js` : la barre de navigation (retour, actualiser, avancer, menu
  repliable) et les Paramètres par catégories, ajoutés par la demande de fusion n° 50. On les garde ; on change seulement leur apparence.
- `assets/screens.js` (`window.OMScreens`, `UI.el`…) construit beaucoup d'éléments en JavaScript. Les classes CSS qu'il pose doivent
  continuer de s'afficher correctement.
- La politique de sécurité (CSP, dans `vercel.json` et `server/index.mjs`) n'autorise que `style-src 'self' 'unsafe-inline'
  https://fonts.googleapis.com`, `font-src https://fonts.gstatic.com` et `script-src 'self'`. **Aucun CDN** : tout le CSS
  doit être servi depuis `/assets/`.
- Production : le serveur du cabinet (https://office.eynowa.com). On déploie en poussant la branche `production` (GitHub
  Actions : tests, puis déploiement). **Tu ne pousses jamais sur `production` ni sur `main`.**

## Décisions de Paul (à respecter)

1. **Composants shadcn/ui en HTML + Tailwind**, sans Vue ni React. Utilise une bibliothèque sous **licence MIT** qui fournit les
   composants shadcn en classes HTML (par exemple **Basecoat UI**, `basecoat-css`). Vérifie sa licence et sa version, puis
   **installe-la en dépendance de développement** : pas de CDN. Composants attendus : Button, Card, Badge, Input, Select, Textarea,
   Table, Tabs, Dialog, Dropdown, Tooltip, Alert, Sidebar, Breadcrumb, Avatar, Skeleton, Switch, Checkbox, Toast.
2. **Base du modèle + couleur du cabinet.**
   - Prends du modèle les tokens neutres de `template/app/assets/css/tailwind.css` : background, foreground, muted, border,
     card, `--radius: 0.625rem`, les tokens de sidebar et le mode sombre `.dark`.
   - La **couleur du cabinet** (`--brand`, réglée dans Paramètres) remplace `--primary`. Elle sert aux boutons principaux, à
     l'élément actif du menu, aux liens et au focus.
   - Le **logo du cabinet** va en haut du menu latéral.
   - Garde le contraste lisible en clair et en sombre : calcule une couleur de texte `--primary-foreground` lisible sur `--brand`.
3. **S'inspirer seulement du template.** Le dossier `template/` est le produit « NalaCare Manager » d'un autre projet.
   - Ne copie **aucun** fichier, composant `.vue`, image, logo, nom (« NalaCare ») ou texte de ce dossier.
   - Reproduis seulement le style et la disposition, avec les composants shadcn libres.
   - **Ne commite jamais le dossier `template/`** : ajoute-le à `.gitignore` dans ton premier commit.
4. **Pilote d'abord, puis le reste par lots.** Voir « Étapes » ci-dessous.

## Ce que doit donner le nouveau design (référence : `template/app/assets/images/preview.png`)

- **Menu latéral** (comme `template/app/layouts/default.vue`, en HTML) :
  - en haut : le logo et le nom du cabinet ;
  - des groupes titrés (Tableau de bord, Missions, Audit, Cabinet, Paramètres…), chaque entrée avec une icône Lucide en SVG
    inline (licence ISC, aucune police d'icônes externe) ;
  - l'entrée active mise en valeur, un menu **repliable en icônes seules** (avec info-bulle) ;
  - en bas : la personne connectée (nom, e-mail, avatar à initiales générées localement) et un menu de compte (thème clair /
    sombre, cabinet, déconnexion).
  - **Le menu reste filtré par rôle exactement comme aujourd'hui** : mêmes pages par rôle, même source (`brand-theme.js`).
- **En-tête de page** : bouton pour replier le menu, fil d'Ariane (Application › Page), titre de la page, actions à droite, bouton du thème.
- **Contenu** :
  - cartes d'indicateurs comme le cockpit du modèle (titre, grande valeur, petite légende, icône) ;
  - tableaux shadcn (en-têtes discrets, lignes séparées, survol) ;
  - onglets shadcn ;
  - formulaires shadcn (libellé au-dessus, champ, aide, erreur) ;
  - dialogues shadcn à la place des fenêtres maison, **sans changer leur JavaScript**.
- **Typographie** : une police sans empattement moderne via Google Fonts, autorisé par la CSP. Propose Inter, ou garde IBM Plex
  Sans si Inter n'apporte rien : dis lequel et pourquoi. Échelle shadcn (titre de page `text-3xl font-bold`, titres de carte
  `font-semibold`, texte `text-sm`).
- **Responsive** :
  - sur téléphone, le menu devient un tiroir (Sheet shadcn) ;
  - aucune barre de défilement horizontale de la page ;
  - les tableaux larges défilent dans leur propre cadre.

## Contraintes techniques

- **Tailwind compilé, pas de CDN.**
  - Ajoute `tailwindcss` et la bibliothèque shadcn-HTML en dépendances de développement.
  - Crée `assets/ui.src.css` (Tailwind, couche des tokens, imports de la bibliothèque) et compile-le en **`assets/ui.css` minifié,
    commité dans le dépôt**.
  - Ajoute `npm run build:css` (et `build:css:watch`).
  - Le serveur et Vercel servent des fichiers statiques **sans étape de build** : le CSS compilé doit être à jour dans chaque commit.
  - Ajoute un test (`tests/ui-css-up-to-date.test.js`) qui recompile en mémoire et échoue si `assets/ui.css` n'est pas à jour.
    Ce test doit tourner dans `npm test` sur la CI (Node 24).
  - Configure le `content` de Tailwind pour scanner `*.html` et `assets/**/*.js`, puisque des classes sont posées par le JavaScript.
    Ajoute une `safelist` pour les classes construites dynamiquement.
- **Aucune fonction perdue.** Pour chaque page, la liste des `id`, des `name`, des attributs `data-*` et des éléments que le JavaScript
  lit ou écrit doit rester identique. Tu changes les classes et la structure visuelle autour, jamais les identifiants utilisés par le
  code. Si un changement de structure est vraiment nécessaire, adapte le JavaScript **dans le même commit** et dis-le.
- **Ne modifie pas la logique** :
  - rien dans `lib/`, `api/`, `server/`, `db/` ;
  - rien dans les routes, les droits, les appels `OM.api`, les règles de rôle et la marque blanche (seulement leur rendu).
  - Interdits en plus, quoi qu'il arrive : `lib/fill-orders.js`, `lib/filling-methods.js`, `lib/procedure-workspace.js`,
    `tests/fill-orders.test.js` et `tests/procedure-workspace.test.js` (travail en cours d'une autre personne).
- **Fins de ligne** : plusieurs fichiers sont en CRLF (voir `CLAUDE.md`). Conserve-les.
- **Accessibilité** : contraste AA en clair et en sombre, focus visible, navigation au clavier dans le menu et les dialogues,
  `aria-current` sur l'entrée active, `prefers-reduced-motion` respecté.
- **Ancien CSS** : `app.css`, `screens.css` et les autres restent tant qu'une page en dépend. À chaque lot, retire seulement les
  règles devenues inutiles. Ne supprime jamais un fichier qu'une page charge encore.
- Jamais de secret, de donnée client ou de capture d'écran avec des données réelles dans le dépôt. Jamais le dossier `entrainement/`.

## Étapes (une branche, des commits séparés, une demande de fusion par étape)

Crée la branche `feature/design-shadcn` à partir de `feature/white-label-desktop` (`git fetch` d'abord : d'autres agents
poussent sur ce dépôt). Ouvre **chaque demande de fusion vers `feature/white-label-desktop`**, jamais vers `production` ni `main`.

**Étape 1 — Socle + pilote** (une demande de fusion, puis attendre la validation de Paul) :
1. Tailwind + bibliothèque shadcn-HTML, tokens, `assets/ui.css` compilé, `npm run build:css`, test « CSS à jour », `template/` dans `.gitignore`.
2. Le **cadre commun** (menu latéral, en-tête, fil d'Ariane, menu de compte, thème, tiroir mobile), branché sur `brand-theme.js`
   et `workspace-navigation.js` sans changer leur logique.
3. Trois pages pilotes refaites entièrement :
   - `accueil.html` : cockpit, « Ma messagerie », cartes par rôle ;
   - `mission.html` : cartes, équipe, pièces reçues, archivage ;
   - `procedure.html` : deux colonnes SOP / working file. C'est la page la plus dense, et elle a ses propres CSS.
4. Captures avant / après des trois pages, en clair et en sombre, sur ordinateur et téléphone, **avec des données fictives**.
   Mets-les dans la description de la demande de fusion, jamais dans le dépôt.

**Étape 2 — le reste, par lots de 6 à 8 pages** (une demande de fusion par lot) :
- missions, dossiers, programme, revue analytique, méthodologie, workflow ;
- paramètres, mise en service, cabinets, démarrer, login, bienvenue ;
- opportunités, veille, secrétariat, équipe, validations, messagerie, recherche ;
- entraînement, missions terminées, pilotage, mon IA, fichiers, spécialistes, et le reste.

**Étape 3 — nettoyage** : retirer les règles CSS mortes, vérifier qu'aucune page ne charge un fichier supprimé, et mettre à jour
`CLAUDE.md` avec une courte section « Design ».

## Vérifications obligatoires à chaque demande de fusion

1. `npm test` vert en local et sur la CI. Après chaque push, vérifie avec `gh run list` : la CI doit être verte. Plus `npm run test:sql` et `npm run check`.
2. `npm run build:css`, puis le test « CSS à jour ».
3. Pour chaque page touchée, un test (ou un script dans `tests/`) qui compare **avant / après la liste des `id`, `name` et
   `data-*`** des éléments utilisés par le JavaScript : aucune disparition non justifiée.
4. Ouvre chaque page touchée dans un vrai navigateur (Playwright si disponible) avec une session de test, puis vérifie :
   - pas d'erreur dans la console ;
   - le menu filtré pour au moins trois rôles (owner, manager, auditor) ;
   - le thème sombre ;
   - la couleur et le logo d'un cabinet fictif appliqués ;
   - l'affichage à 375 px de large sans défilement horizontal.
5. Aucune violation de la CSP : aucune ressource externe en dehors de Google Fonts.
6. Dans la description de la demande de fusion, en français simple :
   - ce qui a changé ;
   - ce qui n'a **pas** été vérifié ;
   - les captures (données fictives).

## Ce que tu ne fais pas

- Pas de Vue, React, Nuxt ni Vite. Pas de réécriture du JavaScript des pages au-delà de l'indispensable.
- Pas de nouvelle fonction, pas de changement de texte métier ni de libellé de bouton, sauf demande de Paul.
- Pas de fusion ni de déploiement par toi-même. Paul (ou Claude, sur sa demande) valide et met en ligne.
- Ne dis jamais « fait » ou « vérifié » sans la preuve (test, capture, CI).
