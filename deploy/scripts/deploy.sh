#!/usr/bin/env bash
set -euo pipefail

export HOME=${HOME:-/root}

REPO_DIR=/opt/lms-repo
ENV_FILE=/opt/lms/.env
SECRETS_FILE=/opt/lms/secrets.env
STATE_FILE=/opt/lms/deployed-image-id
LOCK_FILE=/var/lock/lms-deploy.lock
HEALTH_TIMEOUT=900
COMPOSE_FILE="$REPO_DIR/deploy/docker-compose.prod.yml"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

dc() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --env-file "$SECRETS_FILE" "$@"
}

get_param() {
  aws ssm get-parameter --name "$1" --with-decryption --region "$AWS_REGION" \
    --query Parameter.Value --output text
}

write_secrets() {
  local db_pw admin_pw tmp
  db_pw=$(get_param "$SSM_DB_ROOT_PASSWORD_PARAM")
  admin_pw=$(get_param "$SSM_ADMIN_PASSWORD_PARAM")
  for v in "$db_pw" "$admin_pw"; do
    if [[ -z $v || $v == *"'"* || $v == *$'\n'* ]]; then
      die "a fetched secret is empty or contains a single quote or newline"
    fi
  done
  tmp=$(mktemp /opt/lms/.secrets.XXXXXX)
  chmod 600 "$tmp"
  printf "DB_ROOT_PASSWORD='%s'\nADMIN_PASSWORD='%s'\n" "$db_pw" "$admin_pw" > "$tmp"
  mv -f "$tmp" "$SECRETS_FILE"
}

checkout_ref() {
  local ref=$1
  git -C "$REPO_DIR" config core.fileMode false
  git -C "$REPO_DIR" fetch --all --prune --tags --force
  if git -C "$REPO_DIR" show-ref --verify --quiet "refs/remotes/origin/$ref"; then
    git -C "$REPO_DIR" checkout -f -B "$ref" "origin/$ref"
    git -C "$REPO_DIR" reset --hard "origin/$ref"
  elif git -C "$REPO_DIR" show-ref --verify --quiet "refs/tags/$ref"; then
    git -C "$REPO_DIR" checkout -f --detach "refs/tags/$ref"
  else
    git -C "$REPO_DIR" checkout -f --detach "$ref"
  fi
  chmod +x "$REPO_DIR"/deploy/scripts/*.sh
}

rewrite_image_tag() {
  local tag=$1 base last repo new
  base=${LMS_IMAGE%%@*}
  last=${base##*/}
  if [[ $last == *:* ]]; then repo=${base%:*}; else repo=$base; fi
  new="$repo:$tag"
  if grep -q '^LMS_IMAGE=' "$ENV_FILE"; then
    sed -i "s|^LMS_IMAGE=.*|LMS_IMAGE=$new|" "$ENV_FILE"
  else
    printf 'LMS_IMAGE=%s\n' "$new" >> "$ENV_FILE"
  fi
  LMS_IMAGE=$new
  log "LMS_IMAGE set to $LMS_IMAGE"
}

site_ping() {
  local out
  out=$(dc exec -T caddy wget -q -T 5 -O - --header "Host: $DOMAIN" \
    "http://frontend:8080/api/method/ping" 2>/dev/null || true)
  [[ $out == *pong* ]]
}

dump_diagnostics() {
  log "docker compose ps:" >&2
  dc ps -a >&2 || true
  log "recent logs:" >&2
  dc logs --no-color --tail 60 >&2 || true
}

wait_healthy() {
  local deadline cid state ping_ok=no created=no
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while (( $(date +%s) < deadline )); do
    created=no
    state=
    cid=$(dc ps -a -q create-site 2>/dev/null || true)
    if [[ -n $cid ]]; then
      state=$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$cid" 2>/dev/null || true)
      if [[ $state == exited* && $state != "exited 0" ]]; then
        dump_diagnostics
        die "create-site failed ($state)"
      fi
      if [[ $state == "exited 0" ]]; then created=yes; fi
    fi
    ping_ok=no
    if site_ping; then ping_ok=yes; fi
    if [[ $ping_ok == yes && $created == yes ]]; then
      log "site $DOMAIN is healthy"
      return 0
    fi
    sleep 10
  done
  dump_diagnostics
  die "site did not become healthy within ${HEALTH_TIMEOUT}s (site_ping ok: $ping_ok, create-site exited 0: $created, create-site state: ${state:-none})"
}

migrate_if_image_changed() {
  local current previous
  current=$(docker image inspect -f '{{.Id}}' "$LMS_IMAGE")
  previous=$(cat "$STATE_FILE" 2>/dev/null || true)
  if [[ -n $previous && $previous != "$current" ]]; then
    log "image changed, running bench migrate"
    dc exec -T backend bench --site "$DOMAIN" migrate
  fi
  printf '%s\n' "$current" > "$STATE_FILE"
}

install_backup_units() {
  install -m 0644 "$REPO_DIR/deploy/systemd/lms-backup.service" /etc/systemd/system/lms-backup.service
  install -m 0644 "$REPO_DIR/deploy/systemd/lms-backup.timer" /etc/systemd/system/lms-backup.timer
  systemctl daemon-reload
  systemctl enable --now lms-backup.timer
}

# Everything lives in main so bash has parsed the whole body before git
# checkout rewrites this file on disk.
main() {
  local ref=${1:-} image_tag=${2:-}
  [[ -n $ref ]] || die "usage: deploy.sh <git-ref> [image-tag]"
  [[ $(id -u) -eq 0 ]] || die "must run as root"
  [[ $ref =~ ^[A-Za-z0-9._/][A-Za-z0-9._/-]*$ ]] || die "invalid git ref"
  [[ -z $image_tag || $image_tag =~ ^[A-Za-z0-9._][A-Za-z0-9._-]*$ ]] || die "invalid image tag"

  exec 9>"$LOCK_FILE"
  log "acquiring deploy lock"
  flock -w 900 9 || die "another deploy is running"

  log "step 1/7: load $ENV_FILE"
  [[ -f $ENV_FILE ]] || die "$ENV_FILE not found"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  : "${DOMAIN:?}" "${AWS_REGION:?}" "${LMS_IMAGE:?}"
  : "${SSM_DB_ROOT_PASSWORD_PARAM:?}" "${SSM_ADMIN_PASSWORD_PARAM:?}"
  if [[ -n $image_tag ]]; then
    rewrite_image_tag "$image_tag"
  fi

  log "step 2/7: checkout $ref"
  checkout_ref "$ref"
  log "now at $(git -C "$REPO_DIR" rev-parse --short HEAD)"

  log "step 3/7: fetch secrets from SSM"
  write_secrets

  log "step 4/7: pull images"
  dc pull

  log "step 5/7: start stack"
  dc up -d --remove-orphans

  log "step 6/7: wait for site health (up to ${HEALTH_TIMEOUT}s)"
  wait_healthy
  migrate_if_image_changed

  log "step 7/7: install backup timer and clean up"
  install_backup_units
  docker image prune -f >/dev/null
  dc ps
  log "deploy finished"
}

main "$@"; exit $?
