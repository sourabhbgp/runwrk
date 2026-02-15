import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const MEMORY_PATH = join(process.cwd(), ".myteam", "MEMORY.md");

function ensureDir() {
  const dir = dirname(MEMORY_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readMemory(): string[] {
  if (!existsSync(MEMORY_PATH)) return [];
  const content = readFileSync(MEMORY_PATH, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").filter((l) => l.trim() !== "");
}

export function appendMemory(fact: string): void {
  ensureDir();
  const lines = readMemory();
  lines.push(fact);
  writeFileSync(MEMORY_PATH, lines.join("\n") + "\n");
}

export function removeMemory(query: string): boolean {
  const lines = readMemory();
  const lower = query.toLowerCase();
  const idx = lines.findIndex((l) => l.toLowerCase().includes(lower));
  if (idx === -1) return false;
  lines.splice(idx, 1);
  ensureDir();
  writeFileSync(MEMORY_PATH, lines.length ? lines.join("\n") + "\n" : "");
  return true;
}

export function getMemoryBlock(): string {
  const lines = readMemory();
  if (lines.length === 0) return "";
  const items = lines.map((l) => `- ${l}`).join("\n");
  return `\n## Things to remember\n${items}`;
}
