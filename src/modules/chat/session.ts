import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getMemoryBlock } from "./memory";

const SYSTEM_PROMPT_PATH = join(process.cwd(), ".myteam", "SYSTEM.md");

const DEFAULT_SYSTEM_PROMPT = `You are a focused task assistant. Be concise and direct.
Help the user with their current task. Avoid unnecessary preamble.`;

export type Message = { role: "user" | "assistant"; content: string };

let messages: Message[] = [];

export function addMessage(role: Message["role"], content: string) {
  messages.push({ role, content });
}

export function getMessages(): Message[] {
  return messages;
}

export function reset() {
  messages = [];
}

export function getSystemPrompt(): string {
  let base: string;
  if (existsSync(SYSTEM_PROMPT_PATH)) {
    base = readFileSync(SYSTEM_PROMPT_PATH, "utf-8").trim();
  } else {
    base = DEFAULT_SYSTEM_PROMPT;
  }
  const memory = getMemoryBlock();
  return memory ? `${base}\n${memory}` : base;
}
