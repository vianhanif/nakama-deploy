# nakama-deploy

Self-hosted [Nakama](https://github.com/ahmadrosid/nakama) — AI agent platform for teams — packaged
for reproducible deployment from **our fork** (`vianhanif/nakama`).

Follows the same supply-chain pattern as [`9router-deploy`](https://github.com/vianhanif/9router-deploy):
the image is built by us from a pinned ref of our fork, then deployed from a pinned tag.

- **Upstream:** MIT, single container, SQLite, ~200 MB idle
- **This repo owns:** Dockerfile, manifests, image tagging, changelog
- **Not deployed:** upstream's `updater` service (it mounts the Docker socket)

## Status

Tested end-to-end on local k3s (Colima), 2026-10-30:

| Check | Result |
|---|---|
| Image builds from fork | ✅ 250 MB |
| `GET /health` | ✅ 200 |
| Dashboard serves HTML | ✅ |
| Setup API responds | ✅ 200 |
| NodePort 30431 reachable | ✅ 200 |
| Data survives pod restart | ✅ marker + health 200 |

## Requirements

- Docker with BuildKit (`docker buildx`) — on macOS: `brew install docker-buildx`
- `kubectl`, `kustomize`
- A local cluster. Colima with k3s is enough:

```bash
brew install colima kustomize
colima start --cpu 4 --memory 4 --kubernetes
```

## Quick start

```bash
git clone https://github.com/vianhanif/nakama-deploy.git
cd nakama-deploy

# 1. Secret (required — the server refuses to start without it)
mkdir -p overlays/local
cat > overlays/local/secret.yaml <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: nakama-secret
  namespace: nakama
type: Opaque
stringData:
  NAKAMA_SECRETS_KEY: "$(openssl rand -base64 32)"
EOF

# 2. Build from the fork and deploy
make build
make up

# 3. Open the dashboard
open http://localhost:30431
```

`make help` lists every target.

## Make targets

| Target | Effect |
|---|---|
| `make validate` | Render manifests + client dry-run. No cluster changes. |
| `make build` | Build image from fork. `NAKAMA_VERSION=<sha>` pins the ref. |
| `make up` | Apply to the cluster, wait for rollout. |
| `make test` | Health check + **pod restart persistence check**. |
| `make logs` / `make shell` | Follow logs / exec into pod. |
| `make down` | Delete resources, keep the PVC. |
| `make reset` | Delete the namespace — **destroys the SQLite volume**. |

All targets pin `--context colima` (`KUBE_CONTEXT=` overrides). This is deliberate: the same
kubeconfig also carries production EKS contexts, and an accidental apply there is not recoverable.

## Architecture

```
                     NodePort 30431
                          │
                    Service/nakama :4310
                          │
              ┌───────────┴────────────┐
              │ Deployment/nakama (1)  │
              │  image: nakama:local   │
              │  probes: GET /health   │
              │  strategy: Recreate    │
              └───────────┬────────────┘
                          │ /nakama/data
                    PVC nakama-data 1Gi
                     (SQLite + plugins)
```

**Replica count is fixed at 1.** SQLite is a single-writer store; two pods sharing the volume
corrupt it. `strategy: Recreate` ensures the old pod releases the volume before the new one starts.

## Configuration

| Variable | Source | Notes |
|---|---|---|
| `NAKAMA_SECRETS_KEY` | Secret | Base64 32 bytes. **Never rotate casually** — it decrypts stored secrets. |
| `NAKAMA_CONFIG_DIR` | Deployment | `/nakama/data` |
| `DATABASE_URL` | Deployment | `file:/nakama/data/sqlite/nakama.sqlite` |
| `NAKAMA_SEED_ADMIN_*` | Secret (optional) | Skips the first-boot wizard when all three are set. |

LLM provider: configure in **Control Center → AI providers** using the `openai_compatible` provider
pointed at the 9router gateway. No key is baked into the image or manifests.

## Deliberate omissions

- **Updater service** — upstream's convenience updater mounts `/var/run/docker.sock`, which is
  root-equivalent on the host. Upgrades here go through `kubectl set image`.
- **Ingress/TLS** — NodePort is enough locally. Add an overlay when there is a real hostname.
- **Backups** — the PVC is the only copy today. Add a second PVC on `NAKAMA_BACKUP_DIR` before
  putting real data in it.
- **HA** — blocked by SQLite. Out of scope until the storage question is re-examined.

## Risks

| Risk | Mitigation |
|---|---|
| Loss of `NAKAMA_SECRETS_KEY` → encrypted secrets unreadable | Key stored in cluster Secret + offline copy in password manager |
| Young, fast-moving upstream | We build from our fork at pinned refs; upgrade is a deliberate PR |
| We own patching | Dependabot on base images; `make build && make test` before tagging |
| Agent tool access = write access to connected systems | Do not connect production channel tokens until permissions are reviewed |

## Repository layout

```
nakama-deploy/
├── src/nakama/Dockerfile   # upstream Dockerfile + fork-fetch source stage
├── base/                   # kustomize: namespace, pvc, service, deployment
├── overlays/local/         # NodePort 30431 + secret.yaml (gitignored)
├── env/                    # environment templates
├── changelog/              # one entry per change
└── .github/workflows/      # build-test, ghcr-pull-test
```

## License

Deployment configuration: MIT. Upstream Nakama: MIT.
