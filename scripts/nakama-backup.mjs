#!/usr/bin/env node
// Export / restore for a native (pm2) Nakama. Thin wrapper over the product's
// own endpoints — no new format, no new schema.
//
//   node scripts/nakama-backup.mjs export  ~/Data/nakama-backups/manual.zip
//   node scripts/nakama-backup.mjs restore ~/Data/nakama-backups/nakama-*.zip.enc
//
// Restore REPLACES live databases (upstream semantics), so it previews first and
// only proceeds when the preview succeeds.
//
// ponytail: assumes a local instance. For the k8s path, port-forward and point
// NAKAMA_URL / NAKAMA_DATA_DIR at it, or run the same two curl calls in the pod.
import { createDecipheriv } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const URL_BASE = process.env.NAKAMA_URL || "http://127.0.0.1:4310";
const DATA = process.env.NAKAMA_DATA_DIR || path.join(os.homedir(), "Data/nakama");

const MAGIC = Buffer.from("NKBK1\n");

async function token() {
  // Escape hatch: a dashboard session token works without touching the DB.
  if (process.env.NAKAMA_TOKEN) return process.env.NAKAMA_TOKEN.trim();
  return (await readFile(path.join(DATA, "local-auth-token"), "utf8")).trim();
}

async function secretsKey() {
  const env = await readFile(path.join(DATA, ".env"), "utf8");
  const line = env.split("\n").find((l) => l.startsWith("NAKAMA_SECRETS_KEY="));
  const encoded = line?.slice("NAKAMA_SECRETS_KEY=".length).trim().replace(/^"|"$/g, "");
  const key = Buffer.from(encoded ?? "", "base64");
  if (key.length !== 32) throw new Error("NAKAMA_SECRETS_KEY must be 32 bytes base64");
  return key;
}

/** Mirrors encryptBackup() in apps/server/src/services/scheduled-backup.ts. */
async function decryptBackup(data) {
  if (!data.subarray(0, MAGIC.length).equals(MAGIC)) return data;
  const key = await secretsKey();
  const nonce = data.subarray(6, 18);
  const tag = data.subarray(18, 34);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(34)), decipher.final()]);
}

async function call(method, pathname, body) {
  const res = await fetch(`${URL_BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${await res.text()}`);
  return res;
}

const [verb, file] = process.argv.slice(2);

if (verb === "export") {
  const out = file || path.join(DATA, "..", "nakama-backups", `manual-${Date.now()}.zip`);
  const zip = Buffer.from(await (await call("GET", "/v1/platform/data/export")).arrayBuffer());
  await writeFile(out, zip, { mode: 0o600 });
  console.log(`exported ${(zip.length / 1024).toFixed(0)} KB -> ${out}`);
} else if (verb === "restore") {
  if (!file) throw new Error("usage: nakama-backup.mjs restore <file.zip|file.zip.enc>");
  const archive = await decryptBackup(await readFile(file));
  const data = archive.toString("base64");
  const preview = await (await call("POST", "/v1/platform/data/import/preview", { data })).json();
  console.log("preview:", JSON.stringify(preview).slice(0, 500));
  try {
    await call("POST", "/v1/platform/data/import/restore", { confirm: true, data });
    console.log(`restored ${file}`);
  } catch (error) {
    // Restore swaps the database out from under the running server, so the
    // connection is closed before a response can be sent. Expected, not fatal.
    if (!/fetch failed|other side closed|ECONNRESET/.test(String(error))) throw error;
    console.log(`restore accepted; server is restarting. Start it again, then check /health.`);
  }
} else {
  throw new Error("usage: nakama-backup.mjs <export|restore> [file]");
}
