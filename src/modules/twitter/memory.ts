/**
 * memory.ts — Persistent engagement history stored per-workflow.
 *
 * When a workflowName is provided, reads/writes from `.myteam/workflows/<name>/memory.json`.
 * Otherwise falls back to the legacy `.myteam/twitter-memory.json` path.
 * Blocked accounts are delegated to the global safety state shared across workflows.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { workflowMemoryPath, globalBlockAccount, isGloballyBlocked, readGlobalSafety } from "./workflow";

// --- Legacy path (lazy for testability with process.chdir) ---

/** Get the legacy memory path used when no workflow is specified */
function getLegacyMemoryPath(): string { return join(process.cwd(), ".myteam", "twitter-memory.json"); }

// --- Types ---

/** A single engagement action (reply or original post) */
type ActionEntry = {
  tweetId: string;
  userId: string;
  username: string;
  date: string;
  ourReply?: string;
};

/** Aggregate action counts for a single day */
type DayStats = {
  replies: number;
  likes: number;
  posts: number;
  follows: number;
  retweets: number;
};

/** Record of a tweet the user or Claude chose to skip */
type SkipEntry = {
  username: string;
  snippet: string;
  reason: string;
  date: string;
};

/** Full persistent memory structure written to disk as JSON */
export type TwitterMemory = {
  repliedTo: ActionEntry[];
  liked: string[];
  retweeted: string[];
  posted: ActionEntry[];
  followed: string[];
  dailyStats: Record<string, DayStats>;
  skipped: SkipEntry[];
  blockedAccounts: string[];
  feedback: string[];
};

/** Default empty state — used when no memory file exists or on parse failure */
const EMPTY_MEMORY: TwitterMemory = {
  repliedTo: [],
  liked: [],
  retweeted: [],
  posted: [],
  followed: [],
  dailyStats: {},
  skipped: [],
  blockedAccounts: [],
  feedback: [],
};

// --- Path Resolution ---

/** Resolve the memory file path — workflow-scoped when name provided, legacy otherwise */
function getMemoryPath(workflowName?: string): string {
  return workflowName ? workflowMemoryPath(workflowName) : getLegacyMemoryPath();
}

// --- Persistence Helpers ---

/** Ensure the parent directory exists before writing */
function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Load memory from disk, falling back to empty defaults on any error */
export function readMemory(workflowName?: string): TwitterMemory {
  const path = getMemoryPath(workflowName);
  if (!existsSync(path)) return { ...EMPTY_MEMORY };
  try {
    const raw = readFileSync(path, "utf-8");
    // Spread EMPTY_MEMORY first so any new fields get defaults on old files
    return { ...EMPTY_MEMORY, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_MEMORY };
  }
}

/** Write full memory state to disk as pretty-printed JSON */
export function saveMemory(mem: TwitterMemory, workflowName?: string): void {
  const path = getMemoryPath(workflowName);
  ensureDir(path);
  writeFileSync(path, JSON.stringify(mem, null, 2) + "\n");
}

/** Return today's date as YYYY-MM-DD for daily stat bucketing */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get or create today's DayStats entry in memory */
function ensureDayStats(mem: TwitterMemory): DayStats {
  const key = today();
  if (!mem.dailyStats[key]) {
    mem.dailyStats[key] = { replies: 0, likes: 0, posts: 0, follows: 0, retweets: 0 };
  }
  return mem.dailyStats[key];
}

// --- Action Logging ---

/** Record that we replied to a specific tweet */
export function logReply(
  tweetId: string, userId: string, username: string, ourReply: string,
  workflowName?: string,
): void {
  const mem = readMemory(workflowName);
  mem.repliedTo.push({ tweetId, userId, username, date: new Date().toISOString(), ourReply });
  ensureDayStats(mem).replies++;
  saveMemory(mem, workflowName);
}

/** Record that we liked a tweet */
export function logLike(tweetId: string, workflowName?: string): void {
  const mem = readMemory(workflowName);
  mem.liked.push(tweetId);
  ensureDayStats(mem).likes++;
  saveMemory(mem, workflowName);
}

/** Record that we retweeted a tweet */
export function logRetweet(tweetId: string, workflowName?: string): void {
  const mem = readMemory(workflowName);
  mem.retweeted.push(tweetId);
  ensureDayStats(mem).retweets++;
  saveMemory(mem, workflowName);
}

