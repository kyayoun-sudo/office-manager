#!/usr/bin/env bash
# DÉMÉNAGER LES DONNÉES DE SUPABASE VERS LE POSTGRESQL DU SERVEUR DU CABINET (VPS) — 2026-11-04.
# À lancer SUR LE VPS, dans le dossier de l'application, APRÈS « docker compose up -d db » (base neuve, tables installées).
#
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<mot de passe>@<hôte>:5432/postgres' bash scripts/vps-migrate.sh
#
# L'adresse vient de Supabase → bouton « Connect » → « Session pooler ». Elle n'est écrite nulle part (seulement pour cette commande).
# Ce que fait le script, dans l'ordre, sans rien effacer chez Supabase :
#   1. compare les tables et les colonnes (vues ignorées : elles ne contiennent pas de données). Ce qui n'existe que chez
#      Supabase (anciennes tables, colonnes ajoutées à la main) est CRÉÉ sur le serveur d'après Supabase : seulement des
#      ajouts (CREATE TABLE, ADD COLUMN), jamais une suppression ; essai à blanc d'abord, puis en une seule transaction.
#      Une erreur arrête tout avant la copie (2026-11-15 : 47 tables et 55 colonnes de Supabase manquaient au serveur) ;
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

echo "1/4 Comparaison des tables et des colonnes…"
# Base tables only (relkind r/p): views hold no data and are not copied.
COLS="select c.relname||'.'||a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped order by 1"
TABLES="select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by 1"
$PG psql "$SUPABASE_DB_URL" -Atc "$COLS" | sort > "$WORK/supabase_columns.txt"
$LOCAL -Atc "$COLS" | sort > "$WORK/vps_columns.txt"
$PG psql "$SUPABASE_DB_URL" -Atc "$TABLES" | sort > "$WORK/supabase_tables.txt"
$LOCAL -Atc "$TABLES" | sort > "$WORK/vps_tables.txt"
MISSING_TABLES=$(comm -23 "$WORK/supabase_tables.txt" "$WORK/vps_tables.txt" || true)
# Columns missing from tables that DO exist on the server (a missing table brings its own columns).
MISSING_COLS=$(comm -23 "$WORK/supabase_columns.txt" "$WORK/vps_columns.txt" | awk -F. 'NR==FNR{t[$1]=1;next} t[$1]' "$WORK/vps_tables.txt" - || true)
: > "$WORK/schema_add.sql"
if [ -n "$MISSING_TABLES" ]; then
  echo "   Tables qui n'existent que chez Supabase, créées sur le serveur :"; echo "$MISSING_TABLES" | sed 's/^/     /'
  ARGS=$(echo "$MISSING_TABLES" | sed 's/^/-t public./' | tr '\n' ' ')
  $PG pg_dump "$SUPABASE_DB_URL" --schema-only --no-owner --no-privileges $ARGS -Fc -f /work/missing_tables.dump
  # Structure only: no access policies, triggers, comments or rights of Supabase (its roles and functions do not exist here).
  $PG sh -c "pg_restore -l /work/missing_tables.dump | grep -v -E '^[0-9]+; [0-9]+ [0-9]+ (POLICY|TRIGGER|ROW SECURITY|COMMENT|ACL|DEFAULT ACL|PUBLICATION|PUBLICATION TABLE) ' > /work/missing_tables.list && pg_restore --no-owner --no-privileges -L /work/missing_tables.list -f /work/missing_tables.sql /work/missing_tables.dump"
  grep -v -E '^(SET transaction_timeout|SELECT pg_catalog.set_config)' "$WORK/missing_tables.sql" >> "$WORK/schema_add.sql"
fi
if [ -n "$MISSING_COLS" ]; then
  echo "   Colonnes qui n'existent que chez Supabase, ajoutées sur le serveur :"; echo "$MISSING_COLS" | sed 's/^/     /'
  IN=$(echo "$MISSING_COLS" | sed "s/.*/'&'/" | paste -sd, -)
  $PG psql "$SUPABASE_DB_URL" -At -c "select format('alter table public.%I add column if not exists %I %s%s%s;', c.relname, a.attname, format_type(a.atttypid, a.atttypmod), coalesce(' default '||pg_get_expr(d.adbin, d.adrelid), ''), case when a.attnotnull then ' not null' else '' end) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where n.nspname='public' and c.relname||'.'||a.attname in ($IN) order by c.relname, a.attnum" >> "$WORK/schema_add.sql"
