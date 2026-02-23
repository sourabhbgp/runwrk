import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

/** Get the .env.local path (lazy for testability with process.chdir) */
function getEnvPath(): string { return join(process.cwd(), ".env.local"); }

export function readEnv(): Record<string, string> {
  const envPath = getEnvPath();
  if (!existsSync(envPath)) return {};
  const content = readFileSync(envPath, "utf-8");
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  }
  return env;
}

export function writeEnv(env: Record<string, string>) {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(getEnvPath(), lines.join("\n") + "\n");
}

export function normalizeKeyInput(raw: string): string {
  let val = raw.trim();
  // Handle: export KEY="value" or KEY=value
  const match = val.match(/^(?:export\s+)?[A-Za-z_]\w*\s*=\s*(.+)$/);
  if (match) val = match[1].trim();
  // Strip surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return val.trim();
}
