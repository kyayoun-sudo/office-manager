# Installer Office Manager pour un cabinet

État au 2026-10-11. L'essai porte sur 4 cabinets. Ce document est la seule recette d'installation.

## Le principe : un cabinet = une installation

Chaque cabinet a :
- son propre projet **Supabase** (sa base) ;
- son propre projet **Vercel** (son adresse) ;
- son propre **Drive**, connecté depuis l'application.

Le code est le même pour tous (même dépôt, même branche). Rien ne mélange deux cabinets : les données, les secrets, le Drive, le planificateur et les comptes sont séparés.

Ce choix suit la spécification (§52 « Private Tenant »). On n'a rien à reconstruire : le code fonctionne déjà avec un cabinet par déploiement (`DEFAULT_ORG_ID`).

Un seul Supabase partagé par plusieurs cabinets fonctionnerait aussi, techniquement : toutes les lignes portent `org_id`. Mais l'isolement repose alors seulement sur le code. Avec des dossiers clients réels, des projets séparés sont plus sûrs.

## Ce qui est déjà réglé dans le code

- **Socle de la base**
  - `db/INSTALL_TOUT.sql` crée toute la base sur un Supabase vide : 21 parties, dont `db/base.sql` pour le cabinet, les missions, l'équipe, « À valider » et l'inventaire.
  - On peut le relancer sans danger.
  - `tests/schema-coverage.test.js` vérifie que chaque colonne lue par le code existe.
- **Rien du premier cabinet**
  - Pas de Drive, de fichier ni de nom de TATY par défaut.
  - Le pont Supabase `taty-google-bridge` ne sert plus de repli que si on le demande (`GOOGLE_BRIDGE_FALLBACK=true`, ou `OFFICE_MANAGER_PILOT_LEGACY_IDS=true` chez TATY).
  - Un cabinet qui n'a pas connecté Google le voit écrit, au lieu de recevoir un autre Drive.
- **Le propriétaire**
  - Seules les adresses de `FIRST_OWNER_EMAILS` peuvent ouvrir le compte propriétaire.
  - « Repartir de zéro » (Paramètres) efface les données d'Office Manager du cabinet, jamais ses documents.
- **Autoriser les agents** : l'autorisation est écrite avec la session du propriétaire ou d'un associé de ce cabinet seulement, et l'approbateur est enregistré par la base elle-même.

## Les étapes, pour chaque cabinet (environ 20 minutes)

1. **Préparer le kit.** Dans le dépôt, lancer :
   `node scripts/new-firm.mjs --name "Cabinet X" --url https://cabinet-x.vercel.app --owner associe@cabinet-x.com`

   Le script affiche :
   - l'identifiant du cabinet ;
   - des secrets **nouveaux**, propres à ce cabinet ;
   - le SQL du planificateur, déjà rempli.

   Garder ce texte en lieu sûr (gestionnaire de mots de passe) : il contient des secrets.
2. **Supabase.**
   - Nouveau projet.
   - SQL Editor → coller `db/INSTALL_TOUT.sql` → Run.
   - Puis coller le SQL du planificateur du kit → Run.
3. **Vercel.**
   - Nouveau projet → importer le dépôt `office-manager`.
   - Branche de production : celle choisie pour l'essai.
   - Settings → Environment Variables : coller les variables du kit, et compléter les clés partagées :
     - IA : `OPENAI_API_KEY` ;
     - client Google : `GOOGLE_CLIENT_ID` et `GOOGLE_CLIENT_SECRET`.
   - Ensuite seulement : Deploy.
4. **Google Cloud** (un seul client OAuth pour tous les cabinets) : ajouter l'URI de redirection affichée par le kit (`https://<adresse>/oauth/google/callback`).
5. **Le cabinet.**
   - Ouvrir l'adresse et créer le compte avec l'adresse propriétaire.
   - « Démarrer » : nom du cabinet, connecter Google, choisir le Drive, autoriser les agents.
   - **Paramètres → Mise en service** doit être entièrement verte : réglages, tables, compte, Drive, passages automatiques.

## À savoir avant l'essai (conditions des fournisseurs, vérifiées le 2026-10-11)

- **Vercel**
  - L'offre gratuite (Hobby) est réservée à un usage personnel non commercial. Un essai avec des cabinets clients relève de l'usage commercial, donc de l'offre Pro.
  - Plusieurs projets peuvent vivre dans la même équipe Pro.
- **Supabase**
  - L'offre gratuite est limitée à 2 projets actifs, mis en pause après une semaine d'inactivité.
  - Pour 4 cabinets : offre Pro (à partir de 25 $/mois, qui couvre un projet « Micro »), plus environ 10 $/mois par projet supplémentaire.
- **Google**
  - Le client OAuth doit être en statut **« En production »**, pas « Test ». En test, l'autorisation expire au bout de 7 jours.
  - Tant que l'application n'est pas vérifiée par Google :
    - un avertissement « application non vérifiée » s'affiche ;
    - un plafond de 100 utilisateurs s'applique à vie.
  - Ici, une seule personne par cabinet connecte le Drive (le propriétaire), donc ce plafond suffit pour l'essai.
  - La vérification Google du scope Drive (restreint) sera nécessaire pour une vente à grande échelle.
  - Les cabinets sur Google Workspace peuvent devoir autoriser l'application dans leur console d'administration.

## Ce qui reste propre au premier cabinet (TATY)

TATY garde son installation actuelle. Pour qu'elle continue d'utiliser ses anciens fichiers et l'ancien pont, son déploiement doit avoir :
- `OFFICE_MANAGER_PILOT_LEGACY_IDS=true` (ou `MASTER_SHEET_ID`, `PBC_MASTER_FILE_ID`, `MISSION_CONTROL_REGISTRY_ID`) ;
- `GOOGLE_BRIDGE_FALLBACK=true` s'il passe encore par le pont.

`db/INSTALL_TOUT.sql` peut être relancé sur la base de TATY : il n'ajoute que ce qui manque.
