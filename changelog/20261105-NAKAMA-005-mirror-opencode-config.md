# 2026-11-05 — NAKAMA-005 — Mirror the OpenCode CLI config into Nakama

## Summary
Registered the MCP servers and providers the local OpenCode CLI has, so the Nakama instance is the
same working environment rather than a second, differently-equipped one.

## Changes (live instance; nothing in this repo besides docs)
- MCP servers added: `lark-chat`, `tldraw`, `jam`, `duckdb`, `aws-mcp` — all attached to the
  `Default Bot` profile (5 → 10 servers).
- `~/.config/nakama/mcp-stdio.sh` (new, 0700): generic stdio launcher. Sets the real `HOME` (the
  MCP child gets `HOME=<data dir>`), puts `uvx`/`npx` caches outside the data root, sources
  `~/.zsh/secrets.zsh`. Used by `duckdb` and `aws-mcp`.
- Provider `9router`: added `General` (200k ctx / 32k out) and marked it default; `General_Opencode`
  kept at 128k/32k. Done with `PATCH /v1/providers/:id`.
- Provider `9router-test` created (`https://9router-test.vianhanif.link/v1`, both models), key
  written with `PUT /v1/providers/:id/secret`.

## Verification
`POST /v1/mcp/servers/test` before each create, then create:

| Server | Tools | Status |
|---|---|---|
| tldraw | 6 | connected |
| duckdb | 4 | connected |
| aws-mcp | 8 | connected |
| lark-chat | 2 | connected |
| jam | 39 | connected |

Profiles keep `model: null`, which resolves to the default provider's default model — no per-profile
model write needed.

## Follow-up bug (fixed)
Registering `lark-chat` re-created `~/Data/nakama/.npm` (6.2k files) — the MCP child gets a filtered
env that drops `npm_config_cache`, so `npx` fell back to `$HOME` = the data root. The exporter's
10k-entry cap would have started refusing backups again. `lark-mcp.sh` now pins the npm/XDG caches
to the real home; data root is back to 389 files. Any future `npx`-based server needs the same.

## Risks
- `jam`'s API key and `router-gateway`'s gateway key live in Nakama's DB (sealed, redacted on read,
  but present in a plain export ZIP). Lark avoids that via its wrapper.
- More MCP tools per profile means more prompt tokens per turn on the `Default Bot` profile.
- `aws-mcp` connects without credentials; actual AWS calls need the real `~/.aws` profile.
