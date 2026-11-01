#!/usr/bin/env bash
# Native build for the pm2 daily driver.
#
# Mirrors src/nakama/Dockerfile exactly: same fork, same ref, same build steps.
# If this script and the Dockerfile disagree, the daily driver is running
# something the image does not — treat that as a bug.
set -euo pipefail

: "${NAKAMA_SRC:=$HOME/Documents/personal/github/nakama}"
: "${NAKAMA_REPO:=https://github.com/vianhanif/nakama.git}"
: "${NAKAMA_VERSION:=main}"

command -v bun >/dev/null || { echo "bun missing: brew install oven-sh/bun/bun" >&2; exit 1; }

echo "[local-build] fork=$NAKAMA_REPO ref=$NAKAMA_VERSION"

if [ ! -d "$NAKAMA_SRC/.git" ]; then
  mkdir -p "$(dirname "$NAKAMA_SRC")"
  git clone --depth 1 --branch "$NAKAMA_VERSION" "$NAKAMA_REPO" "$NAKAMA_SRC"
else
  git -C "$NAKAMA_SRC" fetch --depth 1 origin "$NAKAMA_VERSION"
  # Detached checkout keeps the tree matching the pin instead of a local branch.
  git -C "$NAKAMA_SRC" checkout --detach FETCH_HEAD
fi

echo "[local-build] ref now: $(git -C "$NAKAMA_SRC" rev-parse --short HEAD)"

cd "$NAKAMA_SRC"

# --ignore-scripts matches the Dockerfile: postinstall hooks are not part of the
# artifact we ship.
bun install --frozen-lockfile --ignore-scripts

for pkg in "@nakama/web" "@nakama/server" "@nakama/automation" "@nakama/telegram" \
           "@nakama/whatsapp" "@nakama/discord" "@nakama/slack" "@nakama/teams"; do
  echo "[local-build] $pkg"
  bun run --filter "$pkg" build
done

test -f apps/server/dist/index.js || { echo "server bundle missing" >&2; exit 1; }
echo "[local-build] OK"
