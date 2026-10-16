#!/usr/bin/env bash
set -euo pipefail

# Output goes to journald through the systemd unit (unit: lms-backup.service).
log() { printf '[backup %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

: "${DOMAIN:?}" "${AWS_REGION:?}" "${BACKUP_BUCKET:?}"

BENCH_DIR=/home/frappe/frappe-bench
BACKUP_DIR="sites/$DOMAIN/private/backups"
RETAIN_DAYS=3

cid=$(docker ps -q \
  --filter label=com.docker.compose.project=lms \
  --filter label=com.docker.compose.service=backend | head -n1)
[[ -n $cid ]] || die "backend container is not running"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

log "running bench backup for $DOMAIN"
docker exec "$cid" bench --site "$DOMAIN" backup --with-files

stamp=$(docker exec "$cid" bash -c \
  "ls -1 '$BACKUP_DIR' | grep -E '^[0-9]{8}_[0-9]{6}-' | cut -d- -f1 | sort | tail -n1")
[[ -n $stamp ]] || die "no backup files found in $BACKUP_DIR"

mapfile -t files < <(docker exec "$cid" bash -c "cd '$BACKUP_DIR' && ls -1 '$stamp'-*")
[[ ${#files[@]} -gt 0 ]] || die "no files for backup set $stamp"

for f in "${files[@]}"; do
  docker cp "$cid:$BENCH_DIR/$BACKUP_DIR/$f" "$tmp/$f"
done
compgen -G "$tmp/*-database.sql.gz" >/dev/null || die "database dump missing from backup set $stamp"

dest="s3://$BACKUP_BUCKET/backups/$(date -u +%Y/%m/%d-%H%M%S)/"
log "uploading ${#files[@]} files to $dest"
for f in "${files[@]}"; do
  aws s3 cp "$tmp/$f" "$dest" --region "$AWS_REGION" --only-show-errors
  log "uploaded $f"
done

docker exec "$cid" find "$BACKUP_DIR" -type f -mtime +"$RETAIN_DAYS" -delete
log "backup complete"
