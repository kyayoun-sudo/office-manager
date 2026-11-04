# Passer Office Manager sur votre propre serveur — le guide pas à pas

Ce guide explique, étape par étape, comment faire tourner Office Manager sur **votre propre serveur** au lieu de Vercel et
Supabase. Suivez les étapes **dans l'ordre**. Chaque étape dit : ce qu'il faut faire, comment vérifier que c'est bon, et
quoi faire si ça ne marche pas.

**Durée totale : environ 2 heures**, dont une partie à attendre (le nom de domaine met jusqu'à 1 heure à « se propager »).

**Rien n'est perdu pendant ce travail.** L'application actuelle (Vercel + Supabase) continue de marcher normalement
jusqu'à la fin. Vous ne l'arrêterez qu'à la toute fin, quand tout marche sur le nouveau serveur.

> Vous pouvez faire les étapes 5 à 9 avec Claude en direct : vous tapez les commandes qu'il vous donne, il lit les
> résultats avec vous. Il ne tape jamais un mot de passe à votre place.

---

## Avant de commencer : ce qu'il vous faut

| Quoi | Pourquoi | Où le trouver |
|---|---|---|
| Une carte bancaire | Louer le serveur (≈ 8 à 15 € par mois) | — |
| L'accès à votre **nom de domaine** | Donner une adresse à l'application (ex. `office.mon-cabinet.com`) | Chez le fournisseur où vous l'avez acheté (OVH, Gandi, GoDaddy, Namecheap…) |
| L'accès à **Vercel** | Recopier les réglages actuels | vercel.com |
| L'accès à **Supabase** | Déménager les données | supabase.com |
| L'accès à **Google Cloud** | Autoriser la nouvelle adresse pour Google Drive | console.cloud.google.com |
| Un **compte d'envoi d'e-mails** | Envoyer les e-mails « confirmez votre adresse » | Voir l'étape 3 |
| Un ordinateur Windows | Pour se connecter au serveur | Votre poste |

Préparez aussi **un petit fichier texte sur votre ordinateur** (Bloc-notes) appelé `notes-serveur.txt`. Vous y noterez
au fur et à mesure : l'adresse IP du serveur, les mots de passe que vous créez, etc. **Gardez ce fichier pour vous, ne
l'envoyez à personne.**

---

## Étape 1 — Louer le serveur (≈ 10 minutes)

Un « VPS » est un ordinateur loué chez un hébergeur, allumé jour et nuit, sur lequel on installe l'application.

1. Choisissez un hébergeur. Exemples simples et sérieux, en Europe :
   - **Hetzner** (hetzner.com) : modèle **CX32** (4 Go de mémoire), centre de données en Allemagne ou Finlande.
   - **OVHcloud** (ovhcloud.com) : gamme **VPS**, modèle avec 4 Go de mémoire, centre de données en France.
   - **Scaleway** (scaleway.com) : instance avec 4 Go de mémoire, Paris.
2. Créez un compte et commandez un serveur avec :
   - **Système : Ubuntu 24.04**
   - **Mémoire : 4 Go** (2 Go marchent aussi pour commencer)
   - **Disque : 40 Go ou plus**
3. À la commande, on vous demande comment vous connecter : choisissez **mot de passe** (le plus simple). Notez-le dans
   `notes-serveur.txt`.
4. Quand le serveur est prêt (quelques minutes), l'hébergeur affiche son **adresse IP**, par exemple `203.0.113.10`.
   **Notez-la** dans `notes-serveur.txt`.

✅ **C'est bon si** : vous avez une adresse IP et un mot de passe pour le serveur.

---

## Étape 2 — Donner une adresse au serveur (≈ 5 minutes, puis jusqu'à 1 heure d'attente)

On va faire en sorte que `office.mon-cabinet.com` (remplacez par votre domaine) mène à votre serveur.

1. Allez chez le fournisseur de votre nom de domaine, dans la partie **« Zone DNS »** (ou « DNS », « Gérer les
   enregistrements »).
2. Ajoutez un enregistrement :
   - **Type : A**
   - **Nom (ou sous-domaine) : `office`**
   - **Valeur (ou cible) : l'adresse IP du serveur** (ex. `203.0.113.10`)
   - **TTL : laissez la valeur proposée**
3. Enregistrez.
4. Notez dans `notes-serveur.txt` l'adresse complète choisie, par exemple `office.mon-cabinet.com`.

✅ **C'est bon si** : sur votre ordinateur, dans PowerShell (menu Démarrer → tapez « PowerShell »), la commande
`nslookup office.mon-cabinet.com` affiche l'adresse IP du serveur. Si ce n'est pas encore le cas, attendez et réessayez
dans 15 minutes : c'est normal, cela peut prendre jusqu'à 1 heure. Vous pouvez continuer les étapes 3 à 6 pendant ce
temps.

---

## Étape 3 — Prévoir l'envoi des e-mails (≈ 15 minutes)

Quand quelqu'un s'inscrit, l'application lui envoie un e-mail « confirmez votre adresse ». Il faut un compte d'envoi.

**Le plus simple : Brevo (gratuit jusqu'à 300 e-mails par jour).**
1. Créez un compte sur **brevo.com**.
2. Dans Brevo : **Paramètres → SMTP et API → onglet SMTP**. Vous y trouvez :
   - le **serveur** : `smtp-relay.brevo.com`
   - le **port** : `587`
   - l'**identifiant** (une adresse e-mail)
   - une **clé SMTP** : cliquez sur « Générer une nouvelle clé SMTP » (c'est le mot de passe d'envoi)
3. Dans Brevo, **Expéditeurs** : ajoutez l'adresse qui enverra les e-mails (ex. `no-reply@mon-cabinet.com`) et
   validez-la (Brevo envoie un lien).
4. Notez ces 4 informations dans `notes-serveur.txt`.

(Si votre cabinet a déjà un fournisseur d'e-mails professionnel — Google Workspace, Microsoft 365, OVH Mail —, il
donne aussi ces informations « SMTP ». Brevo est simplement le plus facile.)

✅ **C'est bon si** : vous avez noté serveur, port, identifiant, clé SMTP et adresse d'expéditeur validée.

---

## Étape 4 — Recopier les réglages de Vercel (≈ 15 minutes)

Les réglages de l'application (clés de l'IA, clés de chiffrement…) sont aujourd'hui dans Vercel. Il faut les recopier.

1. Allez sur **vercel.com** → projet **office-manager-personal-pilot** → **Settings** → **Environment Variables**.
2. Pour chacune des lignes ci-dessous, cliquez sur l'œil 👁 pour voir la valeur, et recopiez-la dans
   `notes-serveur.txt` (nom = valeur) :

   - `DEFAULT_ORG_ID` (pour votre cabinet c'est `6c2fe1e2-3daf-4795-9d09-3fdb95e52942`)
   - `GOOGLE_TOKEN_ENCRYPTION_KEY`
   - `OWNER_APPROVAL_SECRET`
   - `OAUTH_STATE_SECRET`
   - `OFFICE_MANAGER_INTERNAL_SECRET`
   - `OFFICE_MANAGER_SCHEDULER_SECRET`
   - `ORPAILLEUR_JOB_SECRET`
   - `OFFICE_MANAGER_ACCESS_TOKEN`
   - `OFFICE_MANAGER_OWNER_TOKEN`
   - `OFFICE_MANAGER_MULTI_CABINET`
   - `FIRST_OWNER_EMAILS`
   - `GOOGLE_OAUTH_CLIENT_ID` et `GOOGLE_OAUTH_CLIENT_SECRET` (ou `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`)
   - Les clés de l'IA : `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `GEMINI_API_KEY`,
     `OPENROUTER_API_KEY` (celles qui existent)
   - Et toute autre ligne présente que vous voulez garder.

3. **Si une valeur est cachée et ne peut pas être affichée** (Vercel l'indique « Sensitive ») :
   - pour une clé d'IA : allez la recréer chez le fournisseur (Anthropic, OpenAI…) ;
   - pour `GOOGLE_TOKEN_ENCRYPTION_KEY`, `OWNER_APPROVAL_SECRET` ou `OAUTH_STATE_SECRET` : ce n'est pas grave, on en
     créera une nouvelle, mais **il faudra reconnecter Google** une fois à la fin (étape 11), et chacun devra
     ressaisir sa clé « Mon IA » s'il en avait une.

✅ **C'est bon si** : toutes les valeurs sont dans `notes-serveur.txt`.

---

## Étape 5 — Se connecter au serveur (≈ 5 minutes)

1. Sur votre ordinateur, ouvrez **PowerShell** (menu Démarrer → tapez « PowerShell » → Entrée).
2. Tapez (remplacez par l'IP de votre serveur) :
   ```
   ssh root@203.0.113.10
   ```
3. La première fois, il demande « Are you sure you want to continue connecting? » → tapez `yes` puis Entrée.
4. Il demande le mot de passe du serveur : **collez-le** (clic droit dans la fenêtre) puis Entrée.
   *Rien ne s'affiche pendant que vous tapez le mot de passe : c'est normal.*
5. Vous voyez maintenant une ligne qui commence par `root@...:~#`. **Vous êtes sur le serveur.**

👉 À partir d'ici, chaque commande en gris se **copie**, se **colle** dans cette fenêtre (clic droit), puis on appuie sur
**Entrée**. Attendez qu'une commande soit finie (la ligne `root@...:~#` réapparaît) avant de coller la suivante.

---

## Étape 6 — Installer les outils et l'application (≈ 10 minutes)

1. Mettre le serveur à jour et installer Docker (l'outil qui fait tourner l'application) :
   ```
   apt update && apt -y upgrade && curl -fsSL https://get.docker.com | sh
   ```
   (Cela prend 2 à 5 minutes. Si un écran violet pose une question, appuyez simplement sur Entrée.)

2. Protéger le serveur (n'ouvrir que la connexion à distance et le site web) :
   ```
   ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
   ```

3. Récupérer l'application :
   ```
   git clone -b feature/white-label-desktop https://github.com/kyayoun-sudo/office-manager.git
   cd office-manager
   ```

✅ **C'est bon si** : la commande `docker --version` affiche un numéro de version.

---

## Étape 7 — Remplir les réglages du serveur (≈ 15 minutes)

1. Créer le fichier de réglages à partir du modèle :
   ```
   cp .env.example .env
   ```
2. Créer deux mots de passe au hasard dont on aura besoin (copiez ce qui s'affiche dans `notes-serveur.txt`) :
   ```
   openssl rand -base64 32
   openssl rand -hex 32
   ```
3. Ouvrir le fichier pour le remplir :
   ```
   nano .env
   ```
   Un éditeur de texte simple s'ouvre. On se déplace avec les **flèches du clavier**. On tape ou on colle (clic droit)
   après le signe `=` de chaque ligne.

4. Remplissez :
   - `OFFICE_MANAGER_DOMAIN=` → votre adresse, ex. `office.mon-cabinet.com`
   - `OFFICE_MANAGER_PUBLIC_URL=` → la même avec https, ex. `https://office.mon-cabinet.com`
   - `POSTGRES_PASSWORD=` → le **premier** mot de passe créé au point 2 (celui avec `openssl rand -base64 32`).
     ⚠️ Ne le changez plus jamais ensuite.
   - `DEFAULT_ORG_ID=`, `OFFICE_MANAGER_MULTI_CABINET=`, `FIRST_OWNER_EMAILS=` → les valeurs de Vercel (étape 4)
   - Les secrets (`OFFICE_MANAGER_INTERNAL_SECRET`, `OFFICE_MANAGER_SCHEDULER_SECRET`, `OAUTH_STATE_SECRET`,
     `OWNER_APPROVAL_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `OFFICE_MANAGER_ACCESS_TOKEN`, `OFFICE_MANAGER_OWNER_TOKEN`)
     → les valeurs de Vercel. **S'il en manque une**, mettez le **second** mot de passe créé au point 2
     (`openssl rand -hex 32`) — un différent pour chaque ligne vide (relancez la commande pour en avoir d'autres).
   - `GOOGLE_OAUTH_CLIENT_ID=` et `GOOGLE_OAUTH_CLIENT_SECRET=` → les valeurs de Vercel
   - `SMTP_HOST=`, `SMTP_PORT=`, `SMTP_USER=`, `SMTP_PASSWORD=`, `SMTP_FROM=` → les informations de l'étape 3
     (pour `SMTP_FROM`, par exemple : `Office Manager <no-reply@mon-cabinet.com>`)
   - Les clés de l'IA → les valeurs de Vercel. Une ligne qui reste vide n'est pas un problème.
   - Si Vercel contenait d'autres lignes que vous voulez garder, ajoutez-les à la fin, sous la forme `NOM=valeur`.

5. Enregistrer et fermer : appuyez sur **Ctrl + O**, puis **Entrée** (enregistrer), puis **Ctrl + X** (fermer).

✅ **C'est bon si** : la commande `grep -c "=" .env` affiche un nombre (le fichier existe et contient vos lignes).

---

## Étape 8 — Créer la base de données et y déménager vos données (≈ 20 minutes)

1. Démarrer **seulement** la base de données (elle crée toutes les tables de l'application au premier démarrage) :
   ```
   docker compose up -d db
   ```
   Attendez 30 secondes, puis vérifiez qu'elle tourne :
   ```
   docker compose ps
   ```
   ✅ La ligne `db` doit indiquer `healthy` (attendez encore un peu si elle indique `starting`).

2. Récupérer l'adresse de votre base Supabase :
   - Sur **supabase.com**, ouvrez le projet **TATY Mission Controller**.
   - Cliquez sur le bouton **Connect** (en haut).
   - Choisissez **Session pooler**, et copiez l'adresse qui commence par `postgresql://postgres.jdshiarbgpddhfhivmie:`.
   - Elle contient `[YOUR-PASSWORD]` : remplacez-le par le **mot de passe de la base Supabase**.
     Si vous ne le connaissez plus : Supabase → **Project Settings → Database → Reset database password**, choisissez-en
     un nouveau (cela ne gêne pas l'application actuelle, qui n'utilise pas ce mot de passe).

3. Lancer le déménagement. **Collez la commande en remplaçant ce qu'il y a entre les apostrophes** par l'adresse
   complète de l'étape précédente (gardez les apostrophes) :
   ```
   SUPABASE_DB_URL='postgresql://postgres.jdshiarbgpddhfhivmie:VOTRE-MOT-DE-PASSE@aws-0-eu-west-3.pooler.supabase.com:5432/postgres' bash scripts/vps-migrate.sh
   ```
   Le programme affiche 4 étapes :
   - **1/4 Comparaison des colonnes** : s'il affiche « ARRÊT », **rien n'a été copié** ; copiez la liste affichée et
     envoyez-la à Claude, il corrigera.
   - **2/4 Copie des données** : peut prendre quelques minutes.
   - **3/4 Copie des comptes** : chacun gardera son mot de passe.
   - **4/4 Vérification** : un tableau avec, pour chaque table, le nombre de lignes chez Supabase et sur le serveur.

✅ **C'est bon si** : aucune ligne du tableau final n'indique `<-- DIFFÉRENT`, et la dernière phrase dit « Terminé ».
Rien n'a été effacé chez Supabase, quoi qu'il arrive.

❌ **En cas d'erreur** : copiez le message et envoyez-le à Claude. Pour recommencer à zéro proprement :
```
docker compose down -v
docker compose up -d db
```
(puis refaites le point 3). ⚠️ `down -v` efface la base **du serveur** (jamais celle de Supabase).

---

## Étape 9 — Démarrer l'application (≈ 10 minutes)

1. Tout démarrer :
   ```
   docker compose up -d --build
   ```
   La première fois, cela prend 3 à 6 minutes.

2. Vérifier que l'application a bien démarré :
   ```
   docker compose logs app --tail 20
   ```
   ✅ Vous devez voir : `[server] Office Manager on port 3000`.

3. Ouvrez dans votre navigateur : `https://office.mon-cabinet.com/api/health`
   ✅ Vous devez voir un texte contenant `"status":"ok"` et `"database":true`.
   *Si le navigateur affiche une erreur de certificat ou « site inaccessible » : attendez 2 minutes (le certificat
   HTTPS se crée tout seul) et vérifiez que l'étape 2 est terminée (`nslookup`).*

---

## Étape 10 — Autoriser la nouvelle adresse chez Google (≈ 5 minutes)

Sans cela, « Continuer avec Google » et le Drive refuseront la nouvelle adresse (erreur `redirect_uri_mismatch`).

1. Allez sur **console.cloud.google.com** → choisissez le projet de l'application.
2. **API et services → Identifiants** → cliquez sur le **client OAuth** de l'application.
3. Dans **URI de redirection autorisés**, cliquez **Ajouter un URI** et collez :
   `https://office.mon-cabinet.com/oauth/google/callback`
4. Dans **Origines JavaScript autorisées** (s'il y a cette partie), ajoutez : `https://office.mon-cabinet.com`
5. **Enregistrer**. (Ne supprimez pas l'ancienne adresse Vercel tant que vous n'avez pas basculé.)

---

## Étape 11 — Essayer (≈ 15 minutes)

Sur `https://office.mon-cabinet.com` :

1. **Connectez-vous avec votre e-mail et votre mot de passe habituels.** ✅ Vous arrivez sur l'accueil.
2. Ouvrez **Paramètres → Mise en service** : vérifiez que tout est vert (ou lisez ce qui manque).
3. Ouvrez la mission **PAGFIC** et la procédure **PRJ-01** : vos données sont là.
4. Vérifiez que le **Drive** répond (une mission affiche ses documents).
   Si le Drive ne répond pas, ou si vous aviez dû créer de nouvelles clés à l'étape 4 :
   **Paramètres → Connecter Google**, refaites la connexion une fois.
5. Faites essayer une autre personne du cabinet (connexion avec son mot de passe).

✅ **C'est bon si** : ces 5 points marchent. Sinon, notez ce qui ne va pas et envoyez-le à Claude, avec la sortie de :
```
docker compose logs app --tail 100
```

---

## Étape 12 — Basculer définitivement

Quand tout marche :

1. **Juste avant** de basculer, refaites l'étape 8 (point 3) pour récupérer les dernières données saisies sur
   l'ancienne application. Pour cela, d'abord :
   ```
   docker compose down
   docker volume rm office-manager_pgdata
   docker compose up -d db
   ```
   puis la commande de déménagement, puis `docker compose up -d --build`.
2. Prévenez tout le monde : **la nouvelle adresse est `https://office.mon-cabinet.com`**, mêmes mots de passe.
3. Ne supprimez rien chez Vercel et Supabase pendant **quelques semaines** : c'est votre solution de secours. Vous
   pouvez mettre le projet Supabase en pause et retirer le déploiement Vercel ensuite.

---

## Au quotidien (une fois installé)

Toujours dans PowerShell, après `ssh root@IP-du-serveur` puis `cd office-manager` :

| Je veux… | Commande |
|---|---|
| Voir si tout tourne | `docker compose ps` |
| Voir les derniers messages de l'application | `docker compose logs app --tail 50` |
| Mettre à jour l'application (nouvelle version) | `git pull && docker compose up -d --build` |
| Redémarrer l'application | `docker compose restart app` |
| Voir les sauvegardes | `ls backups` |

**Sauvegardes** : une copie complète de la base est faite **chaque nuit à 2 h**, dans le dossier `backups` du
serveur, et gardée **14 jours**. Une fois par mois, copiez la plus récente sur votre ordinateur. Dans PowerShell,
**sur votre ordinateur** (pas sur le serveur) :
```
scp root@203.0.113.10:office-manager/backups/office_manager_AAAA-MM-JJ.dump .
```
(remplacez l'IP et la date par celle d'un fichier affiché par `ls backups`).

---

## Ce qui change pour les utilisateurs

- **La même application**, les mêmes écrans, les mêmes mots de passe.
- **« Continuer avec Google »** marche toujours.
- **La connexion avec Microsoft n'existe plus** (elle passait par Supabase). Les personnes concernées se connectent par
  e-mail + mot de passe, ou par Google.
- **Une nouvelle inscription** : la personne reçoit un e-mail ; en cliquant le lien, la page de connexion lui demande
  l'e-mail et le mot de passe choisis à l'inscription (c'est une protection contre l'usurpation d'adresse).
- Après **10 mots de passe faux de suite**, il faut attendre 10 minutes avant de réessayer.
