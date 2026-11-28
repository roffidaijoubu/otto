import { getPort, LMA_INTERNAL_SECRET } from "./config.ts";

const ALLOWED_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "NODE_ENV",
  "OMP_BIN",
  "LMA_WORKDIR",
  "LMA_PUBLIC_URL",
  "FLY_APP_NAME",
  "FLY_REGION",
  "FLY_MACHINE_ID",
  "CHROME_BIN",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
]);
const ALLOWED_ENV_PREFIXES = ["SPRITE_", "SPRITES_"];
const SENSITIVE_KEY_RE = /(?:PASSWORD|SECRET|SIGNING_KEY|DATABASE_URL|TOKEN|API_KEY)/i;

// Explicit allowlist so inbound UI passcode, DB URLs, and QStash signing keys never leak into agent subprocesses
export function buildAgentChildEnv(
  extra?: Record<string, string>
): Record<string, string | undefined> {
  const childEnv: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue;
    if (SENSITIVE_KEY_RE.test(key)) continue;
    if (
      ALLOWED_ENV_KEYS.has(key) ||
      ALLOWED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      childEnv[key] = val;
    }
  }
  childEnv.LMA_INTERNAL_SECRET = LMA_INTERNAL_SECRET;
  childEnv.LMA_WEB_PORT = String(getPort());
  if (extra) {
    for (const [key, val] of Object.entries(extra)) {
      childEnv[key] = val;
    }
  }
  return childEnv;
}
