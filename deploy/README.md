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
2. The `Deploy LMS` workflow runs the same script through SSM Run Command. See
   "Deploy triggers" below for what starts it and which image it deploys.
3. The script reads `/opt/lms/.env`, checks out the ref, writes `/opt/lms/secrets.env`
   from SSM (mode 600), pulls images, and, when the pulled image differs from the
   last deployed one (`/opt/lms/deployed-image-id`) and the backend is running, runs
   `backup.sh` before touching the stack (a failed backup aborts the deploy). It then
   runs `up -d`, waits up to 10 minutes for `/api/method/ping`, and runs
   `bench migrate` when the image changed.
4. The site is created by `create-site`. If the site already exists, it installs any
   missing `payments` or `lms` app, so a partially created site is repaired.

The DB root password only takes effect when the `db-data` volume is first created.

## Deploy triggers

- After merge to main, `Build LMS image` builds and pushes `ghcr.io/18phongnguyen/terada-lms:main` and `:sha-<7char>`. When that run succeeds and was started by a push, `Deploy LMS` starts (`workflow_run`) and deploys ref `main` with image tag `sha-<7char>` of the commit the build ran on. `deploy.sh` rewrites `LMS_IMAGE` in `/opt/lms/.env` to that tag, backs up, recreates containers and runs `bench migrate` because the image changed. A failed or cancelled build deploys nothing; a dispatched build never deploys itself.
- A push to main touching only `deploy/**` (`Build LMS image` ignores those paths) runs `Deploy LMS` without an image tag: new deploy files, same pinned image. A push touching both app code and `deploy/**` deploys twice: first the deploy files with the old image, then the new image when the build finishes.
- Manual dispatch (rollback, redeploy): `image_tag` is required. The workflow fails before touching the instance if it is empty or the tag is not in GHCR. To redeploy what is running, pass the tag pinned in `/opt/lms/.env` (shown in the previous run's summary and in the deploy log line `LMS_IMAGE set to ...`). For example:

      gh workflow run "Deploy LMS" -f image_tag=sha-1a2b3c4

- Why the tag is required: on 2026-10-21 a dispatch without `image_tag` redeployed the pinned `sha-6487cf3` and reported success while main had newer builds.
- Deploys share the `deploy-lms` concurrency group: one runs at a time, and a newer queued deploy replaces an older queued one. Re-running an old successful `Build LMS image` run redeploys that older image (a way to roll back, but do it on purpose).
- The `workflow_run` trigger only takes effect from the copy of `deploy.yml` on the default branch.

## LMS image

The official `ghcr.io/frappe/lms` image is broken (it contains only frappe, without lms and payments). The image is built by the `Build LMS image` workflow into GHCR as `ghcr.io/18phongnguyen/terada-lms`, from the fork https://github.com/18PhongNguyen/terada-lms. The GHCR package is private: the instance pulls with its own registry credentials, and `Deploy LMS` checks that a tag exists by logging in with the job token (`packages: read`).

Build with `frappe_branch` and `payments_ref` set to `develop` (the workflow defaults). The fork's frontend imports `useDataImport` and `DataImportWizard` from `@framework/ui`, which exist only on frappe `develop`; on `version-16` `vite build` fails with `"useDataImport" is not exported by node_modules/@framework/ui/src/components/DataImport/index.ts`.

The fork repository is private. `git clone` on the instance (`repo_url`) and the image build both need read access to it (a deploy key or token), or make the repository public.

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
