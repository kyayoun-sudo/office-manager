# Login premium (lot 1, première page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refaire la page de connexion `login.html` en écran « admin panel premium » (split-screen façon `template/app/layouts/auth.vue`), sans changer une seule ligne de sa logique ni aucun `id` / `name` / `data-*`.

**Architecture:** Une nouvelle feuille `assets/ui/auth.css` (CSS simple, préfixe `om-auth-`) est importée dans `assets/ui.src.css` puis compilée dans `assets/ui.css`. Le balisage de `login.html` est réorganisé (formulaire d'abord dans le DOM, panneau de marque à côté) et ses styles en ligne disparaissent. Le script inline reste identique octet pour octet, ce qu'un nouveau test épingle.

**Tech Stack:** HTML statique, CSS (Tailwind 4 CLI + `basecoat-css` déjà en place), JS vanilla existant, `node --test`, Playwright (vérification visuelle).

**Spec:** `docs/superpowers/specs/2026-11-17-admin-panel-premium-design.md` (sections 4.1 fondations, 4.4 mise en page « auth », 5 garde-fous). Ce plan ne couvre que la page de connexion ; le reste du kit (sidebar, tables, etc.) aura ses propres plans.

## Global Constraints

- Ne jamais ajouter, retirer ni modifier un `id`, un `name` ou un attribut `data-*` dans `login.html` : `tests/ui-pilot-hooks.test.js` (empreinte `cbe22dfb…acbec61`) doit rester vert **sans toucher à ce test**. Les nouveaux éléments décoratifs n'ont donc ni `id`, ni `name`, ni `data-*`.
- Le script inline (`<script>…</script>` sans `src`) reste identique : empreinte SHA-256 `decdefabca83247f026fd1f08104abdf49e8df4a966a6747e06e4c7db1f9f7aa` (fins de ligne `\r` retirées avant calcul).
- Français conservé, libellés existants conservés (titre « Connexion », « Continuer avec Google », etc.). Aucun émoji.
- La couleur du cabinet (`--brand` → `--primary`, `--primary-foreground`, `--om-brand-link`) pilote le panneau de marque et les boutons ; aucune couleur de marque en dur. Le bouton Google garde les couleurs de la charte Google (clair `#fff`, sombre `#131314`).
- Contraste WCAG 2.2 AA, focus visible, formulaire utilisable à 320 px de large sans défilement horizontal, `prefers-reduced-motion` respecté (la règle globale `.om-design *` existe déjà).
- `npm run build:css` puis `node --test tests/ui-css-up-to-date.test.js` doivent passer ; `assets/ui.css` est commité.
- Fichiers à fins de ligne CRLF : le dépôt est en `core.autocrlf=true` ; ne pas se battre contre les avertissements LF/CRLF de Git.
- Les modifications non liées au design présentes dans l'arbre de travail (`lib/fill-orders.js`, `lib/filling-methods.js`, `lib/procedure-workspace.js`, `package-lock.json`, `tests/fill-orders.test.js`, `tests/procedure-workspace.test.js`, `docs/BILAN_2026-10-25.txt`) ne sont jamais ajoutées à un commit de ce plan : toujours `git add` avec des chemins explicites.
- Ne rien déployer, ne rien écrire en base de production.

## Review Focus

1. Mot de passe incorrect, serveur en panne ou compte fermé (`FIRM_CLOSED`) : les messages d'état restent visibles et lisibles, `#restart-box` s'affiche correctement (le `hidden` ne doit plus être contredit par un `display` en ligne). Test : la règle `[hidden]` n'est pas surchargée par `.om-auth-alert` / `.om-auth-form` (Task 2).
2. Cabinet sans Google (`google_login` faux) : le bouton Google est masqué par le script (`style.display = 'none'`) et le bloc e-mail/mot de passe s'ouvre ; la page ne doit pas paraître vide ni cassée. Test : le bloc `#pw-box` reste un `<details>` contenant `#login-form` (Task 2).
3. Écran étroit (320 px), zoom 200 % et police agrandie : rien ne déborde, les boutons restent atteignables. Vérification Playwright (Task 3).
4. Thème sombre (préférence système) : texte, bordures, champs, bouton Google et panneau de marque lisibles. Vérification Playwright + contrôle de contraste (Task 3).
5. Couleur de cabinet très claire (ex. jaune) ou très foncée : le texte du panneau de marque reste lisible grâce à `--primary-foreground`. Test : le CSS n'écrit aucune couleur de texte en dur sur le panneau (Task 1) ; vérification Playwright avec deux couleurs (Task 3).

---

## File Structure

- Create: `assets/ui/auth.css` : tout le style de la page de connexion (mise en page, panneau de marque, champs, boutons, alerte, `details`, animation d'entrée).
- Modify: `assets/ui.src.css` : une ligne `@import` pour `auth.css`.
- Modify: `assets/ui.css` : sortie compilée (générée, jamais éditée à la main).
- Modify: `login.html` : `<head>` (suppression du `<style>`), balisage du corps ; le script inline n'est pas touché.
- Create: `tests/login-page.test.js` : épingle le script, la structure, l'accessibilité de base et la présence des règles CSS.
- Modify: `CLAUDE.md` (section « Design ») : deux lignes sur la page de connexion et le dossier `assets/ui/`.

---

### Task 1: Feuille de style `auth.css` et compilation

**Files:**
- Create: `assets/ui/auth.css`
- Modify: `assets/ui.src.css:1-8` (ajout d'un `@import`)
- Modify (généré): `assets/ui.css`
- Test: `tests/login-page.test.js` (créé ici, complété en Task 2)

**Interfaces:**
- Consumes: tokens existants de `assets/ui.src.css` (`--background`, `--foreground`, `--card`, `--border`, `--muted-foreground`, `--primary`, `--primary-foreground`, `--ring`, `--radius`, `--om-brand-link`, `--danger` défini dans `assets/app.css`).
- Produces: classes `om-auth` (conteneur), `om-auth-main`, `om-auth-card`, `om-auth-brand`, `om-auth-title`, `om-auth-lead`, `om-auth-google`, `om-auth-alert`, `om-auth-form`, `om-auth-more`, `om-auth-links`, `om-auth-aside`, `om-auth-pitch`, `om-auth-points`, `om-auth-foot`. Task 2 les utilise telles quelles.

- [ ] **Step 1: Écrire le test qui échoue (CSS présent, aucune couleur de texte en dur sur le panneau)**

Créer `tests/login-page.test.js` :

```js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8').replace(/\r/g, '');

test('auth.css defines the login layout classes and is compiled into ui.css', () => {
  const source = read('assets/ui/auth.css');
  const compiled = read('assets/ui.css');
  for (const cls of ['om-auth', 'om-auth-main', 'om-auth-card', 'om-auth-brand', 'om-auth-google',
    'om-auth-alert', 'om-auth-form', 'om-auth-more', 'om-auth-aside', 'om-auth-pitch', 'om-auth-points']) {
    assert.ok(source.includes('.' + cls), cls + ' missing from assets/ui/auth.css');
    assert.ok(compiled.includes('.' + cls), cls + ' missing from assets/ui.css: run npm run build:css');
  }
});

test('the brand panel takes its colours from the firm tokens only', () => {
  const source = read('assets/ui/auth.css');
  const aside = source.slice(source.indexOf('.om-auth-aside'), source.indexOf('/* end aside */'));
  assert.ok(aside.includes('var(--primary)'), 'panel background must use --primary');
  assert.ok(aside.includes('var(--primary-foreground)'), 'panel text must use --primary-foreground');
  assert.ok(!/(^|[^-\w])color:\s*#[0-9a-f]{3,8}/i.test(aside), 'no hard-coded hex text colour on the panel');
});

test('the form never overrides the hidden attribute', () => {
  const source = read('assets/ui/auth.css');
  assert.ok(!/\[hidden\]\s*{[^}]*display\s*:\s*(?!none)/.test(source));
  assert.ok(source.includes('.om-auth [hidden]'), 'auth.css must keep [hidden] effective inside .om-auth');
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test tests/login-page.test.js`
Expected: FAIL (`ENOENT … assets/ui/auth.css`).

- [ ] **Step 3: Créer `assets/ui/auth.css`**

```css
/* Page de connexion — mise en page « auth » du template (layouts/auth.vue), en CSS simple.
   Aucune couleur de marque en dur : tout vient de --primary / --primary-foreground (réglés par le cabinet). */

.om-auth {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  background: var(--background);
  color: var(--foreground);
}
.om-auth [hidden] { display: none !important; }

/* ---- Colonne du formulaire ---- */
.om-auth-main {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 1rem;
}
.om-auth-card {
  width: 100%;
  max-width: 26rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 2rem 1.75rem;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 0.25rem);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.04), 0 12px 32px -12px rgb(0 0 0 / 0.12);
  animation: om-auth-in 0.32s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
@keyframes om-auth-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

.om-auth-brand { display: flex; align-items: center; gap: 0.75rem; }
.om-auth-brand .logo { width: 2.5rem; height: 2.5rem; border-radius: var(--radius); font-size: 1.125rem; }
.om-auth-brand strong { display: block; font-size: 1.125rem; line-height: 1.2; }
.om-auth-brand small { font-size: 0.8125rem; color: var(--muted-foreground); }

.om-auth-title { margin: 0; font-size: 1.5rem; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
.om-auth-lead { margin: 0; font-size: 0.875rem; line-height: 1.5; color: var(--muted-foreground); text-wrap: balance; }

/* ---- Champs ---- */
.om-auth .field { display: flex; flex-direction: column; gap: 0.375rem; }
.om-auth .field label { font-size: 0.875rem; font-weight: 500; line-height: 1.3; }
.om-auth input[type="text"],
.om-auth input[type="password"] {
  width: 100%;
  height: 2.5rem;
  box-sizing: border-box;
  padding: 0 0.75rem;
  font: inherit;
  font-size: 0.875rem;
  color: var(--foreground);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 2px);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.om-auth input[type="text"]:focus-visible,
.om-auth input[type="password"]:focus-visible {
  outline: none;
  border-color: var(--ring);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 28%, transparent);
}
.om-auth input[type="checkbox"] { width: 1rem; height: 1rem; accent-color: var(--primary); }
.om-auth .check { display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; font-weight: 400; }

/* ---- Boutons ---- */
.om-auth .btn {
  min-height: 2.5rem;
  padding: 0 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--primary-foreground);
  background: var(--primary);
  border: 1px solid transparent;
  border-radius: calc(var(--radius) - 2px);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
  transition: filter 0.15s, transform 0.15s, box-shadow 0.15s;
}
.om-auth .btn:hover { filter: brightness(1.08); }
.om-auth .btn:active { transform: translateY(1px); box-shadow: none; }
.om-auth .btn:focus-visible { outline: 2px solid var(--om-brand-link, currentColor); outline-offset: 2px; }
.om-auth .btn.ghost { color: var(--foreground); background: transparent; border-color: var(--border); box-shadow: none; }
.om-auth .btn.ghost:hover { background: var(--om-muted-surface); filter: none; }
.om-auth .btn:disabled { opacity: 0.5; cursor: not-allowed; }

.om-auth-google {
  min-height: 2.75rem;
  gap: 0.625rem;
  color: #1f1f1f !important;
  background: #fff !important;
  border: 1px solid #747775 !important;
}
.dark .om-auth-google {
  color: #e3e3e3 !important;
  background: #131314 !important;
  border-color: #8e918f !important;
}

.om-auth .status { min-height: 0; margin: 0; font-size: 0.875rem; line-height: 1.4; color: var(--muted-foreground); }
.om-auth .status:empty { display: none; }
.om-auth .status.error { color: var(--danger, #b42318); }

.om-auth .or { display: flex; align-items: center; gap: 0.625rem; font-size: 0.8125rem; color: var(--muted-foreground); }
.om-auth .or::before,
.om-auth .or::after { content: ""; flex: 1; height: 1px; background: var(--border); }

/* ---- Alerte « espace fermé » ---- */
.om-auth-alert {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--border);
  border-left: 4px solid var(--danger, #b42318);
  border-radius: var(--radius);
  background: var(--om-muted-surface);
}
.om-auth-alert h2 { margin: 0; font-size: 1rem; }
.om-auth-alert p { margin: 0; font-size: 0.875rem; line-height: 1.5; }

/* ---- Formulaires et blocs repliables ---- */
.om-auth-form { display: flex; flex-direction: column; gap: 0.875rem; }
.om-auth-form h2 { margin: 0; font-size: 1rem; }
.om-auth-form p { margin: 0; font-size: 0.8125rem; line-height: 1.5; color: var(--muted-foreground); }
.om-auth-form .out { display: flex; flex-direction: column; gap: 0.375rem; font-size: 0.875rem; line-height: 1.55; }
.om-auth-form .out p { margin: 0; font-size: inherit; color: inherit; }

.om-auth-more > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 2.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--muted-foreground);
  cursor: pointer;
  list-style: none;
}
.om-auth-more > summary::-webkit-details-marker { display: none; }
.om-auth-more > summary::after {
  content: "";
  width: 0.5rem;
  height: 0.5rem;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(45deg);
  transition: transform 0.15s;
}
.om-auth-more[open] > summary::after { transform: rotate(-135deg); }
.om-auth-more > summary:hover { color: var(--foreground); }
.om-auth-more > summary:focus-visible { outline: 2px solid var(--om-brand-link, currentColor); outline-offset: 2px; border-radius: 4px; }
.om-auth-more > .om-auth-form,
.om-auth-more > .om-auth-links,
.om-auth-more > p { margin-top: 0.75rem; }

.om-auth-links { display: flex; flex-direction: column; gap: 0.25rem; }
.om-auth .link-btn {
  min-height: 2.25rem;
  padding: 0.5rem 0;
  align-self: flex-start;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--om-brand-link, var(--foreground));
  text-decoration: underline;
  text-underline-offset: 3px;
  background: none;
  border: 0;
  cursor: pointer;
}
.om-auth a { color: var(--om-brand-link, var(--foreground)); text-underline-offset: 3px; }

/* ---- Panneau de marque (écrans larges) ---- */
.om-auth-aside {
  grid-column: 2;
  grid-row: 1;
  display: none;
  position: relative;
  isolation: isolate;
  overflow: hidden;
  flex-direction: column;
  justify-content: space-between;
  padding: 3rem;
  color: var(--primary-foreground);
  background: var(--primary);
}
.om-auth-aside::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background:
    radial-gradient(48rem 32rem at 0% -10%, color-mix(in oklab, white 24%, transparent), transparent 62%),
    radial-gradient(36rem 28rem at 110% 110%, color-mix(in oklab, black 28%, transparent), transparent 62%);
}
.om-auth-aside::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  opacity: 0.18;
  background-image: radial-gradient(currentColor 1px, transparent 1.2px);
  background-size: 22px 22px;
  mask-image: linear-gradient(to bottom right, transparent 20%, #000 90%);
}
.om-auth-pitch { margin: 0; max-width: 28rem; font-size: 2rem; font-weight: 700; line-height: 1.15; letter-spacing: -0.02em; text-wrap: balance; }
.om-auth-points { display: flex; flex-direction: column; gap: 0.875rem; margin: 1.75rem 0 0; padding: 0; list-style: none; max-width: 28rem; }
.om-auth-points li { display: flex; gap: 0.75rem; align-items: flex-start; font-size: 0.9375rem; line-height: 1.45; }
.om-auth-points svg { flex: none; width: 1.25rem; height: 1.25rem; margin-top: 0.1rem; }
.om-auth-foot { margin: 0; font-size: 0.8125rem; opacity: 0.85; }
/* end aside */

@media (min-width: 1024px) {
  .om-auth { grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); }
  .om-auth-aside { display: flex; }
  .om-auth-main { padding: 2rem; }
}
@media (max-width: 400px) {
  .om-auth-card { padding: 1.5rem 1.125rem; border-radius: var(--radius); }
}
```

- [ ] **Step 4: Importer la feuille dans `assets/ui.src.css`**

Ajouter cette ligne juste après la ligne `@source inline(...)` (ligne 7) :

```css
@import "./ui/auth.css" layer(components);
```

- [ ] **Step 5: Compiler et lancer les tests**

Run: `npm run build:css && node --test tests/login-page.test.js tests/ui-css-up-to-date.test.js`
Expected: PASS (3 tests de `login-page.test.js` + le test d'actualité).
Si `@import` relatif échoue avec une erreur Tailwind : lire le message exact, ne pas déplacer le fichier ; vérifier que le chemin est relatif à `assets/ui.src.css` (`./ui/auth.css`).

- [ ] **Step 6: Commit**

```bash
git add assets/ui/auth.css assets/ui.src.css assets/ui.css tests/login-page.test.js
git commit -m "Design: feuille de style de la page de connexion (auth.css)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Nouveau balisage de `login.html`

**Files:**
- Modify: `login.html` (le `<style>` du `<head>` est supprimé ; le balisage entre `<body class="om-design">` et `<script src="/assets/brand-theme.js">` est remplacé ; le script inline est conservé tel quel)
- Test: `tests/login-page.test.js` (ajout de tests)

**Interfaces:**
- Consumes: classes de Task 1 ; `assets/app.css` (`.btn`, `.field`, `.status`, `.logo`, `[hidden]`), `assets/brand-theme.js` (remplit `[data-firm-name]` et `[data-firm-logo]`).
- Produces: page de connexion dont les hooks (`id`, `name`, `data-*`) sont identiques à l'existant.

- [ ] **Step 1: Ajouter les tests qui échouent (script épinglé, structure, accessibilité)**

Ajouter à la fin de `tests/login-page.test.js` :

```js
const login = () => read('login.html');

test('the inline script of login.html is unchanged', () => {
  const blocks = [...login().matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1);
  const hash = createHash('sha256').update(blocks[0][1]).digest('hex');
  assert.equal(hash, 'decdefabca83247f026fd1f08104abdf49e8df4a966a6747e06e4c7db1f9f7aa');
});

test('login.html uses the auth layout and no inline styles', () => {
  const html = login();
  assert.ok(html.includes('class="om-auth"'));
  assert.ok(html.includes('<main class="om-auth-main">'));
  assert.ok(html.includes('<aside class="om-auth-aside">'));
  assert.ok(html.includes('href="/assets/ui.css"'));
  assert.ok(!/<style[\s>]/.test(html), 'the page <style> block must move to assets/ui/auth.css');
  assert.ok(!/\sstyle="/.test(html), 'no style="" attributes: use the om-auth-* classes');
});

test('the form comes before the brand panel in the DOM (focus order) and there is one h1', () => {
  const html = login();
  assert.ok(html.indexOf('<main') < html.indexOf('<aside'));
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
});

test('every text and password input has a visible label bound by for/id', () => {
  const html = login();
  const inputs = [...html.matchAll(/<input[^>]*\sid="([^"]+)"[^>]*>/g)].filter(m => !/type="checkbox"/.test(m[0]));
  assert.ok(inputs.length >= 8);
  for (const [, id] of inputs) {
    assert.ok(new RegExp('<label[^>]*for="' + id + '"').test(html), 'no <label for="' + id + '">');
  }
});

test('the password sign-in stays inside the collapsible #pw-box, and the hidden widgets keep the hidden attribute', () => {
  const html = login();
  const box = html.slice(html.indexOf('id="pw-box"'), html.indexOf('</details>', html.indexOf('id="pw-box"')));
  assert.ok(box.includes('id="login-form"'));
  for (const id of ['start-new', 'restart-box', 'claim-form', 'signup-form', 'code-form', 'diag-form']) {
    assert.ok(new RegExp('id="' + id + '"[^>]*\\shidden').test(html) || new RegExp('\\shidden[^>]*id="' + id + '"').test(html), id + ' must stay hidden by default');
  }
});

test('decorative icons are hidden from assistive technology and the panel promises nothing the product does not do', () => {
  const html = login();
  const aside = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
  assert.ok((aside.match(/<svg[^>]*aria-hidden="true"/g) || []).length >= 3);
  assert.ok(!/<svg(?![^>]*aria-hidden)/.test(aside), 'every svg in the panel is decorative');
  assert.ok(!/(?:TATY|EYNOWA)/i.test(html.replace(/<script>[\s\S]*?<\/script>/, '')), 'no firm name in the markup: the firm name comes from data-firm-name');
});
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `node --test tests/login-page.test.js`
Expected: FAIL (au moins « login.html uses the auth layout and no inline styles », « the form comes before the brand panel… », « decorative icons… »). Les tests de Task 1 et le test d'épinglage du script passent déjà.

- [ ] **Step 3: Remplacer le `<head>` (retirer le bloc `<style>`)**

Dans `login.html`, supprimer entièrement le bloc `<style> … </style>` (de `<style>` jusqu'à `</style>`, juste avant `</head>`). Ne rien changer d'autre dans le `<head>`.

- [ ] **Step 4: Remplacer le balisage du corps**

Dans `login.html`, remplacer tout ce qui se trouve **entre** `<body class="om-design">` **et** la ligne `<script src="/assets/brand-theme.js"></script>` (exclues) par le bloc suivant. Les `id`, `name`, `data-*`, `type`, `autocomplete`, `maxlength`, `hidden`, `required`, `novalidate`, `inputmode` et tous les textes sont ceux de l'existant ; seuls les `style=` et les classes changent, plus le panneau de marque.

```html
<div class="om-auth">
  <main class="om-auth-main">
    <div class="om-auth-card">
      <div class="om-auth-brand">
        <div class="logo" data-firm-logo>C</div>
        <div><strong data-firm-name>Office Manager</strong><small>Espace du cabinet</small></div>
      </div>

      <h1 class="om-auth-title">Connexion</h1>
      <p class="om-auth-lead">Avec le compte Google du cabinet. Première fois ? Le même bouton crée votre compte : aucun mot de passe à retenir.</p>
      <a class="btn" id="start-new" href="/demarrer.html" hidden>Nouveau cabinet ? Démarrer ici</a>
      <button class="btn om-auth-google" type="button" id="google-btn">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
        Continuer avec Google</button>
      <p class="status" id="google-status" role="status" aria-live="polite"></p>
      <section class="om-auth-alert" id="restart-box" hidden>
        <h2>Cet espace a été fermé</h2>
        <p>Pour recommencer à zéro, toutes les anciennes données d’Office Manager de ce cabinet sont effacées (missions, personnes, réglages, connexion Google, mémoire des agents, autres comptes). Les documents du cabinet dans son Drive restent. Vous devenez le propriétaire d’un espace vierge et vous remplissez la configuration.</p>
        <div class="field"><label for="restart-word">Tapez EFFACER pour recommencer à zéro</label><input id="restart-word" type="text" autocomplete="off"></div>
        <button class="btn" type="button" id="restart-btn">Effacer et recommencer</button>
        <p class="status" id="restart-status" role="status" aria-live="polite"></p>
      </section>
      <details class="om-auth-more" id="pw-box">
        <summary>Se connecter avec un e-mail et un mot de passe</summary>
        <div class="or" id="or-line" hidden><span>ou</span></div>
        <form class="om-auth-form" id="login-form" novalidate>
          <div class="field"><label for="email">Adresse e-mail</label><input id="email" type="text" inputmode="email" autocomplete="username" maxlength="254" required></div>
          <div class="field"><label for="password">Mot de passe</label><input id="password" type="password" autocomplete="current-password" maxlength="128" required></div>
          <label class="check"><input type="checkbox" id="show-pw"> Afficher le mot de passe</label>
          <button class="btn" type="submit" id="login-btn">Se connecter</button>
          <p class="status" id="login-status" role="status" aria-live="polite"></p>
        </form>
        <p class="om-auth-lead">Pas encore de compte ? <a href="/demarrer.html">Créer un compte</a></p>
      </details>

      <details class="om-auth-more">
        <summary>Autres options</summary>
        <div class="om-auth-links">
          <button type="button" class="link-btn" id="claim-link">Je suis le propriétaire du cabinet</button>
          <form class="om-auth-form" id="claim-form" hidden novalidate>
            <h2>Je suis le propriétaire du cabinet</h2>
            <p>Votre e-mail et votre mot de passe (créez d'abord votre compte si besoin), puis le code propriétaire du cabinet, une seule fois.</p>
            <div class="field"><label for="o-email">Votre adresse e-mail</label><input id="o-email" type="text" inputmode="email" maxlength="254" autocomplete="username"></div>
            <div class="field"><label for="o-pw">Votre mot de passe</label><input id="o-pw" type="password" maxlength="128" autocomplete="current-password"></div>
            <div class="field"><label for="o-code">Code propriétaire du cabinet</label><input id="o-code" type="password" autocomplete="off"></div>
            <button class="btn" type="submit">Devenir propriétaire et entrer</button>
            <p class="status" id="claim-status" role="status" aria-live="polite"></p>
          </form>
          <button type="button" class="link-btn" id="signup-link">Créer mon compte</button>
          <form class="om-auth-form" id="signup-form" hidden novalidate>
            <h2>Créer mon compte</h2>
            <p>Votre compte sera actif dès que le propriétaire du cabinet vous aura donné un rôle. Si vous êtes le propriétaire, créez votre compte puis cliquez sur « Je suis le propriétaire du cabinet ».</p>
            <div class="field"><label for="s-name">Votre nom</label><input id="s-name" type="text" maxlength="120" autocomplete="name"></div>
            <div class="field"><label for="s-email">Votre adresse e-mail</label><input id="s-email" type="text" inputmode="email" maxlength="254" autocomplete="username"></div>
            <div class="field"><label for="s-pw">Choisissez un mot de passe (10 caractères minimum, avec lettres et chiffres)</label><input id="s-pw" type="password" maxlength="128" autocomplete="new-password"></div>
            <button class="btn" type="submit">Créer mon compte</button>
            <p class="status" id="signup-status" role="status" aria-live="polite"></p>
          </form>
          <button type="button" class="link-btn" id="code-link">Se connecter avec le code d'accès du cabinet</button>
          <form class="om-auth-form" id="code-form" hidden novalidate>
            <p>Solution provisoire, tant que les comptes ne sont pas créés : le même code que l'ancienne console pilote.</p>
            <div class="field"><label for="c-code">Code d'accès du cabinet</label><input id="c-code" type="password" autocomplete="off"></div>
            <button class="btn" type="submit">Entrer</button>
            <p class="status" id="code-status" role="status" aria-live="polite"></p>
          </form>
          <button type="button" class="link-btn" id="diag-link">Vérifier mon code</button>
          <form class="om-auth-form" id="diag-form" hidden novalidate>
            <p>Tapez un code : l'application vous dit si c'est le code d'accès, le code propriétaire, ou aucun des deux, et ce qui manque sur le serveur. Aucun secret n'est affiché.</p>
            <div class="field"><label for="d-code">Code à vérifier</label><input id="d-code" type="password" autocomplete="off"></div>
            <button class="btn ghost" type="submit">Vérifier</button>
            <div class="out" id="diag-out" role="status" aria-live="polite"></div>
          </form>
        </div>
      </details>
    </div>
  </main>

  <aside class="om-auth-aside">
    <div>
      <p class="om-auth-pitch">Vos missions avancent, vos agents préparent, vous décidez.</p>
      <ul class="om-auth-points">
        <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>Chaque pièce est lue avant d’être classée, jamais d’après son seul nom.</li>
        <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>L’IA propose, l’humain valide : le jugement professionnel reste à vos équipes.</li>
        <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/></svg>Rien n’est effacé en silence : chaque action importante est tracée.</li>
      </ul>
    </div>
    <p class="om-auth-foot">Vos documents restent dans le Drive de votre cabinet.</p>
  </aside>
</div>

```

Notes pour l'exécutant :
- Dans l'ancien balisage, `#diag-out` avait un style en ligne (`display:flex; flex-direction:column; gap:6px; font-size:14px`). Il est repris par `.om-auth-form .out`. Le script ajoute des `<p>` avec `p.style.margin='0'` et `p.style.color`, c'est du code d'exécution, on n'y touche pas.
- Dans l'ancien balisage, le texte « Pas encore de compte ? » était centré ; il est maintenant dans `.om-auth-lead` (aligné à gauche, cohérent avec le reste).
- `class="btn"` sur `#start-new` n'a plus `text-align:center` : `.btn` est déjà `inline-flex` centré.

- [ ] **Step 5: Lancer toute la famille de tests UI**

Run: `node --test tests/login-page.test.js tests/ui-pilot-hooks.test.js tests/ui-css-up-to-date.test.js`
Expected: PASS partout. En particulier `login.html preserves id, name and data attributes` doit rester vert : si il échoue, comparer avec `git diff HEAD -- login.html` et rétablir l'attribut manquant ou en trop (ne **jamais** modifier l'empreinte dans `tests/ui-pilot-hooks.test.js`).

- [ ] **Step 6: Commit**

```bash
git add login.html tests/login-page.test.js
git commit -m "Design: page de connexion en mise en page auth (formulaire + panneau de marque)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Vérification dans un navigateur, documentation, suite complète

**Files:**
- Modify: `CLAUDE.md` (section « Design (thème shadcn, 2026-11-17) »)
- Aucun fichier de code

**Interfaces:**
- Consumes: pages et CSS des Tasks 1-2.
- Produces: preuve visuelle (captures dans le dossier temporaire de la session, jamais commitées) et rapport honnête de ce qui n'a pas pu être vérifié.

- [ ] **Step 1: Servir les fichiers statiques**

Le login appelle `/api/app?route=setup-state` : sans backend, l'appel échoue et le script l'ignore (`.catch(function () {})`), la page s'affiche quand même, avec le bouton Google. Démarrer un serveur statique **depuis la racine du dépôt** (dans un terminal à part, en arrière-plan) :

Run: `npx --yes serve . -l 4173 --no-clipboard`
Expected: `Accepting connections at http://localhost:4173`.

- [ ] **Step 2: Captures clair/sombre, ordinateur/téléphone (Playwright)**

Avec les outils Playwright, pour chaque combinaison, naviguer vers `http://localhost:4173/login.html`, attendre le chargement et capturer :
1. 1440×900, clair (`browser_emulate_media` colorScheme `light`) ;
2. 1440×900, sombre (`dark`) ;
3. 375×812, clair ;
4. 320×640, sombre ;
5. 1440×900 clair avec une couleur de cabinet très claire : exécuter `document.documentElement.style.setProperty('--brand', '#f5c518')` puis relancer `window.dispatchEvent(new Event('load'))` n'est pas fiable : à la place, charger la page, puis évaluer `document.documentElement.style.setProperty('--brand','#f5c518')`, puis recapturer ;
6. même chose avec `#0b1f4d`.

Contrôler visuellement : (a) le panneau de marque apparaît à partir de 1024 px et pas avant ; (b) le texte du panneau reste lisible dans les captures 5 et 6 ; (c) aucun défilement horizontal à 320 px (`document.documentElement.scrollWidth <= window.innerWidth` via `browser_evaluate`) ; (d) le bouton Google est lisible en clair et en sombre ; (e) ouvrir « Autres options » et « Se connecter avec un e-mail » : les `details` s'ouvrent, la flèche pivote.

Note : à `file://` ou sans `ui-workspace.js` actif, `--om-brand-text` peut manquer ; sur `localhost` le script s'exécute. Si le texte du panneau est illisible avec `#f5c518`, c'est que `--primary-foreground` n'est pas recalculé : le signaler tel quel, ne pas le masquer.

- [ ] **Step 3: États d'erreur**

Via `browser_evaluate` sur la page chargée :
- afficher la boîte « espace fermé » : `document.getElementById('restart-box').hidden = false` → vérifier qu'elle est visible et lisible, puis `hidden = true` → vérifier qu'elle disparaît (preuve que `hidden` n'est plus contredit) ;
- message d'erreur : `var s=document.getElementById('google-status'); s.textContent='Connexion annulée dans Google.'; s.className='status error'` → vérifier la couleur rouge lisible en clair et en sombre.
- soumettre le formulaire e-mail vide : ouvrir `#pw-box`, cliquer « Se connecter » → le message « Renseignez votre e-mail et votre mot de passe. » apparaît en rouge.

- [ ] **Step 4: Contrôle d'accessibilité**

Invoquer le skill `accessibility-scan` sur `http://localhost:4173/login.html` (clair puis sombre). Corriger tout nouveau défaut introduit par le CSS de `auth.css` (contraste, focus) ; consigner ceux qui ne viennent pas de ce chantier sans les corriger ici. Puis le skill `accessibility-inspect` limité au clavier : Tab depuis le début de la page doit atteindre dans l'ordre le bouton Google, le résumé « Se connecter avec un e-mail… », puis « Autres options », avec un anneau de focus visible.

- [ ] **Step 5: Mettre à jour `CLAUDE.md`**

Dans la section « Design (thème shadcn, 2026-11-17) », ajouter à la fin de la liste :

```markdown
- **Page de connexion (2026-11-17)** : `login.html` utilise la mise en page « auth » du template (formulaire d'abord dans le DOM, panneau de
  marque à droite dès 1024 px), style dans `assets/ui/auth.css` (importé par `assets/ui.src.css`, préfixe `om-auth-`). Le script inline est
  épinglé par `tests/login-page.test.js` ; les éléments décoratifs n'ont jamais d'`id` / `name` / `data-*` (sinon l'empreinte de
  `tests/ui-pilot-hooks.test.js` change). Premier fichier du dossier `assets/ui/` (un fichier CSS par famille de composants, prévu par la spec
  `docs/superpowers/specs/2026-11-17-admin-panel-premium-design.md`).
```

- [ ] **Step 6: Suite complète**

Run: `npm test`
Expected: tous les tests passent (≈ 2 minutes). Si un test sans rapport échoue à cause des fichiers déjà modifiés dans l'arbre de travail (`lib/fill-orders.js` etc.), le dire explicitement avec la sortie exacte, et vérifier avec `git stash`-free : lancer `node --test tests/login-page.test.js tests/ui-pilot-hooks.test.js tests/ui-css-up-to-date.test.js` pour prouver que le chantier login est vert indépendamment.

- [ ] **Step 7: Arrêter le serveur statique et commiter la documentation**

Arrêter le processus `serve`, puis :

```bash
git add CLAUDE.md
git commit -m "Docs: page de connexion premium dans CLAUDE.md" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Rapport**

Écrire à Paul ce qui est **prouvé** (tests verts, captures vues, scan d'accessibilité lu) et ce qui **n'est pas essayé** : connexion Google réelle, connexion par e-mail réelle avec un vrai serveur, vrais cabinets avec leur logo, rendu sur un vrai téléphone, navigateurs autres que celui de Playwright. Ne pousser ni ne déployer sans son accord.

---

## Self-Review

1. **Spec coverage.** 4.1 fondations : cette page n'ajoute que les tokens utiles à la connexion (ombres, rayons, mouvement via `om-auth-in` et la règle `prefers-reduced-motion` existante) ; l'échelle complète d'ombres/palette sémantique est repoussée au plan du kit (hors périmètre de ce plan, dit en tête). 4.4 « auth » : Task 1-2. 5 garde-fous : hooks (Task 2 step 5), `ui-css-up-to-date` (Task 1), captures Playwright et accessibilité (Task 3), rapport honnête (Task 3 step 8). Les sections 4.2, 4.3 et les lots 2 à 5 n'ont pas de tâche ici : voulu (« commence par le login »).
2. **Placeholders.** Aucun « TBD ». La seule variabilité est la couleur d'essai de Task 3, donnée en valeur exacte.
3. **Cohérence des noms.** Classes de Task 1 (`om-auth`, `-main`, `-card`, `-brand`, `-title`, `-lead`, `-google`, `-alert`, `-form`, `-more`, `-links`, `-aside`, `-pitch`, `-points`, `-foot`) = celles utilisées dans le balisage de Task 2 et dans les tests. `.out` (sortie du diagnostic) est défini sous `.om-auth-form .out`.
4. **Review Focus.** Les cinq lignes ont chacune un test ou une vérification nommée : hidden/erreurs (tests Task 1 et 2 + Task 3 step 3), sans-Google (test `#pw-box`), 320 px (Task 3 step 2c), sombre (Task 3 steps 2-4), couleur de cabinet (test « firm tokens only » + captures 5 et 6).
