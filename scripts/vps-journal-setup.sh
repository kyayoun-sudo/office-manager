#!/usr/bin/env bash
# ONE PLACE FOR THE SERVER'S LOGS AND ERRORS (VPS) — 2026-11-16 (Paul : « une partie qui écrit tous les logs erreurs »).
# Run once on the server, as root:   bash scripts/vps-journal-setup.sh
#   1. the system journal is kept on disk (it was in memory only: lost at each reboot), 30 days, 1 GB at most;
#   2. installs the command « om-erreurs »: the errors of the application, the database, the backups and nginx, in one list.
# docker-compose.yml sends the containers' logs to this journal (logging: journald), so they survive restarts and deployments.
set -euo pipefail

mkdir -p /etc/systemd/journald.conf.d /var/log/journal
cat > /etc/systemd/journald.conf.d/office-manager.conf <<'EOF'
# Office Manager (2026-11-16): logs kept on disk, 30 days, 1 GB at most.
[Journal]
Storage=persistent
SystemMaxUse=1G
MaxRetentionSec=30day
EOF
systemd-tmpfiles --create --prefix /var/log/journal
systemctl restart systemd-journald
journalctl --flush

cat > /usr/local/bin/om-erreurs <<'EOF'
#!/usr/bin/env bash
# Errors of Office Manager on this server, oldest first.
#   om-erreurs              last 24 hours
#   om-erreurs "2 days ago" since then          om-erreurs tout   every line of the application (not only errors), last 24 h
SINCE="${1:-24 hours ago}"; ALL=""
if [ "${1:-}" = "tout" ]; then SINCE="24 hours ago"; ALL=1; fi
echo "=== Application, base, sauvegardes — depuis : $SINCE"
OUT=$(journalctl --since "$SINCE" -o short-iso --no-pager \
  SYSLOG_IDENTIFIER=office-manager-app-1 + SYSLOG_IDENTIFIER=office-manager-db-1 + SYSLOG_IDENTIFIER=office-manager-backup-1 2>/dev/null)
if [ -n "$ALL" ]; then printf '%s\n' "$OUT"
else printf '%s\n' "$OUT" | grep -iE 'error|erreur|failed|échec|fatal|panic|refus|denied|exception|timeout|unhandled' || echo "(aucune erreur)"; fi
echo
echo "=== Site web (nginx) — dernières erreurs"
grep -vE 'acme-challenge|access forbidden by rule' /var/log/nginx/error.log 2>/dev/null | tail -n 20 | grep . || echo "(aucune)"
echo "(robots refusés par le pare-feu du site aujourd'hui, sans danger : $(grep -c 'access forbidden by rule' /var/log/nginx/error.log 2>/dev/null || echo 0))"
echo
echo "=== Déploiements automatiques (GitHub)"
ls -1t /opt/office-manager/backups/code-avant-*.tgz 2>/dev/null | head -3 | sed 's|.*/code-avant-|copie de code avant le déploiement du |; s|\.tgz$||' || true
echo "Version en ligne : $(cut -c1-7 /opt/office-manager/VERSION_DEPLOYEE 2>/dev/null)"
EOF
chmod 755 /usr/local/bin/om-erreurs
journalctl --disk-usage
echo "Prêt. Essayez : om-erreurs"