/** Record an original post we published */
export function logPost(tweetId: string, content: string, workflowName?: string): void {
  const mem = readMemory(workflowName);
  mem.posted.push({ tweetId, userId: "", username: "", date: new Date().toISOString(), ourReply: content });
  ensureDayStats(mem).posts++;
  saveMemory(mem, workflowName);
}

/** Record that we followed a user */
export function logFollow(userId: string, workflowName?: string): void {
  const mem = readMemory(workflowName);
  mem.followed.push(userId);
  ensureDayStats(mem).follows++;
  saveMemory(mem, workflowName);
}

// --- Duplicate Checks ---

/** Check if we've already replied to a given tweet */
export function hasRepliedTo(tweetId: string, workflowName?: string): boolean {
  return readMemory(workflowName).repliedTo.some((r) => r.tweetId === tweetId);
}

/** Check if we've already liked a given tweet */
export function hasLiked(tweetId: string, workflowName?: string): boolean {
  return readMemory(workflowName).liked.includes(tweetId);
}

// --- Stats Queries ---

/** Get the count of a specific action type for today */
export function getDailyCount(type: keyof DayStats, workflowName?: string): number {
  const mem = readMemory(workflowName);
  const stats = mem.dailyStats[today()];
  return stats?.[type] ?? 0;
}

/** Format recent reply history as a readable string for Claude's system prompt */
export function getRecentHistory(n: number = 10, workflowName?: string): string {
  const mem = readMemory(workflowName);
  const recent = mem.repliedTo.slice(-n);
  if (recent.length === 0) return "No recent engagement history.";
  return recent
    .map((r) => `- Replied to @${r.username}: "${r.ourReply?.slice(0, 80)}..."`)
    .join("\n");
}

// --- Skip Tracking & Learning ---

/** Record a skipped tweet with the reason, for learning user preferences.
 *  Caps at 200 entries to prevent unbounded file growth. */
export function logSkip(username: string, snippet: string, reason: string, workflowName?: string): void {
  const mem = readMemory(workflowName);
  mem.skipped.push({ username, snippet: snippet.slice(0, 120), reason, date: new Date().toISOString() });
  // Keep last 200 skip entries to avoid unbounded growth
  if (mem.skipped.length > 200) mem.skipped = mem.skipped.slice(-200);
  saveMemory(mem, workflowName);
}

/** Permanently block an account — delegates to global safety state */
export function blockAccount(username: string): void {
  globalBlockAccount(username);
}

/** Check if a username is on the permanent blocklist (global) */
export function isBlocked(username: string): boolean {
  return isGloballyBlocked(username);
}

/** Summarize recent skip reasons into a ranked list for Claude's system prompt.
 *  Tallies skip reasons from the last N skips and returns the top 8 by frequency. */
export function getSkipPatterns(n: number = 30, workflowName?: string): string {
  const mem = readMemory(workflowName);
  const recent = mem.skipped.slice(-n);
  if (recent.length === 0) return "";

  // Tally skip reasons to find recurring patterns
  const reasonCounts: Record<string, number> = {};
  for (const skip of recent) {
    const key = skip.reason.toLowerCase().trim();
    reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
  }

  // Return top reasons sorted by frequency
  const sorted = Object.entries(reasonCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return sorted.map(([reason, count]) => `- ${reason} (${count}x)`).join("\n");
}

/** Return the full list of blocked account usernames (from global safety) */
export function getBlockedAccounts(): string[] {
  return readGlobalSafety().blockedAccounts;
}

// --- User Feedback / Directives ---

/** Add a timestamped feedback directive that persists across sessions */
export function addFeedback(text: string, workflowName?: string): void {
  const mem = readMemory(workflowName);
  const entry = `[${new Date().toISOString().slice(0, 10)}] ${text}`;
  mem.feedback.push(entry);
  saveMemory(mem, workflowName);
}

/** Return all stored feedback directives */
export function getFeedback(workflowName?: string): string[] {
  return readMemory(workflowName).feedback;
}

/** Remove a specific feedback entry by index */
export function removeFeedback(index: number, workflowName?: string): void {
  const mem = readMemory(workflowName);
  if (index >= 0 && index < mem.feedback.length) {
    mem.feedback.splice(index, 1);
    saveMemory(mem, workflowName);
  }
}
