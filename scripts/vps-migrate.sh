#!/usr/bin/env bash
# DÉMÉNAGER LES DONNÉES DE SUPABASE VERS LE POSTGRESQL DU SERVEUR DU CABINET (VPS) — 2026-11-04.
# À lancer SUR LE VPS, dans le dossier de l'application, APRÈS « docker compose up -d db » (base neuve, tables installées).
#
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<mot de passe>@<hôte>:5432/postgres' bash scripts/vps-migrate.sh
#
# L'adresse vient de Supabase → bouton « Connect » → « Session pooler ». Elle n'est écrite nulle part (seulement pour cette commande).
# Ce que fait le script, dans l'ordre, sans rien effacer chez Supabase :
#   1. compare les colonnes : une colonne de Supabase absente du serveur arrête tout (rien n'est copié à moitié) ;
#   2. copie toutes les données des tables de l'application (schéma public), en une seule transaction ;
#   3. copie les comptes (identifiant, e-mail, mot de passe chiffré, confirmation) : chacun garde son mot de passe ;
#   4. affiche le nombre de lignes de chaque table des deux côtés.
set -euo pipefail
: "${SUPABASE_DB_URL:?Donnez SUPABASE_DB_URL (Supabase → Connect → Session pooler)}"
cd "$(dirname "$0")/.."
WORK=./backups/migration-$(date +%Y%m%d-%H%M%S)
mkdir -p "$WORK"
PG="docker run --rm -i --network host -e PGCONNECT_TIMEOUT=20 -v $PWD/$WORK:/work postgres:17"
LOCAL="docker compose exec -T db psql -U office_manager -d office_manager -v ON_ERROR_STOP=1 -q"

echo "1/4 Comparaison des colonnes…"
COLS="select table_name||'.'||column_name from information_schema.columns where table_schema='public' order by 1"
$PG psql "$SUPABASE_DB_URL" -Atc "$COLS" > "$WORK/supabase_columns.txt"
$LOCAL -Atc "$COLS" > "$WORK/vps_columns.txt"
MISSING=$(comm -23 <(sort "$WORK/supabase_columns.txt") <(sort "$WORK/vps_columns.txt") || true)
if [ -n "$MISSING" ]; then
  echo "ARRÊT : ces colonnes existent chez Supabase mais pas sur le serveur (rien n'a été copié) :"; echo "$MISSING"
  echo "Envoyez cette liste : le SQL de l'application doit d'abord les créer."; exit 1
fi

echo "2/4 Copie des données de l'application…"
$PG pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner --no-privileges -Fc -f /work/public.dump
docker compose cp "$WORK/public.dump" db:/tmp/public.dump
# --disable-triggers: the rows are copied as they are (no journal entry, no stamp rewritten); --single-transaction: all or nothing.
docker compose exec -T db pg_restore -U office_manager -d office_manager --data-only --disable-triggers --single-transaction --no-owner /tmp/public.dump
docker compose exec -T db rm -f /tmp/public.dump

echo "3/4 Copie des comptes (mots de passe chiffrés)…"
$PG psql "$SUPABASE_DB_URL" -c "\copy (select id, email, encrypted_password, email_confirmed_at, coalesce(raw_user_meta_data,'{}'), coalesce(raw_app_meta_data,'{}'), created_at, updated_at, last_sign_in_at, banned_until from auth.users where email is not null and deleted_at is null) to '/work/auth_users.csv' csv"
docker compose cp "$WORK/auth_users.csv" db:/tmp/auth_users.csv
$LOCAL -c "\copy auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at, last_sign_in_at, banned_until) from '/tmp/auth_users.csv' csv"
docker compose exec -T db rm -f /tmp/auth_users.csv
rm -f "$WORK/auth_users.csv"   # password hashes are not kept in the backup folder

echo "4/4 Vérification : lignes par table (Supabase | serveur)"
COUNT="select format('select %L as t, count(*) from public.%I', table_name, table_name) from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"
for side in supabase vps; do
  if [ $side = supabase ]; then Q="$PG psql $SUPABASE_DB_URL -At"; else Q="$LOCAL -At"; fi
  $Q -c "$COUNT" | sed 's/$/;/' > "$WORK/count_$side.sql"
done
$PG psql "$SUPABASE_DB_URL" -At -F'|' -f /work/count_supabase.sql > "$WORK/rows_supabase.txt"
docker compose cp "$WORK/count_vps.sql" db:/tmp/count_vps.sql
docker compose exec -T db psql -U office_manager -d office_manager -At -F'|' -f /tmp/count_vps.sql > "$WORK/rows_vps.txt"
join -t'|' "$WORK/rows_supabase.txt" "$WORK/rows_vps.txt" | awk -F'|' '{ flag = ($2==$3) ? "" : "   <-- DIFFÉRENT"; printf "%-45s %8s | %-8s%s\n", $1, $2, $3, flag }'
echo "Comptes : $($LOCAL -Atc 'select count(*) from auth.users') sur le serveur."
echo "Terminé. Rien n'a été effacé chez Supabase. Dossier de travail : $WORK"
