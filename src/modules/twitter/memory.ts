/**
 * memory.ts — Persistent engagement history stored in .myteam/twitter-memory.json
 *
 * Tracks all actions (replies, likes, retweets, posts, follows), daily stats,
 * skipped tweets (with reasons), and permanently blocked accounts.
 * Used by the agent to avoid duplicates and learn user preferences over time.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const MEMORY_PATH = join(process.cwd(), ".myteam", "twitter-memory.json");

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
};

// --- Persistence Helpers ---

/** Ensure the .myteam/ directory exists before writing */
function ensureDir() {
  const dir = dirname(MEMORY_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Load memory from disk, falling back to empty defaults on any error */
export function readMemory(): TwitterMemory {
  if (!existsSync(MEMORY_PATH)) return { ...EMPTY_MEMORY };
  try {
    const raw = readFileSync(MEMORY_PATH, "utf-8");
    // Spread EMPTY_MEMORY first so any new fields get defaults on old files
    return { ...EMPTY_MEMORY, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_MEMORY };
  }
}

/** Write full memory state to disk as pretty-printed JSON */
function saveMemory(mem: TwitterMemory): void {
  ensureDir();
  writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2) + "\n");
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
export function logReply(tweetId: string, userId: string, username: string, ourReply: string): void {
  const mem = readMemory();
  mem.repliedTo.push({ tweetId, userId, username, date: new Date().toISOString(), ourReply });
  ensureDayStats(mem).replies++;
  saveMemory(mem);
}

/** Record that we liked a tweet */
export function logLike(tweetId: string): void {
  const mem = readMemory();
  mem.liked.push(tweetId);
  ensureDayStats(mem).likes++;
  saveMemory(mem);
}

/** Record that we retweeted a tweet */
export function logRetweet(tweetId: string): void {
  const mem = readMemory();
  mem.retweeted.push(tweetId);
  ensureDayStats(mem).retweets++;
  saveMemory(mem);
}

/** Record an original post we published */
export function logPost(tweetId: string, content: string): void {
  const mem = readMemory();
  mem.posted.push({ tweetId, userId: "", username: "", date: new Date().toISOString(), ourReply: content });
  ensureDayStats(mem).posts++;
  saveMemory(mem);
}

/** Record that we followed a user */
export function logFollow(userId: string): void {
  const mem = readMemory();
  mem.followed.push(userId);
  ensureDayStats(mem).follows++;
  saveMemory(mem);
}

// --- Duplicate Checks ---

/** Check if we've already replied to a given tweet */
export function hasRepliedTo(tweetId: string): boolean {
  return readMemory().repliedTo.some((r) => r.tweetId === tweetId);
}

/** Check if we've already liked a given tweet */
export function hasLiked(tweetId: string): boolean {
  return readMemory().liked.includes(tweetId);
}

// --- Stats Queries ---

/** Get the count of a specific action type for today */
export function getDailyCount(type: keyof DayStats): number {
  const mem = readMemory();
  const stats = mem.dailyStats[today()];
  return stats?.[type] ?? 0;
}

/** Format recent reply history as a readable string for Claude's system prompt */
export function getRecentHistory(n: number = 10): string {
  const mem = readMemory();
  const recent = mem.repliedTo.slice(-n);
  if (recent.length === 0) return "No recent engagement history.";
  return recent
    .map((r) => `- Replied to @${r.username}: "${r.ourReply?.slice(0, 80)}..."`)
    .join("\n");
}

// --- Skip Tracking & Learning ---

/** Record a skipped tweet with the reason, for learning user preferences.
 *  Caps at 200 entries to prevent unbounded file growth. */
export function logSkip(username: string, snippet: string, reason: string): void {
  const mem = readMemory();
  mem.skipped.push({ username, snippet: snippet.slice(0, 120), reason, date: new Date().toISOString() });
  // Keep last 200 skip entries to avoid unbounded growth
  if (mem.skipped.length > 200) mem.skipped = mem.skipped.slice(-200);
  saveMemory(mem);
}

/** Permanently block an account — tweets from this user will be pre-filtered in future sessions */
export function blockAccount(username: string): void {
  const mem = readMemory();
  const normalized = username.toLowerCase().replace(/^@/, "");
  if (!mem.blockedAccounts.includes(normalized)) {
    mem.blockedAccounts.push(normalized);
    saveMemory(mem);
  }
}

/** Check if a username is on the permanent blocklist */
export function isBlocked(username: string): boolean {
  const mem = readMemory();
  return mem.blockedAccounts.includes(username.toLowerCase().replace(/^@/, ""));
}

/** Summarize recent skip reasons into a ranked list for Claude's system prompt.
 *  Tallies skip reasons from the last N skips and returns the top 8 by frequency. */
export function getSkipPatterns(n: number = 30): string {
  const mem = readMemory();
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

/** Return the full list of blocked account usernames */
export function getBlockedAccounts(): string[] {
  return readMemory().blockedAccounts;
}
