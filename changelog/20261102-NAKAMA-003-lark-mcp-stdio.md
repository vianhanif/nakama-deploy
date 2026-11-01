# 2026-11-02 — NAKAMA-003 — Lark MCP server over stdio

## Summary
Documented and verified how to attach a stdio MCP server (Lark/Feishu chat) to a Nakama agent
profile, and added the HOME-independent wrapper the setup needs.

## Findings
- Nakama MCP client supports `http` and `stdio`; stdio config is `{ command, args?, env? }`
  (`apps/server/src/services/mcp-client-manager.ts:472`).
- The child process gets only `HOME, LOGNAME, PATH, SHELL, TERM, USER` from the server env plus
  `config.env` — a shell wrapper cannot rely on the rest of the login environment.
- `HOME` is `~/Data/nakama` (set by the pm2 ecosystem file), so `source "$HOME/.zsh/..."` fails.
  Wrapper resolves the real home via `eval echo "~$(id -un)"`.
- `cwd` becomes the profile soul dir when org+profile are known → paths must be absolute.
- `npx` needs node on PATH; the wrapper prepends `/opt/homebrew/bin`.

## Changes
- `~/.config/nakama/lark-mcp.sh` (0700, outside this repo) — sources
  `~/.zsh/secrets.zsh`, exports `APP_ID`/`APP_SECRET`, execs
  `@larksuiteoapi/lark-mcp@0.5.1 mcp` with the two chat scopes. Logs to stderr only.
- `README.md` — "Adding an MCP server (Lark example)" with the config shape, the two env caveats
  and the `POST /v1/mcp/servers` / `/v1/mcp/servers/test` payloads.

## Verification
Wrapper run with `HOME=~/Data/nakama` and a minimal `PATH`; raw JSON-RPC over stdin:

| Step | Result |
|---|---|
| `initialize` | ✅ `lark-mcp-server 0.5.1` |
| `tools/list` | ✅ `im_v1_chat_list`, `im_v1_message_list` |

## Risks
- The MCP config stores the command path, not the secret — credentials stay in `~/.zsh/secrets.zsh`.
  If the server were ever containerised this wrapper stops working (no host home, no host node).
- `npx -y` fetches the package at connect time; first connect is slower and needs network.
