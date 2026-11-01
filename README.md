# nakama-deploy

Self-hosted [Nakama](https://github.com/ahmadrosid/nakama) — AI agent platform for teams — packaged
for reproducible deployment from **our fork** (`vianhanif/nakama`).

Follows the same supply-chain pattern as [`9router-deploy`](https://github.com/vianhanif/9router-deploy):
the image is built by us from a pinned ref of our fork, then deployed from a pinned tag.

- **Upstream:** MIT, single container, SQLite, ~200 MB idle
- **This repo owns:** Dockerfile, manifests, image tagging, changelog
- **Not deployed:** upstream's `updater` service (it mounts the Docker socket)

## Status

Tested end-to-end on local k3s (Colima), 2026-11-01:

| Check | Result |
|---|---|
| Image builds from fork | ✅ 250 MB |
| `GET /health` | ✅ 200 |
| Dashboard serves HTML | ✅ |
| Setup API responds | ✅ 200 |
| NodePort 30431 reachable | ✅ 200 |
| Data survives pod restart | ✅ marker + health 200 |

Native pm2 driver, 2026-11-01:

| Check | Result |
|---|---|
| `make local-build` (fork, `main`) | ✅ |
| `pm2` app online, 0 restarts | ✅ |
| `GET /health` on :4310 | ✅ 200 |
| Measured RSS (server + worker) | **259–364 MB** |

## Requirements

Two runtimes, same source pin. Pick per task:

| | Native (daily) | Image + k3s (parity) |
|---|---|---|
| Needs | `bun` | Docker with BuildKit, `kubectl`, `kustomize` |
| Idle RAM | **~365 MB** (measured) | ~2 GB (Colima VM) |
| Startup | ~2 s | ~40 s |
| Use for | day-to-day work | validating what we would ship |

```bash
# native daily driver
brew install oven-sh/bun/bun

# image path (optional)
brew install colima kustomize docker-buildx
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

### Native daily driver (pm2, no Docker)

| Target | Effect |
|---|---|
| `make local-init` | Create `~/Data/nakama` + secret (idempotent; never regenerates an existing key) |
| `make local-build` | Clone/checkout the fork at `NAKAMA_VERSION`, build all bundles |
| `make local-up` | `pm2 start` in namespace `nakama`, then health-check |
| `make local-restart` / `local-down` | Restart / stop + clean worker |
| `make local-logs` / `local-status` / `local-test` | Observe |

### Image + cluster (parity)

| Target | Effect |
|---|---|
| `make validate` | Render manifests + client dry-run. No cluster changes. |
| `make build` | Build image from fork. `NAKAMA_VERSION=<sha>` pins the ref. |
| `make up` | Apply to the cluster, wait for rollout. |
| `make test` | Health check + **pod restart persistence check**. |
| `make logs` / `make shell` | Follow logs / exec into pod. |
| `make down` | Delete resources, keep the PVC. |
| `make reset` | Delete the namespace — **destroys the SQLite volume**. |

All cluster targets pin `--context colima` (`KUBE_CONTEXT=` overrides). This is deliberate: the same
kubeconfig also carries production EKS contexts, and an accidental apply there is not recoverable.

### Why two runtimes

`scripts/local-build.sh` runs the same fork, the same ref, and the same build steps as
`src/nakama/Dockerfile`. If those two disagree, the daily driver is running something the image
does not — treat it as a bug, not a preference.

Native is the daily driver because Colima's VM costs ~1–1.5 GB before any workload runs. The image
path stays the source of truth for "would this work when we ship it".

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

## Native driver notes

- Data and secret live in `~/Data/nakama` (`NAKAMA_DATA_DIR` to override), never in the repo.
  The secret is a `0600` env file; `make local-init` will not regenerate an existing key.
- Nakama's server supervises an `automation` worker **through the shared pm2 daemon**, so that
  worker shows up in `pm2 list` under the `default` namespace. `make local-down` deletes it too.
- Logs: `~/Data/nakama/logs/{out,error}.log`.
- Survives crashes (`autorestart`), not reboots — add `pm2 save` if you want `pm2 resurrect`.

## Adding an MCP server (Lark example)

Nakama's MCP client accepts two transports (`apps/server/src/services/mcp-client-manager.ts`):

| Transport | Config shape |
|---|---|
| `http` | `{ "url": "...", "headers": {...} }` |
| `stdio` | `{ "command": "/abs/path", "args": [...], "env": {...} }` |

Two behaviours to know before wiring a stdio server:

1. **The child inherits a filtered env** — only `HOME, LOGNAME, PATH, SHELL, TERM, USER` plus
   whatever you put in `config.env`. A binary that lives outside those PATH entries will not be found.
2. **`HOME` is the data dir** (`~/Data/nakama`, set by the pm2 ecosystem file), not the real home.
   Any `source "$HOME/..."` in a wrapper breaks. Resolve the real home from the passwd db instead:
   `eval echo "~$(id -un)"`.

Also: `cwd` is set to the profile's soul dir when both `orgId` and `profileId` are known, so every
path in `command`/`args` must be **absolute**.

### Reference: Lark/Feishu chat MCP

Wrapper — credentials never go into the Nakama UI or its DB, and stdout stays reserved for MCP
(any log line must go to stderr):

`~/.config/nakama/lark-mcp.sh` (mode 0700, outside this repo):

```zsh
#!/bin/zsh
REAL_HOME=$(eval echo "~$(id -un)")
[ -r "$REAL_HOME/.zsh/secrets.zsh" ] && source "$REAL_HOME/.zsh/secrets.zsh" >/dev/null 2>&1
export APP_ID="${LARK_APP_ID:-$APP_ID}" APP_SECRET="${LARK_APP_SECRET:-$APP_SECRET}"
[ -z "$APP_ID" ] && { echo "lark-mcp: missing credentials" >&2; exit 1; }
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"   # npx needs node
exec npx -y @larksuiteoapi/lark-mcp@0.5.1 mcp \
  -t im.v1.message.list,im.v1.chat.list --domain https://open.larksuite.com
```

Register it (Control Center → MCP, or the API). `POST /v1/mcp/servers`:

```json
{
  "name": "lark",
  "transport": "stdio",
  "enabled": true,
  "connect": true,
  "config": { "command": "/Users/<you>/.config/nakama/lark-mcp.sh" }
}
```

Dry-run first with `POST /v1/mcp/servers/test` and the same `transport` + `config`; it returns the
tool list without persisting anything. Expect `im_v1_chat_list` and `im_v1_message_list`.

Attach the server to an agent profile afterwards — registering alone does not grant a profile access.

### Verified 2026-11-02

Ran the wrapper under the same env the MCP client produces (`HOME=~/Data/nakama`,
`PATH=/usr/bin:/bin:/usr/sbin:/sbin`) and drove a raw JSON-RPC handshake over stdin:

| Step | Result |
|---|---|
| `initialize` | ✅ `lark-mcp-server 0.5.1` |
| `tools/list` | ✅ `im_v1_chat_list`, `im_v1_message_list` |

The `[WARN] StorageManager ... unknown error` lines on stderr are the built-in OAuth token store
failing to reach a keychain in a headless child — harmless, the app-credential path works.

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
├── scripts/
│   ├── local-build.sh      # native build: same fork, ref and steps as the image
│   ├── local-init.sh       # ~/Data/nakama + NAKAMA_SECRETS_KEY (idempotent)
│   └── pm2/ecosystem.nakama.config.js
├── base/                   # kustomize: namespace, pvc, service, deployment
├── overlays/local/         # NodePort 30431 + secret.yaml (gitignored)
├── env/                    # environment templates
├── changelog/              # one entry per change
└── .github/workflows/      # build-test, ghcr-pull-test
```

## License

Deployment configuration: MIT. Upstream Nakama: MIT.
