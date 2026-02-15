import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

const MEMORY_PATH = join(process.cwd(), ".myteam", "twitter-memory.json");

type ActionEntry = {
  tweetId: string;
  userId: string;
  username: string;
  date: string;
  ourReply?: string;
};

type DayStats = {
  replies: number;
  likes: number;
  posts: number;
  follows: number;
  retweets: number;
};

export type TwitterMemory = {
  repliedTo: ActionEntry[];
  liked: string[];
  retweeted: string[];
  posted: ActionEntry[];
  followed: string[];
  dailyStats: Record<string, DayStats>;
};

const EMPTY_MEMORY: TwitterMemory = {
  repliedTo: [],
  liked: [],
  retweeted: [],
  posted: [],
  followed: [],
  dailyStats: {},
};

function ensureDir() {
  const dir = dirname(MEMORY_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readMemory(): TwitterMemory {
  if (!existsSync(MEMORY_PATH)) return { ...EMPTY_MEMORY };
  try {
    const raw = readFileSync(MEMORY_PATH, "utf-8");
    return { ...EMPTY_MEMORY, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY_MEMORY };
  }
}

function saveMemory(mem: TwitterMemory): void {
  ensureDir();
  writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2) + "\n");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureDayStats(mem: TwitterMemory): DayStats {
  const key = today();
  if (!mem.dailyStats[key]) {
    mem.dailyStats[key] = { replies: 0, likes: 0, posts: 0, follows: 0, retweets: 0 };
  }
  return mem.dailyStats[key];
}

export function logReply(tweetId: string, userId: string, username: string, ourReply: string): void {
  const mem = readMemory();
  mem.repliedTo.push({ tweetId, userId, username, date: new Date().toISOString(), ourReply });
  ensureDayStats(mem).replies++;
  saveMemory(mem);
}

export function logLike(tweetId: string): void {
  const mem = readMemory();
  mem.liked.push(tweetId);
  ensureDayStats(mem).likes++;
  saveMemory(mem);
}

export function logRetweet(tweetId: string): void {
  const mem = readMemory();
  mem.retweeted.push(tweetId);
  ensureDayStats(mem).retweets++;
  saveMemory(mem);
}

export function logPost(tweetId: string, content: string): void {
  const mem = readMemory();
  mem.posted.push({ tweetId, userId: "", username: "", date: new Date().toISOString(), ourReply: content });
  ensureDayStats(mem).posts++;
  saveMemory(mem);
}

export function logFollow(userId: string): void {
  const mem = readMemory();
  mem.followed.push(userId);
  ensureDayStats(mem).follows++;
  saveMemory(mem);
}

export function hasRepliedTo(tweetId: string): boolean {
  return readMemory().repliedTo.some((r) => r.tweetId === tweetId);
}

export function hasLiked(tweetId: string): boolean {
  return readMemory().liked.includes(tweetId);
}

export function getDailyCount(type: keyof DayStats): number {
  const mem = readMemory();
  const stats = mem.dailyStats[today()];
  return stats?.[type] ?? 0;
}

export function getRecentHistory(n: number = 10): string {
  const mem = readMemory();
  const recent = mem.repliedTo.slice(-n);
  if (recent.length === 0) return "No recent engagement history.";
  return recent
    .map((r) => `- Replied to @${r.username}: "${r.ourReply?.slice(0, 80)}..."`)
    .join("\n");
}
