import { LMA_INTERNAL_SECRET, PORT } from "./config.ts";

// Never inherit inbound UI passcode or QStash webhook signing keys into the agent subprocess
export function buildAgentChildEnv(
  extra?: Record<string, string>
): Record<string, string | undefined> {
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    LMA_INTERNAL_SECRET,
    LMA_WEB_PORT: String(PORT),
    ...extra,
  };
  delete childEnv.LMA_WEB_PASSWORD;
  delete childEnv.QSTASH_CURRENT_SIGNING_KEY;
  delete childEnv.QSTASH_NEXT_SIGNING_KEY;
  return childEnv;
}
