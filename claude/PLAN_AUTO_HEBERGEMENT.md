# Plan — Héberger sur un VPS, sans Vercel ni Supabase (mis à jour le 04/11/2026)

Décision de Paul (31/10) : héberger sur un **serveur loué** (VPS). Précision du 03/11 : **plus de Supabase du tout**, même
auto-hébergé. 04/11 : « je veux tout faire depuis mon serveur VPS, aide-moi » → construit (voir l'état ci-dessous).
Choix du 04/11 : VPS pas encore loué ; Paul a un nom de domaine ; les mots de passe sont gardés (reprise de auth.users).

## Ce que Supabase fait aujourd'hui (mesuré dans le code le 03/11)

| Rôle | Dans le code | Remplacement |
|---|---|---|
| Base PostgreSQL (63 tables, `db/INSTALL_TOUT.sql`) | — | PostgreSQL seul (Docker ou paquet Linux) |
| API REST (PostgREST) | `lib/supabase.js` `rest()`, importé par 121 fichiers ; 1 appel direct (`agent-permissions.js:53`) ; `on_conflict` (37 fichiers), `Prefer: resolution=merge` (16), `or=(…)` (7), aucune jointure imbriquée | **Traducteur dans `rest()`** : même syntaxe d'URL → SQL paramétré via `pg`. Les 121 fichiers ne changent pas. |
| 6 fonctions SQL (`rpc/office_create_cabinet`, `office_purge_firm`, `office_ai_usage_increment`, `office_get_google_drive_secret`, `office_mission_staffing_advice`, `office_save_mission_plan`) | `rest('rpc/…')` | `select fn(...)` par le traducteur |
| Comptes (`/auth/v1` : inscription, mot de passe, jeton de rafraîchissement, `admin/users`, `/user`, connexion Google / Microsoft) | `lib/accounts.js`, `lib/user-auth.js` | **Module de comptes propre** : table des identifiants (mot de passe haché scrypt), sessions, confirmation par e-mail (SMTP), mot de passe oublié, connexion Google par notre client OAuth |
| `auth.uid()` dans le SQL | `db/base.sql` l. 41 et 68 | Remplacé (le serveur passe l'utilisateur, ou suppression : seul le serveur accède à la base) |
| Planificateur (pg_cron + pg_net) | `db/scheduler-cron.sql` | Minuterie dans le serveur Node |
| Fonctions Edge (`taty-google-bridge`, `orpailleur-durable-worker`) | 4 fichiers appellent `functions/v1` | Abandonnées (secours / ancien moteur) ; appels retirés ou derrière un interrupteur éteint |

## Étapes

| # | Étape | Qui |
|---|---|---|
| 1 | Serveur Node (`server/index.mjs`) : pages, `api/*.js` tels quels, règles de `vercel.json`, remplace `waitUntil`, planificateur intégré | Claude |
| 2 | Traducteur PostgREST → SQL dans `lib/supabase.js` (`DATABASE_URL`), testé sur PGlite (déjà en dépendance de dev) avec tous les motifs d'URL du code | Claude |
| 3 | Comptes propres (remplace `/auth/v1`), mêmes identifiants d'utilisateur (UUID) que Supabase | Claude |
| 4 | SQL sans `auth.*` ni pg_cron ; `INSTALL_TOUT.sql` reconstruit | Claude |
| 5 | `docker-compose.yml` : PostgreSQL + application + Caddy (HTTPS) ; `.env.example` ; sauvegarde `pg_dump` nocturne | Claude |
| 6 | Louer le VPS (2 Go RAM suffisent sans Supabase, 4 conseillés), domaine, SMTP | Paul / collègue |
| 7 | Déménager : `pg_dump` du schéma public de Supabase + export de `auth.users` (id, e-mail, hachage bcrypt, confirmation) → mots de passe gardés | Paul / collègue, avec guide |
| 8 | Essais sur la nouvelle adresse, ancienne installation gardée jusqu'à la bascule | Paul |

## Non prouvé tant que l'étape 8 n'est pas faite

Traducteur et comptes testés en local ; l'installation réelle (HTTPS, e-mails, Google, données déménagées) seulement sur le VPS.

## État au 04/11/2026 (code fait, pas encore essayé sur un vrai serveur)

| # | Étape | État |
|---|---|---|
| 1 | Serveur Node `server/index.mjs` (pages, `api/*.js` inchangés, règles de `vercel.json`, minuterie toutes les 5 min, lien de confirmation) | fait, `tests/server.test.js` |
| 2 | Traducteur `lib/sql-rest.js` + `lib/pg-db.js`, `rest()` sur PostgreSQL si `DATABASE_URL` | fait (493eda8), `tests/sql-rest.test.js` ; 455 requêtes du code traduites et vérifiées par PostgreSQL |
| 3 | Comptes `lib/local-auth.js` + `db/vps-auth.sql` (mêmes réponses que Supabase Auth ; bcrypt repris puis scrypt ; e-mail de confirmation SMTP ; Google via `google-signin.js` inchangé) | fait, `tests/local-auth.test.js` |
| 4 | SQL : `db/vps-compat.sql` (rôles, `auth.uid()`) avant `INSTALL_TOUT.sql` inchangé ; pas de pg_cron (minuterie du serveur) | fait |
| 5 | `Dockerfile`, `docker-compose.yml` (PostgreSQL 17, app, Caddy, sauvegarde nocturne 14 j), `Caddyfile`, `.env.example` | fait, non lancé (pas de Docker ici) |
| 6-8 | Louer, déménager (`scripts/vps-migrate.sh`), essayer, basculer : `docs/INSTALLER_SUR_UN_VPS.md` | à faire par Paul (Claude peut guider en direct) |

Non repris : connexion Microsoft (passait par le fournisseur Supabase) ; fonctions Edge `taty-google-bridge` / `orpailleur-durable-worker`
(secours / ancien moteur, éteints par défaut). Les sessions ouvertes ne sont pas déménagées : chacun se reconnecte une fois.
