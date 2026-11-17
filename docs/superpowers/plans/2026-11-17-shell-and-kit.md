# Coquille commune et kit de composants (lot 1 suite) — plan d'exécution

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Exécution native (Paul a donné carte blanche sur le design, 2026-11-17, « ne touche pas les fonctionnalités »).

**Goal:** Donner aux ~38 pages connectées (menu latéral + `.main`) le rendu admin panel premium du template, en restylant les classes existantes (`.nav`, `.card`, `.btn`, `.tabs`, `.chip`, `table`, `.tag`…) sans toucher au HTML des pages ni à leurs scripts.

**Architecture:** Deux feuilles non stratifiées `assets/ui/shell.css` (menu, barre du haut, en-tête de page, notifications) et `assets/ui/kit.css` (boutons, champs, onglets, cartes, tableaux, étiquettes, états vides, dialogues, focus, mouvement), importées par `assets/ui.src.css`. Une seule retouche JS : icônes manquantes dans `ICONS` de `assets/brand-theme.js`.

**Spec:** `docs/superpowers/specs/2026-11-17-admin-panel-premium-design.md` (4.1, 4.2, 4.4, 5).

## Global Constraints
- Aucun `id` / `name` / `data-*` ni script de page modifié : `tests/ui-pilot-hooks.test.js` reste vert sans toucher à ses empreintes. Aucune fonctionnalité changée.
- Couleur du cabinet = `--primary` (boutons, élément actif, focus, liens) ; aucune couleur de marque en dur.
- Clair et sombre (`.dark .om-design` et `.om-design.dark`) ; contraste texte ≥ 4,5:1 ; cibles ≥ 2,25 rem de haut ; focus visible ; `prefers-reduced-motion` respecté (règle globale existante).
- Les feuilles sont **non stratifiées** (sinon `app.css`, non stratifié, l'emporte) : l'import de `auth.css` perd donc son `layer(components)`.
- Fins de ligne : Git convertit en CRLF, ne pas s'en soucier. Commits à chemins explicites (jamais `git add -A`) ; ne pas pousser, ne pas déployer.
- Vérification visuelle sur `http://127.0.0.1:4173/<page>.html` (serveur de prévisualisation avec données de démonstration) et `http://localhost:59347` (serve du dépôt).

## Review Focus
1. Pages où `.main` n'a pas de barre du haut (aucun JS de navigation) : rien ne doit se superposer à la cloche (`.notification-tools`).
2. Écran étroit (≤ 860 px) : menu en tiroir, barre du haut sur une ligne, pas de défilement horizontal.
3. Thème sombre : cartes, tableaux, étiquettes, champs et menu lisibles.
4. Tableaux larges (`.table-box`) : défilement interne, jamais de la page.
5. Boutons de classes variées (`.btn.ghost`, `.danger`, `.secondary`, `.chip`, `.tabs button`) : hiérarchie visuelle conservée.

---

### Task A: Feuilles non stratifiées et icônes du menu
**Files:** Modify `assets/ui.src.css` (imports), `assets/brand-theme.js` (`ICONS`), Test `tests/ui-shell.test.js`.
- [ ] Test (RED) : `ICONS` contient toutes les pages du menu (`/dossiers.html`, `/fichiers.html`, `/missions-terminees.html`, `/programme.html`, `/secretariat.html`, `/specialists.html`, `/workflow.html`, `/methodologie.html`, `/revue-analytique.html`, `/mon-ia.html`, `/apprentissage.html`, `/carte.html`, `/cabinets.html`) ; `ui.src.css` importe `auth.css` sans `layer(` ; importe `shell.css` et `kit.css`.
- [ ] Implémenter, `npm run build:css`, tests verts, commit.

### Task B: Coquille (`assets/ui/shell.css`)
Menu (marque, rubriques, liens, état actif, icônes, repli), barre du haut (boutons icône, fil d'Ariane, thème en icône, cloche dans la barre), en-tête de page, espacement et largeur de lecture, tiroir mobile. Test : sélecteurs présents + calcul de contraste de l'élément actif. Vérification navigateur clair / sombre / 375 px.

### Task C: Kit (`assets/ui/kit.css`)
Boutons (primaire, secondaire, fantôme, danger), champs, cases, onglets et puces segmentés, cartes, étiquettes, tableaux, états vides, dialogues, squelettes, focus, mouvement. Test : sélecteurs présents, aucune couleur de texte en dur hors sémantique. Vérification navigateur sur mission, opportunités, validations, équipe, paramètres, procédure, dossiers, messagerie.

### Task D: Finition par page
Accueil (lanceurs, héros, agents), mission, procédure : captures avant / après, corrections ponctuelles dans `kit.css` / `shell.css` seulement.

### Task E: Contrôles et clôture
Suite complète, `CLAUDE.md`, revue finale de la branche, rapport honnête (ce qui est vu / non essayé).
