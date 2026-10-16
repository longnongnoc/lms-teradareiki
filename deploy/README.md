# LMS deployment (single EC2)

Frappe LMS runs with docker compose on one t3.small (2 GiB RAM, Amazon Linux 2023).
Infrastructure (EC2, S3, SSM parameters) lives in `infra/`.

## Files

- `docker-compose.prod.yml`: db, redis-cache, redis-queue, configurator, create-site, backend, websocket, queue, scheduler, frontend, caddy
- `Caddyfile`: TLS termination (Let's Encrypt) and proxy to `frontend:8080`
- `scripts/deploy.sh <ref> [image-tag]`: idempotent deploy, run as root
- `scripts/backup.sh`: site backup uploaded to S3, run daily by `systemd/lms-backup.timer`
- `scripts/restore.md`: restore procedure

## How deploys work

1. `user_data` clones the repo to `/opt/lms-repo` and runs `deploy.sh <ref>` once.
2. The `Deploy LMS` workflow runs the same script through SSM Run Command, on dispatch
   or on push to develop/main/feature/deploy-aws-terraform touching `deploy/**`.
3. The script reads `/opt/lms/.env`, checks out the ref, writes `/opt/lms/secrets.env`
   from SSM (mode 600), pulls images, runs `up -d`, waits up to 10 minutes for
   `/api/method/ping`, and runs `bench migrate` when the image changed.
4. The site is created by `create-site`. If the site already exists, it installs any
   missing `payments` or `lms` app, so a partially created site is repaired.

The DB root password only takes effect when the `db-data` volume is first created.

## LMS image

The official `ghcr.io/frappe/lms` image is broken (it contains only frappe, without lms and payments). The image is built by the `Build LMS image` workflow into GHCR as `ghcr.io/longnongnoc/terada-lms`. The GHCR package must be public so the instance can pull it anonymously.

## Logs

- Deploy: SSM command output in the workflow log, or `/var/log/cloud-init-output.log` on first boot.
- Containers: `docker compose -f /opt/lms-repo/deploy/docker-compose.prod.yml --env-file /opt/lms/.env --env-file /opt/lms/secrets.env logs -f --tail 100 backend`
- Backups: `journalctl -u lms-backup.service`

## Manual backup

    sudo systemctl start lms-backup.service
    sudo journalctl -u lms-backup.service -n 50

## Memory notes (2 GiB)

- Limits sum to about 1.6 GiB: db 440m, backend 400m, queue 280m, scheduler 140m, websocket 120m, redis 80m x2, frontend 64m, caddy 48m.
- MariaDB uses a 256M buffer pool and 60 connections; redis caps at 64mb.
- Gunicorn runs 2 workers x 4 threads (`GUNICORN_WORKERS` / `GUNICORN_THREADS`).
- First site creation is the peak; add a swap file if `create-site` is OOM-killed.
- Check usage with `docker stats --no-stream` and `free -m`.
