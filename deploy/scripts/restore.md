# Restore from S3

Run as root on the instance. The site must exist, so run `deploy.sh <ref>` first on a fresh host.

    set -a; . /opt/lms/.env; set +a
    . /opt/lms/secrets.env
    aws s3 ls "s3://$BACKUP_BUCKET/backups/" --recursive | tail
    P=2026/10/16-180000
    mkdir -p /tmp/restore && aws s3 cp "s3://$BACKUP_BUCKET/backups/$P/" /tmp/restore/ --recursive --region "$AWS_REGION"
    cid=$(docker ps -q --filter label=com.docker.compose.project=lms --filter label=com.docker.compose.service=backend)
    docker cp /tmp/restore "$cid:/tmp/restore"
    docker exec -e DOMAIN -e DB_ROOT_PASSWORD="$DB_ROOT_PASSWORD" "$cid" bash -c '
      cd /tmp/restore
      pub=$(ls ./*-files.tar | grep -v -- -private-files.tar)
      bench --site "$DOMAIN" restore ./*-database.sql.gz \
        --with-public-files "$pub" --with-private-files ./*-private-files.tar \
        --db-root-username root --db-root-password "$DB_ROOT_PASSWORD"
      bench --site "$DOMAIN" migrate'
    docker exec "$cid" rm -rf /tmp/restore && rm -rf /tmp/restore

Notes:

- Restore overwrites the site database and files. Take a fresh backup first if the site still has data.
- `*-site_config_backup.json` is kept for reference; do not copy it over `site_config.json` (it holds the db password of the old site).
