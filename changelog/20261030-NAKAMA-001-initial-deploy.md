# 2026-10-30 — NAKAMA-001 — Initial local k3s deployment

## Summary
First working deployment of Nakama from our fork on local k3s (Colima).

## Changes
- Fork `ahmadrosid/nakama` → `vianhanif/nakama`
- `src/nakama/Dockerfile`: upstream Dockerfile + `source` stage that fetches the fork at `NAKAMA_VERSION`
- `base/`: kustomize namespace, 1 Gi PVC, ClusterIP service, Deployment (1 replica, `Recreate`)
- `overlays/local/`: NodePort 30431 + gitignored secret
- `Makefile`: validate/build/up/test/down/reset, kubectl pinned to `colima`
- CI: `build-test.yml` (build + boot-check), `ghcr-pull-test.yml`, Dependabot

## Verification
| Check | Result |
|---|---|
| Image build from fork | ✅ 250 MB |
| `GET /health` | ✅ 200 |
| Dashboard HTML | ✅ |
| Setup API | ✅ 200 |
| NodePort 30431 | ✅ 200 |
| Data survives pod restart | ✅ marker + health 200 |

## Decisions
- SQLite kept container-local; no external DB. Replica count fixed at 1.
- Updater service **not** deployed (Docker socket = root-equivalent).
- Backups deferred; PVC is the only copy until then.
- LLM provider configured in-app via `openai_compatible` → 9router, not baked into manifests.

## Risks
- Loss of `NAKAMA_SECRETS_KEY` makes stored secrets unreadable. Offline copy required.
- No HA story while SQLite is the store.
