# Installer Office Manager sur le serveur du cabinet (VPS), sans Vercel ni Supabase

Tout tourne sur **un seul serveur loué** : la base PostgreSQL, l'application, le HTTPS (Caddy) et une sauvegarde chaque nuit.
L'installation actuelle (Vercel + Supabase) reste en place et intacte jusqu'à la bascule (étape 7) : on peut revenir en arrière à tout moment.

## 1. Louer le serveur (≈ 10 min)
- Un VPS **Ubuntu 24.04**, **4 Go de mémoire** (2 Go suffisent pour démarrer), 2 processeurs, 40 Go de disque.
  Exemples : Hetzner (CX22/CX32), OVHcloud (VPS-2), Scaleway, Contabo. Choisir un centre de données en Europe.
- Noter l'**adresse IP** du serveur et le mot de passe (ou la clé SSH) donnés par le fournisseur.

## 2. Faire pointer le nom de domaine (≈ 5 min, effet sous 1 h)
Chez le fournisseur du domaine (zone DNS) : un enregistrement **A**, nom `office` (ou celui choisi), valeur = l'IP du serveur.
Exemple : `office.mon-cabinet.com → 203.0.113.10`.

## 3. Installer Docker et l'application (≈ 15 min)
Se connecter au serveur (`ssh root@IP`), puis :
```bash
curl -fsSL https://get.docker.com | sh
git clone https://github.com/kyayoun-sudo/office-manager.git && cd office-manager
git checkout feature/white-label-desktop
cp .env.example .env && nano .env      # remplir : voir les commentaires du fichier
```
Pour un **déménagement**, recopier dans `.env` les **mêmes valeurs que dans Vercel** (Settings → Environment Variables) —
en particulier `DEFAULT_ORG_ID`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `OWNER_APPROVAL_SECRET`, `OAUTH_STATE_SECRET` : les accès Google
et les clés « Mon IA » enregistrés sont chiffrés avec elles. `POSTGRES_PASSWORD` : un mot de passe neuf (`openssl rand -base64 32`).

## 4. Démarrer la base seule et y déménager les données (≈ 15 min)
```bash
docker compose up -d db                 # au premier démarrage : les tables de l'application sont créées
SUPABASE_DB_URL='…' bash scripts/vps-migrate.sh
```
`SUPABASE_DB_URL` : Supabase → bouton **Connect** → **Session pooler** (remplacer `[YOUR-PASSWORD]` par le mot de passe de la base).
Le script arrête tout s'il manque une colonne, copie les données en une fois (tout ou rien), puis les **comptes avec leurs mots de
passe** (chacun se reconnecte avec son mot de passe actuel), et affiche le nombre de lignes de chaque table des deux côtés.
Rien n'est effacé chez Supabase.

## 5. Démarrer tout (≈ 5 min)
```bash
docker compose up -d --build
docker compose logs -f app              # « [server] Office Manager on port 3000 » ; Ctrl+C pour quitter
```
Ouvrir `https://office.mon-cabinet.com/api/health` : `"database": true`. Le certificat HTTPS arrive tout seul (1-2 min).

## 6. Google (≈ 5 min)
Google Cloud Console → API et services → Identifiants → le client OAuth du cabinet → **URI de redirection autorisés** : ajouter
`https://office.mon-cabinet.com/oauth/google/callback`. Les accès Drive déjà donnés restent valables (même client, mêmes clés).

## 7. Essayer, puis basculer
- Se connecter avec son mot de passe habituel ; ouvrir une mission, une procédure, Paramètres → Mise en service.
- Quand tout va bien : dire aux personnes la nouvelle adresse. Vercel et Supabase peuvent rester en pause quelques semaines
  (retour arrière possible), puis être arrêtés.
- Les données écrites sur l'ancienne installation APRÈS le déménagement ne sont pas recopiées : déménager juste avant la bascule.

## Au quotidien
- Sauvegardes : `backups/office_manager_AAAA-MM-JJ.dump` chaque nuit (14 jours gardés). Les copier aussi ailleurs de temps en temps.
- Mettre à jour l'application : `git pull && docker compose up -d --build`.
- Un nouveau fichier SQL de l'application (il est cité dans la note de version) : `docker compose exec -T db psql -U office_manager -d office_manager < db/<fichier>.sql`.
- Restaurer une sauvegarde : `docker compose exec -T db pg_restore -U office_manager -d office_manager --clean < backups/<fichier>.dump`.

## Ce qui change
| Avant | Sur le VPS |
|---|---|
| Vercel (pages et API) | `server/index.mjs` (mêmes fichiers `api/*.js`, mêmes règles de `vercel.json`) |
| Supabase base + API REST | PostgreSQL 17 + `lib/sql-rest.js` (mêmes appels, traduits en SQL) |
| Supabase Auth | `lib/local-auth.js` (table `auth.users` reprise de Supabase, mots de passe gardés) |
| Supabase pg_cron (toutes les 5 min) | minuterie du serveur (`OFFICE_MANAGER_SCHEDULER_SECONDS`, défaut 300) |
| e-mails de confirmation de Supabase | SMTP du cabinet (`SMTP_*` dans `.env`) |
| connexion Microsoft via Supabase | non disponible (Google et mot de passe restent) |