fi
if [ -s "$WORK/schema_add.sql" ]; then
  docker compose cp "$WORK/schema_add.sql" db:/tmp/schema_add.sql
  echo "   Essai à blanc…"
  ( echo 'begin;'; echo '\i /tmp/schema_add.sql'; echo 'rollback;' ) | $LOCAL -f - > /dev/null || { echo "ARRÊT : la création de ce qui manque échoue (rien n'a été créé ni copié). Envoyez ce message."; exit 1; }
  docker compose exec -T db psql -U office_manager -d office_manager -v ON_ERROR_STOP=1 -q -1 -f /tmp/schema_add.sql > /dev/null
  docker compose exec -T db rm -f /tmp/schema_add.sql
  STILL=$(comm -23 "$WORK/supabase_columns.txt" <($LOCAL -Atc "$COLS" | sort) || true)
  if [ -n "$STILL" ]; then echo "ARRÊT : il manque encore (rien n'a été copié) :"; echo "$STILL"; exit 1; fi
  echo "   Ajouts faits et vérifiés."
fi

echo "2/4 Copie des données de l'application…"
$PG pg_dump "$SUPABASE_DB_URL" --data-only --schema=public --no-owner --no-privileges -Fc -f /work/public.dump
docker compose cp "$WORK/public.dump" db:/tmp/public.dump
# A column required on the server but optional at Supabase (2026-11-15: office_missions.client_contact_emails) would refuse
# Supabase's empty cells. For the copy only: the rule is lifted, empty cells then get the server's default, and the rule is
# put back. Without a default the column stays optional and is named.
NOTNULL="select c.relname||'.'||a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped and a.attnotnull order by 1"
$PG psql "$SUPABASE_DB_URL" -Atc "$NOTNULL" | sort > "$WORK/supabase_notnull.txt"
$LOCAL -Atc "$NOTNULL" | sort > "$WORK/vps_notnull.txt"
# Only columns that exist on both sides: a server-only column is not in the copy and receives its default.
RELAX=$(comm -23 "$WORK/vps_notnull.txt" "$WORK/supabase_notnull.txt" | comm -12 - "$WORK/supabase_columns.txt" || true)
if [ -n "$RELAX" ]; then
  IN=$(echo "$RELAX" | sed "s/.*/'&'/" | paste -sd, -)
  $LOCAL -Atc "select format('alter table public.%I alter column %I drop not null;', c.relname, a.attname) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname||'.'||a.attname in ($IN)" > "$WORK/relax.sql"
  $LOCAL -Atc "select case when d.adbin is null then format('-- %s.%s : pas de valeur par défaut, reste facultative', c.relname, a.attname) else format('update public.%1\$I set %2\$I = %3\$s where %2\$I is null; alter table public.%1\$I alter column %2\$I set not null;', c.relname, a.attname, pg_get_expr(d.adbin, d.adrelid)) end from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where n.nspname='public' and c.relname||'.'||a.attname in ($IN)" > "$WORK/restore_rules.sql"
  docker compose cp "$WORK/relax.sql" db:/tmp/relax.sql; docker compose cp "$WORK/restore_rules.sql" db:/tmp/restore_rules.sql
  docker compose exec -T db psql -U office_manager -d office_manager -v ON_ERROR_STOP=1 -q -1 -f /tmp/relax.sql > /dev/null
fi
# --disable-triggers: the rows are copied as they are (no journal entry, no stamp rewritten); --single-transaction: all or nothing.
RESTORED=0
docker compose exec -T db pg_restore -U office_manager -d office_manager --data-only --disable-triggers --single-transaction --no-owner /tmp/public.dump || RESTORED=$?
if [ -n "$RELAX" ]; then
  docker compose exec -T db psql -U office_manager -d office_manager -v ON_ERROR_STOP=1 -q -1 -f /tmp/restore_rules.sql > /dev/null
  echo "   Colonnes obligatoires sur le serveur, vides chez Supabase (valeur par défaut mise) :"; echo "$RELAX" | sed 's/^/     /'
  grep '^--' "$WORK/restore_rules.sql" | sed 's/^-- /     /' || true
  docker compose exec -T db rm -f /tmp/relax.sql /tmp/restore_rules.sql
fi
docker compose exec -T db rm -f /tmp/public.dump
if [ "$RESTORED" != 0 ]; then echo "ARRÊT : la copie des données a échoué, rien n'a été copié (tout ou rien). Envoyez ce message."; exit 1; fi

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
