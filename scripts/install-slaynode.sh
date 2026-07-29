#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY="${SLAYNODE_REPOSITORY:-is2a4c/SLAYBOT}"
SOURCE_REF="${SLAYNODE_SOURCE_REF:-main}"
INSTALL_DIR="${SLAYNODE_INSTALL_DIR:-${PWD}/slaynode-worker}"
SOURCE_DIR="${SLAYNODE_SOURCE_DIR:-}"
TEMP_DIR=""
ENROLL_ENV=""

die() {
  printf 'SlayNode installer: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "$ENROLL_ENV" && -f "$ENROLL_ENV" ]]; then
    rm -f -- "$ENROLL_ENV"
  fi
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || die "Docker is not installed: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
docker info >/dev/null 2>&1 || die "Docker daemon is not running"

if [[ -z "${SLAYNODE_CONTROL_URL:-}" ]]; then
  read -r -p "SlayNode control URL (https://...): " SLAYNODE_CONTROL_URL
fi
SLAYNODE_CONTROL_URL="${SLAYNODE_CONTROL_URL%/}"
[[ -n "$SLAYNODE_CONTROL_URL" ]] || die "SLAYNODE_CONTROL_URL is required"
if [[ "$SLAYNODE_CONTROL_URL" != https://* && "${SLAYNODE_ALLOW_HTTP:-false}" != "true" ]]; then
  die "HTTPS is required. Set SLAYNODE_ALLOW_HTTP=true only for a local test control plane."
fi

mkdir -p -- "$INSTALL_DIR"
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
[[ "$INSTALL_DIR" != "/" && "$INSTALL_DIR" != "${HOME:-}" ]] || die "refusing to use a broad install directory"
if [[ ! -f "$INSTALL_DIR/.slaynode-install" ]]; then
  if [[ -n "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    die "$INSTALL_DIR is not empty and is not a managed SlayNode installation"
  fi
  : >"$INSTALL_DIR/.slaynode-install"
fi

if [[ -z "$SOURCE_DIR" ]]; then
  command -v curl >/dev/null 2>&1 || die "curl is required to download SlayNode"
  command -v tar >/dev/null 2>&1 || die "tar is required to unpack SlayNode"
  TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/slaynode-install.XXXXXX")"
  curl -fsSL --retry 3 \
    "https://github.com/${REPOSITORY}/archive/${SOURCE_REF}.tar.gz" \
    -o "$TEMP_DIR/source.tar.gz"
  mkdir "$TEMP_DIR/source"
  tar -xzf "$TEMP_DIR/source.tar.gz" -C "$TEMP_DIR/source" --strip-components=1
  SOURCE_DIR="$TEMP_DIR/source"
else
  SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"
fi

for required in Dockerfile.slaynode docker-compose.slaynode.yml package.json package-lock.json src slaynode; do
  [[ -e "$SOURCE_DIR/$required" ]] || die "source is missing $required"
done

cp "$SOURCE_DIR/Dockerfile.slaynode" "$SOURCE_DIR/docker-compose.slaynode.yml" \
  "$SOURCE_DIR/package.json" "$SOURCE_DIR/package-lock.json" \
  "$SOURCE_DIR/bot.js" "$SOURCE_DIR/jsconfig.json" "$INSTALL_DIR/"
rm -rf -- "$INSTALL_DIR/src" "$INSTALL_DIR/slaynode"
cp -R "$SOURCE_DIR/src" "$SOURCE_DIR/slaynode" "$INSTALL_DIR/"
if [[ -f "$SOURCE_DIR/.dockerignore" ]]; then
  cp "$SOURCE_DIR/.dockerignore" "$INSTALL_DIR/.dockerignore"
fi

cd "$INSTALL_DIR"
docker build \
  --file Dockerfile.slaynode \
  --tag "slaynode-worker:${SLAYNODE_IMAGE_TAG:-local}" \
  .

if [[ ! -s .env ]] || ! grep -Eq '^SLAYNODE_ID=.+$' .env || ! grep -Eq '^SLAYNODE_SECRET=.+$' .env; then
  if [[ -z "${SLAYNODE_ENROLLMENT_TOKEN:-}" ]]; then
    read -r -s -p "One-time token from /slaynode enroll: " SLAYNODE_ENROLLMENT_TOKEN
    printf '\n'
  fi
  [[ -n "$SLAYNODE_ENROLLMENT_TOKEN" ]] || die "SLAYNODE_ENROLLMENT_TOKEN is required"

  ENROLL_ENV="$INSTALL_DIR/.enroll.env"
  umask 077
  {
    printf 'SLAYNODE_CONTROL_URL=%s\n' "$SLAYNODE_CONTROL_URL"
    printf 'SLAYNODE_ENROLLMENT_TOKEN=%s\n' "$SLAYNODE_ENROLLMENT_TOKEN"
    printf 'SLAYNODE_ID=enrollment\n'
    printf 'SLAYNODE_SECRET=enrollment\n'
    printf 'SLAYNODE_PARALLELISM=%s\n' "${SLAYNODE_PARALLELISM:-1}"
    printf 'SLAYNODE_GPU=%s\n' "${SLAYNODE_GPU:-false}"
  } >"$ENROLL_ENV"

  ENROLLMENT_OUTPUT="$(
    docker compose --env-file "$ENROLL_ENV" -f docker-compose.slaynode.yml \
      run --rm --no-deps enroll
  )"
  SLAYNODE_ID="$(printf '%s\n' "$ENROLLMENT_OUTPUT" | sed -n 's/.*"nodeId": "\([^"]*\)".*/\1/p' | tail -1)"
  SLAYNODE_SECRET="$(printf '%s\n' "$ENROLLMENT_OUTPUT" | sed -n 's/.*"secret": "\([^"]*\)".*/\1/p' | tail -1)"
  [[ -n "$SLAYNODE_ID" && -n "$SLAYNODE_SECRET" ]] || die "control plane did not return worker credentials"

  {
    printf 'SLAYNODE_CONTROL_URL=%s\n' "$SLAYNODE_CONTROL_URL"
    printf 'SLAYNODE_ID=%s\n' "$SLAYNODE_ID"
    printf 'SLAYNODE_SECRET=%s\n' "$SLAYNODE_SECRET"
    printf 'SLAYNODE_PARALLELISM=%s\n' "${SLAYNODE_PARALLELISM:-1}"
    printf 'SLAYNODE_RAM_MB=%s\n' "${SLAYNODE_RAM_MB:-2048}"
    printf 'SLAYNODE_JOB_TIMEOUT_MS=%s\n' "${SLAYNODE_JOB_TIMEOUT_MS:-120000}"
    printf 'SLAYNODE_CPU_LIMIT=%s\n' "${SLAYNODE_CPU_LIMIT:-1.0}"
    printf 'SLAYNODE_MEMORY_LIMIT=%s\n' "${SLAYNODE_MEMORY_LIMIT:-3g}"
    printf 'IMAGE_SPAM_VISION_MODEL=%s\n' "${IMAGE_SPAM_VISION_MODEL:-HuggingFaceTB/SmolVLM-Instruct}"
    printf 'IMAGE_SPAM_VISION_DTYPE=%s\n' "${IMAGE_SPAM_VISION_DTYPE:-q4}"
  } >.env
  chmod 600 .env
else
  printf 'Existing SlayNode credentials found; enrollment skipped.\n'
fi

docker compose -f docker-compose.slaynode.yml up -d slaynode
CONTAINER_ID="$(docker compose -f docker-compose.slaynode.yml ps -q slaynode)"
[[ -n "$CONTAINER_ID" ]] || die "worker container was not created"

printf 'Waiting for SlayNode to connect'
for _ in {1..45}; do
  STATUS="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER_ID")"
  if [[ "$STATUS" == "healthy" ]]; then
    printf '\nSlayNode is installed and connected.\n'
    printf 'Install directory: %s\n' "$INSTALL_DIR"
    printf 'Status: cd %q && docker compose -f docker-compose.slaynode.yml ps\n' "$INSTALL_DIR"
    printf 'Logs:   cd %q && docker compose -f docker-compose.slaynode.yml logs -f slaynode\n' "$INSTALL_DIR"
    exit 0
  fi
  printf '.'
  sleep 2
done

printf '\n'
docker compose -f docker-compose.slaynode.yml logs --tail=80 slaynode >&2
die "worker did not become healthy within 90 seconds"
