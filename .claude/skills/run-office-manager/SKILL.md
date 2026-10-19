---
name: run-office-manager
description: Lancer, tester et vérifier Office Manager AI (backend Node/Vercel, SQL Supabase, app bureau Tauri). À utiliser pour « lance les tests », « vérifie que ça marche », « lance l'app bureau », ou avant de dire qu'une modification est terminée.
---

# Lancer et vérifier Office Manager AI

Node >= 20, modules ES. Dépendances : `npm ci` à la racine (et dans `desktop/` pour Tauri).

## Vérifier une modification (du plus rapide au plus complet)

1. **Syntaxe** — quelques secondes :
   `npm run check`
   Pour un seul fichier : `node --check lib/<fichier>.js`
2. **Tests ciblés** — d'abord le test du module touché :
   `node --test tests/<module>.test.js`
   Filtrer par nom : `node --test --test-name-pattern="<motif>" tests/*.test.js`
3. **Suite complète** — ~2 min, 800+ tests, aucun réseau requis :
   `npm test`
4. **SQL** (si `db/*.sql` ou `supabase/` change) — Postgres embarqué via pglite :
   `npm run test:sql`

Ne jamais annoncer « terminé » ou « vérifié » sans avoir lu la sortie (principe 8 de `CLAUDE.md`).
Si un test échoue, montrer la sortie exacte.

## Application bureau (Tauri 2, `desktop/`)

- `cd desktop && npm ci` la première fois
- `npm run dev` (dans `desktop/`) — fenêtre de dev, compile le Rust (long la 1re fois)
- `npm run build` — installeur ; `npm run icons` régénère les icônes depuis `logo-cabinet.png`

## Backend et déploiement

- Fonctions serverless : `api/*.js` (Vercel, `maxDuration` 60 s, voir `vercel.json`).
  Le routeur principal est `api/app.js?route=...`.
- Planificateur : cron Supabase → Edge Function `office-manager-scheduler-bridge` → `/api/app?route=scheduler-tick` → `lib/agent-passes.js`.
- Edge Functions Supabase : `supabase/functions/*` (Deno/TypeScript).
- Pages : HTML statiques à la racine (`accueil.html` est la page d'accueil) ; complément Excel dans `excel/`.
- Détails de déploiement : `DEPLOYMENT.md`. Ne pas déployer ni écrire en base de production sans accord explicite.
