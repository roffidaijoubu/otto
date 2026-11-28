import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));

export const LMA_INTERNAL_SECRET = crypto.randomBytes(24).toString("hex");

export function getPort(): number {
  return Number(process.env.PORT || 8080);
}

export const PORT = getPort();
export const DIST_DIR = path.join(LIB_DIR, "..", "dist");
export const HOME_DIR = process.env.HOME || process.env.USERPROFILE || os.homedir() || "/home/sprite";
export const LOCAL_BIN = path.join(HOME_DIR, ".local", "bin");

if (!String(process.env.PATH || "").includes(LOCAL_BIN)) {
  process.env.PATH = `${LOCAL_BIN}:${process.env.PATH || ""}`;
}

export const WORK_DIR = process.env.LMA_WORKDIR || HOME_DIR;
export const OMP_BIN =
  process.env.OMP_BIN ||
  (fs.existsSync(path.join(LOCAL_BIN, "omp")) ? path.join(LOCAL_BIN, "omp") : "omp");

// Load optional private runtime config (~/.config/lma/web.env, chmod 600, outside git)
export function loadPrivateEnv(): void {
  const home = process.env.HOME || "/home/sprite";
  const envFile = path.join(home, ".config", "lma", "web.env");
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
    }
  }
}
