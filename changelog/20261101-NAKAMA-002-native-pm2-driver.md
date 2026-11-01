# 2026-11-01 — NAKAMA-002 — Native pm2 daily driver

## Summary
Added a no-Docker runtime for daily local use, sharing the fork pin with the image build.

## Problem
The image path needs Colima, which costs ~1–1.5 GB of VM memory before any workload.
That is a poor fit for all-day use of a ~200 MB app.

## Changes
- `scripts/local-build.sh` — clone/checkout the fork at `NAKAMA_VERSION`, `bun install
  --frozen-lockfile --ignore-scripts`, build the 8 bundles. Mirrors `src/nakama/Dockerfile`.
- `scripts/local-init.sh` — creates `~/Data/nakama/{sqlite,logs}` and a `NAKAMA_SECRETS_KEY`
  env file (0600). Idempotent: never regenerates an existing key.
- `scripts/pm2/ecosystem.nakama.config.js` — namespace `nakama`, `interpreter: none`,
  `autorestart`, restart backoff, logs under the data dir.
- `Makefile` — `local-init|build|up|down|restart|logs|status|test`.
- `README`/`AGENTS` — documented the two-runtime model and the pm2 worker quirk.

## Verification
| Check | Result |
|---|---|
| `make local-build` | ✅ |
| pm2 app online, 0 restarts | ✅ |
| `/health` on :4310 | ✅ 200 |
| Measured RSS (server + automation worker) | 259–364 MB |

## Decisions
- Daily = native; image/k3s = parity check. Both pinned by `NAKAMA_VERSION`.
- pm2 ecosystem file lives **in this repo**, not `~/.zsh` — one source of truth, reviewable in PRs.
- `~/.zsh/aliases/nakama.zsh` holds only thin wrappers around `make`.

## Risks
- Nakama's internal supervisor attaches its `automation` worker to the shared pm2 daemon
  (namespace `default`). `make local-down` removes it; a manual `pm2 delete nakama` alone
  leaves the worker running.
- Native artifact is not byte-identical to the image. Mitigated by shared pin + mirrored steps,
  not by construction.
- Does not survive reboot without `pm2 save` / `pm2 resurrect`.
