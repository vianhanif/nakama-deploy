#!/usr/bin/env bash
# Prepare the native daily driver's data dir and secret. Idempotent: an existing
# NAKAMA_SECRETS_KEY is never regenerated (rotating it makes stored secrets
# unreadable).
set -euo pipefail

: "${NAKAMA_DATA_DIR:=$HOME/Data/nakama}"
ENV_FILE="$NAKAMA_DATA_DIR/.env"

mkdir -p "$NAKAMA_DATA_DIR"/{sqlite,logs}

if [ -f "$ENV_FILE" ] && grep -q '^NAKAMA_SECRETS_KEY=.\+' "$ENV_FILE"; then
  echo "[local-init] secret already present — leaving it alone"
else
  umask 077
  printf 'NAKAMA_SECRETS_KEY=%s\n' "$(openssl rand -base64 32)" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "[local-init] generated NAKAMA_SECRETS_KEY in $ENV_FILE"
  echo "[local-init] back this up — losing it makes stored secrets unreadable"
fi

echo "[local-init] data dir: $NAKAMA_DATA_DIR"
