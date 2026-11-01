# AGENTS.md — nakama-deploy

## What this repo is
Deployment packaging for the Nakama AI-agent platform. Source lives in our fork
(`vianhanif/nakama`); this repo owns the image build, manifests, and upgrade discipline.

## Hard rules
- **Never** apply to a non-local cluster. All kubectl calls pin `--context colima`.
  The same kubeconfig carries production EKS contexts.
- **Never** commit `overlays/local/secret.yaml` or any real `NAKAMA_SECRETS_KEY`.
- **Never** add the upstream `updater` service: it mounts the host Docker socket.
- **Never** set `replicas > 1`: SQLite single-writer. Corruption risk.
- **Never** use `:latest` in a deployment manifest. Pin a tag or SHA.

## Two runtimes, one pin
- Native daily driver: `make local-*` → pm2, `~/Data/nakama`, ~365 MB.
- Image/cluster: `make build|up|test` → k3s in Colima, ~2 GB.
- Both take `NAKAMA_VERSION`. `scripts/local-build.sh` must mirror
  `src/nakama/Dockerfile` steps. Divergence is a bug.

## pm2 quirks
- Nakama spawns its own `automation` worker on the shared pm2 daemon (namespace `default`).
  `make local-down` removes it. Do not "clean up" the daemon by killing unknown apps blindly.
- `~/.zsh` holds only thin aliases; the ecosystem file lives in this repo.

## Supply chain
`src/nakama/Dockerfile` = upstream Dockerfile + a `source` stage that fetches the fork.
`NAKAMA_VERSION` selects branch or SHA. CI passes a resolved SHA.

## Before tagging a release
1. `make validate`
2. `make build && make up && make test`
3. Update `changelog/{YYYYMMDD}-NAKAMA-{n}-{title}.md`
