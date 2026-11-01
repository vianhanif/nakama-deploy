// pm2 config for the native (no-Docker) daily driver.
// Same fork, same pinned ref as src/nakama/Dockerfile — the two runtimes must
// not drift. Started via `make local-up` (see Makefile) or directly:
//
//   pm2 start scripts/pm2/ecosystem.nakama.config.js
//
// Data and secret live outside the repo, so `make local-reset` never touches git.
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const HOME = os.homedir();
const SRC = process.env.NAKAMA_SRC || path.join(HOME, "Documents/personal/github/nakama");
const DATA = process.env.NAKAMA_DATA_DIR || path.join(HOME, "Data/nakama");

// pm2 does NOT support `env_file` in an ecosystem file — it is silently ignored,
// which leaves the process without NAKAMA_SECRETS_KEY while still booting (the
// server only rejects secret writes, so the failure surfaces late, in the UI).
// Parse the file ourselves and merge it into `env`.
function readEnvFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `[nakama] missing env file: ${file}\n` +
        `Run \`make local-init\` to create it (needs NAKAMA_SECRETS_KEY).`,
    );
  }
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Tolerate the two shapes people actually write: KEY=value and KEY="value".
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  if (!out.NAKAMA_SECRETS_KEY) {
    throw new Error(
      `[nakama] NAKAMA_SECRETS_KEY missing from ${file}\n` +
        `Regenerate with: printf 'NAKAMA_SECRETS_KEY=%s\\n' "$(openssl rand -base64 32)"`,
    );
  }
  return out;
}

const secrets = readEnvFile(path.join(DATA, ".env"));

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
      // Parsed from a 0600 file at load time (see readEnvFile above), so the
      // config stays commit-safe and pm2 still gets the variables.
      env: {
        ...secrets,
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
