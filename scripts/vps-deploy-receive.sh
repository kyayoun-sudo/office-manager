#!/usr/bin/env bash
# RECEIVE A DEPLOYMENT FROM GITHUB ON THE FIRM'S SERVER (VPS) — 2026-11-16.
# Installed on the server as /usr/local/bin/office-manager-deploy and tied to ONE SSH key in root's authorized_keys:
#   command="/usr/local/bin/office-manager-deploy",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 …
# That key can do nothing else: GitHub sends « deploy <sha> » and the code as a tar archive on standard input.
# Steps, all or nothing for the code:
#   1. checks the archive (size, application files present) in a separate folder;
#   2. if the SQL of the application changed: night-style dump of the base, the new SQL tried first on a throwaway copy of
#      the structure, then applied for real (it only adds: tables, columns, functions — INSTALL_TOUT.sql is replayable);
#   3. copy of the current code kept in backups/, new code put in place (.env, backups, local overrides never touched);
#   4. application rebuilt; every service whose settings changed is restarted (docker compose up -d), /api/health must answer with the database within 90 s;
#   5. otherwise the previous code is put back and restarted, and the job fails (the SQL additions stay: they only add).
# The file in the repository is the reference; after changing it, reinstall it on the server (see docs/DEPLOIEMENT_AUTOMATIQUE.md).
set -euo pipefail
APP=/opt/office-manager
MAX_BYTES=$((300 * 1024 * 1024))

REQ="${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "$REQ" =~ ^deploy\ ([0-9a-f]{40})$ ]]; then echo "REFUS : commande inattendue (attendu : deploy <sha>)."; exit 2; fi
SHA="${BASH_REMATCH[1]}"

exec 9>/var/lock/office-manager-deploy.lock
flock -w 900 9 || { echo "REFUS : un autre déploiement est en cours."; exit 3; }

STAMP=$(date +%Y%m%d-%H%M%S)
NEW=$(mktemp -d /opt/office-manager-recu.XXXXXX)
trap 'rm -rf "$NEW"' EXIT
cd "$APP"

echo "1/5 Réception de la version ${SHA:0:7}…"
head -c "$MAX_BYTES" | tar -x --no-same-owner -C "$NEW"
for f in docker-compose.yml Dockerfile server/index.mjs package.json db/INSTALL_TOUT.sql; do
  [ -f "$NEW/$f" ] || { echo "REFUS : $f absent de l'archive. Rien n'a changé."; exit 4; }
done

sqlsum() { cat "$1/db/INSTALL_TOUT.sql" | sha256sum | cut -c1-64; }
if [ "$(sqlsum "$NEW")" != "$(sqlsum "$APP")" ]; then
  echo "2/5 Le SQL de l'application a changé : sauvegarde de la base, essai, puis application…"
  docker compose exec -T db pg_dump -U office_manager -d office_manager -Fc > "backups/avant-sql-$STAMP.dump"
  docker compose cp "$NEW/db/INSTALL_TOUT.sql" db:/tmp/deploy-install.sql >/dev/null
  DB="docker compose exec -T db"
  $DB dropdb -U office_manager --if-exists essai_deploiement >/dev/null 2>&1 || true
  $DB createdb -U office_manager essai_deploiement
  $DB sh -c "pg_dump -U office_manager -s office_manager | psql -q -U office_manager -d essai_deploiement" >/dev/null 2>&1
  if ! $DB psql -q -U office_manager -d essai_deploiement -v ON_ERROR_STOP=1 -f /tmp/deploy-install.sql >/dev/null 2>"backups/essai-sql-$STAMP.log"; then
    $DB dropdb -U office_manager essai_deploiement || true
    echo "ARRÊT : le nouveau SQL échoue sur une copie de la base (détail : backups/essai-sql-$STAMP.log). Rien n'a changé."
    tail -5 "backups/essai-sql-$STAMP.log"; exit 5
  fi
  $DB dropdb -U office_manager essai_deploiement
  if ! $DB psql -q -U office_manager -d office_manager -v ON_ERROR_STOP=1 -f /tmp/deploy-install.sql >/dev/null 2>"backups/sql-$STAMP.log"; then
    echo "ARRÊT : le SQL a échoué sur la vraie base (détail : backups/sql-$STAMP.log ; sauvegarde : backups/avant-sql-$STAMP.dump). Code inchangé."
    tail -5 "backups/sql-$STAMP.log"; exit 6
  fi
  $DB rm -f /tmp/deploy-install.sql
else
  echo "2/5 SQL inchangé."
fi

echo "3/5 Copie du code actuel, puis mise en place du nouveau…"
tar --exclude=./backups --exclude='./.env' --exclude='./.env.*' -czf "backups/code-avant-$STAMP.tgz" -C "$APP" .
KEEP=(--exclude=/.env --exclude='/.env.avant*' --exclude=/backups/ --exclude=/docker-compose.override.yml
      --exclude='/docker-compose.yml.avant*' --exclude=/VERSION_DEPLOYEE --exclude=/node_modules/)
rsync -a --delete "${KEEP[@]}" "$NEW/" "$APP/"
OLD_VERSION=$(cat VERSION_DEPLOYEE 2>/dev/null || echo inconnue)
echo "$SHA" > VERSION_DEPLOYEE

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS -m 5 http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"database":true'; then return 0; fi
    sleep 3
  done
  return 1
}

echo "4/5 Construction et redémarrage de l'application…"
if docker compose build app && docker compose up -d && healthy; then
  echo "5/5 En ligne : version ${SHA:0:7} (avant : ${OLD_VERSION:0:7})."
  ls -1t backups/code-avant-*.tgz 2>/dev/null | tail -n +11 | xargs -r rm -f   # keep the 10 latest code copies
  exit 0
fi

echo "ÉCHEC : l'application ne répond pas. Remise de la version précédente (${OLD_VERSION:0:7})…"
RESTORE=$(mktemp -d /opt/office-manager-retour.XXXXXX)
tar -xzf "backups/code-avant-$STAMP.tgz" -C "$RESTORE"
rsync -a --delete "${KEEP[@]}" "$RESTORE/" "$APP/"
rm -rf "$RESTORE"
echo "$OLD_VERSION" > VERSION_DEPLOYEE
docker compose build app && docker compose up -d && healthy && echo "Version précédente remise en ligne." || echo "ATTENTION : la version précédente ne répond pas non plus."
docker compose logs app --tail 30 || true
exit 7
