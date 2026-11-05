# 2026-11-05 — NAKAMA-004 — Backups and machine migration

## Summary
Enabled Nakama's built-in daily encrypted backup in both runtimes and added a tested
export/restore path for moving an install between machines.

## Why
`README → Deliberate omissions` listed backups as missing. Upstream already implements them
(`apps/server/src/services/scheduled-backup.ts`), gated on one env var, so this is wiring, not
a feature.

## Changes
- `scripts/pm2/ecosystem.nakama.config.js`
  - `NAKAMA_BACKUP_DIR=~/Data/nakama-backups` (sibling of the data root — upstream rejects a
    nested path).
  - `XDG_CACHE_HOME` / `npm_config_cache` / `BUN_INSTALL_CACHE_DIR` pinned to `~/Data/nakama-cache`.
- `base/pvc.yaml` — second PVC `nakama-backups`.
- `base/deployment.yaml` — mount `/nakama/backups`, set `NAKAMA_BACKUP_DIR`.
- `scripts/nakama-backup.mjs` — `export` and `restore` verbs over the product's own endpoints;
  decrypts `NKBK1` archives with `NAKAMA_SECRETS_KEY`. Restore previews before confirming.
- `Makefile` — `local-backups`, `local-backup-check`, `local-restore FILE=...`; `local-restart`
  now re-creates the app instead of `pm2 restart` (which ignores ecosystem edits).

## Verification (two live instances, 4310 + 4311)
| Step | Result |
|---|---|
| Scheduled backup written on boot | ✅ `nakama-2026-11-05T063853Z.zip.enc`, 1.8 MB, 0600, `NKBK1` magic |
| Export endpoint | ✅ 386 files, 1.8 MB |
| Fresh instance setup | ✅ 201 |
| Restore `.zip` into fresh instance | ✅ users + profiles match source |
| Restore `.zip.enc` (decrypt path) | ✅ |
| Teardown of test instance | ✅ data dir removed, live instance untouched |

## Risks
- **Export ZIPs contain `.env` (`NAKAMA_SECRETS_KEY`), `local-auth-token`, `tool-credentials.key`
  in plaintext.** Required for cross-host restore; means a downloaded export is key material.
  Scheduled backups are the only encrypted artifact.
- Backup target is on the same host/volume family as the data. Still not off-machine.
- Restore aborts the HTTP request (server swaps the DB mid-flight). Script treats that as
  success and tells the operator to restart.

## Decisions
- Reused upstream export/import + scheduled backup instead of building a declarative YAML
  apply/reconcile layer. Config-as-code stays out of scope until there is more than one instance.
