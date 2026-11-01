// pm2 config for the native (no-Docker) daily driver.
// Same fork, same pinned ref as src/nakama/Dockerfile — the two runtimes must
// not drift. Started via `make local-up` (see Makefile) or directly:
//
//   pm2 start scripts/pm2/ecosystem.nakama.config.js
//
// Data and secret live outside the repo, so `make local-reset` never touches git.
const path = require("node:path");
const os = require("node:os");

const HOME = os.homedir();
const SRC = process.env.NAKAMA_SRC || path.join(HOME, "Documents/personal/github/nakama");
const DATA = process.env.NAKAMA_DATA_DIR || path.join(HOME, "Data/nakama");

module.exports = {
  apps: [
    {
      name: "nakama",
      namespace: "nakama",
      // bun runs the built server bundle directly; no interpreter wrapper.
      script: "/opt/homebrew/bin/bun",
      args: "run apps/server/dist/index.js",
      interpreter: "none",
      cwd: SRC,
      // The server refuses to boot without this. Read from a 0600 file rather
      // than inlining it here, so the ecosystem file stays commit-safe.
      env_file: path.join(DATA, ".env"),
      env: {
        NODE_ENV: "production",
        NAKAMA_HOST: "127.0.0.1",
        NAKAMA_PORT: "4310",
        PORT: "4310",
        NAKAMA_CONFIG_DIR: DATA,
        DATABASE_URL: `file:${DATA}/sqlite/nakama.sqlite`,
        BUN_INSTALL_BIN: `${DATA}/.bun/bin`,
        BUN_INSTALL_GLOBAL_DIR: `${DATA}/.bun/install/global`,
        HOME: DATA,
      },
      autorestart: true,
      // Bun exits non-zero while the SQLite file is locked by a previous run.
      // A short backoff avoids a restart storm on a stale lock.
      restart_delay: 2000,
      max_restarts: 20,
      kill_timeout: 5000,
      exp_backoff_restart_delay: 200,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      out_file: path.join(DATA, "logs/out.log"),
      error_file: path.join(DATA, "logs/error.log"),
      merge_logs: true,
    },
  ],
};
