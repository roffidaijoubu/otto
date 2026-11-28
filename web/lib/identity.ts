import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";
import { HOME_DIR } from "./config.ts";

const IDENTITY_LIB_DIR = path.dirname(fileURLToPath(import.meta.url));

export function readSetupIdentity(): { creatorName: string; timezone: string } {
  const memPath = path.join(HOME_DIR, ".omp", "agent", "MEMORY.md");
  if (!fs.existsSync(memPath)) return { creatorName: "", timezone: "" };
  const md = fs.readFileSync(memPath, "utf8");
  const cleanVal = (raw: string): string => {
    const cleaned = raw.replace(/[*`]/g, "").trim();
    if (!cleaned || /^\(not set|\(pending/i.test(cleaned)) return "";
    return cleaned;
  };
  const nameMatch = md.match(/-\s*\*\*Name\s*\/\s*Persona:\*\*\s*(.+)/i);
  const tzMatch = md.match(/-\s*\*\*Timezone:\*\*\s*(.+)/i);
  return {
    creatorName: nameMatch ? cleanVal(nameMatch[1]) : "",
    timezone: tzMatch ? cleanVal(tzMatch[1]) : "",
  };
}

export function writeIdentityToMemoryMd(creatorName: string, timezone: string): void {
  const memDir = path.join(HOME_DIR, ".omp", "agent");
  const memPath = path.join(memDir, "MEMORY.md");
  fs.mkdirSync(memDir, { recursive: true });
  let md = "";
  if (fs.existsSync(memPath)) {
    md = fs.readFileSync(memPath, "utf8");
  } else {
    const examplePath = path.resolve(IDENTITY_LIB_DIR, "..", "..", "agent", "MEMORY.md.example");
    md = fs.existsSync(examplePath)
      ? fs.readFileSync(examplePath, "utf8")
      : `# Talent Dossier\n\n## Profile\n- **Name / Persona:** (not set)\n- **Timezone:** (not set)\n`;
  }
  const safeName = creatorName.replace(/[\r\n]+/g, " ").trim();
  const safeTz = timezone.replace(/[\r\n]+/g, " ").trim();
  if (safeName) {
    if (/-\s*\*\*Name\s*\/\s*Persona:\*\*.*/i.test(md)) {
      md = md.replace(/-\s*\*\*Name\s*\/\s*Persona:\*\*.*/i, `- **Name / Persona:** ${safeName}`);
    } else {
      md = `- **Name / Persona:** ${safeName}\n` + md;
    }
  }
  if (safeTz) {
    if (/-\s*\*\*Timezone:\*\*.*/i.test(md)) {
      md = md.replace(/-\s*\*\*Timezone:\*\*.*/i, `- **Timezone:** ${safeTz}`);
    } else if (/-\s*\*\*Name\s*\/\s*Persona:\*\*.*/i.test(md)) {
      md = md.replace(/(-\s*\*\*Name\s*\/\s*Persona:\*\*.*)/i, `$1\n- **Timezone:** ${safeTz}`);
    } else {
      md = `- **Timezone:** ${safeTz}\n` + md;
    }
  }
  const tmp = `${memPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, md, "utf8");
  fs.renameSync(tmp, memPath);
}
